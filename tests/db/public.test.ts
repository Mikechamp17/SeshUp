import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asUser, makeGym, pool, resetData } from "./helpers";

beforeEach(resetData);
afterAll(() => pool.end());

describe("public gym lookup", () => {
  it("gives anonymous visitors a gym's name and time zone and nothing for an unknown link", async () => {
    await makeGym({ slug: "pilot-gym" });
    const known = await asUser(undefined, (q) => q("select * from public.public_gym('pilot-gym')"), "anon");
    expect(known.rows).toEqual([{ name: "Gym pilot-gym", timezone: "Africa/Johannesburg" }]);
    const unknown = await asUser(undefined, (q) => q("select * from public.public_gym('nope')"), "anon");
    expect(unknown.rowCount).toBe(0);
  });
});
