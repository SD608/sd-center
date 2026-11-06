-- Isolated read-only RPC test, never call against production.
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$
DECLARE s jsonb; snap jsonb; 
BEGIN
 SELECT public.sd_bitcoin_get_state() INTO s;
 SELECT public.get_sd_bitcoin_snapshot() INTO snap;
 IF (s->>'btc_balance')::numeric <> 126.85000000
    OR (snap->>'btc_quantity')::numeric <> 126.85000000 THEN
   RAISE EXCEPTION 'legacy verified BTC balance changed';
 END IF;
 IF jsonb_array_length(s->'rooms') <> 1 THEN
   RAISE EXCEPTION 'existing verified room lost';
 END IF;
 IF (SELECT count(*) FROM public.sd_bitcoin_accounts) <> 1 THEN
   RAISE EXCEPTION 'read created an extra account';
 END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
DO $$
DECLARE blocked boolean := false;
BEGIN
 BEGIN
   PERFORM public.sd_bitcoin_get_state();
 EXCEPTION WHEN sqlstate 'P1032' THEN blocked := true;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'unknown account getter did not fail closed'; END IF;
 blocked := false;
 BEGIN
   PERFORM public.get_sd_bitcoin_snapshot();
 EXCEPTION WHEN sqlstate 'P1032' THEN blocked := true;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'unknown account snapshot did not fail closed'; END IF;
 IF (SELECT count(*) FROM public.sd_bitcoin_accounts) <> 1 OR
    (SELECT count(*) FROM public.sd_bitcoin_rooms) <> 1 THEN
   RAISE EXCEPTION 'read-only getters created a new account/room';
 END IF;
END $$;
SELECT 'PASS: existing records available, no new account/room created by reads' result;
