import { describe, expect, it } from "vitest";
import { fetchStatement, formatStatement, parseMonth, type RawStatement } from "@/lib/operator/statements";

const raw: RawStatement = {
  gym_id: "5b1f1a3e-6d0c-4a0e-9d0b-0c9a1f2b3c4d",
  gym_name: "Pilot Gym",
  timezone: "Africa/Johannesburg",
  month_start: "2026-03-01",
  gym_owes_cents: 123456,
  seshup_absorbed_cents: 250,
  entries: [
    {
      id: "e1",
      entry_kind: "gym_share",
      owed_by: "gym",
      amount_cents: 9000,
      created_at: "2026-02-28T22:30:00Z",
      local_date: "2026-03-01",
      refund_id: "r1",
      refund_status: "processed",
      refund_amount_cents: 10000,
      booking_id: "b1",
      class_name: "Boxing Basics",
      class_local_date: "2026-03-02",
    },
    {
      id: "e2",
      entry_kind: "processing_fee",
      owed_by: "seshup",
      amount_cents: 250,
      created_at: "2026-03-10T10:00:00Z",
      local_date: "2026-03-10",
      refund_id: "r2",
      refund_status: "processed",
      refund_amount_cents: 10000,
      booking_id: "b2",
      class_name: "Sparring",
      class_local_date: "2026-03-12",
    },
  ],
};

describe("formatStatement", () => {
  it("shows totals and entries in rand with a readable month", () => {
    const view = formatStatement(raw);
    expect(view.monthLabel).toBe("March 2026");
    expect(view.gymOwes).toBe("R1 234.56");
    expect(view.seshupAbsorbed).toBe("R2.50");
    expect(view.entries).toHaveLength(2);
    expect(view.entries[0]).toMatchObject({
      kind: "Gym share of refund",
      owedBy: "gym",
      amount: "R90.00",
      refundAmount: "R100.00",
      entryDate: "1 Mar 2026",
      classLabel: "Boxing Basics, 2 Mar 2026",
    });
    expect(view.entries[1]).toMatchObject({ kind: "Processing fee kept", owedBy: "seshup", amount: "R2.50" });
  });

  it("shows an empty month as zero", () => {
    const view = formatStatement({ ...raw, gym_owes_cents: 0, seshup_absorbed_cents: 0, entries: [] });
    expect(view.gymOwes).toBe("R0.00");
    expect(view.entries).toEqual([]);
  });
});

describe("parseMonth", () => {
  it("accepts a month or a date and returns the first day", () => {
    expect(parseMonth("2026-03")).toBe("2026-03-01");
    expect(parseMonth("2026-03-15")).toBe("2026-03-01");
  });
  it("refuses anything else", () => {
    for (const bad of ["", "2026-13", "2026-00", "March", "26-03", "2026/03"]) expect(parseMonth(bad)).toBeNull();
  });
});

describe("fetchStatement", () => {
  it("calls gym_statement with the gym and month start", async () => {
    const calls: { fn: string; args?: Record<string, unknown> }[] = [];
    const view = await fetchStatement(
      async (fn, args) => {
        calls.push({ fn, args });
        return { data: raw, error: null };
      },
      raw.gym_id,
      "2026-03-01",
    );
    expect(calls).toEqual([{ fn: "gym_statement", args: { p_gym: raw.gym_id, p_month: "2026-03-01" } }]);
    expect(view?.gymName).toBe("Pilot Gym");
  });

  it("returns null for an unknown gym and throws on other errors", async () => {
    expect(await fetchStatement(async () => ({ data: null, error: { message: "gym_not_found" } }), raw.gym_id, "2026-03-01")).toBeNull();
    await expect(
      fetchStatement(async () => ({ data: null, error: { message: "boom" } }), raw.gym_id, "2026-03-01"),
    ).rejects.toThrow("boom");
  });
});
