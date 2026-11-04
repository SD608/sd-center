# SD Core shared extension authority contract — current security addendum

Status: **DRAFT / review required**, 2026-11-04. This file describes existing migration code; it does not approve or introduce a new RPC or production policy. The latest SD종합센터 Google Drive CURRENT INDEX and approved design remain authoritative.

## Why this exists

The older `docs/sd-core/SD_LINK_API_CONTRACT_v1.md` contains a `reward` client request and reward/replay examples from the original Core v1 test contract. Those samples **must not** be treated as permission for a current SD Link, Unity, website, mobile client, or extension to issue new money.

`database/migrations/sd_core_reward_authority_v1.sql` makes client `reward` calls fail with `P1030 / REWARD_CAPABILITY_REQUIRED`. Its public `sd_core_apply_wallet_event` is a SECURITY INVOKER wrapper around the guarded client implementation; it does **not** authorize a client to mint rewards. This is a *code observation*, not evidence that all production environments have applied the migration.

The historical tests `tests/sd-core/wallet_regression.sql` exercise the **pre-hardening baseline** where sample client reward was allowed. They are **not** evidence of current reward authority. The hardening-specific `tests/sd-core/reward_authority_regression.sql` and `.github/workflows/sd-core-authority-regression.yml` separately test the hardened contract.

## Current boundaries observed in GitHub

| Caller / flow | Current intended handling | Evidence / limit |
| --- | --- | --- |
| Client new reward through Core wallet RPC | Reject with `P1030` | `sd_core_reward_authority_v1.sql`; check deployed DB independently |
| Client spend/transfer | Guarded path, account/device and existing balance rules | Same migration delegates non-reward to `apply_wallet_event_impl`; execute runtime regressions before release |
| Legacy SD Link new positive deposit | Reject with `P1030` | `sd_core_legacy_reward_authority_v1.sql` |
| Legacy exact previously committed operation replay | Return duplicate, no second credit | Legacy migration, subject to payload and ownership checks; test required |
| Core/server-authorized reward | Only a validated trusted server/Core path may request final settlement | Production capability/API details must be confirmed separately; **no automatic approval of a new server endpoint** |
| Extension-side claimed reward or balance | Never authoritative | Existing SD Core economic integrity and asset protection rules |

## Cross-extension development rule (proposed integration checklist, not a new approved game policy)

1. The extension may send a bounded **claim/evidence event** to its trusted server. It must not set final balance, claim an achievement as final, or call a new client reward RPC.
2. The trusted game/service validator determines eligibility according to that extension's *approved* design. SD Core determines whether/when an authorized, idempotent ledger mutation is committed. Use stable logical event identifiers and fail closed on unclear status.
3. Record the response status and reconcile unknown outcomes from authoritative Core state before retrying. Do not generate a fresh logical reward event merely because the client timed out.
4. Preserve existing legitimate balances, items, unlocks, achievements and ownership through changes/recovery.
5. Block launch/production integration until actual server, Auth, revoked-device, concurrency, replay, rollback, negative and lost-response tests have passed for that extension.
6. Keep 4막 Miner GameSession and Unity↔Center Named Pipe under the existing Miner branches/PRs. This document does not change or implement their contracts.
7. Treat 5막/6막/7막 API names, event shapes, limits, payout formulas and ownership schemas as **TBD** pending their independent approvals.

## Current verification limits

- This addendum reconciles source files only; it is not a live production deployment, successful E2E, migration promotion, or Release Gate PASS.
- DEV Auth for Miner PR #95 was still LIVE NOT_RUN on the last checked checkpoint; do not confuse anonymous-denial CI or mock tests with a real JWT session.
- The compatibility guard test accompanying this document checks **source invariants**. It is not a substitute for Postgres SQL regression, actual JWT, deployment, Windows/UI testing, or independent review.
- Do not merge this Draft PR until the user reviews its wording and downstream contract owners confirm that it does not override a newer authoritative design.
