import { describe, expect, it } from "vitest";
import { friendlyError, parseOneOffForm, parseSeriesForm, stopMessage } from "@/lib/booking/schedule";

function form(entries: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const item of Array.isArray(v) ? v : [v]) f.append(k, item);
  return f;
}

const valid = {
  name: "Boxing Basics", description: "Pads and bags", level: "Beginner", weekdays: ["1", "3"], startTime: "18:00",
  length: "60", spotLimit: "12", price: "100", cutoffHours: "", coachId: "",
};

describe("series form", () => {
  it("turns a valid form into a series in cents with the default 12 hour cutoff", () => {
    const r = parseSeriesForm(form(valid));
    expect(r).toEqual({
      ok: true,
      value: {
        name: "Boxing Basics", description: "Pads and bags", level: "Beginner", coachId: null, weekdays: [1, 3],
        startTime: "18:00", lengthMinutes: 60, spotLimit: 12, priceCents: 10000, cutoffHours: 12,
      },
    });
  });

  it("rounds a rand price with cents to whole cents", () => {
    const r = parseSeriesForm(form({ ...valid, price: "99.99" }));
    expect(r.ok && r.value.priceCents).toBe(9999);
  });

  it.each([
    [{ name: "" }, /class name/],
    [{ level: "Elite" }, /level/],
    [{ weekdays: [] as string[] }, /day/],
    [{ price: "0" }, /price/],
    [{ spotLimit: "0" }, /spot limit/],
    [{ cutoffHours: "-1" }, /cutoff/],
  ])("refuses a bad field %#", (override, message) => {
    const r = parseSeriesForm(form({ ...valid, ...override }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });
});

describe("friendlyError", () => {
  it("explains the limit error and passes unknown messages through", () => {
    expect(friendlyError("limit_below_taken")).toMatch(/below the spots already taken/);
    expect(friendlyError("something else")).toBe("something else");
  });

  it("turns a one-off date in the past into a plain message", () => {
    expect(friendlyError("time_in_past")).toBe("Choose a time in the future.");
  });
});

const oneOff = {
  name: "Holiday Session", description: "", level: "Intermediate", date: "2026-11-27", startTime: "18:00",
  length: "60", spotLimit: "12", price: "150", cutoffHours: "", coachId: "",
};
const JOHANNESBURG = "Africa/Johannesburg";

describe("one-off class form", () => {
  it("covers AE2: turns a valid form into one start instant in the gym's zone, with cents and the default cutoff", () => {
    const r = parseOneOffForm(form(oneOff), JOHANNESBURG);
    expect(r).toEqual({
      ok: true,
      value: {
        name: "Holiday Session", description: "", level: "Intermediate", coachId: null,
        startsAt: new Date("2026-11-27T16:00:00Z"), lengthMinutes: 60, spotLimit: 12, priceCents: 15000, cutoffHours: 12,
      },
    });
  });

  it.each([
    [{ date: "" }, /date/],
    [{ date: "27/11/2026" }, /date/],
    [{ date: "2026-13-45" }, /date/],
    [{ date: "2026-02-30" }, /date/],
    [{ startTime: "" }, /start time/],
    [{ name: "" }, /class name/],
    [{ price: "0" }, /price/],
    [{ spotLimit: "0" }, /spot limit/],
  ])("refuses a bad field %#", (override, message) => {
    const r = parseOneOffForm(form({ ...oneOff, ...override }), JOHANNESBURG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });

  it("ignores any weekdays sent with a one-off, since it never repeats", () => {
    const r = parseOneOffForm(form({ ...oneOff, weekdays: ["1", "2"] }), JOHANNESBURG);
    expect(r.ok && Object.keys(r.value)).not.toContain("weekdays");
  });
});

describe("stopMessage", () => {
  it("says how many empty dates were removed and how many dates stay", () => {
    expect(stopMessage(5, 2)).toBe("Class stopped. 5 empty dates were removed. 2 dates stay because they have bookings or are cancelled.");
  });

  it("uses singular wording for one", () => {
    expect(stopMessage(1, 1)).toBe("Class stopped. 1 empty date was removed. 1 date stays because it has bookings or is cancelled.");
  });

  it("is still sensible when nothing was removed or kept", () => {
    expect(stopMessage(0, 0)).toBe("Class stopped. It had no future dates to remove.");
  });
});
