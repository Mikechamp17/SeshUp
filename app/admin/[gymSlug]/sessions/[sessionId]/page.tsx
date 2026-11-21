import Link from "next/link";
import { requireStaff } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { formatGymDateTime } from "@/lib/time/gym-time";
import { Banner, first, type SearchParams } from "../../../banner";
import { styles } from "../../../styles";
import { formatRand } from "@/lib/money/fees";
import { changeTimeAction, setSpotLimitAction, updateSessionAction } from "../../actions";
import { cancelDateAction } from "./cancel-action";

export const metadata = { title: "Class date" };

type Person = { name: string; email: string | null };
type CancelPreview = { booked: number; refund_total_cents: number; waitlisted: number };

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ gymSlug: string; sessionId: string }>;
  searchParams: SearchParams;
}) {
  const { gymSlug, sessionId } = await params;
  const query = await searchParams;
  await requireStaff(gymSlug);
  const supabase = await createClient();

  const { data: session } = await supabase.from("class_sessions").select("*").eq("id", sessionId).single();
  if (!session) return <main style={styles.main}><p>Class date not found.</p></main>;
  const { data: gym } = await supabase.from("gyms").select("timezone").eq("id", session.gym_id).single();
  const tz = gym?.timezone ?? "Africa/Johannesburg";
  const { data: coaches } = await supabase.from("coaches").select("id, name").eq("gym_id", session.gym_id).order("name");

  const { data: bookings } = await supabase
    .from("bookings")
    .select("status, hold_expires_at, profiles(name, email)")
    .eq("session_id", sessionId)
    .in("status", ["confirmed", "pending"])
    .order("created_at");
  const { data: waiting } = await supabase
    .from("waitlist_entries")
    .select("created_at, profiles(name)")
    .eq("session_id", sessionId)
    .order("created_at");
  const { data: takenData } = await supabase.rpc("session_spots_taken", { p_session_id: sessionId });
  const taken = typeof takenData === "number" ? takenData : 0;

  const person = (b: { profiles: unknown }) => (Array.isArray(b.profiles) ? b.profiles[0] : b.profiles) as Person | null;
  const confirmed = (bookings ?? []).filter((b) => b.status === "confirmed");
  const pending = (bookings ?? []).filter((b) => b.status === "pending");

  // Cancelling a date is two steps: the owner sees who will be refunded before it happens.
  const confirmCancel = first(query.cancel) === "1";
  let preview: CancelPreview | null = null;
  if (confirmCancel && !session.cancelled) {
    const { data: p } = await supabase.rpc("cancel_preview", { p_session_id: sessionId });
    preview = p as CancelPreview;
  }

  // Two-step time change: pick a time, then see who will be told before it is saved.
  const to = first(query.to);
  const toValid = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(to);

  return (
    <main style={styles.main}>
      <p><Link href={`/admin/${gymSlug}`}>Back</Link></p>
      <h1>{session.name}</h1>
      <p>
        {formatGymDateTime(session.starts_at, tz)} - {session.level} {session.cancelled ? "(cancelled)" : ""}
      </p>
      <Banner error={first(query.error)} message={first(query.message)} />
      <p>
        <strong>{taken}</strong> of {session.spot_limit} spots taken, {Math.max(session.spot_limit - taken, 0)} left
      </p>

      <h2>Booked ({confirmed.length})</h2>
      {confirmed.length === 0 ? <p style={styles.small}>Nobody yet.</p> : null}
      <ul>
        {confirmed.map((b, i) => (
          <li key={i}>{person(b)?.name || "Member"} <span style={styles.small}>{person(b)?.email}</span></li>
        ))}
      </ul>
      {pending.length > 0 ? (
        <>
          <h2>Paying now ({pending.length})</h2>
          <ul>
            {pending.map((b, i) => (
              <li key={i}>{person(b)?.name || "Member"} <span style={styles.small}>spot held while they pay</span></li>
            ))}
          </ul>
        </>
      ) : null}

      <h2>Waitlist ({(waiting ?? []).length})</h2>
      <ol>
        {(waiting ?? []).map((w, i) => (
          <li key={i}>{person(w)?.name || "Member"}</li>
        ))}
      </ol>

      {!session.cancelled ? (
        <>
          <h2>This date only</h2>
          <form action={updateSessionAction} style={styles.form}>
            <input type="hidden" name="slug" value={gymSlug} />
            <input type="hidden" name="sessionId" value={sessionId} />
            <label style={styles.label}>
              Price (rand)
              <input name="price" type="number" min={1} step="0.01" defaultValue={(session.price_cents / 100).toFixed(2)} required style={styles.input} />
            </label>
            <label style={styles.label}>
              Free cancellation until (hours before start)
              <input name="cutoffHours" type="number" min={0} defaultValue={session.cutoff_hours} required style={styles.input} />
            </label>
            <label style={styles.label}>
              Coach
              <select name="coachId" defaultValue={session.coach_id ?? ""} style={styles.input}>
                <option value="">No coach</option>
                {(coaches ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <button type="submit" style={styles.button}>Save</button>
          </form>

          <form action={setSpotLimitAction} style={{ ...styles.form, marginTop: 16 }}>
            <input type="hidden" name="slug" value={gymSlug} />
            <input type="hidden" name="sessionId" value={sessionId} />
            <label style={styles.label}>
              Spots (cannot go below the {taken} taken)
              <input name="spotLimit" type="number" min={1} defaultValue={session.spot_limit} required style={styles.input} />
            </label>
            <button type="submit" style={styles.secondary}>Change spots</button>
          </form>

          <h2>Move to a different time</h2>
          {toValid ? (
            <form action={changeTimeAction} style={styles.form}>
              <input type="hidden" name="slug" value={gymSlug} />
              <input type="hidden" name="sessionId" value={sessionId} />
              <input type="hidden" name="to" value={to} />
              <p role="status" style={styles.notice}>
                {confirmed.length === 0
                  ? `Move this class to ${to.replace("T", " ")}. Nobody is booked, so nobody will be emailed.`
                  : `${confirmed.length} booked member${confirmed.length === 1 ? "" : "s"} will be emailed and can cancel for a full refund until the class starts.`}
              </p>
              <button type="submit" style={styles.button}>Confirm new time</button>
              <Link href={`/admin/${gymSlug}/sessions/${sessionId}`}>Cancel</Link>
            </form>
          ) : (
            <form method="get" style={styles.form}>
              <label style={styles.label}>
                New date and time (gym time)
                <input name="to" type="datetime-local" required style={styles.input} />
              </label>
              <button type="submit" style={styles.secondary}>Review the change</button>
            </form>
          )}

          <h2>Cancel this date</h2>
          {preview ? (
            <form action={cancelDateAction} style={styles.form}>
              <input type="hidden" name="slug" value={gymSlug} />
              <input type="hidden" name="sessionId" value={sessionId} />
              <p role="alert" style={styles.error}>
                {preview.booked} booked member{preview.booked === 1 ? "" : "s"} will be refunded {formatRand(preview.refund_total_cents)} in total and emailed
                {preview.waitlisted > 0 ? `. ${preview.waitlisted} waitlisted member${preview.waitlisted === 1 ? "" : "s"} will be removed from the waitlist` : ""}.
                This cannot be undone.
              </p>
              <button type="submit" style={styles.danger}>Yes, cancel this class</button>
              <Link href={`/admin/${gymSlug}/sessions/${sessionId}`}>Keep it</Link>
            </form>
          ) : (
            <p><Link href={`/admin/${gymSlug}/sessions/${sessionId}?cancel=1`}>Cancel this date</Link></p>
          )}
        </>
      ) : null}
    </main>
  );
}
