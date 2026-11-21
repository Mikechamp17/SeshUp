import Link from "next/link";
import { requestPasswordReset } from "../actions";
import { first, type AuthSearchParams } from "../search-params";
import { styles } from "../styles";

export const metadata = { title: "Reset password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: AuthSearchParams }) {
  const params = await searchParams;
  const error = first(params.error);
  const sent = first(params.sent) === "1";

  return (
    <main style={styles.main}>
      <h1>Reset your password</h1>
      {error ? (
        <p role="alert" style={styles.error}>
          {error}
        </p>
      ) : null}
      {sent ? (
        <p role="status" style={styles.notice}>
          If an account exists for that email, we have sent a link to reset the password.
        </p>
      ) : null}
      <form action={requestPasswordReset} style={styles.form}>
        <label style={styles.label}>
          Email
          <input name="email" type="email" autoComplete="email" required style={styles.input} />
        </label>
        <button type="submit" style={styles.button}>
          Send reset link
        </button>
      </form>
      <p style={styles.footer}>
        <Link href="/auth/sign-in">Back to sign in</Link>
      </p>
    </main>
  );
}
