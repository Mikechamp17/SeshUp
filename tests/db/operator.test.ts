import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asUser, makeBooking, makeGym, makeSession, makeUser, pool, resetData, sql } from "./helpers";
import {
  OperatorAuthError,
  StoreError,
  connectPayments,
  createGym,
  inviteOwner,
  listProblems,
  type OperatorAuthAdmin,
  type OperatorContext,
  type OperatorStore,
} from "@/lib/operator/gyms";
import { fetchStatement } from "@/lib/operator/statements";
import { createFakeProvider } from "@/lib/payments/fake";
import { renderEmail, type EmailData } from "@/lib/email/templates";
import type { Rpc } from "@/lib/email/outbox";

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
      // A function returning one jsonb value comes back as that value, like supabase-js.
      const rows = res.rows as Record<string, unknown>[];
      const single = rows.length === 1 && Object.keys(rows[0]).length === 1 && Object.keys(rows[0])[0] === fn;
      return { data: single ? rows[0][fn] : rows, error: null };
    } finally {
      await client.query("reset role");
      client.release();
    }
  } catch (e) {
    return { data: null, error: { message: (e as Error).message } };
  }
};

/** The table writes the supabase store does, as plain SQL run as the service role. */
const store: OperatorStore = {
  async insertGym({ name, slug, feeBps, timezone }) {
    try {
      const rows = await sql<{ id: string }>(
        "insert into public.gyms (name, slug, fee_bps, timezone) values ($1, $2, $3, $4) returning id",
        [name, slug, feeBps, timezone],
      );
      return rows[0];
    } catch (e) {
      throw new StoreError((e as Error).message, (e as { code?: string }).code);
    }
  },
  async findGym(id) {
    const rows = await sql<never>(
      "select id, name, slug, fee_bps, timezone, paystack_subaccount_code from public.gyms where id = $1",
      [id],
    );
    return (rows[0] as never) ?? null;
  },
  async listGyms() {
    return (await sql<never>("select id, name, slug, fee_bps, timezone, paystack_subaccount_code from public.gyms order by name")) as never;
  },
  async setSubaccountCode(gymId, code) {
    await sql("update public.gyms set paystack_subaccount_code = $2 where id = $1", [gymId, code]);
  },
  async addOwner(gymId, userId) {
    await sql("insert into public.gym_staff (gym_id, user_id, role) values ($1, $2, 'owner')", [gymId, userId]);
  },
  async enqueueEmail(template, recipient, data) {
    await sql("insert into public.email_outbox (template, recipient, data) values ($1, $2, $3)", [template, recipient, JSON.stringify(data)]);
  },
};

/** Stands in for the auth admin API: creates the user as an unconfirmed invite and returns a token. */
const authAdmin: OperatorAuthAdmin & { invited: string[] } = {
  invited: [],
  async createInvite(email) {
    const userId = await makeUser("Invited", email);
    authAdmin.invited.push(email);
    return { userId, hashedToken: "hashed-token-123" };
  },
};

const fake = createFakeProvider();
const APP_URL = "https://seshup.test";

function ctxFor(operator: boolean): OperatorContext {
  return {
    assertOperator: async () => {
      if (!operator) throw new OperatorAuthError();
    },
    store: () => store,
    authAdmin: () => authAdmin,
    rpc: () => rpc,
    provider: () => fake,
    appUrl: async () => APP_URL,
  };
}
const op = ctxFor(true);

beforeEach(() => {
  authAdmin.invited.length = 0;
  fake.calls.length = 0;
});

