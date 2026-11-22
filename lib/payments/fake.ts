import { createHmac } from "node:crypto";
import {
  ProviderError,
  type PaymentProvider,
  type RefundRecord,
  type VerifyResult,
  type WebhookEvent,
} from "./provider";

export const FAKE_WEBHOOK_SECRET = "fake_webhook_secret";

export type FakeVerifyOutcome = "success" | "failed" | "pending";
export type FakeRefundOutcome = "success" | "error" | "duplicate";

type Payment = {
  reference: string;
  amountCents: number;
  subaccountCode: string;
  feeCents: number;
};

export type FakeProvider = PaymentProvider & {
  calls: { method: string; args: unknown }[];
  /** Outcome of verify for one reference. Default is "pending" until set. */
  setVerifyOutcome(reference: string, outcome: FakeVerifyOutcome): void;
  /** A payment that was pending and later succeeds (late success). */
  completeLate(reference: string): void;
  /** Outcome of the next refunds. "duplicate" returns the existing refund. */
  setRefundOutcome(outcome: FakeRefundOutcome): void;
  /** The provider finishes refunds it accepted earlier for this payment reference. */
  finishRefunds(reference: string): void;
  /** A body and signature, signed with FAKE_WEBHOOK_SECRET, to post to the webhook route. */
  makeWebhook(event: {
    type: "charge.success" | "refund.processed" | "refund.failed";
    reference: string;
    amountCents: number;
    id?: string;
  }): { rawBody: string; signature: string };
};

export function createFakeProvider(): FakeProvider {
  const calls: FakeProvider["calls"] = [];
  const payments = new Map<string, Payment>();
  const outcomes = new Map<string, FakeVerifyOutcome>();
  const refunds = new Map<string, RefundRecord[]>();
  let refundOutcome: FakeRefundOutcome = "success";
  let counter = 0;

  const sign = (raw: string) => createHmac("sha512", FAKE_WEBHOOK_SECRET).update(raw).digest("hex");

  return {
    calls,

    setVerifyOutcome(reference, outcome) {
      outcomes.set(reference, outcome);
    },
    completeLate(reference) {
      outcomes.set(reference, "success");
    },
    setRefundOutcome(outcome) {
      refundOutcome = outcome;
    },
    finishRefunds(reference) {
      refunds.set(
        reference,
        (refunds.get(reference) ?? []).map((r) => ({ ...r, status: "processed" as const })),
      );
    },

    makeWebhook({ type, reference, amountCents, id }) {
      const rawBody = JSON.stringify({
        event: type,
        data: { id: id ?? `${type}-${reference}`, reference, amount: amountCents },
      });
      return { rawBody, signature: sign(rawBody) };
    },

    async createSubaccount(input) {
      calls.push({ method: "createSubaccount", args: input });
      counter += 1;
      return { code: `ACCT_fake${counter}` };
    },

    async initialize(input) {
      calls.push({ method: "initialize", args: input });
      payments.set(input.reference, {
        reference: input.reference,
        amountCents: input.amountCents,
        subaccountCode: input.subaccountCode,
        feeCents: input.feeCents,
      });
      return {
        authorizationUrl: `https://fake-checkout.test/pay/${input.reference}`,
        accessCode: `access_${input.reference}`,
      };
    },

    async verify(reference): Promise<VerifyResult> {
      calls.push({ method: "verify", args: reference });
      const payment = payments.get(reference);
      return {
        status: outcomes.get(reference) ?? "pending",
        amountCents: payment?.amountCents ?? 0,
        currency: "ZAR",
        reference,
        ...(payment
          ? { subaccountCode: payment.subaccountCode, transactionChargeCents: payment.feeCents }
          : {}),
      };
    },

    async refund(input) {
      calls.push({ method: "refund", args: input });
      const existing = refunds.get(input.reference)?.find((r) => r.status !== "failed");
      if (refundOutcome === "error") {
        throw new ProviderError("Fake refund failure", true);
      }
      if (refundOutcome === "duplicate" || existing) {
        if (existing) {
          return {
            refundId: existing.refundId,
            status: existing.status === "processed" ? "processed" : "pending",
          };
        }
        throw new ProviderError("Fake duplicate refund with no earlier refund", false);
      }
      counter += 1;
      const record: RefundRecord = {
        refundId: `refund_fake${counter}`,
        status: "pending",
        amountCents: input.amountCents,
      };
      refunds.set(input.reference, [...(refunds.get(input.reference) ?? []), record]);
      return { refundId: record.refundId, status: "pending" };
    },

    async findRefunds(reference) {
      calls.push({ method: "findRefunds", args: reference });
      return refunds.get(reference) ?? [];
    },

    verifyWebhook(rawBody, signature) {
      return signature !== null && signature === sign(rawBody);
    },

    parseWebhook(rawBody): WebhookEvent {
      const parsed = JSON.parse(rawBody) as {
        event: string;
        data: { id: string; reference?: string; amount?: number };
      };
      const type =
        parsed.event === "charge.success" ||
        parsed.event === "refund.processed" ||
        parsed.event === "refund.failed"
          ? parsed.event
          : "other";
      return {
        eventKey: `${parsed.event}:${parsed.data.id}`,
        type,
        reference: parsed.data.reference,
        amountCents: parsed.data.amount,
      };
    },
  };
}
