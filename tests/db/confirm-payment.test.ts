import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { createFakeProvider, FAKE_WEBHOOK_SECRET, type FakeProvider } from "@/lib/payments/fake";
import type { PaymentProvider } from "@/lib/payments/provider";
import { confirmByReference } from "@/lib/booking/confirm";
import { startCheckout } from "@/lib/booking/checkout";
import { handlePaymentWebhook } from "@/lib/booking/webhook";
import { makeBooking, makeGym, makeRpc, makeSession, makeUser, pool, resetData, sql } from "./helpers";

beforeEach(resetData);
afterAll(() => pool.end());

const service = makeRpc("service_role");

async function checkout(provider: FakeProvider, sessionId: string, memberId: string, email = "m@x.test") {
  const res = await startCheckout({
    memberRpc: makeRpc("authenticated", memberId),
    serviceRpc: service,
    provider,
    sessionId,
    memberEmail: email,
    subaccountCode: "ACCT_test",
    callbackUrl: (id) => `https://seshup.test/return?ref=${id}`,
  });
  return res;
}

const bookingStatus = async (id: string) => (await sql<{ status: string }>("select status from public.bookings where id = $1", [id]))[0].status;
const spotsTaken = async (session: string) => (await sql<{ n: number }>("select public.spots_taken($1)::int as n", [session]))[0].n;
const mailFor = (recipient: string) => sql<{ template: string }>("select template from public.email_outbox where recipient = $1", [recipient]);

async function setup(opts: { spotLimit?: number; priceCents?: number; feeBps?: number } = {}) {
  const provider = createFakeProvider();
  const gym = await makeGym({ feeBps: opts.feeBps ?? 500 });
  const session = await makeSession(gym.id, { spotLimit: opts.spotLimit ?? 5, priceCents: opts.priceCents ?? 10000 });
  const member = await makeUser("M", "m@x.test");
  return { provider, gym, session, member };
}

describe("checkout and confirmation", () => {
  it("covers F1: a member books, pays, and ends with one confirmed booking, fewer spots, and one email", async () => {
    const { provider, session, member } = await setup();
    const res = await checkout(provider, session, member);
    expect(res.kind).toBe("redirect");
    const bookingId = (res as { bookingId: string }).bookingId;
    provider.setVerifyOutcome(bookingId, "success");

    const result = await confirmByReference({ rpc: service, provider, reference: bookingId });
    expect(result).toEqual({ outcome: "confirmed", bookingStatus: "confirmed" });
    expect(await bookingStatus(bookingId)).toBe("confirmed");
    expect(await spotsTaken(session)).toBe(1);
    expect((await mailFor("m@x.test")).map((m) => m.template)).toEqual(["booking_confirmed"]);
    const [pay] = await sql<{ amount_cents: number; fee_cents: number; status: string }>("select amount_cents, fee_cents, status from public.payments");
    expect(pay).toEqual({ amount_cents: 10000, fee_cents: 500, status: "succeeded" });
  });

  it("initializes checkout with the amount and fee recorded on the booking", async () => {
    const { provider, session, member } = await setup({ priceCents: 12345, feeBps: 700 });
    await checkout(provider, session, member);
    const init = provider.calls.find((c) => c.method === "initialize")!.args as { amountCents: number; feeCents: number; subaccountCode: string };
    expect(init).toMatchObject({ amountCents: 12345, feeCents: 864, subaccountCode: "ACCT_test" }); // 12345 * 7% = 864.15, rounded
  });

  it("sends a member who abandons checkout and taps Book again back to the same checkout, with no second booking", async () => {
    const { provider, session, member } = await setup();
    const first = (await checkout(provider, session, member)) as { url: string };
    const second = (await checkout(provider, session, member)) as { url: string };
    expect(second.url).toBe(first.url);
    expect(await sql("select 1 from public.bookings")).toHaveLength(1);
    expect(await sql("select 1 from public.payments")).toHaveLength(1);
  });

  it("returns 'full' when no spot is left and frees the spot when the provider cannot start checkout", async () => {
    const { provider, session, member } = await setup({ spotLimit: 1 });
    await makeBooking(session, await makeUser(), "confirmed");
    expect(await checkout(provider, session, member)).toEqual({ kind: "full" });

    const open = await makeSession((await sql<{ gym_id: string }>("select gym_id from public.class_sessions limit 1"))[0].gym_id, { spotLimit: 1 });
    const broken: PaymentProvider = { ...provider, initialize: async () => { throw new Error("provider down"); } };
    await expect(checkout(broken as FakeProvider, open, member)).rejects.toThrow(/provider down/);
    expect(await spotsTaken(open)).toBe(0);
  });

  it("moves a failed payment to failed and frees the spot", async () => {
    const { provider, session, member } = await setup({ spotLimit: 1 });
    const { bookingId } = (await checkout(provider, session, member)) as { bookingId: string };
    provider.setVerifyOutcome(bookingId, "failed");
    expect((await confirmByReference({ rpc: service, provider, reference: bookingId })).outcome).toBe("failed");
    expect(await bookingStatus(bookingId)).toBe("failed");
    expect(await spotsTaken(session)).toBe(0);
  });

  it("changes nothing while the provider still reports the payment as pending", async () => {
    const { provider, session, member } = await setup();
    const { bookingId } = (await checkout(provider, session, member)) as { bookingId: string };
    expect((await confirmByReference({ rpc: service, provider, reference: bookingId })).outcome).toBe("pending");
    expect(await bookingStatus(bookingId)).toBe("pending");
  });
});

