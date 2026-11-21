import { requireUser } from "@/lib/auth/roles";
import { safeNextPath } from "@/lib/auth/redirect";
import { setPassword } from "../actions";
import { first, type AuthSearchParams } from "../search-params";
import { styles } from "../styles";

export const metadata = { title: "Choose a password" };

// Reached from an invite or a reset link, which the callback route turns into a
// signed-in session. Without that session the visitor is sent to sign in.
export default async function SetPasswordPage({ searchParams }: { searchParams: AuthSearchParams }) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next));
  const error = first(params.error);
  await requireUser(`/auth/set-password?next=${encodeURIComponent(next)}`);

  return (
    <main style={styles.main}>
      <h1>Choose a password</h1>
      {error ? (
        <p role="alert" style={styles.error}>
          {error}
        </p>
      ) : null}
      <form action={setPassword} style={styles.form}>
        <input type="hidden" name="next" value={next} />
        <label style={styles.label}>
          New password
          <input name="password" type="password" autoComplete="new-password" minLength={6} required style={styles.input} />
        </label>
        <button type="submit" style={styles.button}>
          Save password
        </button>
      </form>
    </main>
  );
}
