import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asUser, makeBooking, makeGym, makeStaff, makeUser, pool, resetData, sql } from "./helpers";

beforeEach(resetData);
afterAll(() => pool.end());

const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

function createOneOff(userId: string, gymId: string, over: { start?: string; coach?: string | null; name?: string } = {}) {
  return asUser(userId, (q) =>
    q("select public.create_one_off_class($1, $2, 'Guest coach night', 'Intermediate', $3, $4, 60, 12, 15000, 12) as id", [
      gymId,
      over.name ?? "Holiday Session",
      over.coach ?? null,
      over.start ?? inHours(30),
    ]),
  );
}

async function makeWeeklySeries(gymId: string, ownerId: string) {
  const res = await asUser(ownerId, (q) =>
    q(
      `insert into public.class_series (gym_id, name, level, weekdays, start_time, length_minutes, spot_limit, price_cents)
       values ($1, 'Pad Work', 'Beginner', '{1,2,3,4,5,6,7}'::smallint[], '18:00', 60, 12, 10000) returning id`,
      [gymId],
    ),
  );
  const id = res.rows[0].id as string;
  await asUser(ownerId, (q) => q("select public.generate_my_series_sessions($1)", [id]));
  return id;
}

const futureDates = (seriesId: string) =>
  sql<{ id: string; cancelled: boolean }>(
    "select id, cancelled from public.class_sessions where series_id = $1 and starts_at > now() order by starts_at",
    [seriesId],
  );

describe("create_one_off_class", () => {
  it("covers AE2: staff of the gym add one date with no repeating class behind it", async () => {
    const gym = await makeGym();
    const owner = await makeStaff(gym.id);
    const start = inHours(30);
    const res = await createOneOff(owner, gym.id, { start });
    const [row] = await sql<{ series_id: string | null; name: string; level: string; price_cents: number; starts_at: Date; local_date: string }>(
      "select series_id, name, level, price_cents, starts_at, to_char(local_date, 'YYYY-MM-DD') as local_date from public.class_sessions where id = $1",
      [res.rows[0].id],
    );
    expect(row.series_id).toBeNull();
    expect(row.name).toBe("Holiday Session");
    expect(row.level).toBe("Intermediate");
    expect(row.price_cents).toBe(15000);
    expect(row.starts_at.toISOString()).toBe(start);
    // The local day is the gym's day in its own time zone, not the UTC day.
    const [{ expected }] = await sql<{ expected: string }>(
      "select to_char(($1::timestamptz at time zone g.timezone)::date, 'YYYY-MM-DD') as expected from public.gyms g where g.id = $2",
      [start, gym.id],
    );
    expect(row.local_date).toBe(expected);
  });

  it("shows the new date in the member timetable like any other date", async () => {
    const gym = await makeGym();
    const owner = await makeStaff(gym.id);
    await createOneOff(owner, gym.id);
    const member = await makeUser();
    const res = await asUser(member, (q) =>
      q("select name from public.public_timetable($1, now(), now() + interval '7 days')", [gym.slug]),
    );
    expect(res.rows.map((r) => r.name)).toContain("Holiday Session");
  });

  it("refuses staff of another gym and members who are not staff", async () => {
    const gym = await makeGym();
    const otherGym = await makeGym();
    const otherOwner = await makeStaff(otherGym.id);
    const member = await makeUser();
    await expect(createOneOff(otherOwner, gym.id)).rejects.toThrow(/not_staff/);
    await expect(createOneOff(member, gym.id)).rejects.toThrow(/not_staff/);
    expect(await sql("select 1 from public.class_sessions where gym_id = $1", [gym.id])).toHaveLength(0);
  });

  it("refuses a start time in the past", async () => {
    const gym = await makeGym();
    const owner = await makeStaff(gym.id);
    await expect(createOneOff(owner, gym.id, { start: inHours(-2) })).rejects.toThrow(/time_in_past/);
  });

  it("refuses a coach from another gym", async () => {
    const gym = await makeGym();
    const otherGym = await makeGym();
    const owner = await makeStaff(gym.id);
    const [{ id: coachId }] = await sql<{ id: string }>("insert into public.coaches (gym_id, name) values ($1, 'Thabo') returning id", [otherGym.id]);
    await expect(createOneOff(owner, gym.id, { coach: coachId })).rejects.toThrow(/coach_wrong_gym/);
  });
});

describe("end_series", () => {
  async function setup() {
    const gym = await makeGym();
    const owner = await makeStaff(gym.id);
    const series = await makeWeeklySeries(gym.id, owner);
    const dates = await futureDates(series);
    expect(dates.length).toBeGreaterThanOrEqual(8);
    return { gym, owner, series, dates };
  }

  it("covers AE3: removes empty future dates and keeps booked, waitlisted, and cancelled ones", async () => {
    const { gym, owner, series, dates } = await setup();
    const booked = dates[2].id;
    const waitlisted = dates[3].id;
    const cancelled = dates[4].id;
    await makeBooking(booked, await makeUser("Booked member"), "confirmed");
    await sql("insert into public.waitlist_entries (gym_id, session_id, member_id) values ($1, $2, $3)", [gym.id, waitlisted, await makeUser("Waiting")]);
    await sql("update public.class_sessions set cancelled = true where id = $1", [cancelled]);

    const res = await asUser(owner, (q) => q("select public.end_series($1) as result", [series]));
    expect(res.rows[0].result).toEqual({ removed: dates.length - 3, kept: 3 });

    const remaining = (await futureDates(series)).map((d) => d.id).sort();
    expect(remaining).toEqual([booked, waitlisted, cancelled].sort());
    const [{ ended }] = await sql<{ ended: boolean }>("select ended from public.class_series where id = $1", [series]);
    expect(ended).toBe(true);
  });

  it("creates no new dates for the class once it has ended", async () => {
    const { owner, series, dates } = await setup();
    await asUser(owner, (q) => q("select public.end_series($1)", [series]));
    await sql("update public.class_sessions set starts_at = starts_at where series_id = $1", [series]);
    await sql("select public._generate_all_sessions()");
    expect(await futureDates(series)).toHaveLength(0);
    expect(dates.length).toBeGreaterThan(0);
  });

  it("is safe to run twice and reports nothing removed the second time", async () => {
    const { owner, series, dates } = await setup();
    await makeBooking(dates[0].id, await makeUser(), "confirmed");
    await asUser(owner, (q) => q("select public.end_series($1)", [series]));
    const second = await asUser(owner, (q) => q("select public.end_series($1) as result", [series]));
    expect(second.rows[0].result).toEqual({ removed: 0, kept: 1 });
  });

  it("refuses staff of another gym and members who are not staff", async () => {
    const { series, dates } = await setup();
    const otherGym = await makeGym();
    const otherOwner = await makeStaff(otherGym.id);
    const member = await makeUser();
    await expect(asUser(otherOwner, (q) => q("select public.end_series($1)", [series]))).rejects.toThrow(/not_staff/);
    await expect(asUser(member, (q) => q("select public.end_series($1)", [series]))).rejects.toThrow(/not_staff/);
    expect(await futureDates(series)).toHaveLength(dates.length);
  });

  it("refuses an unknown class", async () => {
    const gym = await makeGym();
    const owner = await makeStaff(gym.id);
    await expect(asUser(owner, (q) => q("select public.end_series('00000000-0000-0000-0000-000000000000')"))).rejects.toThrow(/series_not_found/);
  });
});
