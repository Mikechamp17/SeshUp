import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asUser, makeBooking, makeGym, makeSession, makeStaff, makeUser, pool, resetData, sql } from "./helpers";

beforeEach(resetData);
afterAll(() => pool.end());

type SeriesInput = { weekdays?: number[]; startTime?: string; price?: number; spotLimit?: number };

async function makeSeries(gymId: string, ownerId: string, input: SeriesInput = {}) {
  const res = await asUser(ownerId, (q) =>
    q(
      `insert into public.class_series (gym_id, name, level, weekdays, start_time, length_minutes, spot_limit, price_cents)
       values ($1, 'Boxing Basics', 'Beginner', $2::smallint[], $3, 60, $4, $5) returning id`,
      [gymId, input.weekdays ?? [1, 3], input.startTime ?? "18:00", input.spotLimit ?? 12, input.price ?? 10000],
    ),
  );
  const id = res.rows[0].id as string;
  await asUser(ownerId, (q) => q("select public.generate_my_series_sessions($1)", [id]));
  return id;
}

const updateSeries = (ownerId: string, seriesId: string, over: Partial<{ price: number; startTime: string; weekdays: number[]; spotLimit: number }> = {}) =>
  asUser(ownerId, (q) =>
    q("select public.update_series($1, 'Boxing Basics', '', 'Beginner', null, $2::smallint[], $3, 60, $4, $5, 12)", [
      seriesId,
      over.weekdays ?? [1, 3],
      over.startTime ?? "18:00",
      over.spotLimit ?? 12,
      over.price ?? 10000,
    ]),
  );

describe("session generation", () => {
  it("covers AE5: generates the Monday and Wednesday dates for the window, and cancelling one Wednesday leaves the rest bookable", async () => {
    const gym = await makeGym();
    const owner = await makeStaff(gym.id);
    const series = await makeSeries(gym.id, owner);
    const sessions = await sql<{ id: string; local_date: string; starts_at: Date }>(
      "select id, to_char(local_date, 'YYYY-MM-DD') as local_date, starts_at from public.class_sessions where series_id = $1 order by starts_at",
      [series],
    );
    expect(sessions.length).toBeGreaterThanOrEqual(4);
    for (const s of sessions) {
      const dow = new Date(`${s.local_date}T12:00:00Z`).getUTCDay(); // 1 = Monday, 3 = Wednesday
      expect([1, 3]).toContain(dow);
      expect(s.starts_at.toISOString().slice(11, 16)).toBe("16:00"); // 18:00 Johannesburg is 16:00 UTC
    }
    const wednesday = sessions.find((s) => new Date(`${s.local_date}T12:00:00Z`).getUTCDay() === 3)!;
    await sql("update public.class_sessions set cancelled = true where id = $1", [wednesday.id]);
    const member = await makeUser();
    for (const s of sessions.filter((x) => x.id !== wednesday.id && x.starts_at.getTime() < Date.now() + 13 * 86400000)) {
      const res = await asUser(member, (q) => q("select * from public.take_spot($1)", [s.id]));
      expect(res.rows[0].outcome).toBe("booked");
      await sql("delete from public.bookings where session_id = $1", [s.id]);
    }
  });

  it("creates no duplicates when generation runs twice", async () => {
    const gym = await makeGym();
    const owner = await makeStaff(gym.id);
    const series = await makeSeries(gym.id, owner);
    const [{ before }] = await sql<{ before: number }>("select count(*)::int as before from public.class_sessions where series_id = $1", [series]);
    await asUser(owner, (q) => q("select public.generate_my_series_sessions($1)", [series]));
    await sql("select public.tidy()");
    const [{ after }] = await sql<{ after: number }>("select count(*)::int as after from public.class_sessions where series_id = $1", [series]);
    expect(after).toBe(before);
  });

  it("extends the window for every series when the per-minute tidy runs", async () => {
    const gym = await makeGym();
    const owner = await makeStaff(gym.id);
    const series = await makeSeries(gym.id, owner);
    await sql("delete from public.class_sessions where series_id = $1", [series]);
    await sql("select public.tidy()");
    const [{ n }] = await sql<{ n: number }>("select count(*)::int as n from public.class_sessions where series_id = $1", [series]);
    expect(n).toBeGreaterThan(0);
  });

  it("refuses a coach from another gym on a series", async () => {
    const gymA = await makeGym();
    const gymB = await makeGym();
    const owner = await makeStaff(gymA.id);
    const [{ id: coachB }] = await sql<{ id: string }>("insert into public.coaches (gym_id, name) values ($1, 'Other') returning id", [gymB.id]);
    await expect(
      asUser(owner, (q) =>
        q(
          `insert into public.class_series (gym_id, name, level, coach_id, weekdays, start_time, length_minutes, spot_limit, price_cents)
           values ($1, 'X', 'Beginner', $2, '{1}'::smallint[], '18:00', 60, 5, 1000)`,
          [gymA.id, coachB],
        ),
      ),
    ).rejects.toThrow(/coach_wrong_gym/);
  });
});