describe("create gym", () => {
  it("creates a gym with the fee stored as basis points and the default time zone", async () => {
    const result = await createGym(op, { name: "Iron Gym", slug: "iron-gym", feePercent: "7.5" });
    expect(result.ok).toBe(true);
    const [row] = await sql<{ fee_bps: number; timezone: string; paystack_subaccount_code: string | null }>(
      "select fee_bps, timezone, paystack_subaccount_code from public.gyms where slug = 'iron-gym'",
    );
    expect(row).toEqual({ fee_bps: 750, timezone: "Africa/Johannesburg", paystack_subaccount_code: null });
  });

  it("refuses a slug that already exists", async () => {
    await makeGym({ slug: "taken" });
    const result = await createGym(op, { name: "Other", slug: "taken", feePercent: "5" });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/already exists/) });
    expect(await sql("select 1 from public.gyms")).toHaveLength(1);
  });

  it("refuses a fee below 0 or above 100, and accepts the ends", async () => {
    for (const feePercent of ["-1", "100.01", "101", "abc", ""]) {
      const result = await createGym(op, { name: "G", slug: "g", feePercent });
      expect(result.ok, feePercent).toBe(false);
    }
    expect(await sql("select 1 from public.gyms")).toHaveLength(0);
    expect((await createGym(op, { name: "Free", slug: "free", feePercent: "0" })).ok).toBe(true);
    expect((await createGym(op, { name: "All", slug: "all", feePercent: "100" })).ok).toBe(true);
  });

  it("refuses a bad slug", async () => {
    for (const slug of ["Has Caps", "-lead", "a_b", ""]) {
      expect((await createGym(op, { name: "G", slug, feePercent: "5" })).ok, slug).toBe(false);
    }
  });
});

