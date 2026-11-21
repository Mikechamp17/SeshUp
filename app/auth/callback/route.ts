import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

// Landing point for emailed links (invite, password reset, sign-up). It turns
// the link into a session and then sends the person to a safe local path.
// Invite links should set `next` to the set-password page, with the final
// destination as that page's own `next`.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const next = safeNextPath(searchParams.get("next"));
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await createClient();
  let failed = true;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failed = Boolean(error);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    failed = Boolean(error);
  }

  if (failed) {
    const message = "That link is invalid or has expired. Request a new one.";
    return NextResponse.redirect(`${origin}/auth/sign-in?error=${encodeURIComponent(message)}`);
  }
  return NextResponse.redirect(`${origin}${next}`);
}
