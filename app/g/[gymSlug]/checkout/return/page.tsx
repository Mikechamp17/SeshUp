import Link from "next/link";
import { requireUser } from "@/lib/auth/roles";
import { confirmByReference, type ConfirmOutcome } from "@/lib/booking/confirm";
import { getPaymentProvider } from "@/lib/payments/factory";
import { formatRand } from "@/lib/money/fees";
import { one } from "@/lib/db/rows";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { formatGymDateTime } from "@/lib/time/gym-time";
import { first, type SearchParams } from "@/lib/http/search-params";
import { Alert, Topbar } from "../../../../ui";
import { AutoRefresh } from "./auto-refresh";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payment" };

const MAX_CHECKS = 6;

type Gym = { name: string; timezone: string };
type SessionInfo = { name: string; starts_at: string; price_cents: number; gyms: Gym | Gym[] | null };

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
      <div className="app">
        <Topbar name="SeshUp" />
        <main className="app-body pad form-stack">
          <h1 className="t-h1">Payment</h1>
          <Alert kind="error" role="alert" title="Booking not found">We could not find that booking.</Alert>
        </main>
        <div className="cta-bar">
          <Link className="btn btn-primary btn-block" href={`/g/${gymSlug}`}>Back to timetable</Link>
        </div>
      </div>
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

  // Class details for the summary card. The booking was already shown to belong to this member.
  let info: SessionInfo | null = null;
  try {
    const { data } = await createAdminClient()
      .from("class_sessions")
      .select("name, starts_at, price_cents, gyms(name, timezone)")
      .eq("id", booking.session_id)
      .maybeSingle();
    info = (data as unknown as SessionInfo | null) ?? null;
  } catch {
    info = null;
  }
  const gym = info ? one(info.gyms) : null;

  const classHref = `/g/${gymSlug}/classes/${booking.session_id}`;
  const stillChecking = (outcome === "pending" || outcome === "mismatch") && status === "pending";
  const nextHref = `/g/${gymSlug}/checkout/return?ref=${encodeURIComponent(ref)}&n=${checks + 1}`;
  const summary = info ? (
    <div className="card" style={{ padding: "8px 16px" }}>
      <div className="row"><span className="muted">Class</span><b>{info.name}</b></div>
      <div className="row"><span className="muted">When</span><b>{formatGymDateTime(info.starts_at, gym?.timezone ?? "Africa/Johannesburg")}</b></div>
      <div className="row"><span className="muted">Amount</span><b className="t-num">{formatRand(info.price_cents)}</b></div>
    </div>
  ) : null;

  const confirmed = status === "confirmed";
  const refunded = status === "refunded_late";
  const failed = status === "failed" || status === "expired";
  const cancelled = status === "released_by_gym" || status.startsWith("cancelled");
  const checking = stillChecking && checks < MAX_CHECKS;
  const slow = stillChecking && checks >= MAX_CHECKS;

  return (
    <div className="app">
      <Topbar name={gym?.name ?? "SeshUp"} />

      {confirmed ? (
        <div className="hero" style={{ background: "var(--ok-bg)" }} role="status">
          <div className="mark" style={{ background: "var(--ok)", color: "#fff" }} aria-hidden="true">&#10003;</div>
          <span className="t-eyebrow" style={{ color: "var(--ok)" }}>Confirmed</span>
          <h1 className="t-display">You&apos;re in.</h1>
          <p className="t-body">Your spot is booked and paid. A confirmation email is on its way.</p>
        </div>
      ) : null}
      {refunded ? (
        <div className="hero" style={{ background: "var(--paper)" }} role="status">
          <div className="mark" aria-hidden="true">R</div>
          <span className="t-eyebrow">Refunded</span>
          <h1 className="t-display">Class filled up</h1>
          <p className="t-body">Your payment arrived after the spot had gone to someone else. We are refunding you in full and will email you.</p>
        </div>
      ) : null}
      {checking || slow ? (
        <div className="hero" style={{ background: "var(--accent)", color: "var(--on-accent)" }} role="status">
          <div className="mark" aria-hidden="true">&hellip;</div>
          <span className="t-eyebrow" style={{ color: "var(--on-accent)" }}>Still pending</span>
          <h1 className="t-display">Checking your payment</h1>
          <p className="t-body" style={{ fontWeight: 600 }}>
            {checking
              ? "Paystack has not told us yet. This usually takes under a minute."
              : "Your payment is still being confirmed. If it went through, we will email you a confirmation."}
          </p>
        </div>
      ) : null}
      {failed ? (
        <div className="hero" style={{ background: "var(--cancel-bg)" }} role="alert">
          <div className="mark" style={{ background: "var(--cancel)", color: "#fff" }} aria-hidden="true">&times;</div>
          <span className="t-eyebrow" style={{ color: "var(--cancel)" }}>Payment failed</span>
          <h1 className="t-display">Not booked</h1>
          <p className="t-body">Your payment did not go through, so no spot was booked.</p>
        </div>
      ) : null}
      {cancelled ? (
        <div className="hero" style={{ background: "var(--paper)" }} role="status">
          <div className="mark" aria-hidden="true">&times;</div>
          <span className="t-eyebrow">Cancelled</span>
          <h1 className="t-display">Booking cancelled</h1>
          <p className="t-body">This booking is cancelled.</p>
        </div>
      ) : null}
      {checking ? <AutoRefresh href={nextHref} seconds={5} /> : null}

      <main className="app-body pad form-stack">
        {summary}
        {checking || slow ? (
          <Alert kind="warn" title="Do not pay again">If you were charged, your spot will confirm on its own. We will email you either way.</Alert>
        ) : null}
        {confirmed ? (
          <Alert kind="warn" title="Cancelling">Your bookings page shows your refund deadline for this class.</Alert>
        ) : null}
        {refunded ? (
          <Alert title="Refund on its way">Paystack returns it to the card you paid with. Your bank decides how long it takes to show.</Alert>
        ) : null}
      </main>

      <div className="cta-bar">
        {confirmed ? (
          <>
            <Link className="btn btn-primary btn-block" href="/account/bookings">My bookings</Link>
            <Link className="btn btn-block" href={`/g/${gymSlug}`}>Back to timetable</Link>
          </>
        ) : null}
        {checking || slow ? (
          <>
            {slow ? <Link className="btn btn-dark btn-block" href={nextHref}>Check again</Link> : null}
            <Link className="btn btn-block" href={classHref}>Back to the class</Link>
          </>
        ) : null}
        {failed ? (
          <>
            <Link className="btn btn-primary btn-block" href={classHref}>Try again</Link>
            <Link className="btn btn-block" href={`/g/${gymSlug}`}>Back to timetable</Link>
          </>
        ) : null}
        {refunded || cancelled ? (
          <>
            <Link className="btn btn-primary btn-block" href={`/g/${gymSlug}`}>See other classes</Link>
          </>
        ) : null}
      </div>
    </div>
  );
}
