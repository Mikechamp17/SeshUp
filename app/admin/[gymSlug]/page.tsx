import Link from "next/link";
import { requireStaff } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { clockTime, dayHeading, groupSessionsByDay } from "@/lib/admin/timetable";
import { first, type SearchParams } from "@/lib/http/search-params";
import { Alert } from "../../ui";
import { Banner } from "../banner";
import { SHEET_KINDS, TimetableSheet } from "./sheets";

export const metadata = { title: "Gym admin" };

type Row = {
  id: string;
  name: string;
  level: string;
  starts_at: string;
  length_minutes: number;
  spot_limit: number;
  cancelled: boolean;
  series_id: string | null;
  taken: number;
};

function StatusBadge({ row }: { row: Row }) {
  if (row.cancelled) return <span className="badge b-cancel">Cancelled</span>;
  const left = row.spot_limit - row.taken;
  const label = `${row.taken} of ${row.spot_limit} booked`;
  if (left <= 0) return <span className="badge b-full">{label}</span>;
  if (left <= 3) return <span className="badge b-low">{label}</span>;
  return <span className="badge b-open">{label}</span>;
}

export default async function AdminHome({
  params,
  searchParams,
}: {
  params: Promise<{ gymSlug: string }>;
  searchParams: SearchParams;
}) {
  const { gymSlug } = await params;
  const query = await searchParams;
  await requireStaff(gymSlug);
  const supabase = await createClient();

  const { data: gym } = await supabase.from("gyms").select("id, name, timezone").eq("slug", gymSlug).single();
  if (!gym) return <main className="app-body pad"><p>Gym not found.</p></main>;

  const now = new Date();
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + 14);
  const { data: sessions } = await supabase
    .from("class_sessions")
    .select("id, name, level, starts_at, length_minutes, spot_limit, cancelled, series_id")
    .eq("gym_id", gym.id)
    .gt("starts_at", now.toISOString())
    .lt("starts_at", horizon.toISOString())
    .order("starts_at");

  const rows: Row[] = await Promise.all(
    (sessions ?? []).map(async (s) => {
      const { data } = await supabase.rpc("session_spots_taken", { p_session_id: s.id });
      return { ...s, taken: typeof data === "number" ? data : 0 } as Row;
    }),
  );
  const groups = groupSessionsByDay(rows, gym.timezone, now);
  const base = `/admin/${gymSlug}`;
  const sheetLink = (sheet: string, id: string) => `${base}?sheet=${sheet}&id=${id}`;
  const error = first(query.error);
  const message = first(query.message);
  // One sheet may be open over the timetable, chosen by the link that was tapped. A cancelled date has no actions.
  const sheetRow = rows.find((r) => r.id === first(query.id) && !r.cancelled);
  const openSheet = sheetRow ? SHEET_KINDS.find((k) => k === first(query.sheet)) : undefined;

  return (
    <>
      <main className="app-body">
        <div style={{ padding: "16px 16px 0" }}>
          <h1 className="t-h1">Next 14 days</h1>
          <div style={{ marginTop: 12 }}>
            <Banner error={error} message={message} />
          </div>
        </div>

        {groups.length === 0 ? (
          <div className="empty">
            <Alert title="No classes yet">There are no classes in the next 14 days. Use the Add a class button below to start your timetable.</Alert>
          </div>
        ) : null}

        {groups.map((g) => {
          const heading = dayHeading(g.date, g.isToday);
          return (
            <section key={g.date} aria-label={`${heading.title} ${heading.sub}`}>
              <div className="day-head">
                <h2 className="t-h2">{heading.title}</h2>
                <span className="t-eyebrow">{heading.sub}</span>
                <Link className="add-link" href={`${base}/classes/new?date=${g.date}`} aria-label={`Add a class on ${heading.title} ${heading.sub}`}>
                  + Add
                </Link>
              </div>
              {g.sessions.map((s) => (
                <div key={s.id} id={`session-${s.id}`} className={`owner-card${s.cancelled ? " is-cancelled" : ""}`}>
                  <Link className={`class-card${s.cancelled ? " is-cancelled" : ""}`} href={`${base}/sessions/${s.id}`}>
                    <div className="cc-time">
                      <b>{clockTime(s.starts_at, gym.timezone)}</b>
                      <span>{s.length_minutes} min</span>
                    </div>
                    <div className="cc-main">
                      <h3 className="t-h3">{s.name}</h3>
                      <p className="cc-meta">{s.level}</p>
                      <div className="cc-foot">
                        <StatusBadge row={s} />
                      </div>
                    </div>
                  </Link>
                  {s.cancelled ? null : (
                    <div className="row-actions">
                      <Link className="btn btn-sm" scroll={false} href={sheetLink("move", s.id)} aria-label={`Move ${s.name}`}>Move</Link>
                      <Link className="btn btn-sm" scroll={false} href={sheetLink("edit", s.id)} aria-label={`Edit ${s.name}`}>Edit</Link>
                      <Link className="btn btn-sm btn-danger" scroll={false} href={sheetLink("cancel", s.id)} aria-label={`Cancel ${s.name}`}>Cancel</Link>
                    </div>
                  )}
                </div>
              ))}
            </section>
          );
        })}
      </main>
      <div className="cta-bar">
        <Link className="btn btn-primary btn-block" href={`${base}/classes/new`}>+ Add a class</Link>
      </div>
      {openSheet && sheetRow ? (
        <TimetableSheet kind={openSheet} row={sheetRow} gymSlug={gymSlug} gymId={gym.id} timeZone={gym.timezone} to={first(query.to)} />
      ) : null}
    </>
  );
}
