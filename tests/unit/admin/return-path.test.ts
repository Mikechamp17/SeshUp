import { describe, expect, it } from "vitest";
import { adminReturnPath } from "@/lib/admin/return-path";

const fallback = "/admin/pilot/sessions/abc";
const ret = (raw: string) => adminReturnPath("pilot", raw, fallback);

describe("adminReturnPath", () => {
  it("accepts a path inside the same gym's admin area", () => {
    expect(ret("/admin/pilot")).toBe("/admin/pilot");
    expect(ret("/admin/pilot/classes")).toBe("/admin/pilot/classes");
    expect(ret("/admin/pilot/sessions/abc")).toBe("/admin/pilot/sessions/abc");
  });

  it("falls back for another gym, including one whose name starts the same way", () => {
    expect(ret("/admin/other")).toBe(fallback);
    expect(ret("/admin/pilot-two")).toBe(fallback);
    expect(ret("/admin/pilotx/classes")).toBe(fallback);
  });

  it("falls back for an absolute URL, a protocol-relative URL, and an empty value", () => {
    expect(ret("https://evil.test/admin/pilot")).toBe(fallback);
    expect(ret("//evil.test/admin/pilot")).toBe(fallback);
    expect(ret("")).toBe(fallback);
    expect(ret("/")).toBe(fallback);
  });

  it("falls back for a path that climbs out of the gym's area, plain or encoded", () => {
    expect(ret("/admin/pilot/../other")).toBe(fallback);
    expect(ret("/admin/pilot/%2e%2e/%2e%2e/account")).toBe(fallback);
    expect(ret("/admin/pilot/%2E%2E/other")).toBe(fallback);
    expect(ret("/admin/pilot/%zz")).toBe(fallback);
  });

  it("falls back for a backslash and for a query string or fragment, which the result messages add their own of", () => {
    expect(ret("/admin/pilot\\..\\other")).toBe(fallback);
    expect(ret("/admin/pilot?sheet=cancel")).toBe(fallback);
    expect(ret("/admin/pilot#session-1")).toBe(fallback);
  });
});
