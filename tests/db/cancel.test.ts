import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "@/lib/payments/fake";
import { ProviderError, type PaymentProvider } from "@/lib/payments/provider";
import { handlePaymentWebhook } from "@/lib/booking/webhook";
import { processDueRefunds } from "@/lib/refunds/process";
import { makeBooking, makeGym, makePaidBooking, makeRpc, makeSession, makeStaff, makeUser, pool, resetData, sql } from "./helpers";

beforeEach(resetData);
afterAll(() => pool.end());

const service = makeRpc("service_role");
const cancel = (member: string, booking: string) => makeRpc("authenticated", member)("cancel_booking", { p_booking_id: booking });
const ownerCancel = (owner: string, session: string) => makeRpc("authenticated", owner)("owner_cancel_session", { p_session_id: session });
const spotsTaken = async (s: string) => (await sql<{ n: number }>("select public.spots_taken($1)::int as n", [s]))[0].n;
const refunds = () => sql<{ status: string; amount_cents: number; fee_borne_by: string }>("select status, amount_cents, fee_borne_by from public.refunds order by created_at");
const ledger = () => sql<{ entry_kind: string; owed_by: string; amount_cents: number }>("select entry_kind, owed_by, amount_cents from public.gym_ledger_entries order by entry_kind");
const dueNow = () => sql("update public.refunds set next_attempt_at = now() where status in ('pending', 'submitting')");

async function paid(opts: { startsInHours: number; cutoff?: number }) {
  const gym = await makeGym();
  const session = await makeSession(gym.id, { startsInHours: opts.startsInHours, spotLimit: 3 });
  if (opts.cutoff !== undefined) await sql("update public.class_sessions set cutoff_hours = $2 where id = $1", [session, opts.cutoff]);
  const member = await makeUser("Mem", `mem-${Math.random().toString(36).slice(2)}@x.test`);
  const booking = await makePaidBooking(session, member);
  return { gym, session, member, booking };
}

describe("member cancellation", () => {
  it("covers AE2: a cancel before the 12 hour cutoff is refunded in full and one after is not, and both free the spot", async () => {
    const early = await paid({ startsInHours: 13 });
    expect(((await cancel(early.member, early.booking)).data as { outcome: string }).outcome).toBe("refund");
    expect(await spotsTaken(early.session)).toBe(0);
    expect(await refunds()).toEqual([{ status: "pending", amount_cents: 10000, fee_borne_by: "gym" }]);

    const late = await paid({ startsInHours: 11 });
    expect(((await cancel(late.member, late.booking)).data as { outcome: string }).outcome).toBe("no_refund");
    expect(await spotsTaken(late.session)).toBe(0);
    expect(await refunds()).toHaveLength(1); // still only the early one
    const [b] = await sql<{ status: string }>("select status from public.bookings where id = $1", [late.booking]);
    expect(b.status).toBe("cancelled_no_refund");
  });

  it("refunds a cancel after the cutoff when the date's time was changed", async () => {
    const t = await paid({ startsInHours: 3 });
    await sql("update public.class_sessions set time_changed = true where id = $1", [t.session]);
    expect(((await cancel(t.member, t.booking)).data as { outcome: string }).outcome).toBe("refund");
  });

  it("queues the right email for each outcome", async () => {
    const a = await paid({ startsInHours: 13 });
    await cancel(a.member, a.booking);
    const b = await paid({ startsInHours: 11 });
    await cancel(b.member, b.booking);
    const mail = await sql<{ template: string }>("select template from public.email_outbox order by created_at");
    expect(mail.map((m) => m.template)).toEqual(["booking_cancelled_refund", "booking_cancelled_no_refund"]);
  });

  it("refuses another member's booking and a class that already started", async () => {
    const t = await paid({ startsInHours: 13 });
    const stranger = await makeUser("Stranger");
    expect((await cancel(stranger, t.booking)).error?.message).toMatch(/booking_not_found/);
    await sql("update public.class_sessions set starts_at = now() - interval '1 hour' where id = $1", [t.session]);
    expect((await cancel(t.member, t.booking)).error?.message).toMatch(/session_started/);
    expect(await refunds()).toHaveLength(0);
  });

  it("does nothing the second time a booking is cancelled", async () => {
    const t = await paid({ startsInHours: 13 });
    await cancel(t.member, t.booking);
    expect(((await cancel(t.member, t.booking)).data as { outcome: string }).outcome).toBe("noop");
    expect(await refunds()).toHaveLength(1);
  });

  it("answers whether a cancel would be refunded", async () => {
    const t = await paid({ startsInHours: 13 });
    expect((await makeRpc("authenticated", t.member)("booking_refundable", { p_booking_id: t.booking })).data).toBe(true);
  });
});

