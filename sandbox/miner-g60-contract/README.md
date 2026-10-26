# 4막 5장 — G60 코드 감사 + 격리 Mock 계약 검증 (2026-10-26)

**Status: DRAFT / IMPLEMENTATION_PROPOSAL / PRODUCTION NOT CONNECTED / RELEASE GATE NOT PASS.**
This directory is an experimental, deterministic **in-memory mock**, NOT the new Unity 2D game, official Run server, real SQL transaction, Center bridge, Core ledger or authentication service. Nothing here has write access to production data. Test success cannot validate real-world economic safety.

## Verified source audit

- `SD608/sd-center` main `1059097f7693a5be04153a3e88e9587873858efc`: 785 paths in fully returned recursive tree, no Unity `.unity` or `.cs` project found.
- `diagnostics/authority-sources/miner/main.js`: legacy Electron/Node miner, not the new Unity adventure.
- `database/migrations/sd_core_reward_authority_v1.sql`: client `reward` requests forbidden (`P1030`); only source code inspected, production deployment unverified.
- `docs/sd-core/SD_LINK_API_CONTRACT_v1.md` and `preview/v024-core/sdlink-core-runtime.js`: existing Core wallet/device/link contract, NOT a verified Unity Run authority RPC.
- `sql/release-gate/20260820105412_sd_miner_authority_v2_02_api.sql`: old ore mining RPC, not G60 multiplayer Run ownership.
- `update/extensions-catalog.json`: legacy `miner` ZIP 1.1.1, not a new Unity executable.
- **Important existing branch**, `feat/miner-encounter-runtime-foundation-v1-20260923` HEAD `25ebe2bbe21e7ce47e9e6c017de3c5f931f6dc2d`: `miner-remake/runtime-v1` Phaser/Electron foundation on Draft PR #85, distinct from latest Unity-first handoff. Its `persistence/recovery-coordinator.js` has `RECOVERY_WINDOW_MS = 72h`. Latest 2026-10-26 approved G60 design uses 24h Run preservation + verified server-fault conditional maximum extra 24h. **Do not reuse this 72h rule as current CANON.** Foundation's local encounter recovery window may be a separate concept and needs explicit scope mapping before declaring a confirmed runtime bug. This branch is not a verified new Unity project.
- PR #80 and #85 remain Draft, not main. GitHub combined commit status endpoint returning `statuses: []` is NOT a passing CI status.

## What this mock tests

Node >=22, no dependencies:

```sh
node --test sandbox/miner-g60-contract/run-authority-mock.test.cjs
```

Covered by simplified in-memory unit scenarios: G60-CONTRACT-01 through 13, and 15. `G60-CONTRACT-16` is deliberately SKIPPED/BLOCKED because real Center/Unity/Windows does not exist in this mock. `G60-CONTRACT-14` (full physical item ledger + drop/boss history) is likewise NOT_IMPLEMENTED/BLOCKED; mock `itemOwners` is a placeholder, not an actual ledger or restoration algorithm. In addition, covered IDs are *partial mock subsets*, not the full canonical acceptance criteria.

**No claim of full tests 01~16 PASS.** All real server/Core/Center/Unity scenarios remain NOT_RUN, regardless of sandbox test results.

## Confirmed separation from authoritative systems

- `RunAuthorityMock` owns a fake clock, participants, epoch, shipment, simple quantity map and fault fixture.
- No real cryptographic JWT/device/session validation, durable write-ahead log, atomic DB commit, multi-process race, Core wallet mutation, shipping/ownership journal, OAuth, installer, network retries, production ownership queries, Windows build, anti-cheat or anti-duplication proof.
- `approveServerFaultGrace(verified=true)` is strictly a test fixture representing a preverified server event, not an API for players to request grace.
- `join({clientTime})` discards untrusted client time by design. The `now` argument is provided by the test harness as trusted clock; in real code the caller must never control server time.
- Mock Run-wide cargo is NOT a proven per-user item/shipment schema. Exact storage and attribution remain TECHNICAL_TBD.

## Blockers & next safe work for Claude

1. Locate the actual new Unity repository/project (if separate from `sd-center`). Identify exact engine version, `.sln/.asmdef`, Center installer/launcher, main process/session bridge; otherwise mark MISSING/BLOCKED.
2. Define Run authority and shipment owner ledger behind server-only authenticated APIs, with single serialization boundary and transaction/idempotency proof. Do not use this mock as real server code.
3. Map approved D1~D6, item identity, per-person state and G60's 60s/24h + conditional 24h grace onto a concrete DB schema after explicit technical review. Verify no overlap with old 72h local encounter recovery semantics.
4. Run real sandbox Core read/write with disposable accounts; inject ACK loss, replay, revoked device, JOIN-CLEANUP collision and delivery UNKNOWN; capture before/after authoritative ledger and legitimate asset invariants.
5. Build Unity game + Windows executable; attach real Center authentication/launch/update contracts only after source audit. Validate 100/125/150% DPI, installation, offline/recovery and actual user PC.
6. Report per test ID outcome and evidence row; open separate reviewable Draft PR(s). Never merge main, alter production DB, version/update manifest, or release while Critical/High blocked.

Grounding: Google Drive CURRENT INDEX (2026-10-26 D1~D6 USER_APPROVED), three Claude 2026-10-24 implementation handoff DRAFT docs supplemented 2026-10-26, QA `G60-CONTRACT-01~16` (TEST_NOT_RUN when handoff completed).
Evidence: `miner_unity_center_core_actual_code_audit_20261026`.
