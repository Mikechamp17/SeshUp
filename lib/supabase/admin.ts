import { createClient } from "@supabase/supabase-js";

// Service-role client. It bypasses row-level security, so it must only run on
// the server. Failing at import time keeps it out of any client bundle.
if (typeof window !== "undefined") {
  throw new Error("lib/supabase/admin.ts must not be imported in the browser");
}

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase URL and service role key must be set");
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
