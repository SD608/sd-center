# SD Core common RPC authority review — 2026-11-06

Status: DRAFT — source audit; not a deployment or live permission penetration test.

## Verified source boundaries

- Client wallet `public.sd_core_apply_wallet_event` is SECURITY INVOKER and delegates to `sd_core_private.apply_client_wallet_event_impl`; new client rewards raise `P1030 REWARD_CAPABILITY_REQUIRED`. See `database/migrations/sd_core_reward_authority_v1.sql`.
- Trusted settlement helper `sd_core_private.apply_server_wallet_delta_impl` is SECURITY DEFINER with `set search_path=''` and explicit EXECUTE revocations for PUBLIC, anon and authenticated. See `database/migrations/sd_core_server_wallet_delta_v1.sql`. PR #97 extends idempotency checks, but is still Draft/unmerged.
- Legacy logistics public RPC `apply_sd_logistics_wallet_event` executes as SECURITY DEFINER but derives `auth.uid()`; positive *new* events fail P1030, and spends require fixed server-known prices. Repeated historical positive credits are duplicate-only. See `database/migrations/sd_logistics_reward_authority_v1.sql` and later release route file.
- Admin wallet `admin_credit_sd_wallet` and `admin_debit_sd_wallet` are SECURITY DEFINER and check `auth.uid()` against active admin status before settlement. This static check does NOT validate revoked admin device/session enforcement. See `sql/release-gate/20260821092200_sd_release_admin_wallet_core_route_v1.sql`.
- The earlier `sd_season0_ranking_authority_v1.sql` is historical and may be overridden by season-transition migrations. Do not treat it as the deployed current contract without checking effective DB definitions.

## Audit findings / validation gaps

1. Supabase Security Advisor previously reported **84 authenticated-callable SECURITY DEFINER functions across SD-Core-Dev**. The count is advisory scope, not proof of 84 exploitable vulnerabilities. Each privileged public function needs effective body, GRANT, session/device/admin ownership, concurrency and negative-request review.
2. Earlier DEV read-only check confirmed RLS enabled on 6 Core tables, but **individual effective RPC grants and policies remain NOT VERIFIED**.
3. Actual DEV database connector is currently BLOCKED (`link_id must identify an eligible linked account`). No further live SQL or migration was executed. Restore an eligible Supabase connection to continue.
4. JWT positive login, revoked-device/revoked-session, real concurrent wallet mutation and rollbacks, original PC migration preservation, and Windows/Core integration remain NOT_RUN.
5. Existing CI on PR #97 is *isolated PostgreSQL 17* success, not live DEV/production validation. PR #96 static docs guard also remains Draft.

## Source-only regression guard

The adjacent Node test verifies narrow invariant signatures in main-source migration files. **Passing cannot establish actual runtime privileges, deploy order, newer replacements, live RLS or account ownership.**

## Required later release gates

- Reconnect/read SD-Core-Dev; inventory all current effective PUBLIC/anon/authenticated RPC EXECUTE grants and any security-definer functions in exposed schemas.
- Review privileged RPC *effective bodies* and run signed-in ordinary user, revoked admin session/device, inactive profile, forged reward, cross-account and replay tests on isolated DEV fixtures with full cleanup.
- Validate PR #97 additive migration with existing historical event rows in DEV, compare before/after wallet and ledger hashes/counters; do NOT touch production, assets, or main without separate approval.
- Perform actual JWT, concurrency/rollback and extension integration tests, then a separate Release Gate review.
- Unknown API scope, economic rules and 5–7막 production contracts remain TBD pending canon/approval.
