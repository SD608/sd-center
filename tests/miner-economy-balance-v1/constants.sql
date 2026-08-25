\set ON_ERROR_STOP on

create or replace function pg_temp.assert_true(p_value boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_value is distinct from true then
    raise exception 'ASSERTION_FAILED: %', p_message;
  end if;
end;
$$;

select pg_temp.assert_true(private.sd_miner_cycle_ms()=5000,'cycle must be 5000ms');
select pg_temp.assert_true(private.sd_miner_daily_claim_limit()=3600,'daily claim cap must be 3600');
select pg_temp.assert_true(private.sd_miner_ore_price('stone')=50,'stone price must be 50');
select pg_temp.assert_true(private.sd_miner_ore_price('copper')=200,'copper price must be 200');
select pg_temp.assert_true(private.sd_miner_ore_price('iron')=500,'iron price must be 500');
select pg_temp.assert_true(private.sd_miner_ore_price('emerald')=1500,'emerald price must be 1500');
select pg_temp.assert_true(private.sd_miner_ore_price('diamond')=4000,'diamond price must be 4000');

select pg_temp.assert_true(
  (select count(*) from generate_series(0,999) r where private.sd_miner_ore_from_roll(r)='stone')=476,
  'stone probability bucket must be 476/1000');
select pg_temp.assert_true(
  (select count(*) from generate_series(0,999) r where private.sd_miner_ore_from_roll(r)='copper')=238,
  'copper probability bucket must be 238/1000');
select pg_temp.assert_true(
  (select count(*) from generate_series(0,999) r where private.sd_miner_ore_from_roll(r)='iron')=143,
  'iron probability bucket must be 143/1000');
select pg_temp.assert_true(
  (select count(*) from generate_series(0,999) r where private.sd_miner_ore_from_roll(r)='emerald')=95,
  'emerald probability bucket must be 95/1000');
select pg_temp.assert_true(
  (select count(*) from generate_series(0,999) r where private.sd_miner_ore_from_roll(r)='diamond')=48,
  'diamond probability bucket must be 48/1000');
select pg_temp.assert_true(private.sd_miner_ore_from_roll(-1) is null,'negative roll must fail closed');
select pg_temp.assert_true(private.sd_miner_ore_from_roll(1000) is null,'roll 1000 must fail closed');

select pg_temp.assert_true(
  (0.476*50 + 0.238*200 + 0.143*500 + 0.095*1500 + 0.048*4000)=477.4,
  'expected value per claim must be 477.4');
select pg_temp.assert_true(
  (3600000/5000.0)*(0.476*50 + 0.238*200 + 0.143*500 + 0.095*1500 + 0.048*4000)=343728,
  'perfect-cycle expected hourly value must be 343728');
select pg_temp.assert_true(
  3600*(0.476*50 + 0.238*200 + 0.143*500 + 0.095*1500 + 0.048*4000)=1718640,
  'daily-cap expected value must be 1718640');
select pg_temp.assert_true(3600*4000=14400000,'absolute all-diamond daily maximum must be 14400000');

select pg_temp.assert_true(
  not has_function_privilege('authenticated','private.sd_miner_ore_from_roll(integer)','EXECUTE')
  and not has_function_privilege('authenticated','private.sd_miner_ore_price(text)','EXECUTE')
  and not has_function_privilege('authenticated','private.enforce_sd_miner_daily_claim_v1()','EXECUTE'),
  'client must not execute private economy helpers');
select pg_temp.assert_true(
  not has_table_privilege('authenticated','public.sd_miner_accounts','UPDATE'),
  'client must not edit miner counters');
select pg_temp.assert_true(
  not has_table_privilege('authenticated','public.sd_user_item_balances','UPDATE'),
  'client must not edit shared item balances');

-- Workflow seeds two accepted jobs before applying Chapter 4-4.
select pg_temp.assert_true(
  (select daily_claims from public.sd_miner_accounts
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=2,
  'migration must preserve two already-accepted claims from today');
select pg_temp.assert_true(
  (select daily_claim_day from public.sd_miner_accounts
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=private.sd_miner_economy_day(),
  'daily usage must be keyed to Asia/Seoul economy day');

set request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","session_id":"aaaaaaaa-0000-4000-8000-000000000001"}';
select public.record_sd_access_heartbeat(
  'miner-device-A','desktop','electron-test','Asia/Seoul','ko-KR','miner');
select public.sd_miner_v3_bind_device(
  'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )->>'economy_authority')='miner-economy-v1',
  'state must expose miner-economy-v1 authority');
select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )->>'inventory_authority')='sd-item-v1',
  'shared item authority must remain sd-item-v1');
select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )->'config'->>'economy_stage')='final_ch4_4_v1',
  'economy stage must be final_ch4_4_v1');
select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )->'config'->>'cycle_ms')::integer=5000,
  'state cycle must be 5000ms');
select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )->>'daily_claim_limit')::integer=3600,
  'state must expose 3600 daily cap');
select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )->>'daily_claims_used')::integer=2,
  'state must expose migrated daily usage');
select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )->>'daily_reset_timezone')='Asia/Seoul',
  'state must expose Asia/Seoul reset timezone');

select pg_temp.assert_true(
  (select count(*)
   from pg_catalog.jsonb_array_elements(
     public.sd_miner_v3_get_state(
       'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
     )->'config'->'ores'
   ) e
   where (e->>'key'='stone' and (e->>'price')::bigint=50)
      or (e->>'key'='copper' and (e->>'price')::bigint=200)
      or (e->>'key'='iron' and (e->>'price')::bigint=500)
      or (e->>'key'='emerald' and (e->>'price')::bigint=1500)
      or (e->>'key'='diamond' and (e->>'price')::bigint=4000))=5,
  'state must expose all five final prices');

select pg_temp.assert_true(
  (select current_value from public.sd_achievement_progress
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='miner-01')=86,
  'legacy miner-01 progress must remain 86');
select pg_temp.assert_true(
  (select unlocked from public.sd_achievement_progress
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='miner-06'),
  'legacy miner-06 unlock must remain');
select pg_temp.assert_true(
  (select current_value from public.sd_achievement_progress
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='miner-08')=5,
  'legacy miner-08 progress must remain 5');

select 'miner-economy constants PASS' as result;
