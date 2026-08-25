\set ON_ERROR_STOP on

create or replace function pg_temp.assert_true(p_value boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if p_value is distinct from true then
    raise exception 'ASSERTION_FAILED: %', p_message;
  end if;
end;
$$;

create temp table economy_numbers(k text primary key, v numeric not null);
create temp table economy_ids(k text primary key, v uuid not null);

-- Final server constants and deterministic probability buckets.
select pg_temp.assert_true(private.sd_miner_cycle_ms()=5000,'cycle must remain 5000ms');
select pg_temp.assert_true(private.sd_miner_daily_claim_limit()=3600,'daily accepted-claim cap must be 3600');
select pg_temp.assert_true(private.sd_miner_ore_price('stone')=50,'stone price must be 50');
select pg_temp.assert_true(private.sd_miner_ore_price('copper')=200,'copper price must be 200');
select pg_temp.assert_true(private.sd_miner_ore_price('iron')=500,'iron price must be 500');
select pg_temp.assert_true(private.sd_miner_ore_price('emerald')=1500,'emerald price must be 1500');
select pg_temp.assert_true(private.sd_miner_ore_price('diamond')=4000,'diamond price must be 4000');

select pg_temp.assert_true(
  (select count(*) from generate_series(0,999) r where private.sd_miner_ore_from_roll(r)='stone')=476,
  'stone bucket must be exactly 47.6%');
select pg_temp.assert_true(
  (select count(*) from generate_series(0,999) r where private.sd_miner_ore_from_roll(r)='copper')=238,
  'copper bucket must be exactly 23.8%');
select pg_temp.assert_true(
  (select count(*) from generate_series(0,999) r where private.sd_miner_ore_from_roll(r)='iron')=143,
  'iron bucket must be exactly 14.3%');
select pg_temp.assert_true(
  (select count(*) from generate_series(0,999) r where private.sd_miner_ore_from_roll(r)='emerald')=95,
  'emerald bucket must be exactly 9.5%');
select pg_temp.assert_true(
  (select count(*) from generate_series(0,999) r where private.sd_miner_ore_from_roll(r)='diamond')=48,
  'diamond bucket must be exactly 4.8%');
select pg_temp.assert_true(private.sd_miner_ore_from_roll(-1) is null,'negative roll must fail closed');
select pg_temp.assert_true(private.sd_miner_ore_from_roll(1000) is null,'out-of-range roll must fail closed');

-- Economic envelope math is frozen in CI.
insert into economy_numbers(k,v) values
  ('ev_per_claim',0.476*50 + 0.238*200 + 0.143*500 + 0.095*1500 + 0.048*4000),
  ('expected_hourly',(3600000/5000.0)*(0.476*50 + 0.238*200 + 0.143*500 + 0.095*1500 + 0.048*4000)),
  ('expected_daily',3600*(0.476*50 + 0.238*200 + 0.143*500 + 0.095*1500 + 0.048*4000)),
  ('absolute_daily_max',3600*4000);
select pg_temp.assert_true((select v from economy_numbers where k='ev_per_claim')=477.4,'EV per claim must be 477.4');
select pg_temp.assert_true((select v from economy_numbers where k='expected_hourly')=343728,'perfect-cycle expected hourly must be 343728');
select pg_temp.assert_true((select v from economy_numbers where k='expected_daily')=1718640,'daily-cap expected value must be 1718640');
select pg_temp.assert_true((select v from economy_numbers where k='absolute_daily_max')=14400000,'all-diamond mathematical daily max must be 14400000');

-- Private economy writers/helpers remain unavailable to client roles.
select pg_temp.assert_true(
  not has_function_privilege('authenticated','private.sd_miner_ore_from_roll(integer)','EXECUTE')
  and not has_function_privilege('authenticated','private.sd_miner_ore_price(text)','EXECUTE')
  and not has_function_privilege('authenticated','private.enforce_sd_miner_daily_claim_v1()','EXECUTE'),
  'authenticated client must not execute private economy helpers');
select pg_temp.assert_true(
  not has_table_privilege('authenticated','public.sd_miner_accounts','UPDATE'),
  'authenticated client must not edit daily claim counters');
select pg_temp.assert_true(
  not has_table_privilege('authenticated','public.sd_user_item_balances','UPDATE'),
  'authenticated client must not edit shared item balances');

-- The migration must count already-claimed jobs from the current Asia/Seoul day.
select pg_temp.assert_true(
  (select daily_claims from public.sd_miner_accounts
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=2,
  'migration must preserve two pre-existing accepted claims from today');
select pg_temp.assert_true(
  (select daily_claim_day from public.sd_miner_accounts
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=private.sd_miner_economy_day(),
  'migration daily counter must use Asia/Seoul economy day');

set request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","session_id":"aaaaaaaa-0000-4000-8000-000000000001"}';
select public.record_sd_access_heartbeat(
  'miner-device-A','desktop','electron-test','Asia/Seoul','ko-KR','miner');
select public.sd_miner_v3_bind_device(
  'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

-- Public state must advertise the final economy without changing the shared-item authority.
select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )->>'economy_authority')='miner-economy-v1',
  'state must expose final economy authority');
select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )->>'inventory_authority')='sd-item-v1',
  'shared item authority must remain intact');
