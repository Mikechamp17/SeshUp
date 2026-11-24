import Link from "next/link";
import { requireStaff } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { gymLocalDate } from "@/lib/time/gym-time";
import { first, type SearchParams } from "@/lib/http/search-params";
import { Banner } from "../../../banner";
import { createOneOffAction, createSeriesAction } from "../../actions";
import { EMPTY_SERIES, SeriesForm } from "../../series-form";

export const metadata = { title: "Add a class" };

export default async function NewClassPage({
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
  const { data: gym } = await supabase.from("gyms").select("id, timezone").eq("slug", gymSlug).single();
  if (!gym) return <main className="app-body pad"><p>Gym not found.</p></main>;
  const { data: coaches } = await supabase.from("coaches").select("id, name").eq("gym_id", gym.id).order("name");

  // A day's "+ Add" brings a date, which starts the page on "Just once".
  const date = /^\d{4}-\d{2}-\d{2}$/.test(first(query.date)) ? first(query.date) : "";
  const kind = first(query.kind) === "weekly" ? "weekly" : first(query.kind) === "once" || date ? "once" : "weekly";
  const base = `/admin/${gymSlug}/classes/new`;
  const withDate = date ? `&date=${date}` : "";

  return (
    <main className="app-body pad">
      <Link className="backlink" href={`/admin/${gymSlug}`}>&larr; Timetable</Link>
      <h1 className="t-h1" style={{ margin: "4px 0 16px" }}>Add a class</h1>
      <div className="tabs" style={{ marginBottom: 16 }}>
        <Link href={`${base}?kind=once${withDate}`} className={`tab${kind === "once" ? " on" : ""}`} aria-current={kind === "once" ? "page" : undefined}>Just once</Link>
        <Link href={`${base}?kind=weekly${withDate}`} className={`tab${kind === "weekly" ? " on" : ""}`} aria-current={kind === "weekly" ? "page" : undefined}>Every week</Link>
      </div>
      <Banner error={first(query.error)} message={first(query.message)} />
      {kind === "once" ? (
        <SeriesForm
          action={createOneOffAction}
          slug={gymSlug}
          coaches={coaches ?? []}
          defaults={EMPTY_SERIES}
          submitLabel="Add class"
          once={{ date, minDate: gymLocalDate(new Date(), gym.timezone) }}
          compact
        />
      ) : (
        <SeriesForm action={createSeriesAction} slug={gymSlug} coaches={coaches ?? []} defaults={EMPTY_SERIES} submitLabel="Create weekly class" compact />
      )}
    </main>
  );
}
