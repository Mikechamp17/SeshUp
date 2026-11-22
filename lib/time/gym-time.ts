// Gym-local time helpers. Times are stored as UTC instants and shown in the gym's IANA time zone.

type Instant = Date | string;

function toDate(value: Instant): Date {
  return value instanceof Date ? value : new Date(value);
}

function partsInZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** The gym's local calendar date for an instant, as YYYY-MM-DD. */
export function gymLocalDate(instant: Instant, timeZone: string): string {
  const p = partsInZone(toDate(instant), timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** The UTC instant for a gym-local date (YYYY-MM-DD) and time (HH:mm). */
export function zonedTimeToUtc(localDate: string, localTime: string, timeZone: string): Date {
  const [y, mo, d] = localDate.split("-").map(Number);
  const [h, mi] = localTime.split(":").map(Number);
  const wanted = Date.UTC(y, mo - 1, d, h, mi);
  let guess = wanted;
  // The offset depends on the instant, so correct the guess until local time matches (twice is enough for real zones).
  for (let i = 0; i < 2; i++) {
    const p = partsInZone(new Date(guess), timeZone);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += wanted - shown;
  }
  return new Date(guess);
}

/** Short readable date and time in the gym's zone, e.g. "Mon 23 Nov, 18:00". */
export function formatGymDateTime(instant: Instant, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(toDate(instant))
    .replace(",", "")
    .replace(/^(\w+) (\d+ \w+) (\d{2}:\d{2})$/, "$1 $2, $3");
}
