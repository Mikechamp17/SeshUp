import type { Rpc } from "@/lib/db/rpc";
import { ProviderError, type PaymentProvider } from "@/lib/payments/provider";

type Claimed = { refund_id: string; reference: string; amount_cents: number; was_submitting: boolean };

/**
 * Sends due refunds to the provider. Safe to run twice at once: rows are claimed with a lease,
 * and a payment can only ever have one refund. A row a crashed run left half done is checked
 * against the provider first, so the money is never refunded twice.
 */
export async function processDueRefunds(options: { rpc: Rpc; provider: PaymentProvider; limit?: number }) {
  const { rpc, provider } = options;
  const claimed = await rpc("claim_due_refunds", { p_limit: options.limit ?? 20 });
  if (claimed.error) throw new Error(claimed.error.message);

  let submitted = 0;
  let processed = 0;
  let failed = 0;
  for (const row of (claimed.data ?? []) as Claimed[]) {
    try {
      let outcome: { refundId: string; status: "pending" | "processed" } | null = null;
      if (row.was_submitting) {
        const existing = (await provider.findRefunds(row.reference)).find((r) => r.status !== "failed");
        if (existing) {
          outcome = { refundId: existing.refundId, status: existing.status === "processed" ? "processed" : "pending" };
        }
      }
      outcome ??= await provider.refund({ reference: row.reference, amountCents: row.amount_cents });

      const done = await rpc("complete_refund", {
        p_refund_id: row.refund_id,
        p_provider_refund_id: outcome.refundId,
        p_processed: outcome.status === "processed",
      });
      if (done.error) throw new Error(done.error.message);
      if (outcome.status === "processed") processed++;
      else submitted++;
    } catch (e) {
      failed++;
      const message = e instanceof ProviderError || e instanceof Error ? e.message : "refund failed";
      await rpc("fail_refund", { p_refund_id: row.refund_id, p_error: message });
    }
  }
  return { claimed: (claimed.data as unknown[] | null)?.length ?? 0, submitted, processed, failed };
}
