"use server";

import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/booking/schedule";
import { formText, withParams } from "@/lib/http/url";
import { adminReturnPath } from "@/lib/admin/return-path";

/** Cancels a date. The owner-facing database function checks the date belongs to the caller's gym. */
export async function cancelDateAction(formData: FormData): Promise<void> {
  const slug = String(formData.get("slug") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  const path = adminReturnPath(slug, formText(formData, "next"), `/admin/${slug}/sessions/${sessionId}`);
  await requireStaff(slug);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("owner_cancel_session", { p_session_id: sessionId });
  if (error) redirect(withParams(path, { error: friendlyError(error.message) }));
  const result = data as { outcome: string; refunded: number };
  const message =
    result.outcome === "noop"
      ? "That date was already cancelled."
      : `Class cancelled. ${result.refunded} member${result.refunded === 1 ? "" : "s"} will be refunded in full and emailed.`;
  redirect(withParams(path, { message }));
}
