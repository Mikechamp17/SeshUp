# SeshUp

Class booking for boxing gyms. Members book and pay for group classes from their phone, and no class goes over its spot limit.

Stack: Next.js (App Router, TypeScript) on Vercel, Supabase (Postgres, Auth, row-level security), Paystack for card payments, Resend for email.

The implementation plan is in `docs/plans/`.

## Local setup

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`. Every variable is described in `.env.example`.

## Checks

| Command | What it runs |
|---|---|
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm test` | Unit tests (Vitest) |
| `npm run test:db` | Database tests against a fresh Postgres. Starts a throwaway local cluster, or uses `DATABASE_URL` when set |
| `npm run test:e2e` | End-to-end tests on a phone viewport (Playwright). Needs the local Supabase stack (`supabase start`) |

Database tests apply `supabase/tests/shim.sql` first. It stands in for the Supabase roles and auth helpers when the target is plain Postgres.

## After deploying

1. Apply `supabase/migrations/` to the Supabase project (`supabase db push`).
2. Store the job route address and shared secret in Supabase Vault, so the per-minute cron job can call the app. Run once in the SQL editor, with your own values:

```sql
select vault.create_secret('https://YOUR-APP-URL/api/jobs/run', 'job_url');
select vault.create_secret('YOUR-JOB-SECRET', 'job_secret');
```

The same secret goes in the `JOB_SECRET` environment variable on Vercel. Until both secrets exist the cron job does nothing, and pending refunds show up under "Refunds waiting to be sent" on the operator page.
3. Set `APP_URL` on Vercel so emailed links never depend on request headers.
4. Run `scripts/paystack-test-mode-check.ts` against Paystack test keys and record the results in `docs/solutions/paystack-split-refunds.md` before taking live payments. It settles how refunds, fees, and payout balances behave.

