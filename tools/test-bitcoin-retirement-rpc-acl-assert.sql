-- ISOLATED CI VERIFICATION AFTER CANDIDATE REVOCATION (NO PRODUCTION WRITE).
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM (VALUES
 ('public.sd_bitcoin_tick(uuid)'),
 ('public.sd_bitcoin_buy_room(text,uuid)'),
 ('public.sd_bitcoin_buy_frame(text,uuid)'),
 ('public.sd_bitcoin_buy_gpu(text,uuid)'),
 ('public.sd_bitcoin_sell(numeric,uuid)'),
 ('public.sd_bitcoin_reactivate_electricity(uuid)'),
 ('public.upsert_sd_bitcoin_snapshot(text,numeric,text,timestamptz)')
 ) functions(signature)
 WHERE has_function_privilege('authenticated',signature,'EXECUTE')
    OR has_function_privilege('anon',signature,'EXECUTE');
 IF n<>0 THEN RAISE EXCEPTION 'BTC economic write RPC remains accessible count=%',n; END IF;
 IF NOT has_function_privilege('authenticated','public.sd_bitcoin_get_state()','EXECUTE')
   OR NOT has_function_privilege('authenticated','public.get_sd_bitcoin_snapshot()','EXECUTE') THEN
   RAISE EXCEPTION 'read-only BTC history lost access';
 END IF;
 IF NOT has_function_privilege('authenticated','public.push_sd_link_transaction(text,text,text,text,bigint,timestamptz,jsonb)','EXECUTE') THEN
   RAISE EXCEPTION 'unrelated SD Link API permissions changed';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.qa_asset_probe WHERE id=1 AND btc=126.85000000 AND wallet=9000 AND gpu=75) THEN
   RAISE EXCEPTION 'fixture assets mutated by retirement SQL';
 END IF;
END $$;
SELECT 'PASS: BTC write access denied, readonly/SD Link rights and fixture assets preserved' result;