describe("owner cancellation", () => {
  it("covers AE3: cancelling a date 2 hours out refunds all 10 members in full and emails them, and the job processes all 10", async () => {
    const gym = await makeGym();
    const session = await makeSession(gym.id, { startsInHours: 2, spotLimit: 12 });
    const owner = await makeStaff(gym.id);
    for (let i = 0; i < 10; i++) await makePaidBooking(session, await makeUser(`M${i}`, `m${i}@x.test`));

    const res = (await ownerCancel(owner, session)).data as { refunded: number; total_cents: number };
    expect(res).toMatchObject({ refunded: 10, total_cents: 100000 });
    expect(await refunds()).toHaveLength(10);
    const mail = await sql<{ template: string }>("select template from public.email_outbox");
    expect(mail.filter((m) => m.template === "class_cancelled_by_gym")).toHaveLength(10);

    const provider = createFakeProvider();
    const result = await processDueRefunds({ rpc: service, provider });
    expect(result).toMatchObject({ claimed: 10, submitted: 10, failed: 0 });
    expect(provider.calls.filter((c) => c.method === "refund")).toHaveLength(10);
  });

  it("releases members still paying, closes the waitlist, and sends no offer emails", async () => {
    const gym = await makeGym();
    const session = await makeSession(gym.id, { startsInHours: 24 });
    const owner = await makeStaff(gym.id);
    const paying = await makeBooking(session, await makeUser(), "pending", 300);
    const waiter = await makeUser("W", "w@x.test");
    await sql("insert into public.waitlist_entries (gym_id, session_id, member_id) values ($1,$2,$3)", [gym.id, session, waiter]);
    await ownerCancel(owner, session);
    const [b] = await sql<{ status: string }>("select status from public.bookings where id = $1", [paying]);
    expect(b.status).toBe("released_by_gym");
    expect(await sql("select 1 from public.waitlist_entries")).toHaveLength(0);
    expect(await sql("select 1 from public.email_outbox where recipient = 'w@x.test'")).toHaveLength(0);
  });

  it("previews who will be refunded", async () => {
    const gym = await makeGym();
    const session = await makeSession(gym.id);
    const owner = await makeStaff(gym.id);
    await makePaidBooking(session, await makeUser(), 10000);
    await makePaidBooking(session, await makeUser(), 12000);
    const res = (await makeRpc("authenticated", owner)("cancel_preview", { p_session_id: session })).data as { booked: number; refund_total_cents: number };
    expect(res).toMatchObject({ booked: 2, refund_total_cents: 22000 });
  });

  it("refuses staff of another gym and changes nothing", async () => {
    const gymA = await makeGym();
    const gymB = await makeGym();
    const ownerA = await makeStaff(gymA.id);
    const sessionB = await makeSession(gymB.id);
    await makePaidBooking(sessionB, await makeUser());
    expect((await ownerCancel(ownerA, sessionB)).error?.message).toMatch(/not_staff/);
    expect((await makeRpc("authenticated", ownerA)("cancel_preview", { p_session_id: sessionB })).error?.message).toMatch(/not_staff/);
    const [s] = await sql<{ cancelled: boolean }>("select cancelled from public.class_sessions where id = $1", [sessionB]);
    expect(s.cancelled).toBe(false);
    expect(await refunds()).toHaveLength(0);
  });

  it("gives one refund when an owner and a member cancel the same booking at once", async () => {
    const t = await paid({ startsInHours: 24 });
    const owner = await makeStaff(t.gym.id);
    await Promise.all([ownerCancel(owner, t.session), cancel(t.member, t.booking)]);
    expect(await refunds()).toHaveLength(1);
  });
});

