export type Job = { name: string; run: () => Promise<unknown> };
export type JobResult = { name: string; ok: boolean; detail?: unknown; error?: string };

/** Runs jobs in order. One failing job never stops the rest. */
export async function runJobs(jobs: Job[]): Promise<JobResult[]> {
  const results: JobResult[] = [];
  for (const job of jobs) {
    try {
      results.push({ name: job.name, ok: true, detail: await job.run() });
    } catch (e) {
      results.push({ name: job.name, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}
