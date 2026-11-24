import { gymLocalDate } from "@/lib/time/gym-time";

export type DayGroup<T> = { date: string; isToday: boolean; sessions: T[] };

/** Groups class dates by the gym's local day, in time order, and marks the day that is today in the gym's zone. */
export function groupSessionsByDay<T extends { starts_at: string }>(rows: T[], timeZone: string, now: Date): DayGroup<T>[] {
  const today = gymLocalDate(now, timeZone);
  const sorted = [...rows].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const groups = new Map<string, T[]>();
  for (const row of sorted) {
    const key = gymLocalDate(row.starts_at, timeZone);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([date, sessions]) => ({ date, isToday: date === today, sessions }));
}

/** The heading for a day: "Today" or the weekday, with the date beside it. */
export function dayHeading(localDate: string, isToday: boolean): { title: string; sub: string } {
  const at = new Date(`${localDate}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" }).format(at);
  const dayMonth = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(at);
  return isToday ? { title: "Today", sub: `${weekday} ${dayMonth}` } : { title: weekday, sub: dayMonth };
}

/** The clock time of a class in the gym's zone, such as "18:00". */
export function clockTime(startsAt: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(startsAt));
}
