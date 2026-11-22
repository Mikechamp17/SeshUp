import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asUser, fillSession, makeBooking, makeGym, makeSession, makeStaff, makeUser, pool, resetData, sql } from "./helpers";

beforeEach(resetData);
afterAll(() => pool.end());

describe("tenancy and row-level security", () => {
  it("lets an owner see only their own gym's sessions, bookings, and members", async () => {
    const gymA = await makeGym();
    const gymB = await makeGym();
    const ownerA = await makeStaff(gymA.id);
    const sessionA = await makeSession(gymA.id);
    const sessionB = await makeSession(gymB.id);
    const memberA = await makeUser("Only A");
    const memberB = await makeUser("Only B");
    await makeBooking(sessionA, memberA);
    await makeBooking(sessionB, memberB);

    const sessions = await asUser(ownerA, (q) => q("select id from public.class_sessions"));
    expect(sessions.rows.map((r) => r.id)).toEqual([sessionA]);
    const bookings = await asUser(ownerA, (q) => q("select member_id from public.bookings"));
    expect(bookings.rows.map((r) => r.member_id)).toEqual([memberA]);
    const profiles = await asUser(ownerA, (q) => q("select id from public.profiles where id in ($1, $2)", [memberA, memberB]));
    expect(profiles.rows.map((r) => r.id)).toEqual([memberA]);
  });

  it("lets a member read only their own bookings, across two gyms", async () => {
    const gymA = await makeGym();
    const gymB = await makeGym();
    const me = await makeUser("Me");
    const someoneElse = await makeUser("Else");
    await makeBooking(await makeSession(gymA.id), me);
    await makeBooking(await makeSession(gymB.id), me);
    await makeBooking(await makeSession(gymA.id), someoneElse);
    const rows = await asUser(me, (q) => q("select member_id from public.bookings"));
    expect(rows.rowCount).toBe(2);
    expect(rows.rows.every((r) => r.member_id === me)).toBe(true);
  });

  it("gives the anonymous role the public timetable and no table access", async () => {
    const gym = await makeGym({ slug: "pilot-gym" });
    await makeSession(gym.id);
    const tt = await asUser(undefined, (q) => q("select * from public.public_timetable($1, now(), now() + interval '7 days')", ["pilot-gym"]), "anon");
    expect(tt.rowCount).toBe(1);
    for (const table of ["gyms", "class_sessions", "bookings", "profiles", "payments"]) {
      await expect(asUser(undefined, (q) => q(`select * from public.${table}`), "anon")).rejects.toThrow(/permission denied/);
    }
  });

  it("reports spots left that subtract confirmed, unexpired pending, and offered spots", async () => {
    const gym = await makeGym({ slug: "g1" });
    const session = await makeSession(gym.id, { spotLimit: 10 });
    await fillSession(session, 3);
    await makeBooking(session, await makeUser(), "pending", 300);
    await makeBooking(session, await makeUser(), "pending", -3600); // long expired
    const waiter = await makeUser();
    const [{ id: entry }] = await sql<{ id: string }>(
      "insert into public.waitlist_entries (gym_id, session_id, member_id) values ($1,$2,$3) returning id",
      [gym.id, session, waiter],
    );
    await sql("insert into public.waitlist_offers (entry_id, gym_id, session_id, member_id, offer_end) values ($1,$2,$3,$4, now() + interval '1 hour')", [
      entry, gym.id, session, waiter,
    ]);
    const tt = await asUser(undefined, (q) => q("select spots_left from public.public_timetable('g1', now(), now() + interval '7 days')"), "anon");
    expect(tt.rows[0].spots_left).toBe(5);
  });

  it("limits the public timetable range to 3 weeks and omits cancelled sessions", async () => {
    const gym = await makeGym({ slug: "g2" });
    await makeSession(gym.id, { cancelled: true });
    const live = await asUser(undefined, (q) => q("select * from public.public_timetable('g2', now(), now() + interval '7 days')"), "anon");
    expect(live.rowCount).toBe(0);
    await expect(
      asUser(undefined, (q) => q("select * from public.public_timetable('g2', now(), now() + interval '30 days')"), "anon"),
    ).rejects.toThrow(/range_too_long/);
  });

  it("refuses an authenticated caller executing internal functions", async () => {
    const gym = await makeGym();
    const session = await makeSession(gym.id);
    const member = await makeUser();
    await expect(asUser(member, (q) => q("select public.spots_taken($1)", [session]))).rejects.toThrow(/permission denied/);
  });

  it("refuses an owner changing their gym's fee, sub-account, or a booking's status", async () => {
    const gym = await makeGym();
    const owner = await makeStaff(gym.id);
    const session = await makeSession(gym.id);
    const booking = await makeBooking(session, await makeUser(), "pending");
    await expect(asUser(owner, (q) => q("update public.gyms set fee_bps = 0 where id = $1", [gym.id]))).rejects.toThrow(/permission denied/);
    await expect(
      asUser(owner, (q) => q("update public.gyms set paystack_subaccount_code = 'ACCT_evil' where id = $1", [gym.id])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(owner, (q) => q("update public.bookings set status = 'confirmed' where id = $1", [booking])),
    ).rejects.toThrow(/permission denied/);
    const [b] = await sql<{ status: string }>("select status from public.bookings where id = $1", [booking]);
    expect(b.status).toBe("pending");
  });

  it("refuses an owner directly updating the cancelled flag, start time, or spot limit", async () => {
    const gym = await makeGym();
    const owner = await makeStaff(gym.id);
    const session = await makeSession(gym.id, { spotLimit: 12 });
    for (const set of ["cancelled = true", "starts_at = now() + interval '2 days'", "spot_limit = 1", "time_changed = true"]) {
      await expect(asUser(owner, (q) => q(`update public.class_sessions set ${set} where id = $1`, [session]))).rejects.toThrow(
        /permission denied/,
      );
    }
    const updated = await asUser(owner, (q) => q("update public.class_sessions set price_cents = 12000 where id = $1", [session]));
    expect(updated.rowCount).toBe(1);
  });

  it("refuses staff of gym A reading or changing gym B's classes and coaches", async () => {
    const gymA = await makeGym();
    const gymB = await makeGym();
    const ownerA = await makeStaff(gymA.id);
    const sessionB = await makeSession(gymB.id);
    const updated = await asUser(ownerA, (q) => q("update public.class_sessions set price_cents = 1 where id = $1", [sessionB]));
    expect(updated.rowCount).toBe(0);
    await expect(
      asUser(ownerA, (q) => q("insert into public.coaches (gym_id, name) values ($1, 'Sneaky')", [gymB.id])),
    ).rejects.toThrow(/row-level security/);
  });

  it("refuses deleting a profile or session that has payments, and keeps ledger history", async () => {
    const gym = await makeGym();
    const session = await makeSession(gym.id);
    const member = await makeUser();
    const booking = await makeBooking(session, member);
    await sql(
      "insert into public.payments (gym_id, booking_id, amount_cents, fee_cents, provider_reference, status) values ($1,$2,10000,500,$3,'succeeded')",
      [gym.id, booking, booking],
    );
    await expect(sql("delete from public.class_sessions where id = $1", [session])).rejects.toThrow(/foreign key/);
    await expect(sql("delete from public.profiles where id = $1", [member])).rejects.toThrow(/foreign key/);
    await expect(sql("delete from public.gyms where id = $1", [gym.id])).rejects.toThrow(/foreign key/);
  });

  it("lets a member read a gym's public details but not its fee or payout account", async () => {
    const gym = await makeGym({ feeBps: 700 });
    const member = await makeUser();
    await makeBooking(await makeSession(gym.id), member);
    const ok = await asUser(member, (q) => q("select id, name, slug, timezone from public.gyms"));
    expect(ok.rowCount).toBe(1);
    await expect(asUser(member, (q) => q("select fee_bps from public.gyms"))).rejects.toThrow(/permission denied/);
    await expect(asUser(member, (q) => q("select paystack_subaccount_code from public.gyms"))).rejects.toThrow(/permission denied/);
    await expect(asUser(member, (q) => q("select * from public.gyms"))).rejects.toThrow(/permission denied/);
  });

  it("creates a profile from the sign-up name and email", async () => {
    const id = await makeUser("Thandi", "thandi@example.test");
    const [p] = await sql<{ name: string; email: string }>("select name, email from public.profiles where id = $1", [id]);
    expect(p).toEqual({ name: "Thandi", email: "thandi@example.test" });
  });

  it("allows one booking per member per class date even under a race at the database level", async () => {
    const gym = await makeGym();
    const session = await makeSession(gym.id);
    const member = await makeUser();
    await makeBooking(session, member, "confirmed");
    await expect(makeBooking(session, member, "pending")).rejects.toThrow(/duplicate key/);
  });
});
