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
