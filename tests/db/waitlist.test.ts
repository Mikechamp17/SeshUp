import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeBooking, makeGym, makePaidBooking, makeRpc, makeSession, makeStaff, makeUser, pool, resetData, sql } from "./helpers";

beforeEach(resetData);
afterAll(() => pool.end());

const member = (id: string) => makeRpc("authenticated", id);
const join = (id: string, session: string) => member(id)("join_waitlist", { p_session_id: session });
const leave = (id: string, session: string) => member(id)("leave_waitlist", { p_session_id: session });
const cancel = (id: string, booking: string) => member(id)("cancel_booking", { p_booking_id: booking });
const takeSpot = async (id: string, session: string) =>
  ((await member(id)("take_spot", { p_session_id: session })).data as { outcome: string }[])[0].outcome;
const spotsTaken = async (s: string) => (await sql<{ n: number }>("select public.spots_taken($1)::int as n", [s]))[0].n;
const offers = () => sql<{ member_id: string; secs: number }>("select member_id, extract(epoch from offer_end - now())::int as secs from public.waitlist_offers order by created_at");
const offerMail = () => sql<{ recipient: string }>("select recipient from public.email_outbox where template = 'waitlist_offer' order by recipient");

/** A full class: `limit` paid bookings, plus waitlisted members in order. */
async function fullClass(opts: { startsInHours?: number; limit?: number; waiters?: number } = {}) {
  const gym = await makeGym();
  const limit = opts.limit ?? 1;
  const session = await makeSession(gym.id, { startsInHours: opts.startsInHours ?? 24, spotLimit: limit });
  const booked: { member: string; booking: string }[] = [];
  for (let i = 0; i < limit; i++) {
    const m = await makeUser(`B${i}`, `b${i}@x.test`);
    booked.push({ member: m, booking: await makePaidBooking(session, m) });
  }
  const waiters: string[] = [];
  for (let i = 0; i < (opts.waiters ?? 0); i++) {
    const w = await makeUser(`W${i}`, `w${i}@x.test`);
    expect((await join(w, session)).error).toBeNull();
    await sql("update public.waitlist_entries set created_at = now() + make_interval(secs => $2) where member_id = $1", [w, i]);
    waiters.push(w);
  }
  return { gym, session, booked, waiters };
}

describe("joining and leaving", () => {
  it("lets a member join only when the class is full", async () => {
    const gym = await makeGym();
    const session = await makeSession(gym.id, { spotLimit: 2 });
    const m = await makeUser();
    expect((await join(m, session)).error?.message).toMatch(/not_full/);
    await makeBooking(session, await makeUser(), "confirmed");
    await makeBooking(session, await makeUser(), "confirmed");
    expect((await join(m, session)).error).toBeNull();
  });

  it("refuses a member who is already booked or already waiting", async () => {
    const t = await fullClass({ waiters: 1 });
    expect((await join(t.booked[0].member, t.session)).error?.message).toMatch(/already_booked/);
    expect((await join(t.waiters[0], t.session)).error?.message).toMatch(/already_waitlisted/);
  });

  it("refuses cancelled and started classes", async () => {
    const gym = await makeGym();
    const m = await makeUser();
    const cancelled = await makeSession(gym.id, { cancelled: true });
    expect((await join(m, cancelled)).error?.message).toMatch(/session_cancelled/);
    const started = await makeSession(gym.id, { startsInHours: -1 });
    expect((await join(m, started)).error?.message).toMatch(/session_started/);
  });
});

