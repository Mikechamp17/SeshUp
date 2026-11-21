import type { SupabaseClient } from "@supabase/supabase-js";

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
};

/** A short message for the database errors an owner can cause. Unknown errors are shown plainly. */
export function friendlyError(message: string): string {
  for (const [code, text] of Object.entries(MESSAGES)) {
    if (message.includes(code)) return text;
  }
  return message;
}

export function parseSeriesForm(formData: FormData): { ok: true; value: SeriesInput } | { ok: false; error: string } {
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const num = (k: string) => Number(text(k));
  const weekdays = formData.getAll("weekdays").map((v) => Number(v)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  const level = text("level") as Level;
  const priceRand = Number(text("price"));

  if (!text("name")) return { ok: false, error: "Enter a class name." };
  if (!LEVELS.includes(level)) return { ok: false, error: "Choose a level." };
  if (weekdays.length === 0) return { ok: false, error: "Choose at least one day." };
  if (!/^\d{2}:\d{2}$/.test(text("startTime"))) return { ok: false, error: "Enter a start time." };
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
      weekdays: [...new Set(weekdays)].sort(),
      startTime: text("startTime"),
      lengthMinutes: num("length"),
      spotLimit: num("spotLimit"),
      priceCents: Math.round(priceRand * 100),
      cutoffHours: cutoff,
    },
  };
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
