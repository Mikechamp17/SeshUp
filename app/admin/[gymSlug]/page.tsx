import Link from "next/link";
import { requireStaff } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { formatGymDateTime } from "@/lib/time/gym-time";
import { first, type SearchParams } from "@/lib/http/search-params";
import { Banner } from "../banner";
import { styles } from "../styles";

export const metadata = { title: "Gym admin" };

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
  if (!gym) return <main style={styles.main}><p>Gym not found.</p></main>;

  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 14);
  const { data: sessions } = await supabase
    .from("class_sessions")
    .select("id, name, level, starts_at, spot_limit, cancelled")
    .eq("gym_id", gym.id)
    .gt("starts_at", new Date().toISOString())
    .lt("starts_at", horizon.toISOString())
    .order("starts_at");

  const taken = await Promise.all(
    (sessions ?? []).map(async (s) => {
      const { data } = await supabase.rpc("session_spots_taken", { p_session_id: s.id });
      return typeof data === "number" ? data : 0;
    }),
  );

  return (
    <main style={styles.main}>
      <h1>{gym.name}</h1>
      <Banner error={first(query.error)} message={first(query.message)} />
      <p style={styles.row}>
        <Link href={`/admin/${gymSlug}/classes`}>Classes</Link>
        <Link href={`/admin/${gymSlug}/coaches`}>Coaches</Link>
        <Link href={`/g/${gymSlug}`}>Member timetable</Link>
      </p>
      <h2>Next 14 days</h2>
      {(sessions ?? []).length === 0 ? <p>No classes yet. Add a class to build your timetable.</p> : null}
      {(sessions ?? []).map((s, i) => (
        <Link key={s.id} href={`/admin/${gymSlug}/sessions/${s.id}`} style={{ textDecoration: "none", color: "inherit" }}>
          <div style={styles.card}>
            <strong>{s.name}</strong> {s.cancelled ? "(cancelled)" : ""}
            <div style={styles.small}>
              {formatGymDateTime(s.starts_at, gym.timezone)} - {s.level}
            </div>
            <div>
              {taken[i]} of {s.spot_limit} spots taken
            </div>
          </div>
        </Link>
      ))}
    </main>
  );
}
