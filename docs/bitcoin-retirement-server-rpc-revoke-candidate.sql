-- REVIEW ONLY: NOT APPLIED to production. Requires economic asset-preservation
-- audit and release gate before operator-controlled execution.
-- Narrow deny: new BTC mining/purchases/sales/offline snapshot writes only.
-- Existing balances, transactions, rooms, frames, GPUs, titles and achievements remain untouched.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.sd_bitcoin_tick(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sd_bitcoin_buy_room(text,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sd_bitcoin_buy_frame(text,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sd_bitcoin_buy_gpu(text,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sd_bitcoin_sell(numeric,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sd_bitcoin_reactivate_electricity(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.upsert_sd_bitcoin_snapshot(text,numeric,text,timestamptz)
  FROM PUBLIC, anon, authenticated;
COMMIT;
-- Read-only functions sd_bitcoin_get_state(), get_sd_bitcoin_snapshot()
-- stay callable to support legacy history and verification.
-- CAUTION: inspect push_sd_link_transaction legacy Bitcoin metadata flow
-- separately: do NOT revoke all SD Link writes (other apps depend on them).
-- Recheck ACL, all other Bitcoin write paths, user asset snapshots, and
-- old-client ECONOMY E2E before declaring this server shutoff complete.
