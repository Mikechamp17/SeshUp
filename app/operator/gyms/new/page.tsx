import { requireOperator } from "@/lib/auth/roles";
import { DEFAULT_TIMEZONE } from "@/lib/operator/gyms";
import { styles } from "../../../auth/styles";
import { first, type AuthSearchParams } from "../../../auth/search-params";
import { createGymAction } from "../../actions";
import { operatorStyles } from "../../styles";

export const metadata = { title: "New gym" };

export default async function NewGymPage({ searchParams }: { searchParams: AuthSearchParams }) {
  await requireOperator();
  const error = first((await searchParams).error);

  return (
    <main style={operatorStyles.main}>
      <h1>New gym</h1>
      {error ? (
        <p role="alert" style={styles.error}>
          {error}
        </p>
      ) : null}
      <form action={createGymAction} style={styles.form}>
        <label style={styles.label}>
          Gym name
          <input name="name" required maxLength={100} style={styles.input} />
        </label>
        <label style={styles.label}>
          Link name (members open /g/this-name)
          <input name="slug" required pattern="[a-z0-9][a-z0-9\-]*" maxLength={60} autoCapitalize="none" style={styles.input} />
        </label>
        <label style={styles.label}>
          SeshUp fee percentage (0 to 100)
          <input name="feePercent" required inputMode="decimal" defaultValue="5" style={styles.input} />
        </label>
        <label style={styles.label}>
          Time zone
          <input name="timezone" required defaultValue={DEFAULT_TIMEZONE} style={styles.input} />
        </label>
        <button type="submit" style={styles.button}>
          Create gym
        </button>
      </form>
    </main>
  );
}
