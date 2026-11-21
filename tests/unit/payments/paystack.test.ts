import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ProviderError } from "@/lib/payments/provider";
import { createPaystackProvider } from "@/lib/payments/paystack";

type Call = { url: string; method: string; body: unknown; auth: string | null };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setup(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      auth: headers.get("authorization"),
    };
    calls.push(call);
    return respond(call);
  };
  const provider = createPaystackProvider({ secretKey: "sk_test_abc", fetchImpl });
  return { provider, calls };
}

describe("initialize", () => {
  it("sends the amount, flat fee, sub-account and rand currency, and returns the checkout link", async () => {
    const { provider, calls } = setup(() =>
      json(200, {
        status: true,
        message: "Authorization URL created",
        data: {
          authorization_url: "https://checkout.paystack.com/abc",
          access_code: "abc",
          reference: "ref-1",
        },
      }),
    );

    const result = await provider.initialize({
      reference: "ref-1",
      amountCents: 10000,
      email: "member@example.com",
      subaccountCode: "ACCT_gym1",
      feeCents: 500,
      callbackUrl: "https://seshup.test/return",
    });

    expect(result).toEqual({
      authorizationUrl: "https://checkout.paystack.com/abc",
      accessCode: "abc",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.paystack.co/transaction/initialize");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].auth).toBe("Bearer sk_test_abc");
    expect(calls[0].body).toEqual({
      reference: "ref-1",
      amount: 10000,
      email: "member@example.com",
      currency: "ZAR",
      subaccount: "ACCT_gym1",
      transaction_charge: 500,
      bearer: "subaccount",
      callback_url: "https://seshup.test/return",
    });
  });
});

describe("createSubaccount", () => {
  it("sends bank details and returns the sub-account code", async () => {
    const { provider, calls } = setup(() =>
      json(201, { status: true, data: { subaccount_code: "ACCT_new" } }),
    );
    const result = await provider.createSubaccount({
      businessName: "Iron Fist Boxing",
      bankCode: "632005",
      accountNumber: "0123456789",
    });
    expect(result).toEqual({ code: "ACCT_new" });
    expect(calls[0].url).toBe("https://api.paystack.co/subaccount");
    expect(calls[0].body).toMatchObject({
      business_name: "Iron Fist Boxing",
      settlement_bank: "632005",
      account_number: "0123456789",
    });
  });
});

describe("verify", () => {
  const verifyBody = (status: string) => ({
    status: true,
    data: {
      status,
      amount: 10000,
      currency: "ZAR",
      reference: "ref-1",
      subaccount: { subaccount_code: "ACCT_gym1" },
      fees_split: { subaccount: 9500, integration: 500 },
      transaction_charge: 500,
    },
  });

  it.each([
    ["success", "success"],
    ["failed", "failed"],
    ["abandoned", "pending"],
    ["ongoing", "pending"],
  ])("maps provider status %s to %s", async (providerStatus, expected) => {
    const { provider, calls } = setup(() => json(200, verifyBody(providerStatus)));
    const result = await provider.verify("ref-1");
    expect(result.status).toBe(expected);
    expect(calls[0].url).toBe("https://api.paystack.co/transaction/verify/ref-1");
    expect(calls[0].method).toBe("GET");
  });

  it("returns amount, currency, reference and sub-account", async () => {
    const { provider } = setup(() => json(200, verifyBody("success")));
    const result = await provider.verify("ref-1");
    expect(result).toMatchObject({
      amountCents: 10000,
      currency: "ZAR",
      reference: "ref-1",
      subaccountCode: "ACCT_gym1",
    });
  });
});

describe("refund", () => {
  it("sends the full original amount for the transaction", async () => {
    const { provider, calls } = setup(() =>
      json(200, { status: true, data: { id: 42, status: "pending", amount: 10000 } }),
    );
    const result = await provider.refund({ reference: "ref-1", amountCents: 10000 });
    expect(result).toEqual({ refundId: "42", status: "pending" });
    expect(calls[0].url).toBe("https://api.paystack.co/refund");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({ transaction: "ref-1", amount: 10000, currency: "ZAR" });
  });

  it("returns the existing refund when the transaction was already refunded", async () => {
    const { provider, calls } = setup((call) => {
      if (call.method === "POST") {
        return json(400, { status: false, message: "Transaction has been fully reversed" });
      }
      return json(200, {
        status: true,
        data: [{ id: 42, status: "processed", amount: 10000, transaction_reference: "ref-1" }],
      });
    });
    const result = await provider.refund({ reference: "ref-1", amountCents: 10000 });
    expect(result).toEqual({ refundId: "42", status: "processed" });
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET"]);
  });

  it("surfaces the rejection when no earlier refund exists", async () => {
    const { provider } = setup((call) =>
      call.method === "POST"
        ? json(400, { status: false, message: "Invalid transaction" })
        : json(200, { status: true, data: [] }),
    );
    await expect(provider.refund({ reference: "ref-1", amountCents: 10000 })).rejects.toMatchObject({
      retryable: false,
    });
  });
});

describe("findRefunds", () => {
  it("looks refunds up by transaction reference and normalizes them", async () => {
    const { provider, calls } = setup(() =>
      json(200, {
        status: true,
        data: [
          { id: 1, status: "processed", amount: 5000 },
          { id: 2, status: "failed", amount: 5000 },
          { id: 3, status: "needs-attention", amount: 100 },
        ],
      }),
    );
    const result = await provider.findRefunds("ref-1");
    expect(calls[0].url).toBe("https://api.paystack.co/refund?reference=ref-1");
    expect(result).toEqual([
      { refundId: "1", status: "processed", amountCents: 5000 },
      { refundId: "2", status: "failed", amountCents: 5000 },
      { refundId: "3", status: "pending", amountCents: 100 },
    ]);
  });
});

describe("errors", () => {
  it.each([500, 502, 429])("treats HTTP %i as retryable", async (status) => {
    const { provider } = setup(() => json(status, { status: false, message: "try later" }));
    const error = await provider.verify("ref-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).retryable).toBe(true);
  });

  it("treats HTTP 400 as not retryable", async () => {
    const { provider } = setup(() => json(400, { status: false, message: "Bad request" }));
    const error = await provider.verify("ref-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).retryable).toBe(false);
    expect((error as ProviderError).message).toContain("Bad request");
  });

  it("treats a network failure as retryable", async () => {
    const provider = createPaystackProvider({
      secretKey: "sk_test_abc",
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const error = await provider.verify("ref-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).retryable).toBe(true);
  });
});

describe("webhooks", () => {
  const secret = "sk_test_abc";
  const body = JSON.stringify({
    event: "charge.success",
    data: { id: 987, reference: "ref-1", amount: 10000 },
  });
  const sign = (raw: string) => createHmac("sha512", secret).update(raw).digest("hex");
  const { provider } = setup(() => json(200, {}));

  it("accepts a body signed with the secret key", () => {
    expect(provider.verifyWebhook(body, sign(body))).toBe(true);
  });

  it("rejects the same body with one changed byte", () => {
    const tampered = body.replace("10000", "10001");
    expect(provider.verifyWebhook(tampered, sign(body))).toBe(false);
  });

  it("rejects a missing, empty or wrong-length signature", () => {
    expect(provider.verifyWebhook(body, null)).toBe(false);
    expect(provider.verifyWebhook(body, "")).toBe(false);
    expect(provider.verifyWebhook(body, "abcd")).toBe(false);
  });

  it("normalizes a charge event with a stable key", () => {
    expect(provider.parseWebhook(body)).toEqual({
      eventKey: "charge.success:987",
      type: "charge.success",
      reference: "ref-1",
      amountCents: 10000,
    });
  });

  it("normalizes refund events and unknown events", () => {
    const refund = JSON.stringify({
      event: "refund.processed",
      data: { id: 5, transaction_reference: "ref-1", amount: 10000 },
    });
    expect(provider.parseWebhook(refund)).toMatchObject({
      type: "refund.processed",
      reference: "ref-1",
      amountCents: 10000,
    });
    const other = JSON.stringify({ event: "transfer.success", data: { id: 9 } });
    expect(provider.parseWebhook(other).type).toBe("other");
  });
});
