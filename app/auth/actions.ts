"use server";

import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/redirect";
import { siteUrl } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function withParams(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return `${path}?${query}`;
}

export async function signUp(formData: FormData): Promise<void> {
  const name = field(formData, "name");
  const email = field(formData, "email");
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(field(formData, "next"));
  const back = (error: string) => withParams("/auth/sign-up", { error, next });

  if (!name || !email || !password) redirect(back("Enter your name, email, and password."));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name },
      emailRedirectTo: `${await siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) {
    const exists = /already registered/i.test(error.message);
    redirect(back(exists ? "An account with this email already exists. Sign in instead." : error.message));
  }
  // With email confirmation on, an existing address comes back as a user with
  // no identities instead of an error.
  if (data.user && data.user.identities?.length === 0) {
    redirect(back("An account with this email already exists. Sign in instead."));
  }
  if (!data.session) {
    redirect(withParams("/auth/sign-in", { message: "Check your email to confirm your account, then sign in.", next }));
  }
  redirect(next);
}

export async function signIn(formData: FormData): Promise<void> {
  const email = field(formData, "email");
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(field(formData, "next"));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect(withParams("/auth/sign-in", { error: "Email or password is incorrect.", next }));
  }
  redirect(next);
}

export async function requestPasswordReset(formData: FormData): Promise<void> {
  const email = field(formData, "email");
  if (!email) redirect(withParams("/auth/reset-password", { error: "Enter your email." }));

  const supabase = await createClient();
  const next = encodeURIComponent("/auth/set-password");
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await siteUrl()}/auth/callback?next=${next}`,
  });
  // Same answer whether or not the address has an account.
  redirect(withParams("/auth/reset-password", { sent: "1" }));
}

export async function setPassword(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(field(formData, "next"));
  const back = (error: string) => withParams("/auth/set-password", { error, next });

  if (password.length < 6) redirect(back("Use a password of at least 6 characters."));

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    redirect(withParams("/auth/sign-in", { error: "Your link has expired. Request a new one.", next }));
  }
  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect(back(error.message));
  redirect(next);
}
