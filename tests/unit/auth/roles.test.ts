import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { isOperator, isStaffOfGym } from "@/lib/auth/roles";

type Row = Record<string, unknown>;

// Small fake of the query builder. Each table holds the rows the signed-in
// user could see after row-level security, and filters narrow them the way the
// database would for the calls the helpers make.
function fakeClient(options: {
  gymStaff?: Array<{ gymSlug: string }>;
  platformAdmins?: Row[];
  userMetadata?: Row;
}): SupabaseClient {
  const tables: Record<string, Row[]> = {
    gym_staff: (options.gymStaff ?? []).map((row) => ({
      gym_id: "id-" + row.gymSlug,
      gyms: { slug: row.gymSlug },
    })),
    platform_admins: options.platformAdmins ?? [],
  };

  function from(table: string) {
    let rows = tables[table] ?? [];
    const builder = {
      select() {
        return builder;
      },
      eq(column: string, value: unknown) {
        const [parent, child] = column.split(".");
        rows = rows.filter((row) => {
          if (child === undefined) return row[parent] === value;
          const nested = row[parent] as Row | undefined;
          return nested?.[child] === value;
        });
        return builder;
      },
      limit() {
        return builder;
      },
      maybeSingle() {
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then<T>(resolve: (value: { data: Row[]; error: null }) => T) {
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return builder;
  }

  return {
    from,
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: { id: "u1", user_metadata: options.userMetadata ?? {} } },
          error: null,
        }),
    },
  } as unknown as SupabaseClient;
}

describe("isStaffOfGym", () => {
  it("is true for staff of that gym", async () => {
    const client = fakeClient({ gymStaff: [{ gymSlug: "iron-fist" }] });
    expect(await isStaffOfGym(client, "iron-fist")).toBe(true);
  });

  it("is false for staff of another gym only", async () => {
    const client = fakeClient({ gymStaff: [{ gymSlug: "other-gym" }] });
    expect(await isStaffOfGym(client, "iron-fist")).toBe(false);
  });

  it("is false when there are no rows", async () => {
    const client = fakeClient({});
    expect(await isStaffOfGym(client, "iron-fist")).toBe(false);
  });

  it("is false when the query errors", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: () => Promise.resolve({ data: null, error: { message: "boom" } }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    expect(await isStaffOfGym(client, "iron-fist")).toBe(false);
  });
});

describe("isOperator", () => {
  it("is true when the user has a platform_admins row", async () => {
    const client = fakeClient({ platformAdmins: [{ user_id: "u1" }] });
    expect(await isOperator(client)).toBe(true);
  });

  it("is false when there is no row", async () => {
    const client = fakeClient({});
    expect(await isOperator(client)).toBe(false);
  });

  it("does not grant operator from user_metadata claiming a role", async () => {
    const client = fakeClient({ userMetadata: { role: "operator" } });
    expect(await isOperator(client)).toBe(false);
  });
});