select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )->'config'->>'economy_stage')='final_ch4_4_v1',
  'config must no longer be provisional');
select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )->'config'->>'cycle_ms')::integer=5000,
  'state cycle must be 5000ms');
select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )->>'daily_claim_limit')::integer=3600,
  'state must expose daily cap');
select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )->>'daily_reset_timezone')='Asia/Seoul',
  'daily reset timezone must be explicit');
select pg_temp.assert_true(
  (select count(*) from pg_catalog.jsonb_array_elements(
     public.sd_miner_v3_get_state(
       'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
     )->'config'->'ores'
   ) e
   where (e->>'key', (e->>'price')::bigint) in (
     ('stone',50),('copper',200),('iron',500),('emerald',1500),('diamond',4000)
   ))=5,
  'state must expose all five final sale prices');

-- Existing legitimate achievement assets remain monotonic through the economy migration.
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

-- Bring the user to one claim below the daily cap. The next accepted claim is allowed once.
update public.sd_miner_accounts
set daily_claim_day=private.sd_miner_economy_day(), daily_claims=3599
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into economy_numbers(k,v)
select 'items_before_cap_claim',coalesce(sum(quantity),0)
from public.sd_user_item_balances
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into economy_numbers(k,v)
select 'total_mined_before_cap_claim',total_mined
from public.sd_miner_accounts
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

insert into economy_ids(k,v)
select 'cap_job',(public.sd_miner_v3_start(
  '71000000-0000-4000-8000-000000000001','miner-device-A',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','surface'
)->>'job_id')::uuid;
update public.sd_miner_jobs
set started_at=pg_catalog.clock_timestamp()-interval '2 seconds',
    ready_at=pg_catalog.clock_timestamp()-interval '1 second'
where job_id=(select v from economy_ids where k='cap_job');

select public.sd_miner_v3_claim(
  '72000000-0000-4000-8000-000000000001',
  (select v from economy_ids where k='cap_job'),
  'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
select pg_temp.assert_true(
  (select daily_claims from public.sd_miner_accounts
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=3600,
  'the 3600th accepted claim must be counted exactly once');
select pg_temp.assert_true(
  (select total_mined from public.sd_miner_accounts
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=
  (select v+1 from economy_numbers where k='total_mined_before_cap_claim'),
  'accepted cap-edge claim must increment total_mined once');
select pg_temp.assert_true(
  (select coalesce(sum(quantity),0) from public.sd_user_item_balances
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaaaaaa') is null,
  'unreachable guard');
