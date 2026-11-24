import { requireStaff } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { first, type SearchParams } from "@/lib/http/search-params";
import { Banner } from "../../banner";
import { addCoach, renameCoach } from "../actions";

export const metadata = { title: "Coaches" };

export default async function CoachesPage({
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
  const { data: coaches } = await supabase.from("coaches").select("id, name").eq("gym_id", gym?.id ?? "").order("name");

  return (
    <main className="app-body pad">
      <h1 className="t-h1" style={{ marginBottom: 16 }}>Coaches</h1>
      <Banner error={first(query.error)} message={first(query.message)} />
      <div className="form-stack" style={{ gap: 12 }}>
        {(coaches ?? []).map((c) => (
          <form key={c.id} action={renameCoach} style={{ display: "flex", gap: 8 }}>
            <input type="hidden" name="slug" value={gymSlug} />
            <input type="hidden" name="coachId" value={c.id} />
            <input name="name" defaultValue={c.name} aria-label={`Name of ${c.name}`} required className="input" style={{ flex: 1 }} />
            <button type="submit" className="btn btn-sm">Rename</button>
          </form>
        ))}
      </div>
      <h2 className="t-h2" style={{ margin: "24px 0 12px" }}>Add a coach</h2>
      <form action={addCoach} className="form-stack">
        <input type="hidden" name="slug" value={gymSlug} />
        <div className="field">
          <label htmlFor="coachName">Name</label>
          <input id="coachName" name="name" required className="input" />
        </div>
        <button type="submit" className="btn btn-primary btn-block">Add coach</button>
      </form>
    </main>
  );
}
