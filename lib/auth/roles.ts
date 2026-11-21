import type { SupabaseClient, User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth/redirect";

// These helpers only decide what to show. The database policies are the real
// boundary. Roles come from database rows, never from user_metadata, which the
// user can edit.

// getUser() asks the auth server to validate the token. getSession() only
// reads the cookie, so it is never used for decisions.
export async function getCurrentUser(supabase: SupabaseClient): Promise<User | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

// Row-level security limits gym_staff to the caller's own gyms, so any row
// for this slug means the caller is staff of it.
export async function isStaffOfGym(supabase: SupabaseClient, gymSlug: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("gym_staff")
    .select("gym_id, gyms!inner(slug)")
    .eq("gyms.slug", gymSlug)
    .limit(1);
  if (error || !data) return false;
  return data.length > 0;
}

// Row-level security limits platform_admins to the caller's own row.
export async function isOperator(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.from("platform_admins").select("user_id").maybeSingle();
  if (error) return false;
  return data !== null;
}

function signInPath(next: string): string {
  return `/auth/sign-in?next=${encodeURIComponent(safeNextPath(next))}`;
}

export async function requireUser(next = "/"): Promise<User> {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) redirect(signInPath(next));
  return user;
}

export async function requireStaff(gymSlug: string): Promise<User> {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) redirect(signInPath(`/admin/${gymSlug}`));
  if (!(await isStaffOfGym(supabase, gymSlug))) redirect("/");
  return user;
}

export async function requireOperator(): Promise<User> {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) redirect(signInPath("/operator"));
  if (!(await isOperator(supabase))) redirect("/");
  return user;
}
