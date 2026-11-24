import { requireUser } from "@/lib/auth/roles";
import { safeNextPath } from "@/lib/auth/redirect";
import { setPassword } from "../actions";
import { first, type SearchParams } from "@/lib/http/search-params";
import { Alert, AuthShell } from "../../ui";

export const metadata = { title: "Choose a password" };

// Reached from an invite or a reset link, which the callback route turns into a
// signed-in session. Without that session the visitor is sent to sign in.
export default async function SetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next));
  const error = first(params.error);
  await requireUser(`/auth/set-password?next=${encodeURIComponent(next)}`);

  return (
    <AuthShell title="Choose a password">
      {error ? <Alert kind="error" role="alert">{error}</Alert> : null}
      <form action={setPassword} className="form-stack">
        <input type="hidden" name="next" value={next} />
        <div className="field">
          <label htmlFor="password">New password</label>
          <input id="password" name="password" type="password" autoComplete="new-password" minLength={6} required className="input" />
          <span className="hint">At least 6 characters.</span>
        </div>
        <button type="submit" className="btn btn-primary btn-block">Save password</button>
      </form>
    </AuthShell>
  );
}
