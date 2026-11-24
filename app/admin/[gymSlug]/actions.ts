"use server";

import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import {
  changeSessionTime,
  createOneOff,
  createSeries,
  endSeries,
  parseOneOffForm,
  parseSeriesForm,
  setSpotLimit,
  stopMessage,
  updateSeries,
} from "@/lib/booking/schedule";
import { formText as text, withParams } from "@/lib/http/url";
import { adminReturnPath } from "@/lib/admin/return-path";
import { formatGymDateTime, zonedTimeToUtc } from "@/lib/time/gym-time";

// Every action re-checks that the caller is staff of the gym in the URL, then acts with the caller's own session,
// so row-level security and the owner-facing database functions apply.

function back(path: string, params: Record<string, string>): never {
  redirect(withParams(path, params));
}

/** Where an action on one class date sends the owner afterwards: the page the form came from, else the date's own page. */
function returnPath(formData: FormData, slug: string, sessionId: string): string {
  return adminReturnPath(slug, text(formData, "next"), `/admin/${slug}/sessions/${sessionId}`);
}

async function gymFor(slug: string) {
  await requireStaff(slug);
  const supabase = await createClient();
  const { data, error } = await supabase.from("gyms").select("id, timezone").eq("slug", slug).single();
  if (error || !data) back(`/admin/${slug}`, { error: "Gym not found." });
  return { supabase, gym: data as { id: string; timezone: string } };
}

export async function addCoach(formData: FormData): Promise<void> {
  const slug = text(formData, "slug");
  const name = text(formData, "name");
  const path = `/admin/${slug}/coaches`;
  if (!name) back(path, { error: "Enter the coach's name." });
  const { supabase, gym } = await gymFor(slug);
  const { error } = await supabase.from("coaches").insert({ gym_id: gym.id, name });
  if (error) back(path, { error: error.message });
  back(path, { message: "Coach added." });
}

export async function renameCoach(formData: FormData): Promise<void> {
  const slug = text(formData, "slug");
  const path = `/admin/${slug}/coaches`;
  const name = text(formData, "name");
  if (!name) back(path, { error: "Enter the coach's name." });
  const { supabase } = await gymFor(slug);
  const { error } = await supabase.from("coaches").update({ name }).eq("id", text(formData, "coachId"));
  if (error) back(path, { error: error.message });
  back(path, { message: "Coach renamed." });
}

export async function createSeriesAction(formData: FormData): Promise<void> {
  const slug = text(formData, "slug");
  const path = `/admin/${slug}/classes/new`;
  const parsed = parseSeriesForm(formData);
  if (!parsed.ok) back(path, { kind: "weekly", error: parsed.error });
  const { supabase, gym } = await gymFor(slug);
  try {
    await createSeries(supabase, gym.id, parsed.value);
  } catch (e) {
    back(path, { kind: "weekly", error: e instanceof Error ? e.message : "Could not create the class." });
  }
  back(`/admin/${slug}`, { message: "Class created. Its dates are on the timetable." });
}

/** Adds one date that never repeats. The date and time are the gym's own. */
export async function createOneOffAction(formData: FormData): Promise<void> {
  const slug = text(formData, "slug");
  const path = `/admin/${slug}/classes/new`;
  const { supabase, gym } = await gymFor(slug);
  const parsed = parseOneOffForm(formData, gym.timezone);
  if (!parsed.ok) back(path, { kind: "once", date: text(formData, "date"), error: parsed.error });
  try {
    await createOneOff(supabase, gym.id, parsed.value);
  } catch (e) {
    back(path, { kind: "once", date: text(formData, "date"), error: e instanceof Error ? e.message : "Could not add the class." });
  }
  back(`/admin/${slug}`, { message: `Class added for ${formatGymDateTime(parsed.value.startsAt, gym.timezone)}.` });
}

/** Stops a repeating class. The database removes its empty future dates and keeps the rest. */
export async function endSeriesAction(formData: FormData): Promise<void> {
  const slug = text(formData, "slug");
  const seriesId = text(formData, "seriesId");
  const path = `/admin/${slug}/classes/${seriesId}`;
  const { supabase } = await gymFor(slug);
  let result: { removed: number; kept: number };
  try {
    result = await endSeries(supabase, seriesId);
  } catch (e) {
    back(path, { error: e instanceof Error ? e.message : "Could not stop the class." });
  }
  back(`/admin/${slug}`, { message: stopMessage(result.removed, result.kept) });
}

export async function updateSeriesAction(formData: FormData): Promise<void> {
  const slug = text(formData, "slug");
  const seriesId = text(formData, "seriesId");
  const path = `/admin/${slug}/classes/${seriesId}`;
  const parsed = parseSeriesForm(formData);
  if (!parsed.ok) back(path, { error: parsed.error });
  const { supabase } = await gymFor(slug);
  try {
    await updateSeries(supabase, seriesId, parsed.value);
  } catch (e) {
    back(path, { error: e instanceof Error ? e.message : "Could not save the class." });
  }
  back(path, { message: "Saved. Dates with bookings or their own changes keep their current settings." });
}

export async function updateSessionAction(formData: FormData): Promise<void> {
  const slug = text(formData, "slug");
  const sessionId = text(formData, "sessionId");
  const path = returnPath(formData, slug, sessionId);
  const priceRand = Number(text(formData, "price"));
  const cutoff = Number(text(formData, "cutoffHours"));
  const spotLimit = text(formData, "spotLimit");
  if (!Number.isFinite(priceRand) || priceRand <= 0) back(path, { error: "Enter a price above zero." });
  if (!Number.isInteger(cutoff) || cutoff < 0) back(path, { error: "Enter the cutoff in whole hours." });
  const { supabase } = await gymFor(slug);
  // The spot limit goes first, so a refusal for going below the spots already taken stops the whole save.
  if (spotLimit !== "") {
    try {
      await setSpotLimit(supabase, sessionId, Number(spotLimit));
    } catch (e) {
      back(path, { error: e instanceof Error ? e.message : "Could not change the limit." });
    }
  }
  const { error } = await supabase
    .from("class_sessions")
    .update({ price_cents: Math.round(priceRand * 100), cutoff_hours: cutoff, coach_id: text(formData, "coachId") || null })
    .eq("id", sessionId);
  if (error) back(path, { error: error.message });
  back(path, { message: "Saved. The new price applies to bookings made from now on." });
}

export async function setSpotLimitAction(formData: FormData): Promise<void> {
  const slug = text(formData, "slug");
  const sessionId = text(formData, "sessionId");
  const path = returnPath(formData, slug, sessionId);
  const limit = Number(text(formData, "spotLimit"));
  const { supabase } = await gymFor(slug);
  try {
    await setSpotLimit(supabase, sessionId, limit);
  } catch (e) {
    back(path, { error: e instanceof Error ? e.message : "Could not change the limit." });
  }
  back(path, { message: "Spot limit changed." });
}

export async function changeTimeAction(formData: FormData): Promise<void> {
  const slug = text(formData, "slug");
  const sessionId = text(formData, "sessionId");
  const path = returnPath(formData, slug, sessionId);
  const when = text(formData, "to"); // datetime-local value in the gym's time zone
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(when);
  if (!match) back(path, { error: "Choose a new date and time." });
  const { supabase, gym } = await gymFor(slug);
  try {
    await changeSessionTime(supabase, sessionId, zonedTimeToUtc(match[1], match[2], gym.timezone));
  } catch (e) {
    back(path, { error: e instanceof Error ? e.message : "Could not change the time." });
  }
  back(path, { message: "Time changed. Booked members have been emailed." });
}
