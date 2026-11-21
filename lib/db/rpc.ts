/** The shape of supabase-js `rpc`, so code can run against the real SQL functions in tests. */
export type Rpc = (
  fn: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
