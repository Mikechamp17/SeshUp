import Link from "next/link";
import { requireOperator } from "@/lib/auth/roles";
import { listGyms, requestOperatorContext } from "@/lib/operator/gyms";
import { loadStatement, parseMonth } from "@/lib/operator/statements";
import { styles } from "../../auth/styles";
import { first, type AuthSearchParams } from "../../auth/search-params";
import { operatorStyles } from "../styles";

export const metadata = { title: "Statements" };

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export default async function StatementsPage({ searchParams }: { searchParams: AuthSearchParams }) {
  await requireOperator();
  const query = await searchParams;
  const gymId = first(query.gym);
  const month = parseMonth(first(query.month))?.slice(0, 7) ?? currentMonth();

  const ctx = await requestOperatorContext();
  const gyms = await listGyms(ctx);
  const statement = gymId ? await loadStatement(ctx, gymId, month) : null;

  return (
    <main style={operatorStyles.main}>
      <p>
        <Link href="/operator">Back to operator</Link>
      </p>
      <h1>Statements</h1>
      <form method="get" style={styles.form}>
        <label style={styles.label}>
          Gym
          <select name="gym" defaultValue={gymId} required style={styles.input}>
            <option value="">Choose a gym</option>
            {gyms.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label style={styles.label}>
          Month
          <input name="month" type="month" defaultValue={month} required style={styles.input} />
        </label>
        <button type="submit" style={styles.button}>
          Show statement
        </button>
      </form>

      {gymId && !statement ? (
        <p role="alert" style={styles.error}>
          That gym or month could not be found.
        </p>
      ) : null}

      {statement ? (
        <section style={operatorStyles.section}>
          <h2>
            {statement.gymName}, {statement.monthLabel}
          </h2>
          <p>Months are counted in the gym&apos;s time zone ({statement.timezone}).</p>
          <p>
            <strong>Gym owes SeshUp: {statement.gymOwes}</strong>
            <br />
            SeshUp absorbed: {statement.seshupAbsorbed}
          </p>
          {statement.entries.length === 0 ? <p>No entries this month.</p> : null}
          <ul style={operatorStyles.list}>
            {statement.entries.map((e) => (
              <li key={e.id} style={operatorStyles.item}>
                <strong>{e.amount}</strong> {e.owedBy === "gym" ? "owed by the gym" : "absorbed by SeshUp"}
                <br />
                {e.kind}, {e.entryDate}
                <br />
                Refund of {e.refundAmount} ({e.refundStatus}) for {e.classLabel}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
