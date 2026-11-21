import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asUser, fillSession, makeBooking, makeGym, makeSession, makeUser, pool, resetData, sql } from "./helpers";

beforeEach(resetData);
afterAll(() => pool.end());

const takeSpot = (userId: string, sessionId: string) =>
  asUser(userId, (q) => q("select * from public.take_spot($1)", [sessionId]));

describe("take_spot", () => {
  it("covers AE1: with 11 of 12 spots taken, two parallel members get exactly one spot", async () => {
    const gym = await makeGym();
    const session = await makeSession(gym.id, { spotLimit: 12 });
    await fillSession(session, 11);
    const a = await makeUser("A");
    const b = await makeUser("B");

    const [ra, rb] = await Promise.all([takeSpot(a, session), takeSpot(b, session)]);
    const outcomes = [ra.rows[0].outcome, rb.rows[0].outcome].sort();
    expect(outcomes).toEqual(["booked", "full"]);
    const [{ n }] = await sql<{ n: number }>("select public.spots_taken($1)::int as n", [session]);
    expect(n).toBe(12);
  });

  it("never exceeds the limit when many members race for the same spots", async () => {
    const gym = await makeGym();
    const session = await makeSession(gym.id, { spotLimit: 3 });
    const members = await Promise.all(Array.from({ length: 10 }, (_, i) => makeUser(`M${i}`)));
    const results = await Promise.all(members.map((m) => takeSpot(m, session)));
    expect(results.filter((r) => r.rows[0].outcome === "booked")).toHaveLength(3);
    const [{ n }] = await sql<{ n: number }>("select public.spots_taken($1)::int as n", [session]);
    expect(n).toBe(3);
  });

  it("books a pending hold that lasts about 10 minutes and returns price and fee from the session", async () => {
    const gym = await makeGym({ feeBps: 700 });
    const session = await makeSession(gym.id, { priceCents: 15000 });
    const member = await makeUser();
    const { rows } = await takeSpot(member, session);
    expect(rows[0]).toMatchObject({ outcome: "booked", price_cents: 15000, fee_bps: 700 });
    const [b] = await sql<{ status: string; secs: number }>(
      "select status, extract(epoch from hold_expires_at - now())::int as secs from public.bookings where id = $1",
      [rows[0].booking_id],
    );
    expect(b.status).toBe("pending");
    expect(b.secs).toBeGreaterThan(590);
    expect(b.secs).toBeLessThanOrEqual(600);
  });

  it("keeps a pending hold counted for 3 minutes of grace after it expires, then frees the spot", async () => {
    const gym = await makeGym();
    const session = await makeSession(gym.id, { spotLimit: 1 });
    const holder = await makeUser("Holder");
    await makeBooking(session, holder, "pending", -1); // expired one second ago
    const newcomer = await makeUser("New");

    expect((await takeSpot(newcomer, session)).rows[0].outcome).toBe("full");

    await sql("update public.bookings set hold_expires_at = now() - interval '4 minutes' where session_id = $1", [session]);
    expect((await takeSpot(newcomer, session)).rows[0].outcome).toBe("booked");
    const [old] = await sql<{ status: string }>("select status from public.bookings where member_id = $1", [holder]);
    expect(old.status).toBe("expired");
  });

  it("lets a member whose own hold expired start again", async () => {
    const gym = await makeGym();
    const session = await makeSession(gym.id, { spotLimit: 5 });
    const member = await makeUser();
    await makeBooking(session, member, "pending", -30);
    const { rows } = await takeSpot(member, session);
    expect(rows[0].outcome).toBe("booked");
  });

  it("refuses a member who already holds a confirmed or live pending booking on the date", async () => {
    const gym = await makeGym();
    const session = await makeSession(gym.id);
    const member = await makeUser();
    await makeBooking(session, member, "confirmed");
    await expect(takeSpot(member, session)).rejects.toThrow(/already_booked/);
    const other = await makeUser();
    await makeBooking(session, other, "pending", 300);
    await expect(takeSpot(other, session)).rejects.toThrow(/already_booked/);
  });

  it("refuses cancelled sessions, sessions 15 days ahead, and sessions that started", async () => {
    const gym = await makeGym();
    const member = await makeUser();
    await expect(takeSpot(member, await makeSession(gym.id, { cancelled: true }))).rejects.toThrow(/session_cancelled/);
    await expect(takeSpot(member, await makeSession(gym.id, { startsInHours: 15 * 24 }))).rejects.toThrow(/outside_window/);
    await expect(takeSpot(member, await makeSession(gym.id, { startsInHours: -1 }))).rejects.toThrow(/session_started/);
  });

  it("refuses a gym with no connected payment account", async () => {
    const gym = await makeGym({ connected: false });
    const session = await makeSession(gym.id);
    await expect(takeSpot(await makeUser(), session)).rejects.toThrow(/gym_not_connected/);
  });

  it("refuses callers who are not signed in", async () => {
    const gym = await makeGym();
    const session = await makeSession(gym.id);
    await expect(asUser(undefined, (q) => q("select * from public.take_spot($1)", [session]), "anon")).rejects.toThrow();
  });

  it("counts a live waitlist offer as a taken spot for everyone but the holder", async () => {
    const gym = await makeGym();
    const session = await makeSession(gym.id, { spotLimit: 1 });
    const holder = await makeUser("Holder");
    const other = await makeUser("Other");
    const [{ id: entryId }] = await sql<{ id: string }>(
      "insert into public.waitlist_entries (gym_id, session_id, member_id) values ($1, $2, $3) returning id",
      [gym.id, session, holder],
    );
    await sql(
      "insert into public.waitlist_offers (entry_id, gym_id, session_id, member_id, offer_end) values ($1, $2, $3, $4, now() + interval '1 hour')",
      [entryId, gym.id, session, holder],
    );
    expect((await takeSpot(other, session)).rows[0].outcome).toBe("full");
    expect((await takeSpot(holder, session)).rows[0].outcome).toBe("booked");
    const [{ n }] = await sql<{ n: number }>("select public.spots_taken($1)::int as n", [session]);
    expect(n).toBe(1); // the booking replaces the offer, the spot is counted once
  });
});

