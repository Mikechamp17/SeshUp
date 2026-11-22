import type { Rpc } from "@/lib/db/rpc";
import { confirmByReference } from "@/lib/booking/confirm";
import type { PaymentProvider } from "@/lib/payments/provider";

export type WebhookResult = { status: number; body: { received?: boolean; error?: string } };

/**
 * Handles a provider webhook. The body is checked against its signature before anything is read from it.
 * Retried deliveries are safe: confirming is idempotent.
 */
export async function handlePaymentWebhook(options: {
  rawBody: string;
  signature: string | null;
  provider: PaymentProvider;
  rpc: Rpc;
}): Promise<WebhookResult> {
  if (!options.provider.verifyWebhook(options.rawBody, options.signature)) {
    return { status: 401, body: { error: "invalid signature" } };
  }
  const event = options.provider.parseWebhook(options.rawBody);

  await options.rpc("record_payment_event", {
    p_event_key: event.eventKey,
    p_reference: event.reference ?? "",
    p_payload: JSON.parse(options.rawBody),
  });

  if (event.type === "charge.success" && event.reference) {
    try {
      await confirmByReference({ rpc: options.rpc, provider: options.provider, reference: event.reference });
    } catch {
      // A 5xx makes the provider retry, and confirming again is safe.
      return { status: 500, body: { error: "could not confirm" } };
    }
  }
  if ((event.type === "refund.processed" || event.type === "refund.failed") && event.reference) {
    const settled = await options.rpc("settle_refund_by_reference", {
      p_reference: event.reference,
      p_outcome: event.type === "refund.processed" ? "processed" : "failed",
    });
    if (settled.error) return { status: 500, body: { error: "could not settle refund" } };
  }
  return { status: 200, body: { received: true } };
}
