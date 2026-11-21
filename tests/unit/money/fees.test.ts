import { describe, expect, it } from "vitest";
import { computeFeeCents, formatRand } from "@/lib/money/fees";

describe("computeFeeCents", () => {
  it("takes 5% of R100.00 as 500 cents", () => {
    expect(computeFeeCents(10000, 500)).toBe(500);
  });

  it("rounds R99.99 at 5% up to 500 cents", () => {
    expect(computeFeeCents(9999, 500)).toBe(500);
  });

  it("rounds R99.89 at 5% down to 499 cents", () => {
    expect(computeFeeCents(9989, 500)).toBe(499);
  });

  it("rounds an exact half cent up", () => {
    expect(computeFeeCents(10, 500)).toBe(1);
  });

  it("charges nothing for a free class or a zero rate", () => {
    expect(computeFeeCents(0, 500)).toBe(0);
    expect(computeFeeCents(10000, 0)).toBe(0);
  });
});

describe("formatRand", () => {
  it("formats cents as rand with two decimals", () => {
    expect(formatRand(10000)).toBe("R100.00");
    expect(formatRand(9989)).toBe("R99.89");
    expect(formatRand(5)).toBe("R0.05");
  });

  it("groups thousands with spaces", () => {
    expect(formatRand(123456789)).toBe("R1 234 567.89");
  });
});
