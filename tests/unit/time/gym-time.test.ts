import { describe, expect, it } from "vitest";
import { formatGymDateTime, gymLocalDate, zonedTimeToUtc } from "@/lib/time/gym-time";

const JHB = "Africa/Johannesburg";

describe("gym time", () => {
  it("stores a class at 18:00 Johannesburg time as 16:00 UTC", () => {
    expect(zonedTimeToUtc("2026-11-23", "18:00", JHB).toISOString()).toBe("2026-11-23T16:00:00.000Z");
  });

  it("converts across a daylight saving change in a zone that has one", () => {
    // New York is UTC-5 in winter and UTC-4 in summer.
    expect(zonedTimeToUtc("2026-01-15", "09:00", "America/New_York").toISOString()).toBe("2026-01-15T14:00:00.000Z");
    expect(zonedTimeToUtc("2026-07-15", "09:00", "America/New_York").toISOString()).toBe("2026-07-15T13:00:00.000Z");
  });

  it("reports the gym's local date, which can differ from the UTC date", () => {
    expect(gymLocalDate("2026-11-23T23:30:00Z", JHB)).toBe("2026-11-24");
    expect(gymLocalDate("2026-11-23T21:30:00Z", JHB)).toBe("2026-11-23");
  });

  it("formats a UTC instant in the gym's zone", () => {
    expect(formatGymDateTime("2026-11-23T16:00:00Z", JHB)).toBe("Mon 23 Nov, 18:00");
  });
});
