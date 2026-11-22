import Link from "next/link";
import { requireUser } from "@/lib/auth/roles";
import { confirmByReference, type ConfirmOutcome } from "@/lib/booking/confirm";
import { getPaymentProvider } from "@/lib/payments/factory";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { first, type SearchParams } from "@/lib/http/search-params";
import { styles } from "../../../styles";
import { AutoRefresh } from "./auto-refresh";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payment" };

const MAX_CHECKS = 6;

/** Where the member lands after Paystack. The payment is confirmed here only after the provider says so. */
export default async function CheckoutReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ gymSlug: string }>;
  searchParams: SearchParams;
}) {
  const { gymSlug } = await params;
  const query = await searchParams;
  const ref = first(query.ref);
  const checks = Number(first(query.n)) || 0;
  await requireUser(`/g/${gymSlug}/checkout/return?ref=${encodeURIComponent(ref)}`);

  const supabase = await createClient();
  // Row-level security means this finds only the signed-in member's own booking.
  const { data: booking } = await supabase.from("bookings").select("id, session_id, status").eq("id", ref).maybeSingle();
  if (!booking) {
    return (
      <main style={styles.main}>
        <h1>Payment</h1>
        <p>We could not find that booking.</p>
        <p><Link href={`/g/${gymSlug}`}>Back to the timetable</Link></p>
      </main>
    );
  }

  let outcome: ConfirmOutcome = "pending";
  let status = booking.status as string;
  try {
    const admin = createAdminClient();
    const result = await confirmByReference({
      rpc: (fn, args) => admin.rpc(fn, args),
      provider: getPaymentProvider(),
      reference: booking.id,
    });
    outcome = result.outcome;
    status = result.bookingStatus;
  } catch {
    outcome = "pending";
  }

  const classHref = `/g/${gymSlug}/classes/${booking.session_id}`;
  const stillChecking = (outcome === "pending" || outcome === "mismatch") && status === "pending";
  const nextHref = `/g/${gymSlug}/checkout/return?ref=${encodeURIComponent(ref)}&n=${checks + 1}`;

  return (
    <main style={styles.main}>
      <h1>Payment</h1>
      {status === "confirmed" ? (
        <p role="status" style={styles.notice}>
          You&apos;re booked. A confirmation email is on its way. <Link href="/account/bookings">See your bookings</Link>
        </p>
      ) : null}
      {status === "refunded_late" ? (
        <p role="status" style={styles.error}>
          Your payment arrived after the spot had gone to someone else. We are refunding you in full and will email you.
        </p>
      ) : null}
      {stillChecking && checks < MAX_CHECKS ? (
        <>
          <p role="status" style={styles.notice}>Confirming your payment...</p>
          <AutoRefresh href={nextHref} seconds={5} />
        </>
      ) : null}
      {stillChecking && checks >= MAX_CHECKS ? (
        <p role="status">
          Your payment is still being confirmed. If it went through, we will email you a confirmation.{" "}
          <Link href={classHref}>Back to the class</Link>
        </p>
      ) : null}
      {status === "failed" || status === "expired" ? (
        <>
          <p role="alert" style={styles.error}>Your payment did not go through, so no spot was booked.</p>
          <p><Link href={classHref}>Try again</Link></p>
        </>
      ) : null}
      {status === "released_by_gym" || status.startsWith("cancelled") ? (
        <p>This booking is cancelled. <Link href={`/g/${gymSlug}`}>Back to the timetable</Link></p>
      ) : null}
    </main>
  );
}