describe("set_spot_limit", () => {
  const setLimit = (userId: string, sessionId: string, limit: number) =>
    asUser(userId, (q) => q("select public.set_spot_limit($1, $2)", [sessionId, limit]));

  async function owner(gymId: string) {
    const id = await makeUser("Owner");
    await sql("insert into public.gym_staff (gym_id, user_id, role) values ($1, $2, 'owner')", [gymId, id]);
    return id;
  }

  it("covers AE9: with 9 spots taken, 8 is refused and 9 is accepted", async () => {
    const gym = await makeGym();
    const session = await makeSession(gym.id, { spotLimit: 12 });
    await fillSession(session, 9);
    const o = await owner(gym.id);
    await expect(setLimit(o, session, 8)).rejects.toThrow(/limit_below_taken/);
    await setLimit(o, session, 9);
    const [s] = await sql<{ spot_limit: number }>("select spot_limit from public.class_sessions where id = $1", [session]);
    expect(s.spot_limit).toBe(9);
  });

  it("never leaves spots taken above the limit when a limit edit races bookings", async () => {
    const gym = await makeGym();
    const session = await makeSession(gym.id, { spotLimit: 12 });
    await fillSession(session, 8);
    const o = await owner(gym.id);
    const members = await Promise.all(Array.from({ length: 6 }, (_, i) => makeUser(`R${i}`)));
    await Promise.allSettled([setLimit(o, session, 9), ...members.map((m) => takeSpot(m, session))]);
    const [row] = await sql<{ taken: number; spot_limit: number }>(
      "select public.spots_taken(id)::int as taken, spot_limit from public.class_sessions where id = $1",
      [session],
    );
    expect(row.taken).toBeLessThanOrEqual(row.spot_limit);
  });

  it("refuses staff of another gym", async () => {
    const gymA = await makeGym();
    const gymB = await makeGym();
    const sessionB = await makeSession(gymB.id, { spotLimit: 12 });
    const ownerA = await owner(gymA.id);
    await expect(setLimit(ownerA, sessionB, 5)).rejects.toThrow(/not_staff/);
    const [s] = await sql<{ spot_limit: number }>("select spot_limit from public.class_sessions where id = $1", [sessionB]);
    expect(s.spot_limit).toBe(12);
  });
});
