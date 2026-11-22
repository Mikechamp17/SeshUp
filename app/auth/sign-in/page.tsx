import Link from "next/link";
import { safeNextPath } from "@/lib/auth/redirect";
import { signIn } from "../actions";
import { first, type SearchParams } from "@/lib/http/search-params";
import { Alert, AuthShell } from "../../ui";

export const metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next));
  const error = first(params.error);
  const message = first(params.message);

  return (
    <AuthShell title="Sign in">
      {error ? <Alert kind="error" role="alert">{error}</Alert> : null}
      {message ? <Alert kind="ok" role="status">{message}</Alert> : null}
      <form action={signIn} className="form-stack">
        <input type="hidden" name="next" value={next} />
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required className="input" />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
        </div>
        <button type="submit" className="btn btn-primary btn-block">Sign in</button>
      </form>
      <div className="link-row">
        <Link className="linkish" href="/auth/reset-password">Forgot your password?</Link>
        <span className="t-body">
          New here? <Link className="linkish" href={`/auth/sign-up?next=${encodeURIComponent(next)}`}>Create an account</Link>
        </span>
      </div>
    </AuthShell>
  );
}
