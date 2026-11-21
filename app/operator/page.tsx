import Link from "next/link";
import { requireOperator } from "@/lib/auth/roles";
import { listGyms, listProblems, requestOperatorContext, type Problem } from "@/lib/operator/gyms";
import { styles } from "../auth/styles";
import { operatorStyles } from "./styles";

export const metadata = { title: "Operator" };

const PROBLEM_TITLES: Record<Problem["kind"], string> = {
  gym_not_connected: "Gyms without a payment account",
  refund_failed: "Refunds that failed or keep retrying",
  email_dead: "Emails that gave up",
};

export default async function OperatorPage() {
  await requireOperator();
  const ctx = await requestOperatorContext();
  const [gyms, problems] = await Promise.all([listGyms(ctx), listProblems(ctx)]);

  return (
    <main style={operatorStyles.main}>
      <h1>Operator</h1>
      <p style={operatorStyles.row}>
        <Link href="/operator/gyms/new">New gym</Link>
        <Link href="/operator/statements">Statements</Link>
      </p>

      <h2>Problems</h2>
      {problems.length === 0 ? <p style={styles.notice}>Nothing needs attention.</p> : null}
      {(Object.keys(PROBLEM_TITLES) as Problem["kind"][]).map((kind) => {
        const items = problems.filter((p) => p.kind === kind);
        if (items.length === 0) return null;
        return (
          <section key={kind}>
            <h3>{PROBLEM_TITLES[kind]}</h3>
            <ul style={operatorStyles.list}>
              {items.map((p) => (
                <li key={`${p.kind}-${p.ref_id}`} style={operatorStyles.item}>
                  {p.gym_id ? <Link href={`/operator/gyms/${p.gym_id}`}>{p.gym_name}</Link> : null}
                  {p.gym_id ? ": " : ""}
                  {p.detail}
                  {p.attempts > 0 ? ` (${p.attempts} attempts)` : ""}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <h2>Gyms</h2>
      {gyms.length === 0 ? <p>No gyms yet.</p> : null}
      <ul style={operatorStyles.list}>
        {gyms.map((g) => (
          <li key={g.id} style={operatorStyles.item}>
            <Link href={`/operator/gyms/${g.id}`}>{g.name}</Link> /g/{g.slug}, fee {g.fee_bps / 100}%,{" "}
            {g.paystack_subaccount_code ? "payments connected" : "payments not connected"}
          </li>
        ))}
      </ul>
    </main>
  );
}
