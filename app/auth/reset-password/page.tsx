import Link from "next/link";
import { requestPasswordReset } from "../actions";
import { first, type SearchParams } from "@/lib/http/search-params";
import { Alert, AuthShell } from "../../ui";

export const metadata = { title: "Reset password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const error = first(params.error);
  const sent = first(params.sent) === "1";

  return (
    <AuthShell title="Reset your password">
      {error ? <Alert kind="error" role="alert">{error}</Alert> : null}
      {sent ? (
        <Alert kind="ok" role="status">If an account exists for that email, we have sent a link to reset the password.</Alert>
      ) : null}
      <form action={requestPasswordReset} className="form-stack">
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required className="input" />
        </div>
        <button type="submit" className="btn btn-primary btn-block">Send reset link</button>
      </form>
      <Link className="linkish" href="/auth/sign-in">Back to sign in</Link>
    </AuthShell>
  );
}
