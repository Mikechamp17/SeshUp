import Link from "next/link";
import { requireUser } from "@/lib/auth/roles";
import { formatRand } from "@/lib/money/fees";
import { createClient } from "@/lib/supabase/server";
import { formatGymDateTime } from "@/lib/time/gym-time";
import { one } from "@/lib/db/rows";
import { first, type SearchParams } from "@/lib/http/search-params";
import { styles } from "../../g/styles";
import { cancelBooking } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your bookings" };


type Gym = { name: string; slug: string; timezone: string };
type Session = { id: string; name: string; starts_at: string; price_cents: number; gyms: Gym | Gym[] | null };
type Row = { id: string; class_sessions: Session | Session[] | null };

export default async function MyBookingsPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  await requireUser("/account/bookings");
  const supabase = await createClient();

  const [{ data }, { data: waiting }] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, class_sessions(id, name, starts_at, price_cents, gyms(name, slug, timezone))")
      .eq("status", "confirmed")
      .order("created_at"),
    supabase
      .from("waitlist_entries")
      .select("id, class_sessions(id, name, starts_at, gyms(name, slug, timezone))")
      .order("created_at"),
  ]);
  const now = new Date();
  const upcoming = ((data ?? []) as unknown as Row[])
    .map((b) => ({ id: b.id, session: one(b.class_sessions) }))
    .filter((b): b is { id: string; session: Session } => b.session !== null && new Date(b.session.starts_at) > now)
    .sort((a, b) => a.session.starts_at.localeCompare(b.session.starts_at));

  const refundable = await Promise.all(
    upcoming.map(async (b) => {
      const { data: ok } = await supabase.rpc("booking_refundable", { p_booking_id: b.id });
      return ok === true;
    }),
  );

  const waitlisted = ((waiting ?? []) as unknown as { id: string; class_sessions: Session | Session[] | null }[])
    .map((w) => ({ id: w.id, session: one(w.class_sessions) }))
    .filter((w): w is { id: string; session: Session } => w.session !== null && new Date(w.session.starts_at) > now);

  const confirmId = first(query.cancel);
  const error = first(query.error);
  const message = first(query.message);

  return (
    <main style={styles.main}>
      <h1>Your bookings</h1>
      {error ? <p role="alert" style={styles.error}>{error}</p> : null}
      {message ? <p role="status" style={styles.notice}>{message}</p> : null}
      {upcoming.length === 0 ? <p>You have no upcoming classes booked.</p> : null}
      {upcoming.map((b, i) => {
        const gym = one(b.session.gyms);
        return (
          <div key={b.id} style={styles.card}>
            <strong>{b.session.name}</strong>
            <div style={styles.small}>
              {gym ? `${gym.name} - ` : ""}
              {formatGymDateTime(b.session.starts_at, gym?.timezone ?? "Africa/Johannesburg")}
            </div>
            <div style={styles.small}>
              {refundable[i]
                ? `Cancel now for a full refund of ${formatRand(b.session.price_cents)}.`
                : "The cancellation cutoff has passed, so cancelling now means no refund."}
            </div>
            {confirmId === b.id ? (
              <form action={cancelBooking} style={{ ...styles.form, marginTop: 8 }}>
                <input type="hidden" name="bookingId" value={b.id} />
                <p role="status" style={refundable[i] ? styles.notice : styles.error}>
                  {refundable[i] ? "Cancel this booking and get a full refund?" : "Cancel this booking with no refund?"}
                </p>
                <button type="submit" style={styles.button}>Yes, cancel it</button>
                <Link href="/account/bookings">Keep my booking</Link>
              </form>
            ) : (
              <p style={{ marginBottom: 0 }}>
                <Link href={`/account/bookings?cancel=${b.id}`}>Cancel booking</Link>
              </p>
            )}
          </div>
        );
      })}
      {waitlisted.length > 0 ? (
        <>
          <h2>Waitlists</h2>
          {waitlisted.map((w) => {
            const gym = one(w.session.gyms);
            return (
              <div key={w.id} style={styles.card}>
                <strong>{w.session.name}</strong>
                <div style={styles.small}>
                  {gym ? `${gym.name} - ` : ""}
                  {formatGymDateTime(w.session.starts_at, gym?.timezone ?? "Africa/Johannesburg")}
                </div>
                {gym ? <Link href={`/g/${gym.slug}/classes/${w.session.id}`}>Open class</Link> : null}
              </div>
            );
          })}
        </>
      ) : null}
    </main>
  );
}
