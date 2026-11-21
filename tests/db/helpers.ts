import pg from "pg";
import { randomUUID } from "node:crypto";

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 20 });

export type Role = "anon" | "authenticated" | "service_role";

/** A connection that behaves like one API caller: a Postgres role plus a signed-in user id. */
export async function connectAs(role: Role, userId?: string) {
  const client = await pool.connect();
  await client.query(`set role ${role}`);
  await client.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  await client.query("select set_config('request.jwt.claim.role', $1, false)", [role]);
  return {
    query: client.query.bind(client) as pg.Client["query"],
    release: async () => {
      await client.query("reset role");
      await client.query("select set_config('request.jwt.claim.sub', '', false)");
      client.release();
    },
  };
}

export async function asUser<T>(userId: string | undefined, fn: (q: pg.Client["query"]) => Promise<T>, role: Role = "authenticated") {
  const c = await connectAs(role, userId);
  try {
    return await fn(c.query);
  } finally {
    await c.release();
  }
}

export async function sql<T extends pg.QueryResultRow = Record<string, unknown>>(text: string, params: unknown[] = []) {
  const { rows } = await pool.query<T>(text, params);
  return rows;
}

export async function resetData() {
  await pool.query(`
    truncate public.gym_ledger_entries, public.refunds, public.payments, public.payment_events, public.email_outbox,
      public.waitlist_offers, public.waitlist_entries, public.bookings, public.class_sessions, public.class_series,
      public.coaches, public.gym_staff, public.platform_admins, public.profiles, public.gyms restart identity cascade;
    delete from auth.users;
  `);
}

export async function makeUser(name = "Member", email?: string) {
  const id = randomUUID();
  await pool.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
    id,
    email ?? `${id}@example.test`,
    JSON.stringify({ name }),
  ]);
  return id;
}

export async function makeGym(opts: { slug?: string; connected?: boolean; feeBps?: number } = {}) {
  const id = randomUUID();
  const slug = opts.slug ?? `gym-${id.slice(0, 8)}`;
  await pool.query(
    "insert into public.gyms (id, name, slug, fee_bps, paystack_subaccount_code) values ($1, $2, $3, $4, $5)",
    [id, `Gym ${slug}`, slug, opts.feeBps ?? 500, opts.connected === false ? null : "ACCT_test"],
  );
  return { id, slug };
}

export async function makeStaff(gymId: string, name = "Owner") {
  const userId = await makeUser(name);
  await pool.query("insert into public.gym_staff (gym_id, user_id, role) values ($1, $2, 'owner')", [gymId, userId]);
  return userId;
}

export async function makeSession(
  gymId: string,
  opts: { spotLimit?: number; startsInHours?: number; priceCents?: number; cancelled?: boolean; name?: string } = {},
) {
  const id = randomUUID();
  const startsInHours = opts.startsInHours ?? 24;
  await pool.query(
    `insert into public.class_sessions
       (id, gym_id, name, level, local_date, starts_at, length_minutes, spot_limit, price_cents, cutoff_hours, cancelled)
     values ($1, $2, $3, 'Beginner', (now() + make_interval(hours => $4))::date, now() + make_interval(hours => $4),
             60, $5, $6, 12, $7)`,
    [id, gymId, opts.name ?? "Boxing Basics", startsInHours, opts.spotLimit ?? 12, opts.priceCents ?? 10000, opts.cancelled ?? false],
  );
  return id;
}

export async function makeBooking(
  sessionId: string,
  memberId: string,
  status: "pending" | "confirmed" | "expired" | "failed" = "confirmed",
  holdExpiresInSeconds = 600,
) {
  const [{ gym_id }] = await sql<{ gym_id: string }>("select gym_id from public.class_sessions where id = $1", [sessionId]);
  const id = randomUUID();
  await pool.query(
    `insert into public.bookings (id, gym_id, session_id, member_id, status, hold_expires_at)
     values ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
    [id, gym_id, sessionId, memberId, status, holdExpiresInSeconds],
  );
  return id;
}

export async function fillSession(sessionId: string, count: number) {
  for (let i = 0; i < count; i++) {
    await makeBooking(sessionId, await makeUser(`Filler ${i}`), "confirmed");
  }
}
