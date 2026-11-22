// The payment boundary. Callers depend on this file only, never on a vendor module.

export class ProviderError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "ProviderError";
    this.retryable = retryable;
  }
}

export type VerifyStatus = "success" | "failed" | "pending";
export type RefundStatus = "pending" | "processed";

export type VerifyResult = {
  status: VerifyStatus;
  amountCents: number;
  currency: string;
  reference: string;
  subaccountCode?: string;
  transactionChargeCents?: number;
};

export type RefundRecord = {
  refundId: string;
  status: RefundStatus | "failed";
  amountCents: number;
};

export type WebhookEventType = "charge.success" | "refund.processed" | "refund.failed" | "other";

export type WebhookEvent = {
  /** Stable per event, so a retried delivery maps to the same key. */
  eventKey: string;
  type: WebhookEventType;
  reference?: string;
  amountCents?: number;
};

export interface PaymentProvider {
  createSubaccount(input: {
    businessName: string;
    bankCode: string;
    accountNumber: string;
  }): Promise<{ code: string }>;

  initialize(input: {
    reference: string;
    amountCents: number;
    email: string;
    subaccountCode: string;
    feeCents: number;
    callbackUrl: string;
  }): Promise<{ authorizationUrl: string; accessCode: string }>;

  verify(reference: string): Promise<VerifyResult>;

  /** Refund a payment. If it was already refunded, returns the existing refund. */
  refund(input: {
    reference: string;
    amountCents: number;
  }): Promise<{ refundId: string; status: RefundStatus }>;

  findRefunds(reference: string): Promise<RefundRecord[]>;

  /** Check the signature over the raw, unparsed request body. */
  verifyWebhook(rawBody: string, signature: string | null): boolean;

  parseWebhook(rawBody: string): WebhookEvent;
}
