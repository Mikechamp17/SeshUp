import Link from "next/link";
import { notFound } from "next/navigation";
import { formatRand } from "@/lib/money/fees";
import { createClient } from "@/lib/supabase/server";
import { gymLocalDate } from "@/lib/time/gym-time";
import { SpotsBadge, Topbar } from "../../ui";

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

function weekday(localDate: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" }).format(new Date(`${localDate}T12:00:00Z`));
}

function dayMonth(localDate: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${localDate}T12:00:00Z`));
}

function longDay(localDate: string): string {
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
  const today = gymLocalDate(from, gym.timezone);

  const days = new Map<string, Row[]>();
  for (const row of rows) {
    const key = gymLocalDate(row.starts_at, gym.timezone);
    days.set(key, [...(days.get(key) ?? []), row]);
  }

  return (
    <div className="app">
      <Topbar name={gym.name} sub="Boxing classes · times are gym time" />
      <main className="app-body">
        <div style={{ padding: "16px 16px 0" }}>
          <h1 className="t-h1">Book a class</h1>
          <p className="t-small muted" style={{ marginTop: 6 }}>Next 14 days. Spots left are live. Pay once and your spot is confirmed.</p>
        </div>
        {rows.length === 0 ? (
          <div className="empty">
            <div className="alert"><div><b>No classes yet</b>No classes are scheduled yet. Check back soon.</div></div>
          </div>
        ) : null}
        {[...days.entries()].map(([day, classes]) => (
          <section key={day} aria-label={longDay(day)}>
            <div className="day-head">
              <h2 className="t-h2">{day === today ? "Today" : weekday(day)}</h2>
              <span className="t-eyebrow">{day === today ? `${weekday(day)} ${dayMonth(day)}` : dayMonth(day)}</span>
            </div>
            {classes.map((c) => (
              <Link key={c.session_id} href={`/g/${gymSlug}/classes/${c.session_id}`} className="class-card">
                <div className="cc-time">
                  <b>{timeLabel(c.starts_at, gym.timezone)}</b>
                  <span>{c.length_minutes} min</span>
                </div>
                <div className="cc-main">
                  <h3 className="t-h3">{c.name}</h3>
                  <p className="cc-meta">
                    {c.level}
                    {c.coach_name ? ` · Coach ${c.coach_name}` : ""}
                  </p>
                  <div className="cc-foot">
                    <SpotsBadge spotsLeft={c.spots_left} bookable={c.bookable} />
                    {c.bookable && c.spots_left <= 0 ? (
                      <span className="cc-action">Join waitlist</span>
                    ) : (
                      <span className="price">{formatRand(c.price_cents)}</span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </section>
        ))}
        {rows.length > 0 ? (
          <p className="t-small muted" style={{ padding: "20px 16px 0", textAlign: "center" }}>
            Showing the next 14 days.<br />Cancelled classes are refunded automatically.
          </p>
        ) : null}
      </main>
    </div>
  );
}
