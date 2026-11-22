import type { Rpc } from "@/lib/db/rpc";
import { computeFeeCents } from "@/lib/money/fees";
import type { PaymentProvider } from "@/lib/payments/provider";

export type CheckoutResult =
  | { kind: "redirect"; url: string; bookingId: string }
  | { kind: "full" };

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : data ? [data as T] : [];
}

/**
 * Starts a checkout for the signed-in member. `memberRpc` runs as that member and `serviceRpc` as the server.
 * A member who already has a live checkout on the date goes back to it instead of starting a second one.
 */
export async function startCheckout(options: {
  memberRpc: Rpc;
  serviceRpc: Rpc;
  provider: PaymentProvider;
  sessionId: string;
  memberEmail: string;
  subaccountCode: string;
  callbackUrl: (bookingId: string) => string;
}): Promise<CheckoutResult> {
  const resume = await options.memberRpc("get_resume_checkout", { p_session_id: options.sessionId });
  if (resume.error) throw new Error(resume.error.message);
  if (typeof resume.data === "string" && resume.data) {
    return { kind: "redirect", url: resume.data, bookingId: "" };
  }

  const taken = await options.memberRpc("take_spot", { p_session_id: options.sessionId });
  if (taken.error) throw new Error(taken.error.message);
  const spot = rows<{ booking_id: string | null; outcome: string; price_cents: number; fee_bps: number }>(taken.data)[0];
  if (!spot || spot.outcome === "full" || !spot.booking_id) return { kind: "full" };

  // The price and fee rate are the ones recorded when the spot was taken.
  const feeCents = computeFeeCents(spot.price_cents, spot.fee_bps);
  const bookingId = spot.booking_id;
  try {
    const created = await options.serviceRpc("create_payment", { p_booking_id: bookingId, p_fee_cents: feeCents });
    if (created.error) throw new Error(created.error.message);
    const init = await options.provider.initialize({
      reference: bookingId,
      amountCents: spot.price_cents,
      email: options.memberEmail,
      subaccountCode: options.subaccountCode,
      feeCents,
      callbackUrl: options.callbackUrl(bookingId),
    });
    const stored = await options.serviceRpc("set_checkout_url", { p_booking_id: bookingId, p_url: init.authorizationUrl });
    if (stored.error) throw new Error(stored.error.message);
    return { kind: "redirect", url: init.authorizationUrl, bookingId };
  } catch (error) {
    // The member cannot pay, so the spot goes back at once instead of waiting out the hold.
    await options.serviceRpc("release_booking", { p_booking_id: bookingId });
    throw error;
  }
}
