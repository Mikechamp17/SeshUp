import Link from "next/link";
import { requireStaff } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { first, type SearchParams } from "@/lib/http/search-params";
import { Banner } from "../../banner";

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
      {(series ?? []).length === 0 ? (
        <p className="t-body muted">No weekly classes yet. Use the button below to add one.</p>
      ) : null}
      <Link className="btn btn-primary btn-block" style={{ marginTop: 24 }} href={`/admin/${gymSlug}/classes/new`}>+ Add a class</Link>
    </main>
  );
}
