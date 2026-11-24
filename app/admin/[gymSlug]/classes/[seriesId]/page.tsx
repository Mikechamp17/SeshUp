import Link from "next/link";
import { requireStaff } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { first, type SearchParams } from "@/lib/http/search-params";
import { Alert } from "../../../../ui";
import { Banner } from "../../../banner";
import { SheetFrame } from "../../../sheet-frame";
import { endSeriesAction, updateSeriesAction } from "../../actions";
import { SeriesForm } from "../../series-form";

export const metadata = { title: "Edit class" };

export default async function EditSeriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ gymSlug: string; seriesId: string }>;
  searchParams: SearchParams;
}) {
  const { gymSlug, seriesId } = await params;
  const query = await searchParams;
  await requireStaff(gymSlug);
  const supabase = await createClient();
  const { data: series } = await supabase.from("class_series").select("*").eq("id", seriesId).single();
  if (!series) return <main className="app-body pad"><p>Class not found.</p></main>;
  const { data: coaches } = await supabase.from("coaches").select("id, name").eq("gym_id", series.gym_id).order("name");
  const { data: dates } = await supabase
    .from("class_sessions")
    .select("id, local_date, cancelled")
    .eq("series_id", seriesId)
    .gt("starts_at", new Date().toISOString())
    .order("starts_at");

  // Stopping a class is two steps. The preview follows the database's rule: a date with any booking or waitlist entry
  // stays, a cancelled date stays, and every other future date is removed.
  const stopping = first(query.stop) === "1" && !series.ended;
  let removable = 0;
  const staying: { id: string; local_date: string; booked: number }[] = [];
  if (stopping && (dates ?? []).length > 0) {
    const ids = (dates ?? []).map((d) => d.id);
    const [{ data: bookings }, { data: waiting }] = await Promise.all([
      supabase.from("bookings").select("session_id, status").in("session_id", ids),
      supabase.from("waitlist_entries").select("session_id").in("session_id", ids),
    ]);
    const confirmedBy = new Map<string, number>();
    for (const b of bookings ?? []) confirmedBy.set(b.session_id, (confirmedBy.get(b.session_id) ?? 0) + (b.status === "confirmed" ? 1 : 0));
    const waitingOn = new Set((waiting ?? []).map((w) => w.session_id));
    for (const d of dates ?? []) {
      if (d.cancelled) continue;
      if (confirmedBy.has(d.id) || waitingOn.has(d.id)) staying.push({ id: d.id, local_date: d.local_date, booked: confirmedBy.get(d.id) ?? 0 });
      else removable += 1;
    }
  }

  return (
    <main className="app-body pad">
      <Link className="backlink" href={`/admin/${gymSlug}/classes`}>&larr; Classes</Link>
      <h1 className="t-h1" style={{ margin: "4px 0 16px" }}>{series.name}</h1>
      <Banner error={first(query.error)} message={first(query.message)} />
      {series.ended ? (
        <Alert title="This class has stopped">It no longer makes new dates. Dates that had bookings stay below until they are cancelled.</Alert>
      ) : (
        <>
          <p className="t-small muted" style={{ marginBottom: 16 }}>
            Changes here apply to upcoming dates that have no bookings and no changes of their own. To change one date, open it below.
          </p>
          <SeriesForm
            action={updateSeriesAction}
            slug={gymSlug}
            seriesId={seriesId}
            coaches={coaches ?? []}
            submitLabel="Save class"
            defaults={{
              name: series.name,
              description: series.description,
              level: series.level,
              coachId: series.coach_id ?? "",
              weekdays: series.weekdays as number[],
              startTime: String(series.start_time).slice(0, 5),
              lengthMinutes: series.length_minutes,
              spotLimit: series.spot_limit,
              priceRand: (series.price_cents / 100).toFixed(2),
              cutoffHours: series.cutoff_hours,
            }}
          />
          <Link className="btn btn-block" style={{ marginTop: 16 }} href={`/admin/${gymSlug}/classes/${seriesId}?stop=1`}>Stop this class</Link>
        </>
      )}
      <h2 className="t-h2" style={{ margin: "24px 0 12px" }}>Upcoming dates</h2>
      <div className="form-stack" style={{ gap: 8 }}>
        {(dates ?? []).map((s) => (
          <Link key={s.id} href={`/admin/${gymSlug}/sessions/${s.id}`} className="card" style={{ textDecoration: "none", color: "inherit", padding: "12px 16px" }}>
            {s.local_date} {s.cancelled ? <span className="badge b-cancel">Cancelled</span> : null}
          </Link>
        ))}
      </div>
      {stopping ? (
        <SheetFrame
          eyebrow="Stop this class?"
          title={series.name}
          ariaLabel={`Stop ${series.name}`}
          closeHref={`/admin/${gymSlug}/classes/${seriesId}`}
          closeLabel="Keep it"
          scrimLabel="Close and keep the class"
        >
          <Alert kind="warn" role="alert" title="No new dates will be made">
            {removable} empty date{removable === 1 ? "" : "s"} will be removed.
            {staying.length > 0 ? " These dates stay because they have bookings. Cancel them yourself if you want them gone:" : " Every future date is empty or already cancelled."}
          </Alert>
          {staying.length > 0 ? (
            <div className="card" style={{ padding: "4px 16px" }}>
              {staying.map((d) => (
                <div key={d.id} className="row">
                  <Link className="linkish" href={`/admin/${gymSlug}/sessions/${d.id}`}>{d.local_date}</Link>
                  <b>{d.booked > 0 ? `${d.booked} booked` : "waitlist only"}</b>
                </div>
              ))}
            </div>
          ) : null}
          <form action={endSeriesAction}>
            <input type="hidden" name="slug" value={gymSlug} />
            <input type="hidden" name="seriesId" value={seriesId} />
            <button type="submit" className="btn btn-danger btn-block">Yes, stop this class</button>
          </form>
        </SheetFrame>
      ) : null}
    </main>
  );
}