describe("refund job and ledger", () => {
  it("covers AE6: refunds the full amount and, once processed, records the gym share and kept fee as owed by the gym", async () => {
    const t = await paid({ startsInHours: 13 });
    await cancel(t.member, t.booking);
    const provider = createFakeProvider();
    await processDueRefunds({ rpc: service, provider });
    expect(provider.calls.find((c) => c.method === "refund")!.args).toEqual({ reference: t.booking, amountCents: 10000 });
    expect((await refunds())[0].status).toBe("submitted");
    expect(await ledger()).toHaveLength(0); // nothing is owed until the refund is processed

    const hook = provider.makeWebhook({ type: "refund.processed", reference: t.booking, amountCents: 10000, id: "r1" });
    const res = await handlePaymentWebhook({ rawBody: hook.rawBody, signature: hook.signature, provider, rpc: service });
    expect(res.status).toBe(200);
    expect((await refunds())[0].status).toBe("processed");
    expect(await ledger()).toEqual([
      { entry_kind: "gym_share", owed_by: "gym", amount_cents: 9500 },
      { entry_kind: "processing_fee", owed_by: "gym", amount_cents: 0 },
    ]);
    const mail = await sql<{ template: string }>("select template from public.email_outbox where template = 'refund_processed'");
    expect(mail).toHaveLength(1);
  });

  it("writes one set of ledger rows when the webhook and the job settle the same refund together", async () => {
    const t = await paid({ startsInHours: 13 });
    await cancel(t.member, t.booking);
    const provider = createFakeProvider();
    await processDueRefunds({ rpc: service, provider });
    const hook = provider.makeWebhook({ type: "refund.processed", reference: t.booking, amountCents: 10000, id: "r1" });
    await Promise.all([1, 2, 3].map(() => handlePaymentWebhook({ rawBody: hook.rawBody, signature: hook.signature, provider, rpc: service })));
    expect(await ledger()).toHaveLength(2);
    expect(await sql("select 1 from public.email_outbox where template = 'refund_processed'")).toHaveLength(1);
  });

  it("writes no ledger rows for a refund the provider reports as failed", async () => {
    const t = await paid({ startsInHours: 13 });
    await cancel(t.member, t.booking);
    const provider = createFakeProvider();
    await processDueRefunds({ rpc: service, provider });
    const hook = provider.makeWebhook({ type: "refund.failed", reference: t.booking, amountCents: 10000, id: "r2" });
    await handlePaymentWebhook({ rawBody: hook.rawBody, signature: hook.signature, provider, rpc: service });
    expect((await refunds())[0].status).toBe("failed");
    expect(await ledger()).toHaveLength(0);
  });

  it("retries after provider errors and ends with one refund", async () => {
    const t = await paid({ startsInHours: 13 });
    await cancel(t.member, t.booking);
    const provider = createFakeProvider();
    provider.setRefundOutcome("error");
    expect(await processDueRefunds({ rpc: service, provider })).toMatchObject({ failed: 1 });
    await dueNow();
    expect(await processDueRefunds({ rpc: service, provider })).toMatchObject({ failed: 1 });
    const [afterFails] = await sql<{ attempts: number; status: string }>("select attempts, status from public.refunds");
    expect(afterFails).toEqual({ attempts: 2, status: "pending" });

    provider.setRefundOutcome("success");
    await dueNow();
    expect(await processDueRefunds({ rpc: service, provider })).toMatchObject({ submitted: 1, failed: 0 });
    expect(await refunds()).toHaveLength(1);
    expect(provider.calls.filter((c) => c.method === "refund")).toHaveLength(3);
  });

  it("gives up as failed after 8 attempts so the operator sees it", async () => {
    const t = await paid({ startsInHours: 13 });
    await cancel(t.member, t.booking);
    await sql("update public.refunds set attempts = 7");
    const provider = createFakeProvider();
    provider.setRefundOutcome("error");
    await processDueRefunds({ rpc: service, provider });
    expect((await refunds())[0].status).toBe("failed");
  });

  it("does not refund twice when two job runs start together", async () => {
    const t = await paid({ startsInHours: 13 });
    await cancel(t.member, t.booking);
    const provider = createFakeProvider();
    await Promise.all([processDueRefunds({ rpc: service, provider }), processDueRefunds({ rpc: service, provider })]);
    expect(provider.calls.filter((c) => c.method === "refund")).toHaveLength(1);
  });

  it("finds the existing refund instead of refunding again after a crash that left the row submitting", async () => {
    const t = await paid({ startsInHours: 13 });
    await cancel(t.member, t.booking);
    const provider = createFakeProvider();
    // The provider took the refund, then the run died before recording it.
    await provider.refund({ reference: t.booking, amountCents: 10000 });
    await sql("update public.refunds set status = 'submitting', attempts = 1, next_attempt_at = now() - interval '1 minute'");
    const result = await processDueRefunds({ rpc: service, provider });
    expect(result).toMatchObject({ submitted: 1, failed: 0 });
    expect(provider.calls.filter((c) => c.method === "refund")).toHaveLength(1); // only the pre-crash one
    expect((await refunds())[0].status).toBe("submitted");
  });

  it("checks the provider before retrying a refund whose result was lost, so it is never refunded twice", async () => {
    const t = await paid({ startsInHours: 13 });
    await cancel(t.member, t.booking);
    const provider = createFakeProvider();
    let failedOnce = false;
    const lossy = async (fn: string, args?: Record<string, unknown>) => {
      if (fn === "complete_refund" && !failedOnce) {
        failedOnce = true;
        return { data: null, error: { message: "connection lost" } };
      }
      return service(fn, args);
    };
    expect(await processDueRefunds({ rpc: lossy, provider })).toMatchObject({ failed: 1 });
    await dueNow();
    expect(await processDueRefunds({ rpc: lossy, provider })).toMatchObject({ submitted: 1, failed: 0 });
    expect(provider.calls.filter((c) => c.method === "refund")).toHaveLength(1);
  });

  it("keeps polling a submitted refund and settles it, with its ledger rows, when the provider reports it processed", async () => {
    const t = await paid({ startsInHours: 13 });
    await cancel(t.member, t.booking);
    const provider = createFakeProvider();
    await processDueRefunds({ rpc: service, provider });
    expect((await refunds())[0].status).toBe("submitted");
    expect(await processDueRefunds({ rpc: service, provider })).toMatchObject({ claimed: 0 }); // not due yet

    provider.finishRefunds(t.booking);
    await sql("update public.refunds set next_attempt_at = now() - interval '1 minute'");
    expect(await processDueRefunds({ rpc: service, provider })).toMatchObject({ processed: 1 });
    expect((await refunds())[0].status).toBe("processed");
    expect(await ledger()).toHaveLength(2);
  });

  it("shows refunds that are overdue, or stuck after submission, to the operator", async () => {
    const a = await paid({ startsInHours: 13 });
    await cancel(a.member, a.booking);
    await sql("update public.refunds set next_attempt_at = now() - interval '20 minutes'");
    const b = await paid({ startsInHours: 13 });
    await cancel(b.member, b.booking);
    await sql("update public.refunds set status = 'submitted', created_at = now() - interval '2 days' where booking_id = $1", [b.booking]);
    const kinds = ((await service("operator_problems")).data as { kind: string }[]).map((p) => p.kind);
    expect(kinds).toContain("refund_overdue");
    expect(kinds).toContain("refund_stuck");
  });

  it("refuses members and owners calling the refund functions directly", async () => {
    const member = await makeUser();
    for (const [fn, args] of [
      ["claim_due_refunds", { p_limit: 5 }],
      ["complete_refund", { p_refund_id: "00000000-0000-0000-0000-000000000000", p_provider_refund_id: "x", p_processed: true }],
      ["settle_refund_by_reference", { p_reference: "x", p_outcome: "processed" }],
    ] as const) {
      expect((await makeRpc("authenticated", member)(fn, { ...args })).error?.message).toMatch(/permission denied/);
    }
  });

  it("ignores an unknown provider error type but never loses the message", async () => {
    const t = await paid({ startsInHours: 13 });
    await cancel(t.member, t.booking);
    const provider = createFakeProvider();
    const broken: PaymentProvider = { ...provider, refund: async () => { throw new ProviderError("card network said no", true); } };
    await processDueRefunds({ rpc: service, provider: broken });
    const [r] = await sql<{ last_error: string }>("select last_error from public.refunds");
    expect(r.last_error).toMatch(/card network said no/);
  });
});
