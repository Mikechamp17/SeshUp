import type { SupabaseClient } from "@supabase/supabase-js";
import { lookupMessage } from "@/lib/http/url";
import { zonedTimeToUtc } from "@/lib/time/gym-time";

export const LEVELS = ["Beginner", "Intermediate", "Advanced", "Sparring"] as const;
export type Level = (typeof LEVELS)[number];

export type SeriesInput = {
  name: string;
  description: string;
  level: Level;
  coachId: string | null;
  weekdays: number[];
  startTime: string;
  lengthMinutes: number;
  spotLimit: number;
  priceCents: number;
  cutoffHours: number;
};

const MESSAGES: Record<string, string> = {
  limit_below_taken: "You cannot set the spot limit below the spots already taken on this date.",
  not_staff: "You do not have access to that class.",
  session_cancelled: "That date is cancelled.",
  time_in_past: "Choose a time in the future.",
  coach_wrong_gym: "Choose one of your own coaches.",
  invalid_limit: "Enter a spot limit of at least 1.",
  series_not_found: "That class was not found.",
};

/** A short message for the database errors an owner can cause. Unknown errors are shown plainly. */
export function friendlyError(message: string): string {
  return lookupMessage(MESSAGES, message, message);
}

type ClassFields = Omit<SeriesInput, "weekdays" | "startTime">;
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** The fields a repeating class and a one-off class share. */
function parseClassFields(formData: FormData): Parsed<ClassFields> {
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const num = (k: string) => Number(text(k));
  const level = text("level") as Level;
  const priceRand = Number(text("price"));

  if (!text("name")) return { ok: false, error: "Enter a class name." };
  if (!LEVELS.includes(level)) return { ok: false, error: "Choose a level." };
  if (!Number.isInteger(num("length")) || num("length") < 1) return { ok: false, error: "Enter the class length in minutes." };
  if (!Number.isInteger(num("spotLimit")) || num("spotLimit") < 1) return { ok: false, error: "Enter a spot limit of at least 1." };
  if (!Number.isFinite(priceRand) || priceRand <= 0) return { ok: false, error: "Enter a price above zero." };
  const cutoff = text("cutoffHours") === "" ? 12 : num("cutoffHours");
  if (!Number.isInteger(cutoff) || cutoff < 0) return { ok: false, error: "Enter the cancellation cutoff in whole hours." };

  return {
    ok: true,
    value: {
      name: text("name"),
      description: text("description"),
      level,
      coachId: text("coachId") || null,
      lengthMinutes: num("length"),
      spotLimit: num("spotLimit"),
      priceCents: Math.round(priceRand * 100),
      cutoffHours: cutoff,
    },
  };
}

export function parseSeriesForm(formData: FormData): Parsed<SeriesInput> {
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const weekdays = formData.getAll("weekdays").map((v) => Number(v)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  const fields = parseClassFields(formData);
  if (!fields.ok) return fields;
  if (weekdays.length === 0) return { ok: false, error: "Choose at least one day." };
  if (!/^\d{2}:\d{2}$/.test(text("startTime"))) return { ok: false, error: "Enter a start time." };
  return { ok: true, value: { ...fields.value, weekdays: [...new Set(weekdays)].sort(), startTime: text("startTime") } };
}

export type OneOffInput = ClassFields & { startsAt: Date };

/** True for a YYYY-MM-DD that is a real calendar day, so 2026-13-45 and 2026-02-30 are refused. */
function isRealDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d;
}

/** A class for one date. The date and time are the gym's local ones and become one instant in its time zone. */
export function parseOneOffForm(formData: FormData, timeZone: string): Parsed<OneOffInput> {
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const date = text("date");
  if (!isRealDate(date)) return { ok: false, error: "Choose the date of the class." };
  if (!/^\d{2}:\d{2}$/.test(text("startTime"))) return { ok: false, error: "Enter a start time." };
  const fields = parseClassFields(formData);
  if (!fields.ok) return fields;
  return { ok: true, value: { ...fields.value, startsAt: zonedTimeToUtc(date, text("startTime"), timeZone) } };
}