describe("offers", () => {
  it("covers AE4: a cancel offers the spot only to the first of three, and when that offer lapses the second gets it and the first is never charged", async () => {
    const t = await fullClass({ waiters: 3 });
    await cancel(t.booked[0].member, t.booked[0].booking);

    expect((await offers()).map((o) => o.member_id)).toEqual([t.waiters[0]]);
    expect((await offerMail()).map((m) => m.recipient)).toEqual(["w0@x.test"]);

    await sql("update public.waitlist_offers set offer_end = now() - interval '1 minute'");
    await sql("select public.tidy()");

    expect((await offers()).map((o) => o.member_id)).toEqual([t.waiters[1]]);
    expect((await offerMail()).map((m) => m.recipient)).toEqual(["w0@x.test", "w1@x.test"]);
    expect(await sql("select 1 from public.bookings where member_id = $1", [t.waiters[0]])).toHaveLength(0);
    expect(await sql("select 1 from public.payments p join public.bookings b on b.id = p.booking_id where b.member_id = $1", [t.waiters[0]])).toHaveLength(0);
    expect(await sql("select 1 from public.waitlist_entries where member_id = $1", [t.waiters[0]])).toHaveLength(0);
  });

  it("covers AE8: the offer is 2 hours, cut to end 30 minutes before class, and opens to everyone when under 15 minutes would remain", async () => {
    // Class in 4 hours: a full 2 hour offer.
    const far = await fullClass({ startsInHours: 4, waiters: 1 });
    await cancel(far.booked[0].member, far.booked[0].booking);
    const [farOffer] = await offers();
    expect(farOffer.secs).toBeGreaterThan(7190);
    expect(farOffer.secs).toBeLessThanOrEqual(7200);
  });

  it("ends the offer 30 minutes before a class that is 90 minutes away", async () => {
    const t = await fullClass({ startsInHours: 1.5, waiters: 1 });
    await cancel(t.booked[0].member, t.booked[0].booking);
    const [o] = await offers();
    expect(o.secs).toBeGreaterThan(3590); // 60 minutes from now
    expect(o.secs).toBeLessThanOrEqual(3600);
  });

  it("offers nothing and opens the spot to everyone when the class is 40 minutes away", async () => {
    const t = await fullClass({ startsInHours: 40 / 60, waiters: 1 });
    await cancel(t.booked[0].member, t.booked[0].booking);
    expect(await offers()).toHaveLength(0);
    const stranger = await makeUser("Walk-in");
    expect(await takeSpot(stranger, t.session)).toBe("booked");
  });

  it("gives two freed spots to the first two waiting members", async () => {
    const t = await fullClass({ limit: 2, waiters: 3 });
    await Promise.all(t.booked.map((b) => cancel(b.member, b.booking)));
    expect((await offers()).map((o) => o.member_id).sort()).toEqual([t.waiters[0], t.waiters[1]].sort());
  });

  it("gives exactly two offers to two different members when two cancels run in parallel", async () => {
    const t = await fullClass({ limit: 2, waiters: 3 });
    await Promise.all([cancel(t.booked[0].member, t.booked[0].booking), cancel(t.booked[1].member, t.booked[1].booking)]);
    const rows = await offers();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.member_id)).size).toBe(2);
  });

  it("keeps the spot for the offer holder and from everyone else", async () => {
    const t = await fullClass({ waiters: 2 });
    await cancel(t.booked[0].member, t.booked[0].booking);
    const stranger = await makeUser("Stranger");
    expect(await takeSpot(stranger, t.session)).toBe("full");
    expect(await takeSpot(t.waiters[1], t.session)).toBe("full");
    expect(await takeSpot(t.waiters[0], t.session)).toBe("booked");
  });

  it("counts the spot once while the holder is checking out", async () => {
    const t = await fullClass({ waiters: 1 });
    await cancel(t.booked[0].member, t.booked[0].booking);
    expect(await spotsTaken(t.session)).toBe(1);
    await takeSpot(t.waiters[0], t.session);
    expect(await spotsTaken(t.session)).toBe(1);
  });

  it("keeps the spot reserved when the holder's checkout lapses mid-offer, and creates no second offer", async () => {
    const t = await fullClass({ waiters: 2 });
    await cancel(t.booked[0].member, t.booked[0].booking);
    expect(await takeSpot(t.waiters[0], t.session)).toBe("booked");
    await sql("update public.bookings set hold_expires_at = now() - interval '4 minutes' where member_id = $1", [t.waiters[0]]);
    await sql("select public.tidy()");
    expect(await offers()).toHaveLength(1);
    expect(await takeSpot(t.waiters[1], t.session)).toBe("full");
    expect(await takeSpot(t.waiters[0], t.session)).toBe("booked"); // can check out again
    expect(await offers()).toHaveLength(1);
  });

  it("hands a spot whose hold ran out to the waitlist before a walk-in can take it", async () => {
    const t = await fullClass({ waiters: 1 });
    await sql("update public.bookings set status = 'pending', hold_expires_at = now() - interval '4 minutes' where id = $1", [t.booked[0].booking]);
    const walkIn = await makeUser("Walk-in");
    expect(await takeSpot(walkIn, t.session)).toBe("full");
    expect((await offers()).map((o) => o.member_id)).toEqual([t.waiters[0]]);
  });

  it("confirms the holder's booking, removes their entry and offer, and leaves spots left at zero", async () => {
    const t = await fullClass({ waiters: 1 });
    await cancel(t.booked[0].member, t.booked[0].booking);
    const holderBooking = ((await member(t.waiters[0])("take_spot", { p_session_id: t.session })).data as { booking_id: string }[])[0].booking_id;
    await sql("insert into public.payments (gym_id, booking_id, amount_cents, fee_cents, provider_reference, status) values ($1,$2,10000,500,$3,'initiated')", [t.gym.id, holderBooking, holderBooking]);
    const res = await makeRpc("service_role")("confirm_payment", {
      p_reference: holderBooking, p_status: "success", p_amount_cents: 10000, p_currency: "ZAR", p_subaccount_code: "ACCT_test", p_charge_cents: 500,
    });
    expect((res.data as { outcome: string }).outcome).toBe("confirmed");
    expect(await sql("select 1 from public.waitlist_entries")).toHaveLength(0);
    expect(await offers()).toHaveLength(0);
    expect(await spotsTaken(t.session)).toBe(1);
  });

  it("passes a live offer to the next member when the holder leaves the waitlist", async () => {
    const t = await fullClass({ waiters: 2 });
    await cancel(t.booked[0].member, t.booked[0].booking);
    await leave(t.waiters[0], t.session);
    expect((await offers()).map((o) => o.member_id)).toEqual([t.waiters[1]]);
  });

  it("offers newly raised spots to the waitlist when the owner raises the limit", async () => {
    const t = await fullClass({ waiters: 1 });
    const owner = await makeStaff(t.gym.id);
    await makeRpc("authenticated", owner)("set_spot_limit", { p_session_id: t.session, p_limit: 2 });
    expect((await offers()).map((o) => o.member_id)).toEqual([t.waiters[0]]);
  });

  it("offers a spot when a failed checkout frees one", async () => {
    const gym = await makeGym();
    const session = await makeSession(gym.id, { spotLimit: 1 });
    const payer = await makeUser("Payer");
    await makeBooking(session, payer, "pending", 300);
    const waiter = await makeUser("Waiter", "waiter@x.test");
    await join(waiter, session);
    await makeRpc("service_role")("release_booking", { p_booking_id: (await sql<{ id: string }>("select id from public.bookings"))[0].id });
    expect((await offers()).map((o) => o.member_id)).toEqual([waiter]);
  });

  it("refuses callers who are not signed in or who call the internal offer function", async () => {
    const t = await fullClass({ waiters: 1 });
    expect((await member(t.waiters[0])("offer_next", { p_session_id: t.session })).error?.message).toMatch(/permission denied/);
    expect((await makeRpc("anon")("join_waitlist", { p_session_id: t.session })).error?.message).toMatch(/permission denied/);
  });
});
