# SD Core development workflow

SD Core uses a three-stage, zero-extra-cost development path. Supabase paid Branching is intentionally not required.

## 1. Local Supabase — fast iteration

Use the Supabase CLI with a Docker-compatible runtime.

```bash
supabase init
supabase start
supabase status
```

Use the local database URL reported by `supabase status`, then apply the Core-compatible dev baseline and migrations in order:

```bash
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f database/dev/sd_core_dev_baseline.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/sd_core_wallet_v1.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/sd_core_ledger_api_v1.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sd-core/supabase_integration_regression.sql
```

`database/dev/sd_core_dev_baseline.sql` is **development-only**. It recreates only the production tables that Core v1 depends on and contains no production data. Never apply it to `SD608-Online`.

## 2. SD-Core-Dev — online integration/staging

Supabase project:

- Name: `SD-Core-Dev`
- Project ref: `rwjueffaziiawdebbwpf`
- Region: `ap-northeast-2` (Seoul)
- Purpose: SD Core development/integration only
- Production data: none

The project uses a minimal production-compatible baseline for `profiles`, `wallets`, `transactions`, and `devices`, followed by the exact Core v1 migrations from this branch.

Use this environment for internet-facing integration tests, Auth/RLS/RPC verification, and future SD Link/web/mobile E2E tests. Do not point normal production clients at it.

## 3. GitHub CI — regression gate

`.github/workflows/sd-core-regression.yml` runs the deterministic PostgreSQL 17 regression suite on Core migration/test changes.

CI must stay green before any production candidate is considered. The current required wallet regression is:

1. start at 1,000,000
2. reward 100,000 -> 1,100,000
3. spend 200,000 -> 900,000
4. replay the same reward event -> still 900,000
5. resync/relogin snapshot -> 900,000
6. server remains authoritative when the client/PC is offline

The suite also covers transfer isolation, RLS-visible ledger ownership, idempotency conflict behavior, insufficient-funds rollback, and denial of direct client wallet writes.

## Production promotion

Production remains `SD608-Online` (`qmatphbjzafdtlyviqoa`).

Promotion is manual and approval-gated:

```text
feature/sd-core
  -> local Supabase regression
  -> SD-Core-Dev integration validation
  -> GitHub CI green
  -> user approval
  -> apply Core migrations to SD608-Online
```

Never apply `database/dev/sd_core_dev_baseline.sql` to production. Production already owns the legacy account/wallet/device/transaction schema; only the reviewed Core migrations are production candidates.

## Isolation rules

- Do not merge `feature/sd-core` to `main` during development.
- Do not change the legacy SD Link client protocol as part of Core backend work.
- Do not copy production user data into `SD-Core-Dev`.
- Do not expose `sd_core_private` through the Supabase Data API.
- Client requests use semantic `reward`, `spend`, `transfer` with positive amounts; the server owns sign/direction and final balance.
- Every wallet mutation must carry a unique `event_id`; exact retries are idempotent and changed replays are rejected.
