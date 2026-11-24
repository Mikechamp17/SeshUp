import Link from "next/link";
import { requireStaff } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { first, type SearchParams } from "@/lib/http/search-params";
import { Banner } from "../../banner";
import { createSeriesAction } from "../actions";
import { EMPTY_SERIES, SeriesForm } from "../series-form";

export const metadata = { title: "Classes" };

const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function ClassesPage({
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
  const { data: gym } = await supabase.from("gyms").select("id").eq("slug", gymSlug).single();
  const { data: series } = await supabase
    .from("class_series")
    .select("id, name, level, weekdays, start_time, spot_limit, price_cents")
    .eq("gym_id", gym?.id ?? "")
    .eq("ended", false)
    .order("name");
  const { data: coaches } = await supabase.from("coaches").select("id, name").eq("gym_id", gym?.id ?? "").order("name");

  return (
    <main className="app-body pad">
      <h1 className="t-h1" style={{ marginBottom: 16 }}>Classes</h1>
      <Banner error={first(query.error)} message={first(query.message)} />
      <div className="form-stack">
        {(series ?? []).map((s) => (
          <Link key={s.id} href={`/admin/${gymSlug}/classes/${s.id}`} className="card" style={{ textDecoration: "none", color: "inherit" }}>
            <h2 className="t-h3">{s.name}</h2>
            <p className="cc-meta">
              {(s.weekdays as number[]).map((d) => DAY_NAMES[d]).join(", ")} at {String(s.start_time).slice(0, 5)} · {s.level} · {s.spot_limit} spots
            </p>
          </Link>
        ))}
      </div>
      <h2 className="t-h2" style={{ margin: "24px 0 12px" }}>Add a class</h2>
      <SeriesForm action={createSeriesAction} slug={gymSlug} coaches={coaches ?? []} defaults={EMPTY_SERIES} submitLabel="Create class" />
    </main>
  );
}
