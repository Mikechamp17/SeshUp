import Link from "next/link";
import { requireUser } from "@/lib/auth/roles";
import { formatRand } from "@/lib/money/fees";
import { createClient } from "@/lib/supabase/server";
import { formatGymDateTime } from "@/lib/time/gym-time";
import { one } from "@/lib/db/rows";
import { first, type SearchParams } from "@/lib/http/search-params";
import { Alert, Topbar } from "../../ui";
import { cancelBooking } from "./actions";
import { CancelForm } from "./cancel-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your bookings" };

type Gym = { name: string; slug: string; timezone: string };
type Session = {
  id: string;
  name: string;
  starts_at: string;
  price_cents: number;
  cutoff_hours: number;
  time_changed: boolean;
  gyms: Gym | Gym[] | null;
};
type Row = { id: string; class_sessions: Session | Session[] | null };

export default async function MyBookingsPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  await requireUser("/account/bookings");
  const supabase = await createClient();

  const [{ data }, { data: waiting }] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, class_sessions(id, name, starts_at, price_cents, cutoff_hours, time_changed, gyms(name, slug, timezone))")
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
  const confirmIndex = upcoming.findIndex((b) => b.id === confirmId);
  const confirming = confirmIndex >= 0 ? upcoming[confirmIndex] : null;

  const cutoffText = (s: Session, tz: string) =>
    formatGymDateTime(new Date(new Date(s.starts_at).getTime() - s.cutoff_hours * 3_600_000), tz);

  return (
    <div className="app">
      <Topbar name="My bookings" href="/" />
      <main className="app-body">
        <div style={{ padding: "16px 16px 0" }} className="stack">
          {error ? <Alert kind="error" role="alert" title="Could not cancel">{error}</Alert> : null}
          {message ? <Alert kind="ok" role="status">{message}</Alert> : null}
        </div>

        <div className="day-head"><h1 className="t-h2">Upcoming</h1></div>
        {upcoming.length === 0 ? (
          <div className="empty" style={{ marginTop: 0 }}>
            <Alert title="No classes booked">You have no upcoming classes booked. Open your gym&apos;s link to see its timetable.</Alert>
          </div>
        ) : null}
        {upcoming.map((b, i) => {
          const gym = one(b.session.gyms);
          const tz = gym?.timezone ?? "Africa/Johannesburg";
          return (
            <div key={b.id} className="bk">
              <div className="bk-top">
                <span className="badge b-open" style={{ alignSelf: "flex-start" }}>Confirmed</span>
                <h2 className="t-h3">{b.session.name}</h2>
                <p style={{ fontWeight: 700 }}>{formatGymDateTime(b.session.starts_at, tz)}</p>
                <p className="cc-meta">
                  {gym ? `${gym.name} · ` : ""}{formatRand(b.session.price_cents)} paid
                </p>
              </div>
              <div className="bk-foot">
                <p className="t-small">
                  {b.session.time_changed ? (
                    <><b>Full refund</b> any time, because the time of this class was changed.</>
                  ) : refundable[i] ? (
                    <><b>Full refund</b> if you cancel before {cutoffText(b.session, tz)}.</>
                  ) : (
                    <><b>No refund now.</b> The cutoff was {cutoffText(b.session, tz)}.</>
                  )}
                </p>
                <Link className="btn btn-block btn-sm" href={`/account/bookings?cancel=${b.id}`}>Cancel booking</Link>
              </div>
            </div>
          );
        })}

        {waitlisted.length > 0 ? (
          <>
            <div className="day-head" style={{ paddingTop: 12 }}><h2 className="t-h2">Waitlists</h2></div>
            {waitlisted.map((w) => {
              const gym = one(w.session.gyms);
              return (
                <div key={w.id} className="bk">
                  <div className="bk-top">
                    <span className="badge b-plain" style={{ alignSelf: "flex-start" }}>On the waitlist</span>
                    <h2 className="t-h3">{w.session.name}</h2>
                    <p style={{ fontWeight: 700 }}>{formatGymDateTime(w.session.starts_at, gym?.timezone ?? "Africa/Johannesburg")}</p>
                    {gym ? <p className="cc-meta">{gym.name}</p> : null}
                  </div>
                  {gym ? (
                    <div className="bk-foot">
                      <Link className="btn btn-block btn-sm" href={`/g/${gym.slug}/classes/${w.session.id}`}>Open class</Link>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </>
        ) : null}
      </main>

      {confirming ? (
        <>
          <Link className="scrim" href="/account/bookings" aria-label="Close and keep my booking" />
          <div className="sheet" role="dialog" aria-label="Cancel booking">
            <div className="grab" />
            {(() => {
              const s = confirming.session;
              const gym = one(s.gyms);
              const tz = gym?.timezone ?? "Africa/Johannesburg";
              const ok = refundable[confirmIndex];
              const amount = formatRand(s.price_cents);
              return (
                <>
                  <div className="stack" style={{ gap: 4 }}>
                    <span className="t-eyebrow">Cancel this booking?</span>
                    <h2 className="t-h1">{s.name}</h2>
                    <p style={{ fontWeight: 700 }}>{formatGymDateTime(s.starts_at, tz)}</p>
                  </div>
                  {ok ? (
                    <Alert kind="ok" title={`You get ${amount} back`}>
                      You are cancelling before the cutoff ({cutoffText(s, tz)}), so the full amount is refunded to your card through Paystack.
                    </Alert>
                  ) : (
                    <Alert kind="error" title="No refund, R0.00">
                      The cutoff for a refund has passed. If you cancel now you lose the {amount} you paid, and your spot goes back on sale.
                    </Alert>
                  )}
                  <div className="card" style={{ padding: "4px 16px" }}>
                    <div className="row"><span>Paid</span><b className="t-num">{amount}</b></div>
                    <div className="row">
                      <span>Refund</span>
                      <b className="t-num" style={{ color: ok ? "var(--ok)" : "var(--cancel)" }}>{ok ? amount : "R0.00"}</b>
                    </div>
                  </div>
                  <CancelForm action={cancelBooking} bookingId={confirming.id} refundable={ok} amount={amount} />
                  <Link className={`btn btn-block${ok ? "" : " btn-primary"}`} href="/account/bookings">Keep my spot</Link>
                </>
              );
            })()}
          </div>
        </>
      ) : null}
    </div>
  );
}
