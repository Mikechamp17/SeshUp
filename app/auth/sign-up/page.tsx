import Link from "next/link";
import { safeNextPath } from "@/lib/auth/redirect";
import { signUp } from "../actions";
import { first, type SearchParams } from "@/lib/http/search-params";
import { styles } from "../styles";

export const metadata = { title: "Create account" };

export default async function SignUpPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next));
  const error = first(params.error);

  return (
    <main style={styles.main}>
      <h1>Create your account</h1>
      {error ? (
        <p role="alert" style={styles.error}>
          {error}
        </p>
      ) : null}
      <form action={signUp} style={styles.form}>
        <input type="hidden" name="next" value={next} />
        <label style={styles.label}>
          Name
          <input name="name" type="text" autoComplete="name" required style={styles.input} />
        </label>
        <label style={styles.label}>
          Email
          <input name="email" type="email" autoComplete="email" required style={styles.input} />
        </label>
        <label style={styles.label}>
          Password
          <input name="password" type="password" autoComplete="new-password" minLength={6} required style={styles.input} />
        </label>
        <button type="submit" style={styles.button}>
          Create account
        </button>
      </form>
      <p style={styles.footer}>
        Already have an account? <Link href={`/auth/sign-in?next=${encodeURIComponent(next)}`}>Sign in</Link>
      </p>
    </main>
  );
}
