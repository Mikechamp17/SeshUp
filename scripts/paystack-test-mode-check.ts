// Manual check against Paystack test mode. Not part of the automated suite.
//
// Run: PAYSTACK_SECRET_KEY=sk_test_... npx tsx scripts/paystack-test-mode-check.ts
// Optional: PAYSTACK_TEST_BANK_CODE and PAYSTACK_TEST_ACCOUNT_NUMBER for the sub-account.
//
// Record what it prints in docs/solutions/paystack-split-refunds.md.

import { createPaystackProvider } from "../lib/payments/paystack";
import { ProviderError } from "../lib/payments/provider";
import { computeFeeCents, formatRand } from "../lib/money/fees";

const secretKey = process.env.PAYSTACK_SECRET_KEY ?? "";
if (!secretKey.startsWith("sk_test_")) {
  console.error("Refusing to run: PAYSTACK_SECRET_KEY must be a test key starting with sk_test_.");
  process.exit(1);
}

const provider = createPaystackProvider({ secretKey });
const AMOUNT_CENTS = 10000;
const FEE_BPS = 500;

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

async function raw(path: string): Promise<unknown> {
  const response = await fetch(`https://api.paystack.co${path}`, {
    headers: { authorization: `Bearer ${secretKey}` },
  });
  return response.json();
}

async function ask(question: string): Promise<string> {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer;
}

async function main(): Promise<void> {
  section("1. Create a test sub-account");
  const subaccount = await provider.createSubaccount({
    businessName: `SeshUp check ${Date.now()}`,
    bankCode: process.env.PAYSTACK_TEST_BANK_CODE ?? "632005",
    accountNumber: process.env.PAYSTACK_TEST_ACCOUNT_NUMBER ?? "0000000000",
  });
  console.log("Sub-account code:", subaccount.code);
  console.log("If this failed for a South African bank, the stop condition on onboarding applies.");

  section("2. Start a split payment");
  const reference = `check-${Date.now()}`;
  const feeCents = computeFeeCents(AMOUNT_CENTS, FEE_BPS);
  const checkout = await provider.initialize({
    reference,
    amountCents: AMOUNT_CENTS,
    email: "check@example.com",
    subaccountCode: subaccount.code,
    feeCents,
    callbackUrl: "https://example.com/return",
  });
  console.log(`Amount ${formatRand(AMOUNT_CENTS)}, platform fee ${formatRand(feeCents)}`);
  console.log("MANUAL STEP: open this link and pay with a Paystack test card:");
  console.log(checkout.authorizationUrl);
  await ask("Press Enter once the test payment has completed... ");

  section("3. Verify the payment");
  const verified = await provider.verify(reference);
  console.log(verified);
  console.log("Raw verify response (check who bears the processing fee and the split):");
  console.log(JSON.stringify(await raw(`/transaction/verify/${encodeURIComponent(reference)}`), null, 2));
  await ask("Note the sub-account and main balances in the dashboard now, then press Enter... ");

  section("4. Refund in full");
  const refund = await provider.refund({ reference, amountCents: AMOUNT_CENTS });
  console.log(refund);
  await ask("Wait for the refund to settle, then note both balances again and press Enter... ");

  section("5. A second full refund must be rejected");
  try {
    const second = await provider.refund({ reference, amountCents: AMOUNT_CENTS });
    console.log("Provider returned the existing refund (no new refund created):", second);
  } catch (error) {
    if (error instanceof ProviderError) {
      console.log(`Rejected as expected. retryable=${error.retryable}: ${error.message}`);
    } else {
      throw error;
    }
  }

  section("6. Look up existing refunds by transaction");
  console.log(await provider.findRefunds(reference));
  console.log("Raw response:");
  console.log(JSON.stringify(await raw(`/refund?reference=${encodeURIComponent(reference)}`), null, 2));

  section("7. Still to record by hand");
  console.log("- Webhook header name and event names: see Settings > API Keys & Webhooks, event log.");
  console.log("- Who was debited on the refund (sub-account or main balance), and whether the");
  console.log("  platform fee and the processing fee came back.");
  console.log("- Whether a partial refund is accepted (try a second payment with half the amount).");
  console.log("- What happens when the refund exceeds the platform balance.");
  console.log("- Whether the main balance can be held back from automatic payout.");
  console.log("Write the findings into docs/solutions/paystack-split-refunds.md.");
}

main().catch((error: unknown) => {
  console.error("Check failed:", error);
  process.exit(1);
});
