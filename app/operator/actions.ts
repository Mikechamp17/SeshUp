"use server";

import { redirect } from "next/navigation";
import { formText as field, withParams } from "@/lib/http/url";
import { connectPayments, createGym, inviteOwner, OperatorAuthError, requestOperatorContext } from "@/lib/operator/gyms";

// Every action runs its operator check first, inside the logic function, before
// the service-role client is built. Page guards only decide what to show.

// Runs the logic and returns where to go next. redirect() throws, so it is
// called outside the try block.
async function run(go: () => Promise<string>): Promise<never> {
  let target: string;
  try {
    target = await go();
  } catch (e) {
    if (e instanceof OperatorAuthError) redirect("/");
    throw e;
  }
  redirect(target);
}

export async function createGymAction(formData: FormData): Promise<void> {
  await run(async () => {
    const ctx = await requestOperatorContext();
    const result = await createGym(ctx, {
      name: field(formData, "name"),
      slug: field(formData, "slug"),
      feePercent: field(formData, "feePercent"),
      timezone: field(formData, "timezone"),
    });
    if (!result.ok) return withParams("/operator/gyms/new", { error: result.error });
    return withParams(`/operator/gyms/${result.gymId}`, { message: "Gym created." });
  });
}

export async function inviteOwnerAction(formData: FormData): Promise<void> {
  const gymId = field(formData, "gymId");
  await run(async () => {
    const ctx = await requestOperatorContext();
    const result = await inviteOwner(ctx, { gymId, email: field(formData, "email") });
    const back = `/operator/gyms/${encodeURIComponent(gymId)}`;
    if (!result.ok) return withParams(back, { error: result.error });
    return withParams(back, {
      message: result.kind === "invited" ? "Invite sent." : "Added as an owner. They have been emailed a sign-in link.",
    });
  });
}

export async function connectPaymentsAction(formData: FormData): Promise<void> {
  const gymId = field(formData, "gymId");
  await run(async () => {
    const ctx = await requestOperatorContext();
    // Bank details are read here and passed on. They never enter a redirect.
    const result = await connectPayments(ctx, {
      gymId,
      bankCode: field(formData, "bankCode"),
      accountNumber: field(formData, "accountNumber"),
    });
    const back = `/operator/gyms/${encodeURIComponent(gymId)}`;
    if (!result.ok) return withParams(back, { error: result.error });
    return withParams(back, { message: "Payment account connected." });
  });
}
