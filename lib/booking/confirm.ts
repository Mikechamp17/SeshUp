import type { Rpc } from "@/lib/db/rpc";
import type { PaymentProvider } from "@/lib/payments/provider";

export type ConfirmOutcome =
  | "confirmed"
  | "refunded_late"
  | "failed"
  | "pending"
  | "already_processed"
  | "mismatch";

export type ConfirmResult = { outcome: ConfirmOutcome; bookingStatus: string };

/**
 * Asks the provider what happened to a payment, then lets the database apply it.
 * Safe to call from the webhook, the return page, and the re-check job at the same time.
 * Money is never confirmed from a redirect or a webhook body alone.
 */
export async function confirmByReference(options: {
  rpc: Rpc;
  provider: PaymentProvider;
  reference: string;
}): Promise<ConfirmResult> {
  const verified = await options.provider.verify(options.reference);
  const { data, error } = await options.rpc("confirm_payment", {
    p_reference: options.reference,
    p_status: verified.status,
    p_amount_cents: verified.amountCents,
    p_currency: verified.currency,
    p_subaccount_code: verified.subaccountCode ?? null,
    p_charge_cents: verified.transactionChargeCents ?? null,
  });
  if (error) throw new Error(error.message);
  const row = data as { outcome: ConfirmOutcome; booking_status: string };
  return { outcome: row.outcome, bookingStatus: row.booking_status };
}

/** Checks payments that may have been paid without a webhook reaching us. */
export async function reverifyPendingPayments(options: { rpc: Rpc; provider: PaymentProvider }) {
  const { data, error } = await options.rpc("pending_payments_to_check");
  if (error) throw new Error(error.message);
  const references = ((data ?? []) as { provider_reference: string }[]).map((r) => r.provider_reference);
  const outcomes: Record<string, number> = {};
  for (const reference of references) {
    try {
      const { outcome } = await confirmByReference({ ...options, reference });
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    } catch {
      outcomes.error = (outcomes.error ?? 0) + 1;
    }
  }
  return { checked: references.length, outcomes };
}