/** Creates the series, then asks the database to fill in its dates. */
export async function createSeries(supabase: SupabaseClient, gymId: string, input: SeriesInput): Promise<string> {
  const { data, error } = await supabase
    .from("class_series")
    .insert({
      gym_id: gymId,
      name: input.name,
      description: input.description,
      level: input.level,
      coach_id: input.coachId,
      weekdays: input.weekdays,
      start_time: input.startTime,
      length_minutes: input.lengthMinutes,
      spot_limit: input.spotLimit,
      price_cents: input.priceCents,
      cutoff_hours: input.cutoffHours,
    })
    .select("id")
    .single();
  if (error) throw new Error(friendlyError(error.message));
  const generated = await supabase.rpc("generate_my_series_sessions", { p_series: data.id });
  if (generated.error) throw new Error(friendlyError(generated.error.message));
  return data.id as string;
}

export async function updateSeries(supabase: SupabaseClient, seriesId: string, input: SeriesInput): Promise<void> {
  const { error } = await supabase.rpc("update_series", {
    p_series: seriesId,
    p_name: input.name,
    p_description: input.description,
    p_level: input.level,
    p_coach: input.coachId,
    p_weekdays: input.weekdays,
    p_start_time: input.startTime,
    p_length: input.lengthMinutes,
    p_spot_limit: input.spotLimit,
    p_price: input.priceCents,
    p_cutoff: input.cutoffHours,
  });
  if (error) throw new Error(friendlyError(error.message));
}

export async function setSpotLimit(supabase: SupabaseClient, sessionId: string, limit: number): Promise<void> {
  const { error } = await supabase.rpc("set_spot_limit", { p_session_id: sessionId, p_limit: limit });
  if (error) throw new Error(friendlyError(error.message));
}

export async function changeSessionTime(supabase: SupabaseClient, sessionId: string, newStart: Date): Promise<void> {
  const { error } = await supabase.rpc("change_session_time", { p_session_id: sessionId, p_new_start: newStart.toISOString() });
  if (error) throw new Error(friendlyError(error.message));
}

/** Adds one date with no repeating class behind it. */
export async function createOneOff(supabase: SupabaseClient, gymId: string, input: OneOffInput): Promise<string> {
  const { data, error } = await supabase.rpc("create_one_off_class", {
    p_gym: gymId,
    p_name: input.name,
    p_description: input.description,
    p_level: input.level,
    p_coach: input.coachId,
    p_start: input.startsAt.toISOString(),
    p_length: input.lengthMinutes,
    p_spot_limit: input.spotLimit,
    p_price: input.priceCents,
    p_cutoff: input.cutoffHours,
  });
  if (error) throw new Error(friendlyError(error.message));
  return data as string;
}

/** Stops a repeating class. Returns how many empty dates were removed and how many future dates stay. */
export async function endSeries(supabase: SupabaseClient, seriesId: string): Promise<{ removed: number; kept: number }> {
  const { data, error } = await supabase.rpc("end_series", { p_series: seriesId });
  if (error) throw new Error(friendlyError(error.message));
  const result = data as { removed: number; kept: number };
  return { removed: result.removed, kept: result.kept };
}

/** What the owner is told after stopping a class. */
export function stopMessage(removed: number, kept: number): string {
  if (removed === 0 && kept === 0) return "Class stopped. It had no future dates to remove.";
  const parts = ["Class stopped."];
  if (removed > 0) parts.push(`${removed} empty ${removed === 1 ? "date was" : "dates were"} removed.`);
  if (kept > 0) parts.push(`${kept} ${kept === 1 ? "date stays because it has" : "dates stay because they have"} bookings or ${kept === 1 ? "is" : "are"} cancelled.`);
  return parts.join(" ");
}
