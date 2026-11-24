import Link from "next/link";
import { notFound } from "next/navigation";
import { formatRand } from "@/lib/money/fees";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { formatGymDateTime } from "@/lib/time/gym-time";
import { first, type SearchParams } from "@/lib/http/search-params";
import { Alert, SpotsBadge, Topbar } from "../../../../ui";
import { Countdown } from "../../../../countdown";
import { bookClass } from "./actions";
import { joinWaitlist, leaveWaitlist } from "./waitlist-actions";

export const dynamic = "force-dynamic";

type Row = {
  session_id: string;
  starts_at: string;
  length_minutes: number;
  name: string;
  description: string;
  level: string;
  coach_name: string | null;
  price_cents: number;
  spots_left: number;
  bookable: boolean;
};

function endTime(startsAt: string, minutes: number, timeZone: string): string {
  const end = new Date(new Date(startsAt).getTime() + minutes * 60_000);
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(end);
}

export default async function ClassPage({
  params,
  searchParams,
}: {
  params: Promise<{ gymSlug: string; sessionId: string }>;
  searchParams: SearchParams;
}) {
  const { gymSlug, sessionId } = await params;
  const query = await searchParams;
  const supabase = await createClient();

  const { data: gymRows } = await supabase.rpc("public_gym", { p_slug: gymSlug });
  const gym = (gymRows as { name: string; timezone: string }[] | null)?.[0];
  if (!gym) notFound();

  const from = new Date();
  const to = new Date(from);
  to.setDate(to.getDate() + 21);
  const { data } = await supabase.rpc("public_timetable", {
    p_gym_slug: gymSlug,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  const cls = ((data ?? []) as Row[]).find((r) => r.session_id === sessionId);
  if (!cls) notFound();

  // The refund cutoff is stated before booking. It is public information about this class, read for display only.
  let cutoff: string | null = null;
  let timeChanged = false;
  try {
    const { data: rule } = await createAdminClient()
      .from("class_sessions")
      .select("cutoff_hours, time_changed")
      .eq("id", sessionId)
      .maybeSingle();
    timeChanged = rule?.time_changed === true;
    if (rule && typeof rule.cutoff_hours === "number") {
      cutoff = formatGymDateTime(new Date(new Date(cls.starts_at).getTime() - rule.cutoff_hours * 3_600_000), gym.timezone);
    }
  } catch {
    cutoff = null;
  }

  // What this viewer can do next. Row-level security limits every read below to the viewer's own rows.
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  let state: "signed_out" | "booked" | "paying" | "waitlisted" | "offered" | "full" | "open" = user ? "open" : "signed_out";
  let heldUntil: string | null = null;
  let waitPosition = 0;

  if (user) {
    const { data: mine } = await supabase
      .from("bookings")
      .select("status, hold_expires_at")
      .eq("session_id", sessionId)
      .in("status", ["pending", "confirmed"]);
    const confirmed = mine?.find((b) => b.status === "confirmed");
    const pending = mine?.find((b) => b.status === "pending" && b.hold_expires_at && new Date(b.hold_expires_at) > new Date());
    const nowIso = new Date().toISOString();
    const { data: offers } = await supabase
      .from("waitlist_offers")
      .select("offer_end")
      .eq("session_id", sessionId)
      .gt("offer_end", nowIso);
    const { data: entries } = await supabase.from("waitlist_entries").select("created_at, member_id").eq("session_id", sessionId);

    if (confirmed) state = "booked";
    else if (pending) {
      state = "paying";
      heldUntil = pending.hold_expires_at;
    } else if (offers && offers.length > 0) {
      state = "offered";
      heldUntil = offers[0].offer_end;
    } else if (entries && entries.length > 0) {
      state = "waitlisted";
      const sorted = [...entries].sort((a, b) => a.created_at.localeCompare(b.created_at));
      waitPosition = sorted.findIndex((e) => e.member_id === user.id) + 1;
    } else if (cls.spots_left <= 0) state = "full";
  } else if (cls.spots_left <= 0) {
    state = "full";
  }

  const error = first(query.error);
  const message = first(query.message);
  const next = encodeURIComponent(`/g/${gymSlug}/classes/${sessionId}`);
  const when = `${formatGymDateTime(cls.starts_at, gym.timezone)} to ${endTime(cls.starts_at, cls.length_minutes, gym.timezone)}`;
  const price = formatRand(cls.price_cents);
  const holding = state === "paying" || state === "offered";

  const hidden = (
    <>
      <input type="hidden" name="slug" value={gymSlug} />
      <input type="hidden" name="sessionId" value={sessionId} />
    </>
  );

  let badge = <SpotsBadge spotsLeft={cls.spots_left} bookable={cls.bookable} />;
  if (cls.bookable && state === "booked") badge = <span className="badge b-open">You&apos;re booked</span>;
  if (cls.bookable && state === "waitlisted") badge = <span className="badge b-plain">On the waitlist</span>;
  if (cls.bookable && holding) badge = <span className="badge b-hold">Held for you</span>;

  return (
    <div className="app">
      <Topbar name={gym.name} />

      {cls.bookable && holding && heldUntil ? (
        <div className="hold-banner">
          <div className="t-eyebrow" style={{ color: "var(--on-accent)" }}>
            {state === "offered" ? "A spot opened for you" : "Spot held for you"}
          </div>
          <p className="t-h2" style={{ marginTop: 6 }}>Held until {formatGymDateTime(heldUntil, gym.timezone).split(", ")[1]}</p>
          <Countdown endsAt={heldUntil} totalSeconds={state === "offered" ? 7200 : 600} />
        </div>
      ) : null}

      <main className="app-body">
        <div className="pad" style={{ paddingBottom: 0 }}>
          <Link className="backlink" href={`/g/${gymSlug}`}>&larr; Timetable</Link>
        </div>

        <div className="stack" style={{ padding: "4px 16px 0", gap: 10 }}>
          <span style={{ alignSelf: "flex-start" }}>{badge}</span>
          <h1 className="t-display">{cls.name}</h1>
          <p style={{ font: "700 20px/1.25 var(--font-body)" }}>{when}</p>
        </div>

        {error ? <div style={{ padding: "16px 16px 0" }}><Alert kind="error" role="alert" title="Could not continue">{error}</Alert></div> : null}
        {message ? <div style={{ padding: "16px 16px 0" }}><Alert kind="ok" role="status">{message}</Alert></div> : null}

        <div style={{ padding: 16 }}>
          <div className="card" style={{ padding: "8px 16px" }}>
            <div className="row"><span className="muted">Level</span><b>{cls.level}</b></div>
            {cls.coach_name ? <div className="row"><span className="muted">Coach</span><b>{cls.coach_name}</b></div> : null}
            <div className="row"><span className="muted">Length</span><b>{cls.length_minutes} minutes</b></div>
            <div className="row"><span className="muted">Price</span><b className="t-num">{price}</b></div>
          </div>
        </div>

        {cls.bookable && state !== "booked" ? (
          <div className="stack" style={{ padding: "0 16px", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span className="t-eyebrow">Spots</span>
              <b className="t-num" style={{ font: "800 20px/1 var(--font-display)", textTransform: "uppercase" }}>
                {cls.spots_left <= 0 ? "0 left" : `${cls.spots_left} left`}
              </b>
            </div>
            <p className="t-small muted">Spots update live. A held spot counts as taken for 10 minutes.</p>
          </div>
        ) : null}

        {cls.description ? (
          <div className="stack" style={{ padding: "24px 16px 0", gap: 8 }}>
            <h2 className="t-h3">What to expect</h2>
            <p className="t-body">{cls.description}</p>
          </div>
        ) : null}

        <div style={{ padding: "24px 16px 0" }} className="stack">
          {!cls.bookable ? (
            <Alert title="Bookings not open yet">
              {gym.name} is still setting up online payments, so this class cannot be booked here yet. The class details above are correct. Check back soon, or ask the gym at the front desk.
            </Alert>
          ) : (
            <Alert kind="warn" title="Cancellation rule">
              {timeChanged ? (
                <>The time of this class was changed, so you can cancel at any time for a full refund of {price}.</>
              ) : cutoff ? (
                <>
                  Cancel before <strong>{cutoff}</strong> for a full refund of {price}. After that, no refund.
                </>
              ) : (
                <>Cancel before the cutoff for a full refund. After that, no refund. The cutoff is shown in your bookings.</>
              )}
            </Alert>
          )}
          {cls.bookable && state === "full" ? (
            <div style={{ marginTop: 16 }}>
              <Alert title="How the waitlist works">
                Joining is free. If someone cancels, we email you and hold the spot for you for a limited time. You only pay if you take it.
              </Alert>
            </div>
          ) : null}
          {cls.bookable && state === "waitlisted" ? (
            <div className="card" style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 16 }} role="status">
              <div className="t-num" style={{ font: "800 64px/1 var(--font-display)" }}>#{waitPosition}</div>
              <p className="t-body"><b>You are number {waitPosition} in line.</b> We email you the moment a spot opens for you. You are only charged if you book.</p>
            </div>
          ) : null}
          {cls.bookable && state === "booked" ? (
            <div style={{ marginTop: 16 }}>
              <Alert kind="ok" role="status" title="You're in">
                Your spot is booked and paid. <Link className="linkish" href="/account/bookings">See your bookings</Link>
              </Alert>
            </div>
          ) : null}
        </div>
      </main>

      {!cls.bookable ? (
        <div className="cta-bar">
          <Link className="btn btn-block" href={`/g/${gymSlug}`}>Back to timetable</Link>
        </div>
      ) : null}

      {cls.bookable && state === "signed_out" && cls.spots_left > 0 ? (
        <div className="cta-bar">
          <Link className="btn btn-primary btn-block" href={`/auth/sign-in?next=${next}`}>Sign in to book</Link>
          <p className="t-small muted" style={{ textAlign: "center" }}>
            New here? <Link className="linkish" href={`/auth/sign-up?next=${next}`}>Create an account</Link>
          </p>
        </div>
      ) : null}
      {cls.bookable && state === "signed_out" && cls.spots_left <= 0 ? (
        <div className="cta-bar">
          <Link className="btn btn-dark btn-block" href={`/auth/sign-in?next=${next}`}>Sign in to join the waitlist</Link>
        </div>
      ) : null}

      {cls.bookable && state === "open" ? (
        <form action={bookClass} className="cta-bar">
          {hidden}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="stack" style={{ flex: "none" }}>
              <span className="t-eyebrow">Total</span>
              <span className="price t-num" style={{ fontSize: 30 }}>{price}</span>
            </div>
            <button type="submit" className="btn btn-primary btn-block" style={{ flex: 1 }}>Book this class</button>
          </div>
          <p className="t-small muted" style={{ textAlign: "center" }}>Your spot is held for 10 minutes while you pay on Paystack.</p>
        </form>
      ) : null}

      {cls.bookable && state === "paying" ? (
        <form action={bookClass} className="cta-bar">
          {hidden}
          <button type="submit" className="btn btn-primary btn-block">Continue payment · {price}</button>
          <p className="t-small muted" style={{ textAlign: "center" }}>You will leave SeshUp to pay on Paystack&apos;s secure page.</p>
        </form>
      ) : null}

      {cls.bookable && state === "offered" ? (
        <form action={bookClass} className="cta-bar">
          {hidden}
          <button type="submit" className="btn btn-primary btn-block">Book now · {price}</button>
          <p className="t-small muted" style={{ textAlign: "center" }}>Book and pay before the time above, or the spot goes to the next person.</p>
        </form>
      ) : null}

      {cls.bookable && state === "waitlisted" ? (
        <form action={leaveWaitlist} className="cta-bar">
          {hidden}
          <button type="submit" className="btn btn-block">Leave the waitlist</button>
        </form>
      ) : null}

      {cls.bookable && state === "full" ? (
        <form action={joinWaitlist} className="cta-bar">
          {hidden}
          <button type="submit" className="btn btn-dark btn-block">Join the waitlist</button>
          <p className="t-small muted" style={{ textAlign: "center" }}>The waitlist is first come, first served.</p>
        </form>
      ) : null}

      {cls.bookable && state === "booked" ? (
        <div className="cta-bar">
          <Link className="btn btn-primary btn-block" href="/account/bookings">My bookings</Link>
          <Link className="btn btn-block" href={`/g/${gymSlug}`}>Back to timetable</Link>
        </div>
      ) : null}
    </div>
  );
}