describe("series edits", () => {
  it("updates future sessions with no bookings and leaves a session with a booking unchanged", async () => {
    const gym = await makeGym();
    const owner = await makeStaff(gym.id);
    const series = await makeSeries(gym.id, owner, { price: 10000 });
    const sessions = await sql<{ id: string }>("select id from public.class_sessions where series_id = $1 order by starts_at", [series]);
    const booked = sessions[0].id;
    await makeBooking(booked, await makeUser(), "confirmed");
    await updateSeries(owner, series, { price: 12000 });
    const rows = await sql<{ id: string; price_cents: number }>("select id, price_cents from public.class_sessions where series_id = $1", [series]);
    expect(rows.find((r) => r.id === booked)!.price_cents).toBe(10000);
    for (const r of rows.filter((x) => x.id !== booked)) expect(r.price_cents).toBe(12000);
  });

  it("leaves a single-date edit alone when the series changes", async () => {
    const gym = await makeGym();
    const owner = await makeStaff(gym.id);
    const series = await makeSeries(gym.id, owner, { price: 10000 });
    const [{ id: target }] = await sql<{ id: string }>("select id from public.class_sessions where series_id = $1 order by starts_at limit 1", [series]);
    await asUser(owner, (q) => q("update public.class_sessions set price_cents = 9000 where id = $1", [target]));
    await updateSeries(owner, series, { price: 12000 });
    const [row] = await sql<{ price_cents: number }>("select price_cents from public.class_sessions where id = $1", [target]);
    expect(row.price_cents).toBe(9000);
  });

  it("applies a single-date price change only to later bookings", async () => {
    const gym = await makeGym();
    const owner = await makeStaff(gym.id);
    const session = await makeSession(gym.id, { priceCents: 10000 });
    const first = await makeUser();
    const booked = await asUser(first, (q) => q("select * from public.take_spot($1)", [session]));
    await sql("insert into public.payments (gym_id, booking_id, amount_cents, fee_cents, provider_reference, status) values ($1,$2,10000,500,$3,'initiated')", [
      gym.id, booked.rows[0].booking_id, booked.rows[0].booking_id,
    ]);
    await asUser(owner, (q) => q("update public.class_sessions set price_cents = 15000 where id = $1", [session]));
    const second = await asUser(await makeUser(), (q) => q("select * from public.take_spot($1)", [session]));
    expect(second.rows[0].price_cents).toBe(15000);
    const [p] = await sql<{ amount_cents: number }>("select amount_cents from public.payments where booking_id = $1", [booked.rows[0].booking_id]);
    expect(p.amount_cents).toBe(10000);
  });

  it("leaves a date unchanged when a booking holds its lock while the series edit runs", async () => {
    const gym = await makeGym();
    const owner = await makeStaff(gym.id);
    const series = await makeSeries(gym.id, owner, { price: 10000 });
    const [{ id: target }] = await sql<{ id: string }>("select id from public.class_sessions where series_id = $1 order by starts_at limit 1", [series]);
    const member = await makeUser();

    const booker = await pool.connect();
    await booker.query("begin");
    await booker.query("set local role authenticated");
    await booker.query("select set_config('request.jwt.claim.sub', $1, true)", [member]);
    await booker.query("select * from public.take_spot($1)", [target]); // holds the session lock

    const edit = updateSeries(owner, series, { price: 12000 }); // blocks on that lock
    await new Promise((r) => setTimeout(r, 300));
    await booker.query("commit");
    booker.release();
    await edit;

    const [row] = await sql<{ price_cents: number }>("select price_cents from public.class_sessions where id = $1", [target]);
    expect(row.price_cents).toBe(10000);
  });

  it("refuses staff of another gym", async () => {
    const gymA = await makeGym();
    const gymB = await makeGym();
    const ownerA = await makeStaff(gymA.id);
    const ownerB = await makeStaff(gymB.id);
    const seriesB = await makeSeries(gymB.id, ownerB);
    await expect(updateSeries(ownerA, seriesB, { price: 1 })).rejects.toThrow(/not_staff/);
    await expect(asUser(ownerA, (q) => q("select public.generate_my_series_sessions($1)", [seriesB]))).rejects.toThrow(/not_staff/);
  });
});

