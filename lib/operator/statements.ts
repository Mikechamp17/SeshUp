import type { Rpc } from "@/lib/email/outbox";
import { formatRand } from "@/lib/money/fees";
import { isUuid, type OperatorContext } from "./gyms";

/** The jsonb that public.gym_statement returns. */
export type RawStatement = {
  gym_id: string;
  gym_name: string;
  timezone: string;
  month_start: string;
  gym_owes_cents: number;
  seshup_absorbed_cents: number;
  entries: {
    id: string;
    entry_kind: "gym_share" | "processing_fee";
    owed_by: "gym" | "seshup";
    amount_cents: number;
    created_at: string;
    local_date: string;
    refund_id: string;
    refund_status: string;
    refund_amount_cents: number;
    booking_id: string;
    class_name: string;
    class_local_date: string;
  }[];
};

export type StatementEntry = {
  id: string;
  kind: string;
  owedBy: "gym" | "seshup";
  amount: string;
  entryDate: string;
  refundAmount: string;
  refundStatus: string;
  classLabel: string;
};

export type StatementView = {
  gymName: string;
  monthLabel: string;
  timezone: string;
  gymOwes: string;
  seshupAbsorbed: string;
  entries: StatementEntry[];
};

const KIND_LABELS: Record<string, string> = {
  gym_share: "Gym share of refund",
  processing_fee: "Processing fee kept",
};

/** "2026-03" or "2026-03-15" to the month's first day, "2026-03-01". Null when it is not a real month. */
export function parseMonth(input: string): string | null {
  const m = /^(\d{4})-(\d{2})(-\d{2})?$/.exec(input.trim());
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

function monthLabel(monthStart: string): string {
  const [y, m] = monthStart.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

function dayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export function formatStatement(raw: RawStatement): StatementView {
  return {
    gymName: raw.gym_name,
    monthLabel: monthLabel(raw.month_start),
    timezone: raw.timezone,
    gymOwes: formatRand(raw.gym_owes_cents),
    seshupAbsorbed: formatRand(raw.seshup_absorbed_cents),
    entries: raw.entries.map((e) => ({
      id: e.id,
      kind: KIND_LABELS[e.entry_kind] ?? e.entry_kind,
      owedBy: e.owed_by,
      amount: formatRand(e.amount_cents),
      entryDate: dayLabel(e.local_date),
      refundAmount: formatRand(e.refund_amount_cents),
      refundStatus: e.refund_status,
      classLabel: `${e.class_name}, ${dayLabel(e.class_local_date)}`,
    })),
  };
}

/** Fetches one gym's statement for a month through the SQL function. Operator only. */
export async function loadStatement(
  ctx: Pick<OperatorContext, "assertOperator" | "rpc">,
  gymId: string,
  month: string,
): Promise<StatementView | null> {
  await ctx.assertOperator();
  const monthStart = parseMonth(month);
  if (!monthStart || !isUuid(gymId)) return null;
  return fetchStatement(ctx.rpc(), gymId, monthStart);
}

export async function fetchStatement(rpc: Rpc, gymId: string, monthStart: string): Promise<StatementView | null> {
  const { data, error } = await rpc("gym_statement", { p_gym: gymId, p_month: monthStart });
  if (error) {
    if (/gym_not_found/.test(error.message)) return null;
    throw new Error(error.message);
  }
  return formatStatement(data as RawStatement);
}
