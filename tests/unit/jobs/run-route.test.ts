import { describe, expect, it } from "vitest";
import { createJobsHandler } from "@/lib/jobs/handler";

function setup(secret: string | undefined = "s3cret") {
  const ran: string[] = [];
  const handler = createJobsHandler({
    secret,
    getJobs: () => [
      { name: "send-emails", run: async () => void ran.push("send-emails") },
      {
        name: "broken",
        run: async () => {
          throw new Error("boom");
        },
      },
      { name: "purge", run: async () => void ran.push("purge") },
    ],
  });
  const post = (headers: Record<string, string> = {}) => handler(new Request("https://x.test/api/jobs/run", { method: "POST", headers }));
  return { post, ran };
}

describe("job endpoint", () => {
  it("returns 401 without the secret and runs nothing", async () => {
    const { post, ran } = setup();
    const res = await post();
    expect(res.status).toBe(401);
    expect(ran).toEqual([]);
  });

  it("returns 401 for a wrong secret, including one of a different length", async () => {
    const { post, ran } = setup();
    expect((await post({ "x-job-secret": "nope" })).status).toBe(401);
    expect((await post({ "x-job-secret": "s3cret-and-more" })).status).toBe(401);
    expect(ran).toEqual([]);
  });

  it("refuses everything when no secret is configured", async () => {
    const { post, ran } = setup(undefined);
    expect((await post({ "x-job-secret": "" })).status).toBe(401);
    expect(ran).toEqual([]);
  });

  it("runs every job with the right secret and keeps going after one fails", async () => {
    const { post, ran } = setup();
    const res = await post({ "x-job-secret": "s3cret" });
    expect(res.status).toBe(200);
    expect(ran).toEqual(["send-emails", "purge"]);
    const body = (await res.json()) as { results: { name: string; ok: boolean; error?: string }[] };
    expect(body.results.map((r) => [r.name, r.ok])).toEqual([
      ["send-emails", true],
      ["broken", false],
      ["purge", true],
    ]);
    expect(body.results[1].error).toBe("boom");
  });
});
