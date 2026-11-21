import Link from "next/link";
import { requireStaff } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { first, type SearchParams } from "@/lib/http/search-params";
import { Banner } from "../../../banner";
import { styles } from "../../../styles";
import { updateSeriesAction } from "../../actions";
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
  if (!series) return <main style={styles.main}><p>Class not found.</p></main>;
  const { data: coaches } = await supabase.from("coaches").select("id, name").eq("gym_id", series.gym_id).order("name");
  const { data: dates } = await supabase
    .from("class_sessions")
    .select("id, local_date, cancelled")
    .eq("series_id", seriesId)
    .gt("starts_at", new Date().toISOString())
    .order("starts_at");

  return (
    <main style={styles.main}>
      <p><Link href={`/admin/${gymSlug}/classes`}>Back</Link></p>
      <h1>{series.name}</h1>
      <Banner error={first(query.error)} message={first(query.message)} />
      <p style={styles.small}>
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
      <h2>Upcoming dates</h2>
      {(dates ?? []).map((s) => (
        <p key={s.id}>
          <Link href={`/admin/${gymSlug}/sessions/${s.id}`}>{s.local_date}</Link> {s.cancelled ? "(cancelled)" : ""}
        </p>
      ))}
    </main>
  );
}