describe("idempotence", () => {
  it("confirms once and sends one email when the same charge.success arrives twice", async () => {
    const { provider, session, member } = await setup();
    const { bookingId } = (await checkout(provider, session, member)) as { bookingId: string };
    provider.setVerifyOutcome(bookingId, "success");
    const hook = provider.makeWebhook({ type: "charge.success", reference: bookingId, amountCents: 10000, id: "evt_1" });
    const send = () => handlePaymentWebhook({ rawBody: hook.rawBody, signature: hook.signature, provider, rpc: service });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    expect(await mailFor("m@x.test")).toHaveLength(1);
    expect(await sql("select 1 from public.payment_events where event_key like 'charge.success:%'")).toHaveLength(1);
  });

  it("confirms once when the webhook and the return page race", async () => {
    const { provider, session, member } = await setup();
    const { bookingId } = (await checkout(provider, session, member)) as { bookingId: string };
    provider.setVerifyOutcome(bookingId, "success");
    const results = await Promise.all([
      confirmByReference({ rpc: service, provider, reference: bookingId }),
      confirmByReference({ rpc: service, provider, reference: bookingId }),
      confirmByReference({ rpc: service, provider, reference: bookingId }),
    ]);
    expect(results.filter((r) => r.outcome === "confirmed")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "already_processed")).toHaveLength(2);
    expect(await mailFor("m@x.test")).toHaveLength(1);
    expect(await spotsTaken(session)).toBe(1);
  });

  it("rejects a webhook with an invalid signature and changes nothing", async () => {
    const { provider, session, member } = await setup();
    const { bookingId } = (await checkout(provider, session, member)) as { bookingId: string };
    provider.setVerifyOutcome(bookingId, "success");
    const hook = provider.makeWebhook({ type: "charge.success", reference: bookingId, amountCents: 10000 });
    const res = await handlePaymentWebhook({ rawBody: hook.rawBody + " ", signature: hook.signature, provider, rpc: service });
    expect(res.status).toBe(401);
    expect(await bookingStatus(bookingId)).toBe("pending");
    const none = await handlePaymentWebhook({ rawBody: hook.rawBody, signature: null, provider, rpc: service });
    expect(none.status).toBe(401);
  });
});

