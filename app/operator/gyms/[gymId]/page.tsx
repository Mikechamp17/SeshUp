import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOperator } from "@/lib/auth/roles";
import { getGym, requestOperatorContext } from "@/lib/operator/gyms";
import { styles } from "../../../auth/styles";
import { first, type AuthSearchParams } from "../../../auth/search-params";
import { connectPaymentsAction, inviteOwnerAction } from "../../actions";
import { operatorStyles } from "../../styles";

export const metadata = { title: "Gym" };

export default async function GymPage({
  params,
  searchParams,
}: {
  params: Promise<{ gymId: string }>;
  searchParams: AuthSearchParams;
}) {
  await requireOperator();
  const { gymId } = await params;
  const query = await searchParams;
  const error = first(query.error);
  const message = first(query.message);

  const gym = await getGym(await requestOperatorContext(), gymId);
  if (!gym) notFound();

  return (
    <main style={operatorStyles.main}>
      <p>
        <Link href="/operator">Back to operator</Link>
      </p>
      <h1>{gym.name}</h1>
      <p>
        Members open /g/{gym.slug}. Fee {gym.fee_bps / 100}%. Time zone {gym.timezone}.
      </p>
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

      <section style={operatorStyles.section}>
        <h2>Payments</h2>
        {gym.paystack_subaccount_code ? (
          <p style={styles.notice}>Payment account connected. Members can book.</p>
        ) : (
          <form action={connectPaymentsAction} style={styles.form}>
            <p>Not connected, so members cannot book yet. The bank details go straight to the payment provider and are not kept.</p>
            <input type="hidden" name="gymId" value={gym.id} />
            <label style={styles.label}>
              Bank code
              <input name="bankCode" required inputMode="numeric" autoComplete="off" style={styles.input} />
            </label>
            <label style={styles.label}>
              Account number
              <input name="accountNumber" required inputMode="numeric" autoComplete="off" style={styles.input} />
            </label>
            <button type="submit" style={styles.button}>
              Connect payments
            </button>
          </form>
        )}
      </section>

      <section style={operatorStyles.section}>
        <h2>Invite an owner</h2>
        <form action={inviteOwnerAction} style={styles.form}>
          <input type="hidden" name="gymId" value={gym.id} />
          <label style={styles.label}>
            Owner email
            <input name="email" type="email" required autoComplete="off" style={styles.input} />
          </label>
          <button type="submit" style={styles.button}>
            Invite owner
          </button>
        </form>
      </section>

      <p style={operatorStyles.section}>
        <Link href={`/operator/statements?gym=${gym.id}`}>Monthly statements for this gym</Link>
      </p>
    </main>
  );
}
