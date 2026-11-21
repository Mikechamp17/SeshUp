import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/redirect";

describe("safeNextPath", () => {
  it("keeps a same-origin relative path with a query", () => {
    expect(safeNextPath("/class/abc?x=1")).toBe("/class/abc?x=1");
  });

  it("keeps the root path", () => {
    expect(safeNextPath("/")).toBe("/");
  });

  it("rejects a protocol-relative url", () => {
    expect(safeNextPath("//evil.example")).toBe("/");
  });

  it("rejects an absolute url", () => {
    expect(safeNextPath("https://evil.example")).toBe("/");
  });

  it("rejects a backslash after the slash", () => {
    expect(safeNextPath("/\\evil.example")).toBe("/");
  });

  it("rejects a javascript scheme", () => {
    expect(safeNextPath("javascript:alert(1)")).toBe("/");
  });

  it("rejects a scheme hidden inside a path-like value", () => {
    expect(safeNextPath("/redirect?to=https://evil.example")).toBe("/");
  });

  it("returns the root for empty, null, and undefined", () => {
    expect(safeNextPath("")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
  });

  it("rejects a path with a newline or other control character", () => {
    expect(safeNextPath("/class/abc\n")).toBe("/");
    expect(safeNextPath("/class/\tabc")).toBe("/");
    expect(safeNextPath("/class/abc\u0000")).toBe("/");
  });

  it("rejects a value that does not start with a slash", () => {
    expect(safeNextPath("class/abc")).toBe("/");
  });
});
