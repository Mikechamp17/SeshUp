# Paystack split payments and refunds: test-mode findings

Status: NOT RUN YET. No finding below has been observed. Nothing in this file is a result until someone fills it in from a real run.

## How to run

1. Put Paystack test keys in the environment: `PAYSTACK_SECRET_KEY=sk_test_...`. The script refuses any other key.
2. Run `npx tsx scripts/paystack-test-mode-check.ts` and follow the prompts. It needs one manual step: paying with a Paystack test card at the printed link.
3. Record the results in the sections below, with the date and the dashboard values you saw.

## To record

Each item gets a plain answer and the evidence (dashboard figure or raw response).

- Who is debited on a split refund: the gym sub-account, the platform main balance, or both, and in what amounts.
- Whether the platform fee is returned to SeshUp's balance when the payment is refunded.
- Whether the processing fee is kept by Paystack on a refund, and who bears it.
- Whether a partial refund is supported on a split payment.
- The webhook signature header name, and the names of the events for a successful charge, a processed refund, and a failed refund.
- What happens to a refund larger than the platform's available balance (rejected, queued, or taken from somewhere else).
- Whether the main balance can be held back from automatic payout, so refunds can be funded.
- Whether a second full refund on the same transaction is rejected, and with which message and status code.
- What the refund list by transaction returns after a refund (fields and statuses).
- Whether a South African bank sub-account was created and settles in rand.

## Decisions this sets

- Which ledger rows each refund writes: the gym share the platform funded, and the processing fee kept.
- Whether the stop condition applies: if Paystack cannot return 100% of a split payment to the member, or cannot onboard a South African gym sub-account that settles in rand, stop and re-plan payments.
- Whether any field name guessed in `lib/payments/paystack.ts` needs correcting.

## Results

Not yet recorded.
