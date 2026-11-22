import Link from "next/link";
import { safeNextPath } from "@/lib/auth/redirect";
import { signIn } from "../actions";
import { first, type SearchParams } from "@/lib/http/search-params";
import { styles } from "../styles";

export const metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next));
  const error = first(params.error);
  const message = first(params.message);

  return (
    <main style={styles.main}>
      <h1>Sign in</h1>
      {error ? (
        <p role="alert" style={styles.error}>
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" style={styles.notice}>
          {message}
        </p>
      ) : null}
      <form action={signIn} style={styles.form}>
        <input type="hidden" name="next" value={next} />
        <label style={styles.label}>
          Email
          <input name="email" type="email" autoComplete="email" required style={styles.input} />
        </label>
        <label style={styles.label}>
          Password
          <input name="password" type="password" autoComplete="current-password" required style={styles.input} />
        </label>
        <button type="submit" style={styles.button}>
          Sign in
        </button>
      </form>
      <p style={styles.footer}>
        <Link href="/auth/reset-password">Forgot your password?</Link>
      </p>
      <p>
        New here? <Link href={`/auth/sign-up?next=${encodeURIComponent(next)}`}>Create an account</Link>
      </p>
    </main>
  );
}
