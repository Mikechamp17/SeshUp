import { createHmac, timingSafeEqual } from "node:crypto";
import {
  ProviderError,
  type PaymentProvider,
  type RefundRecord,
  type VerifyStatus,
  type WebhookEventType,
} from "./provider";

// Every Paystack-specific name lives in this file. The field names below come from
// Paystack's public API and must be confirmed by the test-mode check script.

const BASE_URL = "https://api.paystack.co";
const CURRENCY = "ZAR";

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json {
  return typeof value === "object" && value !== null ? (value as Json) : {};
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function mapVerifyStatus(status: unknown): VerifyStatus {
  if (status === "success") return "success";
  if (status === "failed") return "failed";
  return "pending";
}

function mapRefundStatus(status: unknown): RefundRecord["status"] {
  if (status === "processed") return "processed";
  if (status === "failed") return "failed";
  return "pending";
}

function toRefundRecord(raw: unknown): RefundRecord {
  const r = asRecord(raw);
  return {
    refundId: asString(r.id) ?? "",
    status: mapRefundStatus(r.status),
    amountCents: asNumber(r.amount),
  };
}

export function createPaystackProvider(options: {
  secretKey: string;
  fetchImpl?: typeof fetch;
}): PaymentProvider {
  const { secretKey } = options;
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request(method: "GET" | "POST", path: string, body?: Json): Promise<Json> {
    let response: Response;
    try {
      response = await fetchImpl(`${BASE_URL}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${secretKey}`,
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      throw new ProviderError(`Payment provider unreachable: ${reason}`, true);
    }

    let payload: Json = {};
    try {
      payload = asRecord(await response.json());
    } catch {
      // Non-JSON body: fall through to the status handling below.
    }

    if (!response.ok) {
      const message = asString(payload.message) ?? `HTTP ${response.status}`;
      const retryable = response.status >= 500 || response.status === 429;
      throw new ProviderError(`Payment provider error (${response.status}): ${message}`, retryable);
    }
    if (payload.status === false) {
      throw new ProviderError(
        `Payment provider rejected the request: ${asString(payload.message) ?? "unknown"}`,
        false,
      );
    }
    return payload;
  }

  async function findRefunds(reference: string): Promise<RefundRecord[]> {
    const payload = await request("GET", `/refund?reference=${encodeURIComponent(reference)}`);
    return Array.isArray(payload.data) ? payload.data.map(toRefundRecord) : [];
  }

  return {
    async createSubaccount({ businessName, bankCode, accountNumber }) {
      const payload = await request("POST", "/subaccount", {
        business_name: businessName,
        settlement_bank: bankCode,
        account_number: accountNumber,
        percentage_charge: 0,
      });
      const code = asString(asRecord(payload.data).subaccount_code);
      if (!code) throw new ProviderError("Payment provider returned no sub-account code", false);
      return { code };
    },

    async initialize({ reference, amountCents, email, subaccountCode, feeCents, callbackUrl }) {
      const payload = await request("POST", "/transaction/initialize", {
        reference,
        amount: amountCents,
        email,
        currency: CURRENCY,
        subaccount: subaccountCode,
        transaction_charge: feeCents,
        bearer: "subaccount",
        callback_url: callbackUrl,
      });
      const data = asRecord(payload.data);
      const authorizationUrl = asString(data.authorization_url);
      const accessCode = asString(data.access_code);
      if (!authorizationUrl || !accessCode) {
        throw new ProviderError("Payment provider returned no checkout link", false);
      }
      return { authorizationUrl, accessCode };
    },

    async verify(reference) {
      const payload = await request("GET", `/transaction/verify/${encodeURIComponent(reference)}`);
      const data = asRecord(payload.data);
      const subaccountCode = asString(asRecord(data.subaccount).subaccount_code);
      const charge = data.transaction_charge;
      return {
        status: mapVerifyStatus(data.status),
        amountCents: asNumber(data.amount),
        currency: asString(data.currency) ?? CURRENCY,
        reference: asString(data.reference) ?? reference,
        ...(subaccountCode ? { subaccountCode } : {}),
        ...(typeof charge === "number" ? { transactionChargeCents: charge } : {}),
      };
    },

    async refund({ reference, amountCents }) {
      try {
        const payload = await request("POST", "/refund", {
          transaction: reference,
          amount: amountCents,
          currency: CURRENCY,
        });
        const record = toRefundRecord(payload.data);
        return {
          refundId: record.refundId,
          status: record.status === "processed" ? "processed" : "pending",
        };
      } catch (error) {
        // A rejected refund may mean the payment was already refunded. Look it up
        // and hand back the earlier refund instead of failing.
        if (error instanceof ProviderError && !error.retryable) {
          const existing = (await findRefunds(reference)).find((r) => r.status !== "failed");
          if (existing) {
            return {
              refundId: existing.refundId,
              status: existing.status === "processed" ? "processed" : "pending",
            };
          }
        }
        throw error;
      }
    },

    findRefunds,

    verifyWebhook(rawBody, signature) {
      if (!signature) return false;
      const expected = createHmac("sha512", secretKey).update(rawBody).digest();
      const given = Buffer.from(signature, "hex");
      if (given.length !== expected.length) return false;
      return timingSafeEqual(given, expected);
    },

    parseWebhook(rawBody) {
      let parsed: Json = {};
      try {
        parsed = asRecord(JSON.parse(rawBody));
      } catch {
        // Treated as an unknown event below.
      }
      const event = asString(parsed.event) ?? "";
      const data = asRecord(parsed.data);
      const type: WebhookEventType =
        event === "charge.success" || event === "refund.processed" || event === "refund.failed"
          ? event
          : "other";
      const reference = asString(data.reference) ?? asString(data.transaction_reference);
      const id = asString(data.id) ?? reference ?? "unknown";
      const amount = data.amount;
      return {
        eventKey: `${event}:${id}`,
        type,
        ...(reference ? { reference } : {}),
        ...(typeof amount === "number" ? { amountCents: amount } : {}),
      };
    },
  };
}
