"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/roles";
import { withParams } from "@/lib/http/url";
import { createClient } from "@/lib/supabase/server";

function back(params: Record<string, string>): never {
  redirect(withParams("/account/bookings", params));
}

/** Cancels the signed-in member's own booking. The database decides refund or no refund from the cutoff. */
export async function cancelBooking(formData: FormData): Promise<void> {
  await requireUser("/account/bookings");
  const bookingId = String(formData.get("bookingId") ?? "");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_booking", { p_booking_id: bookingId });
  if (error) {
    const message = error.message.includes("session_started")
      ? "That class has already started."
      : "We could not cancel that booking.";
    back({ error: message });
  }
  const outcome = (data as { outcome: string } | null)?.outcome;
  if (outcome === "refund") back({ message: "Cancelled. A full refund is on its way and we have emailed you." });
  if (outcome === "no_refund") back({ message: "Cancelled. It was after the cancellation cutoff, so there is no refund." });
  back({ message: "That booking was already cancelled." });
}
