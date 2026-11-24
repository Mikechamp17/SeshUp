import Link from "next/link";
import { requireStaff } from "@/lib/auth/roles";
import { one } from "@/lib/db/rows";
import { createClient } from "@/lib/supabase/server";
import { formatGymDateTime } from "@/lib/time/gym-time";
import { first, type SearchParams } from "@/lib/http/search-params";
import { Alert } from "../../../../ui";
import { Banner } from "../../../banner";
import { CancelWarning, type CancelPreview } from "../../../cancel-warning";
import { changeTimeAction, setSpotLimitAction, updateSessionAction } from "../../actions";
import { cancelDateAction } from "./cancel-action";

export const metadata = { title: "Class date" };

type Person = { name: string; email: string | null };

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
  if (!session) return <main className="app-body pad"><p>Class date not found.</p></main>;
  const [{ data: gym }, { data: coaches }, { data: bookings }, { data: waiting }, { data: takenData }] = await Promise.all([
    supabase.from("gyms").select("timezone").eq("id", session.gym_id).single(),
    supabase.from("coaches").select("id, name").eq("gym_id", session.gym_id).order("name"),
    supabase
      .from("bookings")
      .select("status, hold_expires_at, profiles(name, email)")
      .eq("session_id", sessionId)
      .in("status", ["confirmed", "pending"])
      .order("created_at"),
    supabase.from("waitlist_entries").select("created_at, profiles(name)").eq("session_id", sessionId).order("created_at"),
    supabase.rpc("session_spots_taken", { p_session_id: sessionId }),
  ]);
  const tz = gym?.timezone ?? "Africa/Johannesburg";
  const taken = typeof takenData === "number" ? takenData : 0;

  const person = (b: { profiles: unknown }) => one(b.profiles as Person | Person[] | null);
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
  const hidden = (
    <>
      <input type="hidden" name="slug" value={gymSlug} />
      <input type="hidden" name="sessionId" value={sessionId} />
    </>
  );

  return (
    <main className="app-body pad">
      <Link className="backlink" href={`/admin/${gymSlug}`}>&larr; Timetable</Link>
      <h1 className="t-h1" style={{ margin: "4px 0 4px" }}>{session.name}</h1>
      <p style={{ fontWeight: 700, marginBottom: 12 }}>
        {formatGymDateTime(session.starts_at, tz)} · {session.level}{" "}
        {session.cancelled ? <span className="badge b-cancel">Cancelled</span> : null}
      </p>
      <Banner error={first(query.error)} message={first(query.message)} />
      <p className="t-body" style={{ marginBottom: 16 }}>
        <strong>{taken}</strong> of {session.spot_limit} spots taken, {Math.max(session.spot_limit - taken, 0)} left
      </p>

      <h2 className="t-h3" style={{ marginBottom: 8 }}>Booked ({confirmed.length})</h2>
      {confirmed.length === 0 ? <p className="t-small muted">Nobody yet.</p> : null}
      <div className="card" style={{ padding: confirmed.length ? "4px 16px" : 0, border: confirmed.length ? undefined : 0, background: confirmed.length ? undefined : "none" }}>
        {confirmed.map((b, i) => (
          <div key={i} className="row"><span>{person(b)?.name || "Member"}</span><span className="t-small muted">{person(b)?.email}</span></div>
        ))}
      </div>
      {pending.length > 0 ? (
        <>
          <h2 className="t-h3" style={{ margin: "16px 0 8px" }}>Paying now ({pending.length})</h2>
          <div className="card" style={{ padding: "4px 16px" }}>
            {pending.map((b, i) => (
              <div key={i} className="row"><span>{person(b)?.name || "Member"}</span><span className="t-small muted">spot held while they pay</span></div>
            ))}
          </div>
        </>
      ) : null}

      <h2 className="t-h3" style={{ margin: "16px 0 8px" }}>Waitlist ({(waiting ?? []).length})</h2>
      {(waiting ?? []).length === 0 ? <p className="t-small muted">Nobody waiting.</p> : null}
      <ol style={{ margin: 0, paddingLeft: 20 }}>
        {(waiting ?? []).map((w, i) => (
          <li key={i}>{person(w)?.name || "Member"}</li>
        ))}
      </ol>

      {!session.cancelled ? (
        <>
          <h2 className="t-h2" style={{ margin: "24px 0 12px" }}>This date only</h2>
          <form action={updateSessionAction} className="form-stack">
            {hidden}
            <div className="field">
              <label htmlFor="price">Price (rand)</label>
              <input id="price" name="price" type="number" min={1} step="0.01" defaultValue={(session.price_cents / 100).toFixed(2)} required className="input" />
            </div>
            <div className="field">
              <label htmlFor="cutoffHours">Free cancellation until (hours before start)</label>
              <input id="cutoffHours" name="cutoffHours" type="number" min={0} defaultValue={session.cutoff_hours} required className="input" />
            </div>
            <div className="field">
              <label htmlFor="coachId">Coach</label>
              <select id="coachId" name="coachId" defaultValue={session.coach_id ?? ""} className="input">
                <option value="">No coach</option>
                {(coaches ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-primary btn-block">Save</button>
          </form>

          <form action={setSpotLimitAction} className="form-stack" style={{ marginTop: 16 }}>
            {hidden}
            <div className="field">
              <label htmlFor="spotLimit">Spots (cannot go below the {taken} taken)</label>
              <input id="spotLimit" name="spotLimit" type="number" min={1} defaultValue={session.spot_limit} required className="input" />
            </div>
            <button type="submit" className="btn btn-block">Change spots</button>
          </form>

          <h2 className="t-h2" style={{ margin: "24px 0 12px" }}>Move to a different time</h2>
          {toValid ? (
            <form action={changeTimeAction} className="form-stack">
              {hidden}
              <input type="hidden" name="to" value={to} />
              <Alert kind="warn" role="status">
                {confirmed.length === 0
                  ? `Move this class to ${to.replace("T", " ")}. Nobody is booked, so nobody will be emailed.`
                  : `${confirmed.length} booked member${confirmed.length === 1 ? "" : "s"} will be emailed and can cancel for a full refund until the class starts.`}
              </Alert>
              <button type="submit" className="btn btn-primary btn-block">Confirm new time</button>
              <Link className="btn btn-block" href={`/admin/${gymSlug}/sessions/${sessionId}`}>Cancel</Link>
            </form>
          ) : (
            <form method="get" className="form-stack">
              <div className="field">
                <label htmlFor="to">New date and time (gym time)</label>
                <input id="to" name="to" type="datetime-local" required className="input" />
              </div>
              <button type="submit" className="btn btn-block">Review the change</button>
            </form>
          )}

          <h2 className="t-h2" style={{ margin: "24px 0 12px" }}>Cancel this date</h2>
          {preview ? (
            <form action={cancelDateAction} className="form-stack">
              {hidden}
              <CancelWarning preview={preview} />
              <button type="submit" className="btn btn-danger btn-block">Yes, cancel this class</button>
              <Link className="btn btn-block" href={`/admin/${gymSlug}/sessions/${sessionId}`}>Keep it</Link>
            </form>
          ) : (
            <Link className="btn btn-danger btn-block" href={`/admin/${gymSlug}/sessions/${sessionId}?cancel=1`}>Cancel this date</Link>
          )}
        </>
      ) : null}
    </main>
  );
}
