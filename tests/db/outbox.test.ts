import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asUser, makeBooking, makeGym, makeSession, makeUser, pool, resetData, sql } from "./helpers";
import { createEmailStore, sendDueEmails, type Rpc } from "@/lib/email/outbox";
import type { EmailSender } from "@/lib/email/send";

beforeEach(resetData);
afterAll(() => pool.end());

/** Calls the real SQL functions as the service role, the way supabase-js rpc would. */
const rpc: Rpc = async (fn, args = {}) => {
  const names = Object.keys(args);
  const placeholders = names.map((n, i) => `${n} => $${i + 1}`).join(", ");
  try {
    const client = await pool.connect();
    try {
      await client.query("set role service_role");
      const res = await client.query(`select * from public.${fn}(${placeholders})`, names.map((n) => args[n]));
      return { data: res.rows, error: null };
    } finally {
      await client.query("reset role");
      client.release();
    }
  } catch (e) {
    return { data: null, error: { message: (e as Error).message } };
  }
};

function recordingSender(failFor: string[] = []) {
  const sent: { to: string; subject: string }[] = [];
  const sender: EmailSender = {
    async send({ to, subject }) {
      if (failFor.includes(to)) throw new Error("provider down");
      sent.push({ to, subject });
    },
  };
  return { sender, sent };
}

const enqueue = (recipient: string, template = "booking_confirmed") =>
  sql("insert into public.email_outbox (template, recipient, data) values ($1, $2, $3)", [
    template,
    recipient,
    JSON.stringify({
      gymName: "Pilot Gym",
      className: "Boxing Basics",
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      timezone: "Africa/Johannesburg",
      amountCents: 10000,
    }),
  ]);

describe("email outbox", () => {
  it("sends all three due rows in one run and marks them sent", async () => {
    for (const r of ["a@x.test", "b@x.test", "c@x.test"]) await enqueue(r);
    const { sender, sent } = recordingSender();
    const result = await sendDueEmails({ store: createEmailStore(rpc), sender });
    expect(result).toEqual({ sent: 3, failed: 0 });
    expect(sent.map((s) => s.to).sort()).toEqual(["a@x.test", "b@x.test", "c@x.test"]);
    const rows = await sql<{ sent_at: string | null }>("select sent_at from public.email_outbox");
    expect(rows.every((r) => r.sent_at !== null)).toBe(true);
  });

  it("sends nothing again on a second run right after a successful run", async () => {
    await enqueue("a@x.test");
    const { sender, sent } = recordingSender();
    await sendDueEmails({ store: createEmailStore(rpc), sender });
    await sendDueEmails({ store: createEmailStore(rpc), sender });
    expect(sent).toHaveLength(1);
  });

  it("keeps a failed row unsent with attempts up and still sends the others", async () => {
    await enqueue("bad@x.test");
    await enqueue("good@x.test");
    const { sender, sent } = recordingSender(["bad@x.test"]);
    const result = await sendDueEmails({ store: createEmailStore(rpc), sender });
    expect(result).toEqual({ sent: 1, failed: 1 });
    expect(sent.map((s) => s.to)).toEqual(["good@x.test"]);
    const [bad] = await sql<{ attempts: number; sent_at: string | null; last_error: string; delayed: boolean }>(
      "select attempts, sent_at, last_error, next_attempt_at > now() as delayed from public.email_outbox where recipient = 'bad@x.test'",
    );
    expect(bad).toMatchObject({ attempts: 1, sent_at: null, delayed: true });
    expect(bad.last_error).toMatch(/provider down/);
  });

  it("does not hand the same due row to two parallel runs", async () => {
    for (let i = 0; i < 6; i++) await enqueue(`r${i}@x.test`);
    const { sender, sent } = recordingSender();
    await Promise.all([
      sendDueEmails({ store: createEmailStore(rpc), sender }),
      sendDueEmails({ store: createEmailStore(rpc), sender }),
    ]);
    expect(sent).toHaveLength(6);
    expect(new Set(sent.map((s) => s.to)).size).toBe(6);
  });

  it("stops retrying a row after 8 failed attempts", async () => {
    await enqueue("dead@x.test");
    await sql("update public.email_outbox set attempts = 8");
    const { sender, sent } = recordingSender();
    const result = await sendDueEmails({ store: createEmailStore(rpc), sender });
    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(sent).toHaveLength(0);
  });

  it("refuses an authenticated member calling the outbox functions", async () => {
    const member = await makeUser();
    await expect(asUser(member, (q) => q("select * from public.claim_due_emails(5)"))).rejects.toThrow(/permission denied/);
    await expect(asUser(member, (q) => q("select public.purge_old_data()"))).rejects.toThrow(/permission denied/);
  });
});

describe("data retention", () => {
  it("blanks webhook payloads and outbox bodies older than 90 days and leaves newer rows", async () => {
    await sql(
      "insert into public.payment_events (event_key, payload, created_at) values ('old', '{\"email\":\"a@x.test\"}', now() - interval '91 days')",
    );
    await sql("insert into public.payment_events (event_key, payload) values ('new', '{\"email\":\"b@x.test\"}')");
    await sql(
      "insert into public.email_outbox (template, recipient, data, sent_at, created_at) values ('t', 'old@x.test', '{\"k\":1}', now(), now() - interval '91 days')",
    );
    await sql("insert into public.email_outbox (template, recipient, data) values ('t', 'new@x.test', '{\"k\":1}')");
    const res = await rpc("purge_old_data");
    expect(res.error).toBeNull();
    const events = await sql<{ event_key: string; payload: unknown }>(
      "select event_key, payload from public.payment_events order by event_key",
    );
    expect(events.find((e) => e.event_key === "old")?.payload).toBeNull();
    expect(events.find((e) => e.event_key === "new")?.payload).not.toBeNull();
    const mail = await sql<{ recipient: string; data: Record<string, unknown> }>(
      "select recipient, data from public.email_outbox",
    );
    expect(mail.find((m) => m.recipient === "old@x.test")?.data).toEqual({});
    expect(mail.find((m) => m.recipient === "new@x.test")?.data).toEqual({ k: 1 });
  });

  it("erases a member by replacing name and email and keeps their bookings and payments", async () => {
    const gym = await makeGym();
    const session = await makeSession(gym.id);
    const member = await makeUser("Thandi", "thandi@x.test");
    const booking = await makeBooking(session, member);
    await sql(
      "insert into public.payments (gym_id, booking_id, amount_cents, fee_cents, provider_reference, status) values ($1,$2,10000,500,$3,'succeeded')",
      [gym.id, booking, booking],
    );
    await enqueue("thandi@x.test");
    const res = await rpc("erase_member", { p_member: member });
    expect(res.error).toBeNull();
    const [p] = await sql<{ name: string; email: string | null; erased_at: string | null }>(
      "select name, email, erased_at from public.profiles where id = $1",
      [member],
    );
    expect(p.name).not.toBe("Thandi");
    expect(p.email).toBeNull();
    expect(p.erased_at).not.toBeNull();
    const [u] = await sql<{ email: string }>("select email from auth.users where id = $1", [member]);
    expect(u.email).not.toBe("thandi@x.test");
    const queued = await sql<{ recipient: string; sent_at: string | null }>("select recipient, sent_at from public.email_outbox");
    expect(queued.every((m) => m.recipient !== "thandi@x.test")).toBe(true);
    expect(await sql("select 1 from public.bookings where id = $1", [booking])).toHaveLength(1);
    expect(await sql("select 1 from public.payments where booking_id = $1", [booking])).toHaveLength(1);
  });
});