describe("late and unusual payments", () => {
  it("covers AE7: a payment after the hold and grace, with the spot taken, is refunded in full and SeshUp absorbs the fee", async () => {
    const { provider, session, member } = await setup({ spotLimit: 1 });
    const { bookingId } = (await checkout(provider, session, member)) as { bookingId: string };
    await sql("update public.bookings set hold_expires_at = now() - interval '4 minutes' where id = $1", [bookingId]);
    const other = await makeUser("Other", "other@x.test");
    expect((await makeRpc("authenticated", other)("take_spot", { p_session_id: session })).data).toBeTruthy();
    await sql("update public.bookings set status = 'confirmed' where member_id = $1", [other]);

    provider.setVerifyOutcome(bookingId, "success");
    const result = await confirmByReference({ rpc: service, provider, reference: bookingId });
    expect(result.outcome).toBe("refunded_late");
    expect(await bookingStatus(bookingId)).toBe("refunded_late");
    const [refund] = await sql<{ status: string; amount_cents: number; fee_borne_by: string }>("select status, amount_cents, fee_borne_by from public.refunds");
    expect(refund).toEqual({ status: "pending", amount_cents: 10000, fee_borne_by: "seshup" });
    expect((await mailFor("m@x.test")).map((m) => m.template)).toEqual(["late_payment_refund"]);
  });

  it("never confirms a booking that was already refunded, even if a spot frees up and the payment is confirmed again", async () => {
    const { provider, session, member } = await setup({ spotLimit: 1 });
    const { bookingId } = (await checkout(provider, session, member)) as { bookingId: string };
    await sql("update public.bookings set hold_expires_at = now() - interval '4 minutes' where id = $1", [bookingId]);
    const other = await makeUser("Other", "other@x.test");
    const otherBooking = await makeBooking(session, other, "confirmed");
    provider.setVerifyOutcome(bookingId, "success");
    expect((await confirmByReference({ rpc: service, provider, reference: bookingId })).outcome).toBe("refunded_late");

    await sql("update public.bookings set status = 'cancelled_no_refund' where id = $1", [otherBooking]); // the spot frees up
    const again = await confirmByReference({ rpc: service, provider, reference: bookingId });
    expect(again.outcome).toBe("already_processed");
    expect(await bookingStatus(bookingId)).toBe("refunded_late");
    expect(await sql("select 1 from public.refunds")).toHaveLength(1);
  });

  it("confirms a payment that arrives after the hold when a spot is still free", async () => {
    const { provider, session, member } = await setup();
    const { bookingId } = (await checkout(provider, session, member)) as { bookingId: string };
    await sql("update public.bookings set hold_expires_at = now() - interval '10 minutes', status = 'expired' where id = $1", [bookingId]);
    provider.setVerifyOutcome(bookingId, "success");
    expect((await confirmByReference({ rpc: service, provider, reference: bookingId })).outcome).toBe("confirmed");
    expect(await bookingStatus(bookingId)).toBe("confirmed");
  });

  it("confirms the first member and tells the second 'full' when payment lands one minute after the hold", async () => {
    const { provider, session, member } = await setup({ spotLimit: 1 });
    const { bookingId } = (await checkout(provider, session, member)) as { bookingId: string };
    await sql("update public.bookings set hold_expires_at = now() - interval '1 minute' where id = $1", [bookingId]);
    const second = await makeUser("Second");
    const taken = await makeRpc("authenticated", second)("take_spot", { p_session_id: session });
    expect((taken.data as { outcome: string }[])[0].outcome).toBe("full");
    provider.setVerifyOutcome(bookingId, "success");
    expect((await confirmByReference({ rpc: service, provider, reference: bookingId })).outcome).toBe("confirmed");
  });

  it("refunds a success that arrives after the owner cancelled the date, with the fee on the gym", async () => {
    const { provider, session, member } = await setup();
    const { bookingId } = (await checkout(provider, session, member)) as { bookingId: string };
    await sql("update public.class_sessions set cancelled = true where id = $1", [session]);
    await sql("update public.bookings set status = 'released_by_gym' where id = $1", [bookingId]);
    provider.setVerifyOutcome(bookingId, "success");
    expect((await confirmByReference({ rpc: service, provider, reference: bookingId })).outcome).toBe("refunded_late");
    const [refund] = await sql<{ fee_borne_by: string }>("select fee_borne_by from public.refunds");
    expect(refund.fee_borne_by).toBe("gym");
  });

  it("refunds a success on an expired booking while the member holds a newer confirmed booking on the date", async () => {
    const { provider, session, member } = await setup();
    const { bookingId } = (await checkout(provider, session, member)) as { bookingId: string };
    await sql("update public.bookings set status = 'expired', hold_expires_at = now() - interval '1 hour' where id = $1", [bookingId]);
    await makeBooking(session, member, "confirmed");
    provider.setVerifyOutcome(bookingId, "success");
    expect((await confirmByReference({ rpc: service, provider, reference: bookingId })).outcome).toBe("refunded_late");
    expect(await sql("select 1 from public.bookings where member_id = $1 and status = 'confirmed'", [member])).toHaveLength(1);
  });

  it.each([
    ["currency", (v: Awaited<ReturnType<PaymentProvider["verify"]>>) => ({ ...v, currency: "USD" })],
    ["amount", (v: Awaited<ReturnType<PaymentProvider["verify"]>>) => ({ ...v, amountCents: v.amountCents - 1 })],
    ["sub-account", (v: Awaited<ReturnType<PaymentProvider["verify"]>>) => ({ ...v, subaccountCode: "ACCT_evil" })],
    ["fee", (v: Awaited<ReturnType<PaymentProvider["verify"]>>) => ({ ...v, transactionChargeCents: 0 })],
  ])("does not confirm when the provider reports a different %s", async (_name, tamper) => {
    const { provider, session, member } = await setup();
    const { bookingId } = (await checkout(provider, session, member)) as { bookingId: string };
    provider.setVerifyOutcome(bookingId, "success");
    const tampered: PaymentProvider = { ...provider, verify: async (r) => tamper(await provider.verify(r)) };
    expect((await confirmByReference({ rpc: service, provider: tampered, reference: bookingId })).outcome).toBe("mismatch");
    expect(await bookingStatus(bookingId)).toBe("pending");
    expect(await sql("select 1 from public.payment_events where event_key like 'mismatch:%'")).toHaveLength(1);
  });

  it("holds a mismatched payment for review: one record however often it is checked, never re-polled, and shown to the operator", async () => {
    const { reverifyPendingPayments } = await import("@/lib/booking/confirm");
    const { provider, session, member } = await setup();
    const { bookingId } = (await checkout(provider, session, member)) as { bookingId: string };
    provider.setVerifyOutcome(bookingId, "success");
    const wrongAccount: PaymentProvider = { ...provider, verify: async (r) => ({ ...(await provider.verify(r)), subaccountCode: "ACCT_evil" }) };
    for (let i = 0; i < 3; i++) await confirmByReference({ rpc: service, provider: wrongAccount, reference: bookingId });
    expect(await sql("select 1 from public.payment_events where event_key like 'mismatch:%'")).toHaveLength(1);
    const [pay] = await sql<{ status: string }>("select status from public.payments");
    expect(pay.status).toBe("needs_review");
    expect((await reverifyPendingPayments({ rpc: service, provider: wrongAccount })).checked).toBe(0);
    const problems = (await service("operator_problems")).data as { kind: string }[];
    expect(problems.map((p) => p.kind)).toContain("payment_mismatch");
  });

  it("explains a late payment for a cancelled class with one email and sends no second one when the refund is processed", async () => {
    const { provider, session, member } = await setup();
    const { bookingId } = (await checkout(provider, session, member)) as { bookingId: string };
    await sql("update public.class_sessions set cancelled = true where id = $1", [session]);
    await sql("update public.bookings set status = 'released_by_gym' where id = $1", [bookingId]);
    provider.setVerifyOutcome(bookingId, "success");
    await confirmByReference({ rpc: service, provider, reference: bookingId });
    expect((await mailFor("m@x.test")).map((m) => m.template)).toEqual(["class_cancelled_by_gym"]);
    const [refund] = await sql<{ id: string }>("select id from public.refunds");
    await service("complete_refund", { p_refund_id: refund.id, p_provider_refund_id: "r1", p_processed: true });
    expect((await mailFor("m@x.test")).map((m) => m.template)).toEqual(["class_cancelled_by_gym"]);
  });

  it("lets a member confirm only through the server: authenticated callers cannot run the confirm function", async () => {
    const { member } = await setup();
    const res = await makeRpc("authenticated", member)("confirm_payment", {
      p_reference: "x", p_status: "success", p_amount_cents: 1, p_currency: "ZAR", p_subaccount_code: "a", p_charge_cents: 0,
    });
    expect(res.error?.message).toMatch(/permission denied/);
    const create = await makeRpc("authenticated", member)("create_payment", { p_booking_id: "00000000-0000-0000-0000-000000000000", p_fee_cents: 0 });
    expect(create.error?.message).toMatch(/permission denied/);
  });
});

