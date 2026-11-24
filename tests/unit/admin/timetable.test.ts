import { describe, expect, it } from "vitest";
import { clockTime, dayHeading, groupSessionsByDay } from "@/lib/admin/timetable";

const tz = "Africa/Johannesburg"; // UTC+2, no daylight saving

const row = (id: string, startsAt: string, cancelled = false) => ({ id, starts_at: startsAt, cancelled });

describe("groupSessionsByDay", () => {
  it("groups by the gym's local day, so a class late in the UTC evening lands on the next local day", () => {
    const groups = groupSessionsByDay(
      [row("a", "2026-11-23T15:00:00Z"), row("b", "2026-11-23T22:30:00Z"), row("c", "2026-11-24T05:00:00Z")],
      tz,
      new Date("2026-11-20T08:00:00Z"),
    );
    expect(groups.map((g) => g.date)).toEqual(["2026-11-23", "2026-11-24"]);
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["a"]);
    expect(groups[1].sessions.map((s) => s.id)).toEqual(["b", "c"]);
  });

  it("puts groups and the classes inside them in time order whatever order they arrive in", () => {
    const groups = groupSessionsByDay(
      [row("late", "2026-11-25T16:00:00Z"), row("early", "2026-11-23T05:00:00Z"), row("noon", "2026-11-25T10:00:00Z")],
      tz,
      new Date("2026-11-20T08:00:00Z"),
    );
    expect(groups.map((g) => g.date)).toEqual(["2026-11-23", "2026-11-25"]);
    expect(groups[1].sessions.map((s) => s.id)).toEqual(["noon", "late"]);
  });

  it("marks the day that is today in the gym's zone, not in UTC", () => {
    // 22:30 UTC on the 23rd is already 00:30 on the 24th in Johannesburg.
    const now = new Date("2026-11-23T22:30:00Z");
    const groups = groupSessionsByDay([row("a", "2026-11-24T06:00:00Z"), row("b", "2026-11-25T06:00:00Z")], tz, now);
    expect(groups.map((g) => [g.date, g.isToday])).toEqual([
      ["2026-11-24", true],
      ["2026-11-25", false],
    ]);
  });

  it("returns no groups for an empty list", () => {
    expect(groupSessionsByDay([], tz, new Date())).toEqual([]);
  });

  it("keeps the extra fields on each class, including whether it is cancelled", () => {
    const groups = groupSessionsByDay([row("x", "2026-11-23T10:00:00Z", true)], tz, new Date("2026-11-20T08:00:00Z"));
    expect(groups[0].sessions[0]).toEqual({ id: "x", starts_at: "2026-11-23T10:00:00Z", cancelled: true });
  });
});

describe("dayHeading and clockTime", () => {
  it("labels today and other days", () => {
    expect(dayHeading("2026-11-24", true)).toEqual({ title: "Today", sub: "Tue 24 Nov" });
    expect(dayHeading("2026-11-25", false)).toEqual({ title: "Wed", sub: "25 Nov" });
  });

  it("shows the clock time in the gym's zone", () => {
    expect(clockTime("2026-11-23T16:00:00Z", tz)).toBe("18:00");
  });
});
