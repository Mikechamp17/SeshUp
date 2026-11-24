import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatGymDateTime } from "@/lib/time/gym-time";
import { Alert } from "../../ui";
import { CancelWarning, type CancelPreview } from "../cancel-warning";
import { SheetFrame } from "../sheet-frame";
import { changeTimeAction, updateSessionAction } from "./actions";
import { cancelDateAction } from "./sessions/[sessionId]/cancel-action";

export const SHEET_KINDS = ["cancel", "move", "edit"] as const;
export type SheetKind = (typeof SHEET_KINDS)[number];
export type SheetRow = { id: string; name: string; starts_at: string; spot_limit: number; series_id: string | null };

/** The sheet over the owner timetable for one class date. Each action returns to the timetable with its result. */
export async function TimetableSheet({
  kind,
  row,
  gymSlug,
  gymId,
  timeZone,
  to,
}: {
  kind: SheetKind;
  row: SheetRow;
  gymSlug: string;
  gymId: string;
  timeZone: string;
  to: string;
}) {
  const base = `/admin/${gymSlug}`;
  const supabase = await createClient();
  const when = formatGymDateTime(row.starts_at, timeZone);
  const frame = (eyebrow: string) => ({ eyebrow, title: row.name, subtitle: when, ariaLabel: `${eyebrow} ${row.name}, ${when}`, closeHref: base });
  const hidden = (
    <>
      <input type="hidden" name="slug" value={gymSlug} />
      <input type="hidden" name="sessionId" value={row.id} />
      <input type="hidden" name="next" value={base} />
    </>
  );

  if (kind === "edit") {
    const [{ data: session }, { data: coaches }] = await Promise.all([
      supabase.from("class_sessions").select("price_cents, cutoff_hours, coach_id").eq("id", row.id).single(),
      supabase.from("coaches").select("id, name").eq("gym_id", gymId).order("name"),
    ]);
    return (
      <SheetFrame {...frame("Edit this class")}>
        <p className="t-small muted">{row.series_id ? "This changes this date only." : "Changes apply to this class."}</p>
        <form action={updateSessionAction}>
          {hidden}
          <div className="field">
            <label htmlFor="price">Price (rand)</label>
            <input id="price" name="price" type="number" min={1} step="0.01" defaultValue={((session?.price_cents ?? 0) / 100).toFixed(2)} required className="input" />
          </div>
          <div className="field">
            <label htmlFor="spotLimit">Spots (never below the spots already taken)</label>
            <input id="spotLimit" name="spotLimit" type="number" min={1} defaultValue={row.spot_limit} required className="input" />
          </div>
          <div className="field">
            <label htmlFor="cutoffHours">Free cancellation until (hours before start)</label>
            <input id="cutoffHours" name="cutoffHours" type="number" min={0} defaultValue={session?.cutoff_hours ?? 12} required className="input" />
          </div>
          <div className="field">
            <label htmlFor="coachId">Coach</label>
            <select id="coachId" name="coachId" defaultValue={session?.coach_id ?? ""} className="input">
              <option value="">No coach</option>
              {(coaches ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn-primary btn-block">Save this date</button>
        </form>
        {row.series_id ? <Link className="btn btn-block" href={`${base}/classes/${row.series_id}`}>Change all future dates instead</Link> : null}
      </SheetFrame>
    );
  }

  const toValid = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(to);
  // The refund preview is only needed to confirm a cancel or to review a move, not to pick the new time.
  let preview: CancelPreview = { booked: 0, refund_total_cents: 0, waitlisted: 0 };
  if (kind === "cancel" || toValid) {
    const { data } = await supabase.rpc("cancel_preview", { p_session_id: row.id });
    preview = (data as CancelPreview | null) ?? preview;
  }

  if (kind === "cancel") {
    return (
      <SheetFrame {...frame("Cancel this class?")}>
        {preview.booked === 0 ? (
          <Alert kind="warn" title="Nobody is booked">Nobody is booked, so nobody will be refunded or emailed.</Alert>
        ) : (
          <CancelWarning preview={preview} />
        )}
        <form action={cancelDateAction}>
          {hidden}
          <button type="submit" className="btn btn-danger btn-block">Yes, cancel this class</button>
        </form>
      </SheetFrame>
    );
  }

  return (
    <SheetFrame {...frame("Move this class")}>
      {toValid ? (
        <form action={changeTimeAction}>
          {hidden}
          <input type="hidden" name="to" value={to} />
          <Alert kind="warn" role="status">
            {preview.booked === 0
              ? `Move this class to ${to.replace("T", " ")}. Nobody is booked, so nobody will be emailed.`
              : `${preview.booked} booked member${preview.booked === 1 ? "" : "s"} will be emailed and can cancel for a full refund until the class starts.`}
          </Alert>
          <button type="submit" className="btn btn-primary btn-block">Confirm new time</button>
          <Link className="btn btn-block" scroll={false} href={`${base}?sheet=move&id=${row.id}`}>Pick another time</Link>
        </form>
      ) : (
        <form method="get" action={base}>
          <input type="hidden" name="sheet" value="move" />
          <input type="hidden" name="id" value={row.id} />
          <div className="field">
            <label htmlFor="to">New date and time (gym time)</label>
            <input id="to" name="to" type="datetime-local" required className="input" />
          </div>
          <button type="submit" className="btn btn-primary btn-block">Review the change</button>
        </form>
      )}
    </SheetFrame>
  );
}
