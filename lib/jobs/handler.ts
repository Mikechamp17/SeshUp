import { createHash, timingSafeEqual } from "node:crypto";
import { runJobs, type Job } from "@/lib/jobs/registry";

function secretsMatch(expected: string, given: string | null): boolean {
  if (!expected || !given) return false;
  // Compare fixed-length digests so length never leaks and the comparison is constant time.
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(given).digest();
  return timingSafeEqual(a, b);
}

/** The job endpoint: refuses anything without the shared secret, then runs the registered jobs. */
export function createJobsHandler(options: { secret: string | undefined; getJobs: () => Job[] }) {
  return async function handle(request: Request): Promise<Response> {
    if (!secretsMatch(options.secret ?? "", request.headers.get("x-job-secret"))) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const results = await runJobs(options.getJobs());
    return Response.json({ results }, { status: 200 });
  };
}
