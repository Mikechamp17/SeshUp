import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentUser, isOperator } from "@/lib/auth/roles";
import type { Rpc } from "@/lib/db/rpc";
import type { EmailData } from "@/lib/email/templates";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPaymentProvider } from "@/lib/payments/factory";
import { ProviderError, type PaymentProvider } from "@/lib/payments/provider";

// Operator logic. Every exported function checks the caller is an operator
// first and only then touches the store, the payment provider, or the
// service-role client. The store and provider are lazy so a failed check
// never builds them.

export const DEFAULT_TIMEZONE = "Africa/Johannesburg";

export class OperatorAuthError extends Error {
  constructor() {
    super("Only the platform operator can do this.");
    this.name = "OperatorAuthError";
  }
}

export type GymRow = {
  id: string;
  name: string;
  slug: string;
  fee_bps: number;
  timezone: string;
  paystack_subaccount_code: string | null;
};

export type AuthAccount = { userId: string; confirmed: boolean };

export type Problem = {
  kind: "gym_not_connected" | "refund_failed" | "email_dead";
  gym_id: string | null;
  gym_name: string | null;
  ref_id: string;
  attempts: number;
  detail: string;
};

export class StoreError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "StoreError";
    this.code = code;
  }
}

/** Table writes the operator logic needs. The supabase version is below. */
export interface OperatorStore {
  insertGym(input: { name: string; slug: string; feeBps: number; timezone: string }): Promise<{ id: string }>;
  findGym(id: string): Promise<GymRow | null>;
  listGyms(): Promise<GymRow[]>;
  setSubaccountCode(gymId: string, code: string): Promise<void>;
  addOwner(gymId: string, userId: string): Promise<void>;
  enqueueEmail(template: "owner_invite" | "owner_added", recipient: string, data: EmailData): Promise<void>;
}

/** Account lookup and invite creation, which need the Supabase auth admin API. */
export interface OperatorAuthAdmin {
  createInvite(email: string, redirectTo: string): Promise<{ userId: string; hashedToken: string }>;
}

export type OperatorContext = {
  assertOperator: () => Promise<void>;
  store: () => OperatorStore;
  authAdmin: () => OperatorAuthAdmin;
  rpc: () => Rpc;
  provider: () => PaymentProvider;
  appUrl: () => Promise<string>;
};

export type ActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

// ---------------------------------------------------------------------------
// Validation

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** Percentage text such as "7.5" to basis points. Null when outside 0 to 100 or not a number. */
export function percentToBps(input: string | number): number | null {
  const text = String(input).trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return null;
  const percent = Number(text);
  if (percent < 0 || percent > 100) return null;
  return Math.round(percent * 100);
}

function validTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Logic

export async function createGym(
  ctx: OperatorContext,
  input: { name: string; slug: string; feePercent: string; timezone?: string },
): Promise<ActionResult<{ gymId: string }>> {
  await ctx.assertOperator();

  const name = input.name.trim();
  const slug = input.slug.trim();
  const timezone = input.timezone?.trim() || DEFAULT_TIMEZONE;
  if (!name || name.length > 100) return fail("Enter a gym name of up to 100 characters.");
  if (!SLUG.test(slug) || slug.length > 60) {
    return fail("The link name can use lowercase letters, digits, and hyphens only, and must start with a letter or digit.");
  }
  const feeBps = percentToBps(input.feePercent);
  if (feeBps === null) return fail("The fee must be a percentage from 0 to 100, with at most two decimals.");
  if (!validTimezone(timezone)) return fail("That time zone is not recognised.");

  try {
    const { id } = await ctx.store().insertGym({ name, slug, feeBps, timezone });
    return { ok: true, gymId: id };
  } catch (e) {
    if (e instanceof StoreError && e.code === "23505") {
      return fail("A gym with that link name already exists. Choose another.");
    }
    throw e;
  }
}

function inviteLink(appUrl: string, hashedToken: string, slug: string): string {
  const next = encodeURIComponent(`/auth/set-password?next=/admin/${slug}`);
  return `${appUrl}/auth/callback?token_hash=${encodeURIComponent(hashedToken)}&type=invite&next=${next}`;
}

/**
 * The gym comes from the id the operator is viewing and is checked to exist.
 * Nothing in the emailed link names a gym: the owner row is written here, keyed
 * to the user id.
 */
export async function inviteOwner(
  ctx: OperatorContext,
  input: { gymId: string; email: string },
): Promise<ActionResult<{ kind: "invited" | "added" }>> {
  await ctx.assertOperator();

  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email)) return fail("Enter a valid email address.");
  if (!isUuid(input.gymId)) return fail("That gym does not exist.");

  const store = ctx.store();
  const gym = await store.findGym(input.gymId);
  if (!gym) return fail("That gym does not exist.");

  const appUrl = await ctx.appUrl();
  const base = { gymName: gym.name, className: "", startsAt: new Date().toISOString(), timezone: gym.timezone };

  const existing = await findAccount(ctx.rpc(), email);
  if (existing) {
    if (!existing.confirmed) {
      return fail("That email has an account that has not confirmed its email yet. Ask the person to confirm it first, then invite them again.");
    }
    await store.addOwner(gym.id, existing.userId);
    await store.enqueueEmail("owner_added", email, {
      ...base,
      signInUrl: `${appUrl}/auth/sign-in?next=${encodeURIComponent(`/admin/${gym.slug}`)}`,
    });
    return { ok: true, kind: "added" };
  }

  const { userId, hashedToken } = await ctx.authAdmin().createInvite(email, `${appUrl}/auth/callback`);
  await store.addOwner(gym.id, userId);
  await store.enqueueEmail("owner_invite", email, { ...base, inviteUrl: inviteLink(appUrl, hashedToken, gym.slug) });
  return { ok: true, kind: "invited" };
}

