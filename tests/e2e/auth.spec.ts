// Auth end-to-end tests, run on the phone viewport set in playwright.config.ts.
//
// Every test here needs the local Supabase stack (supabase start, with the
// migrations applied) and the app running against it. They were written to run
// in CI and have not been run in the sandbox that produced them.
//
// Environment:
//   E2E_BASE_URL                 app URL (default http://localhost:3000)
//   NEXT_PUBLIC_SUPABASE_URL     local API URL (default http://127.0.0.1:54321)
//   SUPABASE_SERVICE_ROLE_KEY    local service-role key, used only to seed users
//   MAIL_API_URL                 local mail catcher (default http://127.0.0.1:54324)
//
// Needs the Supabase stack only:
//   sign-up then return to the chosen path, duplicate email, unsafe next value,
//   reset flow, invited owner flow.
// Needs the Supabase stack and pages from other work (they must apply the route
// guards on /admin/<slug> and /operator; only the redirect is asserted):
//   non-staff redirected away from /admin/x, non-operator redirected away from
//   /operator.
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const mailApi = process.env.MAIL_API_URL ?? "http://127.0.0.1:54324";

test.skip(!serviceKey, "SUPABASE_SERVICE_ROLE_KEY is not set, so the local Supabase stack is not available");

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const password = "correct-horse-battery";

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

async function signUpThroughForm(page: Page, name: string, email: string, path: string) {
  await page.goto(path);
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
}

// Reads the newest message for an address from the local mail catcher (Mailpit).
async function latestEmailBody(email: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const list = await fetch(`${mailApi}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    if (list.ok) {
      const found = (await list.json()) as { messages?: Array<{ ID: string }> };
      const newest = found.messages?.[0];
      if (newest) {
        const message = await fetch(`${mailApi}/api/v1/message/${newest.ID}`);
        const body = (await message.json()) as { Text?: string; HTML?: string };
        return `${body.Text ?? ""}\n${body.HTML ?? ""}`;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No email arrived for ${email}`);
}

test("sign-up returns the member to the chosen path and creates a profile", async ({ page }) => {
  const email = uniqueEmail("member");
  await signUpThroughForm(page, "Test Member", email, "/auth/sign-up?next=/class/abc%3Fx%3D1");
  await expect(page).toHaveURL(/\/class\/abc\?x=1$/);

  const { data } = await admin.from("profiles").select("name").eq("email", email);
  expect(data).toEqual([{ name: "Test Member" }]);
});

test("sign-up with an email already in use shows an error and creates no second profile", async ({ page }) => {
  const email = uniqueEmail("dupe");
  await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: "First" } });

  await signUpThroughForm(page, "Second", email, "/auth/sign-up");
  await expect(page.getByRole("alert").filter({ hasText: "already exists" })).toBeVisible();

  const { data } = await admin.from("profiles").select("id").eq("email", email);
  expect(data).toHaveLength(1);
});

test("unsafe next values land on the default page", async ({ page }) => {
  for (const unsafe of ["//evil.example", "https://evil.example"]) {
    const email = uniqueEmail("unsafe");
    await signUpThroughForm(page, "Unsafe Next", email, `/auth/sign-up?next=${encodeURIComponent(unsafe)}`);
    await expect(page).toHaveURL(new RegExp(`^${page.url().split("/").slice(0, 3).join("/")}/$`));
    await page.context().clearCookies();
  }
});

test("a member who is not staff is redirected away from /admin/x (needs the admin page guard)", async ({ page }) => {
  await signUpThroughForm(page, "Plain Member", uniqueEmail("nonstaff"), "/auth/sign-up");
  await page.goto("/admin/x");
  await expect(page).not.toHaveURL(/\/admin\/x/);
});

test("a user who is not an operator is redirected away from /operator (needs the operator page guard)", async ({ page }) => {
  await signUpThroughForm(page, "Plain Member", uniqueEmail("nonop"), "/auth/sign-up");
  await page.goto("/operator");
  await expect(page).not.toHaveURL(/\/operator/);
});

test("password reset: emailed link lets the user set a new password and sign in with it", async ({ page }) => {
  const email = uniqueEmail("reset");
  await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: "Resetter" } });

  await page.goto("/auth/reset-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("sent a link");

  const body = await latestEmailBody(email);
  const link = body.match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]*/)?.[0];
  expect(link).toBeTruthy();
  await page.goto(link!.replace(/&amp;/g, "&"));
  await expect(page).toHaveURL(/\/auth\/set-password/);

  const newPassword = "a-brand-new-password";
  await page.getByLabel("New password").fill(newPassword);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.context().clearCookies();
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(newPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("an invited owner follows the invite link, sets a password, and lands on the gym admin page", async ({ page }) => {
  const slug = `invite-gym-${Date.now()}`;
  const email = uniqueEmail("owner");
  const { data: gym } = await admin.from("gyms").insert({ name: "Invite Gym", slug }).select("id").single();
  expect(gym).toBeTruthy();

  const { data: link, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { data: { name: "Gym Owner" } },
  });
  expect(error).toBeNull();
  if (!gym || !link?.user || !link.properties) throw new Error("Could not seed the invited owner");
  await admin.from("gym_staff").insert({ gym_id: gym.id, user_id: link.user.id, role: "owner" });

  // The invite email carries this token; the callback accepts it directly.
  const afterPassword = encodeURIComponent(`/admin/${slug}`);
  const next = encodeURIComponent(`/auth/set-password?next=${afterPassword}`);
  await page.goto(
    `/auth/callback?token_hash=${link.properties.hashed_token}&type=invite&next=${next}`,
  );
  await expect(page).toHaveURL(/\/auth\/set-password/);

  await page.getByLabel("New password").fill(password);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${slug}$`));
});
