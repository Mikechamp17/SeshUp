import Link from "next/link";
import type { ReactNode } from "react";
import { formatRand } from "@/lib/money/fees";
import { createClient } from "@/lib/supabase/server";
import { formatGymDateTime } from "@/lib/time/gym-time";
import { Alert } from "../../ui";
import { changeTimeAction, updateSessionAction } from "./actions";
import { cancelDateAction } from "./sessions/[sessionId]/cancel-action";

export type SheetKind = "cancel" | "move" | "edit";
export type SheetRow = { id: string; name: string; starts_at: string; spot_limit: number; series_id: string | null };

type Preview = { booked: number; refund_total_cents: number; waitlisted: number };

function Frame({ eyebrow, row, timeZone, closeHref, children }: { eyebrow: string; row: SheetRow; timeZone: string; closeHref: string; children: ReactNode }) {
  return (
    <>
      <Link className="scrim" scroll={false} href={closeHref} aria-label="Close and go back to the timetable" />
      <div className="sheet" role="dialog" aria-label={`${eyebrow}: ${row.name}, ${formatGymDateTime(row.starts_at, timeZone)}`}>
        <div className="grab" />
        <div className="stack" style={{ gap: 4 }}>
          <span className="t-eyebrow">{eyebrow}</span>
          <h2 className="t-h1">{row.name}</h2>
          <p style={{ fontWeight: 700 }}>{formatGymDateTime(row.starts_at, timeZone)}</p>
        </div>
        {children}
        <Link className="btn btn-block" scroll={false} href={closeHref}>Close</Link>
      </div>
    </>
  );
}

/** The sheet over the owner timetable for one class date. Each action returns to the timetable with its result. */
export async function TimetableSheet({
  kind,
  row,
  gymSlug,
  timeZone,
  to,
}: {
  kind: SheetKind;
  row: SheetRow;
  gymSlug: string;
  timeZone: string;
  to: string;
}) {
  const base = `/admin/${gymSlug}`;
  const supabase = await createClient();
  const hidden = (
    <>
      <input type="hidden" name="slug" value={gymSlug} />
      <input type="hidden" name="sessionId" value={row.id} />
      <input type="hidden" name="next" value={base} />
    </>
  );

  if (kind === "cancel" || kind === "move") {
    const { data } = await supabase.rpc("cancel_preview", { p_session_id: row.id });
    const preview = (data as Preview | null) ?? { booked: 0, refund_total_cents: 0, waitlisted: 0 };

    if (kind === "cancel") {
      return (
        <Frame eyebrow="Cancel this class?" row={row} timeZone={timeZone} closeHref={base}>
          {preview.booked === 0 ? (
            <Alert kind="warn" title="Nobody is booked">Nobody is booked, so nobody will be refunded or emailed.</Alert>
          ) : (
            <Alert kind="error" role="alert" title="This cannot be undone">
              {preview.booked} booked member{preview.booked === 1 ? "" : "s"} will be refunded {formatRand(preview.refund_total_cents)} in total and emailed
              {preview.waitlisted > 0 ? `. ${preview.waitlisted} waitlisted member${preview.waitlisted === 1 ? "" : "s"} will be removed from the waitlist` : ""}.
            </Alert>
          )}
          <form action={cancelDateAction}>
            {hidden}
            <button type="submit" className="btn btn-danger btn-block">Yes, cancel this class</button>
          </form>
        </Frame>
      );
    }

    const toValid = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(to);
    return (
      <Frame eyebrow="Move this class" row={row} timeZone={timeZone} closeHref={base}>
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
      </Frame>
    );
  }

  const { data: session } = await supabase
    .from("class_sessions")
    .select("gym_id, price_cents, cutoff_hours, coach_id, spot_limit")
    .eq("id", row.id)
    .single();
  const { data: coaches } = await supabase.from("coaches").select("id, name").eq("gym_id", session?.gym_id ?? "").order("name");
  return (
    <Frame eyebrow="Edit this class" row={row} timeZone={timeZone} closeHref={base}>
      <p className="t-small muted">{row.series_id ? "This changes this date only." : "Changes apply to this class."}</p>
      <form action={updateSessionAction}>
        {hidden}
        <div className="field">
          <label htmlFor="price">Price (rand)</label>
          <input id="price" name="price" type="number" min={1} step="0.01" defaultValue={((session?.price_cents ?? 0) / 100).toFixed(2)} required className="input" />
        </div>
        <div className="field">
          <label htmlFor="spotLimit">Spots (never below the spots already taken)</label>
          <input id="spotLimit" name="spotLimit" type="number" min={1} defaultValue={session?.spot_limit ?? row.spot_limit} required className="input" />
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
      {row.series_id ? (
        <Link className="btn btn-block" href={`${base}/classes/${row.series_id}`}>Change all future dates instead</Link>
      ) : null}
    </Frame>
  );
}