async function findAccount(rpc: Rpc, email: string): Promise<AuthAccount | null> {
  const { data, error } = await rpc("operator_find_user", { p_email: email });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { user_id: string; confirmed: boolean }[];
  return rows[0] ? { userId: rows[0].user_id, confirmed: rows[0].confirmed } : null;
}

/**
 * Bank details go to the provider and nowhere else: they are not stored, not
 * logged, and never appear in a message. Only the returned code is kept.
 */
export async function connectPayments(
  ctx: OperatorContext,
  input: { gymId: string; bankCode: string; accountNumber: string },
): Promise<ActionResult> {
  await ctx.assertOperator();

  const bankCode = input.bankCode.trim();
  const accountNumber = input.accountNumber.replace(/\s+/g, "");
  if (!isUuid(input.gymId)) return fail("That gym does not exist.");
  if (!/^[A-Za-z0-9-]{1,20}$/.test(bankCode)) return fail("Enter the bank code.");
  if (!/^\d{5,20}$/.test(accountNumber)) return fail("Enter the account number using digits only.");

  const store = ctx.store();
  const gym = await store.findGym(input.gymId);
  if (!gym) return fail("That gym does not exist.");
  if (gym.paystack_subaccount_code) return fail("This gym already has a payment account connected.");

  let code: string;
  try {
    ({ code } = await ctx.provider().createSubaccount({ businessName: gym.name, bankCode, accountNumber }));
  } catch (e) {
    // The provider's own message is dropped so nothing from the request can leak into the page.
    const retryable = e instanceof ProviderError && e.retryable;
    return fail(
      retryable
        ? "The payment provider is not responding. Try again in a moment."
        : "The payment provider could not create the account. Check the bank details and try again.",
    );
  }
  await store.setSubaccountCode(gym.id, code);
  return { ok: true };
}

export async function listGyms(ctx: OperatorContext): Promise<GymRow[]> {
  await ctx.assertOperator();
  return ctx.store().listGyms();
}

export async function getGym(ctx: OperatorContext, gymId: string): Promise<GymRow | null> {
  await ctx.assertOperator();
  if (!isUuid(gymId)) return null;
  return ctx.store().findGym(gymId);
}

export async function listProblems(ctx: OperatorContext): Promise<Problem[]> {
  await ctx.assertOperator();
  const { data, error } = await ctx.rpc()("operator_problems");
  if (error) throw new Error(error.message);
  return (data ?? []) as Problem[];
}

// ---------------------------------------------------------------------------
// Supabase implementations (service-role client). Built only after the check passes.

const GYM_COLUMNS = "id, name, slug, fee_bps, timezone, paystack_subaccount_code";

export function createSupabaseStore(admin: SupabaseClient): OperatorStore {
  const check = (error: { message: string; code?: string } | null) => {
    if (error) throw new StoreError(error.message, error.code);
  };
  return {
    async insertGym({ name, slug, feeBps, timezone }) {
      const { data, error } = await admin
        .from("gyms")
        .insert({ name, slug, fee_bps: feeBps, timezone })
        .select("id")
        .single();
      check(error);
      return { id: (data as { id: string }).id };
    },
    async findGym(id) {
      const { data, error } = await admin.from("gyms").select(GYM_COLUMNS).eq("id", id).maybeSingle();
      check(error);
      return (data as GymRow | null) ?? null;
    },
    async listGyms() {
      const { data, error } = await admin.from("gyms").select(GYM_COLUMNS).order("name");
      check(error);
      return (data ?? []) as GymRow[];
    },
    async setSubaccountCode(gymId, code) {
      const { error } = await admin.from("gyms").update({ paystack_subaccount_code: code }).eq("id", gymId);
      check(error);
    },
    async addOwner(gymId, userId) {
      const { error } = await admin.from("gym_staff").insert({ gym_id: gymId, user_id: userId, role: "owner" });
      check(error);
    },
    async enqueueEmail(template, recipient, data) {
      const { error } = await admin.from("email_outbox").insert({ template, recipient, data });
      check(error);
    },
  };
}

export function createSupabaseAuthAdmin(admin: SupabaseClient): OperatorAuthAdmin {
  return {
    async createInvite(email, redirectTo) {
      // Generates the invite without sending Supabase's own email, whose link
      // carries its token in the URL fragment where the server cannot read it.
      const { data, error } = await admin.auth.admin.generateLink({ type: "invite", email, options: { redirectTo } });
      if (error || !data?.user || !data.properties?.hashed_token) {
        throw new Error("Could not create the invite.");
      }
      return { userId: data.user.id, hashedToken: data.properties.hashed_token };
    },
  };
}

/** The operator check used by pages and actions: the caller's own session, then a platform_admins row. */
export function operatorCheck(supabase: SupabaseClient): () => Promise<void> {
  return async () => {
    const user = await getCurrentUser(supabase);
    if (!user || !(await isOperator(supabase))) throw new OperatorAuthError();
  };
}

async function requestSiteUrl(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const { headers } = await import("next/headers");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** The real context for a request. Nothing here runs until the operator check has passed. */
export async function requestOperatorContext(provider?: PaymentProvider): Promise<OperatorContext> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  let admin: SupabaseClient | undefined;
  const getAdmin = () => {
    if (!admin) {
      admin = createAdminClient();
    }
    return admin;
  };
  return {
    assertOperator: operatorCheck(supabase),
    store: () => createSupabaseStore(getAdmin()),
    authAdmin: () => createSupabaseAuthAdmin(getAdmin()),
    rpc: () => (fn, args) => getAdmin().rpc(fn, args),
    provider: () => getPaymentProvider(provider),
    appUrl: requestSiteUrl,
  };
}
