\set ON_ERROR_STOP on
-- Must execute only on a disposable PostgreSQL 17 instance.
DO $qa$
DECLARE
 r uuid:='00000000-0000-0000-0000-000000000001';
 a uuid:='00000000-0000-0000-0000-0000000000a1';
 b uuid:='00000000-0000-0000-0000-0000000000b2';
 rv jsonb; n bigint;
BEGIN
 IF has_schema_privilege('miner_a_client_qa','miner_a_sandbox','USAGE') THEN
  RAISE EXCEPTION 'UNTRUSTED_SCHEMA_VISIBLE'; END IF;
 IF has_function_privilege('miner_a_client_qa','miner_a_sandbox.trusted_settle(uuid,uuid,uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'UNTRUSTED_SETTLE_EXEC'; END IF;
 IF has_function_privilege('miner_a_client_qa','miner_a_sandbox.trusted_claim(uuid,uuid,uuid,uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'UNTRUSTED_CLAIM_EXEC'; END IF;
 IF has_table_privilege('miner_a_engine_qa','miner_a_sandbox.balances','UPDATE') THEN
  RAISE EXCEPTION 'ENGINE_CAN_DIRECTLY_UPDATE_BALANCE'; END IF;
 IF NOT has_function_privilege('miner_a_engine_qa','miner_a_sandbox.trusted_settle(uuid,uuid,uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'ENGINE_FUNCTION_GRANT_MISSING'; END IF;
 IF miner_a_sandbox.trial_coins(29)<>0 OR miner_a_sandbox.trial_coins(30)<>1
 OR miner_a_sandbox.trial_coins(59)<>1 OR miner_a_sandbox.trial_coins(60)<>2
 OR miner_a_sandbox.trial_coins(99)<>2 OR miner_a_sandbox.trial_coins(100)<>3
 OR miner_a_sandbox.trial_coins(149)<>3 OR miner_a_sandbox.trial_coins(150)<>4
 OR miner_a_sandbox.trial_coins(209)<>4 OR miner_a_sandbox.trial_coins(210)<>5
 OR miner_a_sandbox.trial_coins(279)<>5 OR miner_a_sandbox.trial_coins(280)<>6
 OR miner_a_sandbox.trial_coins(359)<>6 OR miner_a_sandbox.trial_coins(360)<>7
 OR miner_a_sandbox.trial_coins(449)<>7 OR miner_a_sandbox.trial_coins(450)<>8
 OR miner_a_sandbox.trial_coins(999999)<>8 THEN RAISE EXCEPTION 'THRESHOLD_ERROR'; END IF;
 INSERT INTO miner_a_sandbox.runs VALUES(r,'ACTIVE');
 INSERT INTO miner_a_sandbox.players(run_id,player_id) VALUES(r,a),(r,b);
 INSERT INTO miner_a_sandbox.sources(run_id,source_id,class_id,quantity) VALUES
 (r,'00000000-0000-0000-0000-000000000101','ore1',60),
 (r,'00000000-0000-0000-0000-000000000102','ore1',450),
 (r,'00000000-0000-0000-0000-000000000103','story_core',1);
 SELECT miner_a_sandbox.trusted_claim(r,a,'00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000101') INTO rv;
 IF (rv->>'replay')::boolean THEN RAISE EXCEPTION 'FIRST_CLAIM_REPLAY'; END IF;
 SELECT miner_a_sandbox.trusted_claim(r,a,'00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000101') INTO rv;
 IF NOT (rv->>'replay')::boolean THEN RAISE EXCEPTION 'CLAIM_RETRY_NOT_IDEMPOTENT'; END IF;
 BEGIN
  PERFORM miner_a_sandbox.trusted_claim(r,b,'00000000-0000-0000-0000-000000000202',
  '00000000-0000-0000-0000-000000000101');
  RAISE EXCEPTION 'TEST_DID_NOT_FAIL';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'SOURCE_USED_OR_MISSING' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM miner_a_sandbox.trusted_claim(r,a,'00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000102');
  RAISE EXCEPTION 'TEST_DID_NOT_FAIL';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'EVENT_ID_CONFLICT' THEN RAISE; END IF;
 END;
 SELECT miner_a_sandbox.trusted_ship(r,a,'00000000-0000-0000-0000-000000000301',
 '00000000-0000-0000-0000-000000000201',30) INTO rv;
 IF (rv->>'replay')::boolean THEN RAISE EXCEPTION 'FIRST_SHIP_REPLAY'; END IF;
 SELECT miner_a_sandbox.trusted_ship(r,a,'00000000-0000-0000-0000-000000000301',
 '00000000-0000-0000-0000-000000000201',30) INTO rv;
 IF NOT (rv->>'replay')::boolean THEN RAISE EXCEPTION 'SHIP_RETRY_NOT_IDEMPOTENT'; END IF;
 BEGIN
  PERFORM miner_a_sandbox.trusted_ship(r,b,'00000000-0000-0000-0000-000000000302',
  '00000000-0000-0000-0000-000000000201',1);
  RAISE EXCEPTION 'TEST_DID_NOT_FAIL';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'NOT_OWNER_OR_INSUFFICIENT' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM miner_a_sandbox.trusted_ship(r,a,'00000000-0000-0000-0000-000000000303',
  '00000000-0000-0000-0000-000000000201',31);
  RAISE EXCEPTION 'TEST_DID_NOT_FAIL';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'NOT_OWNER_OR_INSUFFICIENT' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM miner_a_sandbox.trusted_ship(r,a,'00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000201',29);
  RAISE EXCEPTION 'TEST_DID_NOT_FAIL';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'SHIPMENT_EVENT_CONFLICT' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM miner_a_sandbox.trusted_settle(r,a,'00000000-0000-0000-0000-000000000401');
  RAISE EXCEPTION 'TEST_DID_NOT_FAIL';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'SERVER_EXIT_AND_SHIPPING_REQUIRED' THEN RAISE; END IF;
 END;
 UPDATE miner_a_sandbox.players SET exit_verified=true,shipping_known=false
 WHERE run_id=r AND player_id=a;
 BEGIN
  PERFORM miner_a_sandbox.trusted_settle(r,a,'00000000-0000-0000-0000-000000000401');
  RAISE EXCEPTION 'TEST_DID_NOT_FAIL';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'SERVER_EXIT_AND_SHIPPING_REQUIRED' THEN RAISE; END IF;
 END;
 UPDATE miner_a_sandbox.players SET shipping_known=true WHERE run_id=r AND player_id=a;
 SELECT miner_a_sandbox.trusted_settle(r,a,'00000000-0000-0000-0000-000000000401') INTO rv;
 IF (rv->>'score')::bigint<>30 OR (rv->>'coins')::integer<>1 THEN
   RAISE EXCEPTION 'SHIPMENT_EXCLUSION_WRONG %',rv; END IF;
 SELECT miner_a_sandbox.trusted_settle(r,a,'00000000-0000-0000-0000-000000000401') INTO rv;
 IF NOT (rv->>'replay')::boolean THEN RAISE EXCEPTION 'RETURN_REPLAY_WRONG'; END IF;
 BEGIN
  PERFORM miner_a_sandbox.trusted_settle(r,a,'00000000-0000-0000-0000-000000000402');
  RAISE EXCEPTION 'TEST_DID_NOT_FAIL';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'SECOND_RETURN_DENIED' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM miner_a_sandbox.trusted_claim(r,a,'00000000-0000-0000-0000-000000000203',
  '00000000-0000-0000-0000-000000000102');
  RAISE EXCEPTION 'TEST_DID_NOT_FAIL';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'PLAYER_NOT_ACTIVE' THEN RAISE; END IF;
 END;
 PERFORM miner_a_sandbox.trusted_claim(r,b,'00000000-0000-0000-0000-000000000204',
 '00000000-0000-0000-0000-000000000102');
 PERFORM miner_a_sandbox.trusted_claim(r,b,'00000000-0000-0000-0000-000000000205',
 '00000000-0000-0000-0000-000000000103');
 UPDATE miner_a_sandbox.players SET exit_verified=true WHERE run_id=r AND player_id=b;
 SELECT miner_a_sandbox.trusted_settle(r,b,'00000000-0000-0000-0000-000000000403') INTO rv;
 IF (rv->>'score')::bigint<>450 OR (rv->>'coins')::integer<>8 THEN
  RAISE EXCEPTION 'SECOND_PLAYER_AND_STORY_SCORE_WRONG %',rv; END IF;
 SELECT count(*) INTO n FROM miner_a_sandbox.ledger WHERE run_id=r;
 IF n<>2 THEN RAISE EXCEPTION 'LEDGER_COUNT_WRONG %',n; END IF;
 SELECT test_coins INTO n FROM miner_a_sandbox.balances WHERE player_id=a;
 IF n<>1 THEN RAISE EXCEPTION 'PLAYER_A_WALLET_WRONG %',n; END IF;
 SELECT test_coins INTO n FROM miner_a_sandbox.balances WHERE player_id=b;
 IF n<>8 THEN RAISE EXCEPTION 'PLAYER_B_WALLET_WRONG %',n; END IF;
 RAISE NOTICE 'DISPOSABLE_PG17_SANDBOX_CONTRACT_PASS / NOT_PRODUCTION';
END $qa$;
