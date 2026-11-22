import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
afterAll(() => pool.end());

describe("database test wiring", () => {
  it("reaches Postgres and sees the auth shim", async () => {
    const { rows } = await pool.query("select auth.uid() is null as no_user");
    expect(rows[0].no_user).toBe(true);
  });
});
