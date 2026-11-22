import { describe, expect, it } from "vitest";
import { friendlyError, parseSeriesForm } from "@/lib/booking/schedule";

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
});
