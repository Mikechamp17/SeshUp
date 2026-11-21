"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/roles";
import { startCheckout, type CheckoutResult } from "@/lib/booking/checkout";
import { getPaymentProvider } from "@/lib/payments/factory";
import { siteUrl } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const MESSAGES: Record<string, string> = {
  already_booked: "You already have a spot, or a payment in progress, for this class.",
  session_started: "This class has already started.",
  session_cancelled: "This class has been cancelled.",
  outside_window: "Booking opens 2 weeks before the class.",
  gym_not_connected: "Booking is not open for this gym yet.",
};

function friendly(message: string): string {
  for (const [code, text] of Object.entries(MESSAGES)) {
    if (message.includes(code)) return text;
  }
  return "Something went wrong starting your payment. Please try again.";
}

function back(slug: string, sessionId: string, params: Record<string, string>): never {
  redirect(`/g/${slug}/classes/${sessionId}?${new URLSearchParams(params).toString()}`);
}

/** Takes a spot and sends the member to pay. A member already paying goes back to the same checkout. */
export async function bookClass(formData: FormData): Promise<void> {
  const slug = String(formData.get("slug") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  const user = await requireUser(`/g/${slug}/classes/${sessionId}`);

  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: session } = await admin
    .from("class_sessions")
    .select("gym_id, gyms!inner(slug, paystack_subaccount_code)")
    .eq("id", sessionId)
    .single();
  const gym = (Array.isArray(session?.gyms) ? session?.gyms[0] : session?.gyms) as
    | { slug: string; paystack_subaccount_code: string | null }
    | undefined;
  if (!session || !gym || gym.slug !== slug || !gym.paystack_subaccount_code) {
    back(slug, sessionId, { error: MESSAGES.gym_not_connected });
  }

  const base = await siteUrl();
  let result: CheckoutResult;
  try {
    result = await startCheckout({
      memberRpc: (fn, args) => supabase.rpc(fn, args),
      serviceRpc: (fn, args) => admin.rpc(fn, args),
      provider: getPaymentProvider(),
      sessionId,
      memberEmail: user.email ?? "",
      subaccountCode: gym.paystack_subaccount_code,
      callbackUrl: (id) => `${base}/g/${slug}/checkout/return?ref=${id}`,
    });
  } catch (e) {
    back(slug, sessionId, { error: friendly(e instanceof Error ? e.message : "") });
  }

  if (result.kind === "full") back(slug, sessionId, { message: "This class just filled up." });
  redirect(result.url);
}