describe("connect payments", () => {
  it("stores only the provider's code and the gym then takes bookings", async () => {
    const gym = await makeGym({ connected: false });
    const result = await connectPayments(op, { gymId: gym.id, bankCode: "632005", accountNumber: "1234567890" });
    expect(result).toEqual({ ok: true });
    const [row] = await sql<{ paystack_subaccount_code: string }>("select paystack_subaccount_code from public.gyms where id = $1", [gym.id]);
    expect(row.paystack_subaccount_code).toMatch(/^ACCT_fake/);

    const session = await makeSession(gym.id);
    const member = await makeUser("Member");
    const res = await asUser(member, (q) => q("select * from public.take_spot($1)", [session]));
    expect(res.rows).toHaveLength(1);
  });

  it("a gym without an account cannot take bookings", async () => {
    const gym = await makeGym({ connected: false });
    const session = await makeSession(gym.id);
    const member = await makeUser("Member");
    await expect(asUser(member, (q) => q("select * from public.take_spot($1)", [session]))).rejects.toThrow(/gym_not_connected/);
  });

  it("never puts the bank details in a message or in the database", async () => {
    const gym = await makeGym({ connected: false });
    const failing = { ...op, provider: () => ({ ...fake, createSubaccount: async () => { throw new Error("bad account 1234567890"); } }) };
    const result = await connectPayments(failing, { gymId: gym.id, bankCode: "632005", accountNumber: "1234567890" });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/1234567890|632005/);
    const dump = JSON.stringify(await sql("select * from public.gyms"));
    expect(dump).not.toMatch(/1234567890|632005/);
  });

  it("refuses a gym that already has an account, and an unknown gym", async () => {
    const gym = await makeGym();
    expect((await connectPayments(op, { gymId: gym.id, bankCode: "632005", accountNumber: "1234567890" })).ok).toBe(false);
    expect((await connectPayments(op, { gymId: randomUUID(), bankCode: "632005", accountNumber: "1234567890" })).ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("invite owner", () => {
  it("creates an owner row at once for a new email and enqueues our own invite email", async () => {
    const gym = await makeGym({ slug: "pilot" });
    const result = await inviteOwner(op, { gymId: gym.id, email: "New.Owner@Example.test" });
    expect(result).toEqual({ ok: true, kind: "invited" });

    const [user] = await sql<{ id: string }>("select id from auth.users where email = 'new.owner@example.test'");
    const staff = await sql<{ gym_id: string; role: string }>("select gym_id, role from public.gym_staff where user_id = $1", [user.id]);
    expect(staff).toEqual([{ gym_id: gym.id, role: "owner" }]);

    const [mail] = await sql<{ template: string; recipient: string; data: EmailData }>("select template, recipient, data from public.email_outbox");
    expect(mail.template).toBe("owner_invite");
    expect(mail.recipient).toBe("new.owner@example.test");
    expect(mail.data.inviteUrl).toBe(
      `${APP_URL}/auth/callback?token_hash=hashed-token-123&type=invite&next=${encodeURIComponent("/auth/set-password?next=/admin/pilot")}`,
    );
    expect(renderEmail("owner_invite", mail.data).html).toContain("token_hash=hashed-token-123");
  });

  it("makes a confirmed member owner of that gym only and enqueues owner_added", async () => {
    const gymA = await makeGym({ slug: "gym-a" });
    const gymB = await makeGym({ slug: "gym-b" });
    const member = await makeUser("Member", "member@example.test");
    await sql("update auth.users set email_confirmed_at = now() where id = $1", [member]);

    const result = await inviteOwner(op, { gymId: gymA.id, email: "MEMBER@example.test" });
    expect(result).toEqual({ ok: true, kind: "added" });
    expect(authAdmin.invited).toHaveLength(0);

    const staff = await sql<{ gym_id: string }>("select gym_id from public.gym_staff where user_id = $1", [member]);
    expect(staff).toEqual([{ gym_id: gymA.id }]);
    expect(staff.some((s) => s.gym_id === gymB.id)).toBe(false);

    const [mail] = await sql<{ template: string; data: EmailData }>("select template, data from public.email_outbox");
    expect(mail.template).toBe("owner_added");
    expect(mail.data.signInUrl).toBe(`${APP_URL}/auth/sign-in?next=${encodeURIComponent("/admin/gym-a")}`);
  });

  it("refuses an existing account whose email is not confirmed and attaches nothing", async () => {
    const gym = await makeGym();
    await makeUser("Pending", "pending@example.test");
    const result = await inviteOwner(op, { gymId: gym.id, email: "pending@example.test" });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/confirm/i) });
    expect(await sql("select 1 from public.gym_staff")).toHaveLength(0);
    expect(await sql("select 1 from public.email_outbox")).toHaveLength(0);
  });

  it("takes the gym from the operator's input, so an unknown gym id attaches nothing", async () => {
    const gym = await makeGym({ slug: "real" });
    const result = await inviteOwner(op, { gymId: randomUUID(), email: "someone@example.test" });
    expect(result.ok).toBe(false);
    expect(authAdmin.invited).toHaveLength(0);
    expect(await sql("select 1 from public.gym_staff")).toHaveLength(0);
    // The emailed link names no gym id: only the token and the slug-based next path.
    await inviteOwner(op, { gymId: gym.id, email: "owner@example.test" });
    const [mail] = await sql<{ data: EmailData }>("select data from public.email_outbox");
    expect(mail.data.inviteUrl).not.toContain(gym.id);
  });
});

describe("operator authorization", () => {
  it("rejects a non-operator on every action and changes nothing", async () => {
    const gym = await makeGym({ connected: false, slug: "keep" });
    const boom = () => {
      throw new Error("touched before the check");
    };
    const denied: OperatorContext = {
      assertOperator: ctxFor(false).assertOperator,
      store: boom,
      authAdmin: boom,
      rpc: boom,
      provider: boom,
      appUrl: boom,
    };
    await expect(createGym(denied, { name: "X", slug: "x", feePercent: "5" })).rejects.toBeInstanceOf(OperatorAuthError);
    await expect(inviteOwner(denied, { gymId: gym.id, email: "a@b.test" })).rejects.toBeInstanceOf(OperatorAuthError);
    await expect(connectPayments(denied, { gymId: gym.id, bankCode: "1", accountNumber: "12345" })).rejects.toBeInstanceOf(OperatorAuthError);
    await expect(listProblems(denied)).rejects.toBeInstanceOf(OperatorAuthError);

    expect(await sql("select 1 from public.gyms")).toHaveLength(1);
    expect(await sql("select 1 from public.gym_staff")).toHaveLength(0);
    expect(await sql("select 1 from public.email_outbox")).toHaveLength(0);
    const [row] = await sql<{ paystack_subaccount_code: string | null }>("select paystack_subaccount_code from public.gyms");
    expect(row.paystack_subaccount_code).toBeNull();
  });

  it("keeps the operator functions out of reach of signed-in and anonymous callers", async () => {
    const gym = await makeGym();
    const user = await makeUser("Someone");
    for (const text of [
      "select public.gym_statement($1, '2026-03-01')",
      "select * from public.operator_problems()",
      "select * from public.operator_find_user('a@b.test')",
    ]) {
      const params = text.includes("$1") ? [gym.id] : [];
      await expect(asUser(user, (q) => q(text, params))).rejects.toThrow(/permission denied/);
      await expect(asUser(undefined, (q) => q(text, params), "anon")).rejects.toThrow(/permission denied/);
    }
  });
});

describe("problems", () => {
  async function refund(gymId: string, status: string, attempts: number) {
    const session = await makeSession(gymId);
    const member = await makeUser("M");
    const booking = await makeBooking(session, member, "confirmed");
    const [payment] = await sql<{ id: string }>(
      "insert into public.payments (gym_id, booking_id, amount_cents, fee_cents, provider_reference) values ($1, $2, 10000, 500, $3) returning id",
      [gymId, booking, `ref-${randomUUID()}`],
    );
    const [r] = await sql<{ id: string }>(
      "insert into public.refunds (gym_id, payment_id, booking_id, amount_cents, fee_borne_by, status, attempts) values ($1, $2, $3, 10000, 'gym', $4, $5) returning id",
      [gymId, payment.id, booking, status, attempts],
    );
    return r.id;
  }

  it("lists unconnected gyms, failed or repeatedly failing refunds, and dead emails", async () => {
    const connected = await makeGym({ slug: "ok" });
    const unconnected = await makeGym({ slug: "nope", connected: false });
    const failed = await refund(connected.id, "failed", 6);
    const stuck = await refund(connected.id, "pending", 5);
    await refund(connected.id, "pending", 4);
    await refund(connected.id, "processed", 7);
    await sql("insert into public.email_outbox (template, recipient, attempts, last_error) values ('booking_confirmed', 'a@x.test', 8, 'provider down')");
    await sql("insert into public.email_outbox (template, recipient, attempts) values ('booking_confirmed', 'b@x.test', 7)");
    await sql("insert into public.email_outbox (template, recipient, attempts, sent_at) values ('booking_confirmed', 'c@x.test', 8, now())");

    const problems = await listProblems(op);
    const byKind = (k: string) => problems.filter((p) => p.kind === k);
    expect(byKind("gym_not_connected").map((p) => p.ref_id)).toEqual([unconnected.id]);
    expect(byKind("refund_failed").map((p) => p.ref_id).sort()).toEqual([failed, stuck].sort());
    expect(byKind("email_dead")).toHaveLength(1);
    expect(byKind("email_dead")[0].detail).toContain("provider down");
  });
});

describe("gym statement", () => {
  /** A refund with its ledger rows created at the given instants. */
  async function ledger(gymId: string, entries: { kind: "gym_share" | "processing_fee"; owedBy: "gym" | "seshup"; cents: number; at: string }[]) {
    for (const e of entries) {
      const session = await makeSession(gymId, { name: "Sparring" });
      const booking = await makeBooking(session, await makeUser("M"), "confirmed");
      const [payment] = await sql<{ id: string }>(
        "insert into public.payments (gym_id, booking_id, amount_cents, fee_cents, provider_reference) values ($1, $2, 10000, 500, $3) returning id",
        [gymId, booking, `ref-${randomUUID()}`],
      );
      const [r] = await sql<{ id: string }>(
        "insert into public.refunds (gym_id, payment_id, booking_id, amount_cents, fee_borne_by, status) values ($1, $2, $3, 10000, $4, 'processed') returning id",
        [gymId, payment.id, booking, e.owedBy],
      );
      await sql(
        "insert into public.gym_ledger_entries (gym_id, refund_id, entry_kind, owed_by, amount_cents, created_at) values ($1, $2, $3, $4, $5, $6)",
        [gymId, r.id, e.kind, e.owedBy, e.cents, e.at],
      );
    }
  }

  it("sums March by owner in the gym's zone and leaves February out", async () => {
    const gym = await makeGym({ slug: "statements" });
    await ledger(gym.id, [
      { kind: "gym_share", owedBy: "gym", cents: 9000, at: "2026-03-05T10:00:00Z" },
      { kind: "gym_share", owedBy: "gym", cents: 4500, at: "2026-03-20T10:00:00Z" },
      { kind: "processing_fee", owedBy: "seshup", cents: 250, at: "2026-03-21T10:00:00Z" },
      { kind: "gym_share", owedBy: "gym", cents: 7000, at: "2026-02-10T10:00:00Z" },
    ]);

    const march = await fetchStatement(rpc, gym.id, "2026-03-01");
    expect(march?.gymOwes).toBe("R135.00");
    expect(march?.seshupAbsorbed).toBe("R2.50");
    expect(march?.entries.map((e) => e.amount)).toEqual(["R90.00", "R45.00", "R2.50"]);
    expect(march?.entries[0].classLabel).toMatch(/^Sparring, /);
    expect(march?.monthLabel).toBe("March 2026");

    const feb = await fetchStatement(rpc, gym.id, "2026-02-01");
    expect(feb?.gymOwes).toBe("R70.00");
    expect(feb?.seshupAbsorbed).toBe("R0.00");
    expect(feb?.entries).toHaveLength(1);
  });

  it("uses the gym's time zone at the month boundary", async () => {
    // Johannesburg is UTC+2. 22:30 UTC on 28 Feb is 00:30 on 1 March there, and
    // 22:30 UTC on 31 Mar is 00:30 on 1 April there.
    const gym = await makeGym({ slug: "boundary" });
    await ledger(gym.id, [
      { kind: "gym_share", owedBy: "gym", cents: 1100, at: "2026-02-28T22:30:00Z" },
      { kind: "gym_share", owedBy: "gym", cents: 2200, at: "2026-03-31T22:30:00Z" },
    ]);
    const march = await fetchStatement(rpc, gym.id, "2026-03-01");
    expect(march?.entries.map((e) => e.amount)).toEqual(["R11.00"]);
    expect(march?.entries[0].entryDate).toBe("1 Mar 2026");
    const april = await fetchStatement(rpc, gym.id, "2026-04-01");
    expect(april?.entries.map((e) => e.amount)).toEqual(["R22.00"]);
    const feb = await fetchStatement(rpc, gym.id, "2026-02-01");
    expect(feb?.entries).toHaveLength(0);

    // The same instants in a zone behind UTC land in the earlier month.
    await sql("update public.gyms set timezone = 'America/Sao_Paulo' where id = $1", [gym.id]);
    const sp = await fetchStatement(rpc, gym.id, "2026-02-01");
    expect(sp?.entries.map((e) => e.amount)).toEqual(["R11.00"]);
  });

  it("counts only the asked gym and reports an unknown gym as missing", async () => {
    const a = await makeGym({ slug: "a" });
    const b = await makeGym({ slug: "b" });
    await ledger(a.id, [{ kind: "gym_share", owedBy: "gym", cents: 100, at: "2026-03-05T10:00:00Z" }]);
    await ledger(b.id, [{ kind: "gym_share", owedBy: "gym", cents: 900, at: "2026-03-05T10:00:00Z" }]);
    expect((await fetchStatement(rpc, a.id, "2026-03-01"))?.gymOwes).toBe("R1.00");
    expect(await fetchStatement(rpc, randomUUID(), "2026-03-01")).toBeNull();
  });
});

describe("account lookup", () => {
  it("finds accounts case-insensitively and reports confirmation", async () => {
    const id = await makeUser("A", "Mixed@Example.test");
    await sql("update auth.users set email_confirmed_at = now() where id = $1", [id]);
    const { data } = await rpc("operator_find_user", { p_email: "mixed@example.TEST" });
    expect(data).toEqual([{ user_id: id, confirmed: true }]);
    expect((await rpc("operator_find_user", { p_email: "none@example.test" })).data).toEqual([]);
  });
});