describe("webhook failures", () => {
  it("answers 500 when confirming fails so the provider retries, then confirms on the retry", async () => {
    const { provider, session, member } = await setup();
    const { bookingId } = (await checkout(provider, session, member)) as { bookingId: string };
    provider.setVerifyOutcome(bookingId, "success");
    const hook = provider.makeWebhook({ type: "charge.success", reference: bookingId, amountCents: 10000, id: "evt_retry" });
    const down: PaymentProvider = { ...provider, verify: async () => { throw new Error("provider down"); } };
    expect((await handlePaymentWebhook({ rawBody: hook.rawBody, signature: hook.signature, provider: down, rpc: service })).status).toBe(500);
    expect(await bookingStatus(bookingId)).toBe("pending");
    expect((await handlePaymentWebhook({ rawBody: hook.rawBody, signature: hook.signature, provider, rpc: service })).status).toBe(200);
    expect(await bookingStatus(bookingId)).toBe("confirmed");
  });

  it("answers 500 when a refund event cannot be settled and 200 for event types it does not use", async () => {
    const { provider } = await setup();
    const hook = provider.makeWebhook({ type: "refund.processed", reference: "x", amountCents: 1, id: "e1" });
    const failing = async (fn: string) => ({ data: null, error: fn === "settle_refund_by_reference" ? { message: "boom" } : null });
    expect((await handlePaymentWebhook({ rawBody: hook.rawBody, signature: hook.signature, provider, rpc: failing })).status).toBe(500);
    const other = JSON.stringify({ event: "transfer.success", data: { id: "t1" } });
    const signed = { rawBody: other, signature: createHmac("sha512", FAKE_WEBHOOK_SECRET).update(other).digest("hex") };
    expect((await handlePaymentWebhook({ ...signed, provider, rpc: service })).status).toBe(200);
  });
});

describe("re-checking payments", () => {
  it("confirms a paid member whose webhook never arrived", async () => {
    const { reverifyPendingPayments } = await import("@/lib/booking/confirm");
    const { provider, session, member } = await setup();
    const { bookingId } = (await checkout(provider, session, member)) as { bookingId: string };
    provider.setVerifyOutcome(bookingId, "success");
    const result = await reverifyPendingPayments({ rpc: service, provider });
    expect(result.outcomes.confirmed).toBe(1);
    expect(await bookingStatus(bookingId)).toBe("confirmed");
  });

  it("releases pending holds past their grace when the per-minute tidy runs", async () => {
    const { session, member } = await setup();
    const id = await makeBooking(session, member, "pending", -600);
    await sql("select public.tidy()");
    expect(await bookingStatus(id)).toBe("expired");
  });
});
