"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/roles";
import { lookupMessage, withParams } from "@/lib/http/url";
import { createClient } from "@/lib/supabase/server";

const MESSAGES: Record<string, string> = {
  not_full: "This class has spots left, so you can book it now.",
  already_booked: "You already have a spot in this class.",
  already_waitlisted: "You are already on the waitlist.",
  session_started: "This class has already started.",
  session_cancelled: "This class has been cancelled.",
  outside_window: "The waitlist opens 2 weeks before the class.",
};

function go(slug: string, sessionId: string, params: Record<string, string>): never {
  redirect(withParams(`/g/${slug}/classes/${sessionId}`, params));
}

function friendly(message: string): string {
  return lookupMessage(MESSAGES, message, "Something went wrong. Please try again.");
}

export async function joinWaitlist(formData: FormData): Promise<void> {
  const slug = String(formData.get("slug") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  await requireUser(`/g/${slug}/classes/${sessionId}`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("join_waitlist", { p_session_id: sessionId });
  if (error) go(slug, sessionId, { error: friendly(error.message) });
  go(slug, sessionId, { message: "You are on the waitlist. We will email you if a spot opens. You are never charged unless you choose to book." });
}

export async function leaveWaitlist(formData: FormData): Promise<void> {
  const slug = String(formData.get("slug") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  await requireUser(`/g/${slug}/classes/${sessionId}`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("leave_waitlist", { p_session_id: sessionId });
  if (error) go(slug, sessionId, { error: friendly(error.message) });
  go(slug, sessionId, { message: "You have left the waitlist." });
}
