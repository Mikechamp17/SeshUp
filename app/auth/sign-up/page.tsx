import Link from "next/link";
import { safeNextPath } from "@/lib/auth/redirect";
import { signUp } from "../actions";
import { first, type SearchParams } from "@/lib/http/search-params";
import { Alert, AuthShell } from "../../ui";

export const metadata = { title: "Create account" };

export default async function SignUpPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next));
  const error = first(params.error);

  return (
    <AuthShell title="Create your account">
      {error ? <Alert kind="error" role="alert">{error}</Alert> : null}
      <form action={signUp} className="form-stack">
        <input type="hidden" name="next" value={next} />
        <div className="field">
          <label htmlFor="name">Name</label>
          <input id="name" name="name" type="text" autoComplete="name" required className="input" />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required className="input" />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="new-password" minLength={6} required className="input" />
          <span className="hint">At least 6 characters.</span>
        </div>
        <button type="submit" className="btn btn-primary btn-block">Create account</button>
      </form>
      <p className="t-body">
        Already have an account? <Link className="linkish" href={`/auth/sign-in?next=${encodeURIComponent(next)}`}>Sign in</Link>
      </p>
    </AuthShell>
  );
}
