import Link from "next/link";
import { requireStaff } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { Banner, first, type SearchParams } from "../../banner";
import { styles } from "../../styles";
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
    <main style={styles.main}>
      <p><Link href={`/admin/${gymSlug}`}>Back</Link></p>
      <h1>Coaches</h1>
      <Banner error={first(query.error)} message={first(query.message)} />
      {(coaches ?? []).map((c) => (
        <form key={c.id} action={renameCoach} style={{ ...styles.row, marginBottom: 8 }}>
          <input type="hidden" name="slug" value={gymSlug} />
          <input type="hidden" name="coachId" value={c.id} />
          <input name="name" defaultValue={c.name} aria-label={`Name of ${c.name}`} required style={{ ...styles.input, flex: 1 }} />
          <button type="submit" style={styles.secondary}>Rename</button>
        </form>
      ))}
      <h2>Add a coach</h2>
      <form action={addCoach} style={styles.form}>
        <input type="hidden" name="slug" value={gymSlug} />
        <label style={styles.label}>
          Name
          <input name="name" required style={styles.input} />
        </label>
        <button type="submit" style={styles.button}>Add coach</button>
      </form>
    </main>
  );
}
