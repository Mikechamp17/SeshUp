import Link from "next/link";
import { notFound } from "next/navigation";
import { formatRand } from "@/lib/money/fees";
import { createClient } from "@/lib/supabase/server";
import { gymLocalDate } from "@/lib/time/gym-time";
import { styles } from "../styles";

export const dynamic = "force-dynamic";

type Row = {
  session_id: string;
  starts_at: string;
  length_minutes: number;
  name: string;
  level: string;
  coach_name: string | null;
  price_cents: number;
  spots_left: number;
  bookable: boolean;
};

function dayLabel(localDate: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(
    new Date(`${localDate}T12:00:00Z`),
  );
}

function timeLabel(startsAt: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(startsAt));
}

export async function generateMetadata({ params }: { params: Promise<{ gymSlug: string }> }) {
  const { gymSlug } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("public_gym", { p_slug: gymSlug });
  const gym = (data as { name: string }[] | null)?.[0];
  return { title: gym ? `${gym.name} timetable` : "Timetable" };
}

export default async function TimetablePage({ params }: { params: Promise<{ gymSlug: string }> }) {
  const { gymSlug } = await params;
  const supabase = await createClient();
  const { data: gymRows } = await supabase.rpc("public_gym", { p_slug: gymSlug });
  const gym = (gymRows as { name: string; timezone: string }[] | null)?.[0];
  if (!gym) notFound();

  const from = new Date();
  const to = new Date(from);
  to.setDate(to.getDate() + 14);
  const { data } = await supabase.rpc("public_timetable", {
    p_gym_slug: gymSlug,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  const rows = (data ?? []) as Row[];

  const days = new Map<string, Row[]>();
  for (const row of rows) {
    const key = gymLocalDate(row.starts_at, gym.timezone);
    days.set(key, [...(days.get(key) ?? []), row]);
  }

  return (
    <main style={styles.main}>
      <h1>{gym.name}</h1>
      <p style={styles.small}>Pick a class to book your spot.</p>
      {rows.length === 0 ? <p>No classes are scheduled yet. Check back soon.</p> : null}
      {[...days.entries()].map(([day, classes]) => (
        <section key={day} aria-label={dayLabel(day)}>
          <h2 style={{ fontSize: 18 }}>{dayLabel(day)}</h2>
          {classes.map((c) => (
            <Link key={c.session_id} href={`/g/${gymSlug}/classes/${c.session_id}`} style={{ textDecoration: "none", color: "inherit" }}>
              <div style={styles.card}>
                <div style={styles.row}>
                  <strong>{timeLabel(c.starts_at, gym.timezone)}</strong>
                  <span>{c.name}</span>
                </div>
                <div style={styles.small}>
                  {c.level}
                  {c.coach_name ? ` - Coach ${c.coach_name}` : ""} - {c.length_minutes} min
                </div>
                <div style={styles.row}>
                  <span>{formatRand(c.price_cents)}</span>
                  <span style={{ marginLeft: "auto", fontWeight: 700 }}>
                    {!c.bookable ? "Booking not open yet" : c.spots_left > 0 ? `${c.spots_left} spot${c.spots_left === 1 ? "" : "s"} left` : "Full"}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </section>
      ))}
    </main>
  );
}