describe("single-date time change", () => {
  const changeTime = (ownerId: string, sessionId: string, hoursFromNow: number) =>
    asUser(ownerId, (q) => q("select public.change_session_time($1, now() + make_interval(hours => $2))", [sessionId, hoursFromNow]));

  it("emails each booked member, marks the date as time-changed, and skips members who only hold a pending spot", async () => {
    const gym = await makeGym();
    const owner = await makeStaff(gym.id);
    const session = await makeSession(gym.id, { startsInHours: 48 });
    const a = await makeUser("A", "a@x.test");
    const b = await makeUser("B", "b@x.test");
    const pending = await makeUser("P", "p@x.test");
    await makeBooking(session, a, "confirmed");
    await makeBooking(session, b, "confirmed");
    await makeBooking(session, pending, "pending", 300);

    await changeTime(owner, session, 50);

    const mail = await sql<{ recipient: string; template: string; data: Record<string, string> }>(
      "select recipient, template, data from public.email_outbox order by recipient",
    );
    expect(mail.map((m) => m.recipient)).toEqual(["a@x.test", "b@x.test"]);
    expect(mail.every((m) => m.template === "class_time_changed")).toBe(true);
    expect(mail[0].data).toMatchObject({ className: "Boxing Basics", timezone: "Africa/Johannesburg" });
    expect(mail[0].data.newStartsAt).toBeTruthy();
    const [s] = await sql<{ time_changed: boolean }>("select time_changed from public.class_sessions where id = $1", [session]);
    expect(s.time_changed).toBe(true);
  });

  it("does not mark a date with no bookings as time-changed", async () => {
    const gym = await makeGym();
    const owner = await makeStaff(gym.id);
    const session = await makeSession(gym.id, { startsInHours: 48 });
    await changeTime(owner, session, 50);
    const [s] = await sql<{ time_changed: boolean }>("select time_changed from public.class_sessions where id = $1", [session]);
    expect(s.time_changed).toBe(false);
  });

  it("refuses staff of another gym and changes nothing", async () => {
    const gymA = await makeGym();
    const gymB = await makeGym();
    const ownerA = await makeStaff(gymA.id);
    const sessionB = await makeSession(gymB.id, { startsInHours: 48 });
    const before = await sql<{ starts_at: Date }>("select starts_at from public.class_sessions where id = $1", [sessionB]);
    await expect(changeTime(ownerA, sessionB, 50)).rejects.toThrow(/not_staff/);
    const after = await sql<{ starts_at: Date }>("select starts_at from public.class_sessions where id = $1", [sessionB]);
    expect(after[0].starts_at).toEqual(before[0].starts_at);
  });

  it("refuses a time in the past and a cancelled date", async () => {
    const gym = await makeGym();
    const owner = await makeStaff(gym.id);
    const session = await makeSession(gym.id, { startsInHours: 48 });
    await expect(changeTime(owner, session, -1)).rejects.toThrow(/time_in_past/);
    const cancelled = await makeSession(gym.id, { startsInHours: 48, cancelled: true });
    await expect(changeTime(owner, cancelled, 50)).rejects.toThrow(/session_cancelled/);
  });
});

describe("session_spots_taken", () => {
  it("gives staff the shared count for their own date and refuses staff of another gym", async () => {
    const gymA = await makeGym();
    const gymB = await makeGym();
    const ownerA = await makeStaff(gymA.id);
    const sessionA = await makeSession(gymA.id);
    await makeBooking(sessionA, await makeUser(), "confirmed");
    await makeBooking(sessionA, await makeUser(), "pending", 300);
    const res = await asUser(ownerA, (q) => q("select public.session_spots_taken($1) as n", [sessionA]));
    expect(res.rows[0].n).toBe(2);
    const sessionB = await makeSession(gymB.id);
    await expect(asUser(ownerA, (q) => q("select public.session_spots_taken($1)", [sessionB]))).rejects.toThrow(/not_staff/);
  });
});
