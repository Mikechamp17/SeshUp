import Link from "next/link";
import { notFound } from "next/navigation";
import { formatRand } from "@/lib/money/fees";
import { createClient } from "@/lib/supabase/server";
import { formatGymDateTime } from "@/lib/time/gym-time";
import { styles } from "../../../styles";
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

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

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

  return (
    <main style={styles.main}>
      <p><Link href={`/g/${gymSlug}`}>All classes</Link></p>
      <h1>{cls.name}</h1>
      <p>
        {formatGymDateTime(cls.starts_at, gym.timezone)} - {cls.length_minutes} min - {cls.level}
        {cls.coach_name ? ` - Coach ${cls.coach_name}` : ""}
      </p>
      {cls.description ? <p>{cls.description}</p> : null}
      <p><strong>{formatRand(cls.price_cents)}</strong></p>
      {error ? <p role="alert" style={styles.error}>{error}</p> : null}
      {message ? <p role="status" style={styles.notice}>{message}</p> : null}

      {!cls.bookable ? <p>Booking is not open for this gym yet.</p> : null}

      {cls.bookable && state === "signed_out" && cls.spots_left > 0 ? (
        <>
          <p>{cls.spots_left} spot{cls.spots_left === 1 ? "" : "s"} left.</p>
          <Link href={`/auth/sign-in?next=${next}`} style={{ ...styles.button, display: "block", textAlign: "center", textDecoration: "none" }}>
            Sign in to book
          </Link>
          <p style={styles.small}>New here? <Link href={`/auth/sign-up?next=${next}`}>Create an account</Link></p>
        </>
      ) : null}
      {cls.bookable && state === "signed_out" && cls.spots_left <= 0 ? (
        <p>This class is full. <Link href={`/auth/sign-in?next=${next}`}>Sign in</Link> to join the waitlist.</p>
      ) : null}

      {cls.bookable && state === "open" ? (
        <form action={bookClass} style={styles.form}>
          <input type="hidden" name="slug" value={gymSlug} />
          <input type="hidden" name="sessionId" value={sessionId} />
          <p>{cls.spots_left} spot{cls.spots_left === 1 ? "" : "s"} left.</p>
          <button type="submit" style={styles.button}>Book and pay {formatRand(cls.price_cents)}</button>
        </form>
      ) : null}

      {state === "booked" ? (
        <p role="status" style={styles.notice}>
          You&apos;re booked. <Link href="/account/bookings">See your bookings</Link>
        </p>
      ) : null}

      {state === "paying" ? (
        <form action={bookClass} style={styles.form}>
          <input type="hidden" name="slug" value={gymSlug} />
          <input type="hidden" name="sessionId" value={sessionId} />
          <p role="status" style={styles.notice}>
            Your spot is held{heldUntil ? ` until ${formatGymDateTime(heldUntil, gym.timezone).split(", ")[1]}` : ""}. Finish paying to keep it.
          </p>
          <button type="submit" style={styles.button}>Continue payment</button>
        </form>
      ) : null}

      {state === "offered" ? (
        <form action={bookClass} style={styles.form}>
          <input type="hidden" name="slug" value={gymSlug} />
          <input type="hidden" name="sessionId" value={sessionId} />
          <p role="status" style={styles.notice}>
            A spot is held for you{heldUntil ? ` until ${formatGymDateTime(heldUntil, gym.timezone)}` : ""}. Book and pay before then.
          </p>
          <button type="submit" style={styles.button}>Book and pay {formatRand(cls.price_cents)}</button>
        </form>
      ) : null}

      {state === "waitlisted" ? (
        <form action={leaveWaitlist} style={styles.form}>
          <input type="hidden" name="slug" value={gymSlug} />
          <input type="hidden" name="sessionId" value={sessionId} />
          <p role="status" style={styles.notice}>You&apos;re on the waitlist, number {waitPosition}. You are only charged if you book when a spot opens.</p>
          <button type="submit" style={styles.secondary}>Leave the waitlist</button>
        </form>
      ) : null}
      {state === "full" ? (
        <form action={joinWaitlist} style={styles.form}>
          <input type="hidden" name="slug" value={gymSlug} />
          <input type="hidden" name="sessionId" value={sessionId} />
          <p>This class is full.</p>
          <button type="submit" style={styles.button}>Join the waitlist</button>
        </form>
      ) : null}
    </main>
  );
}
