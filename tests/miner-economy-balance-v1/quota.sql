\set ON_ERROR_STOP on

create or replace function pg_temp.assert_true(p_value boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_value is distinct from true then
    raise exception 'ASSERTION_FAILED: %', p_message;
  end if;
end;
$$;

create temp table quota_numbers(k text primary key, v bigint not null);
create temp table quota_ids(k text primary key, v uuid not null);

set request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","session_id":"aaaaaaaa-0000-4000-8000-000000000001"}';
select public.record_sd_access_heartbeat(
  'miner-device-A','desktop','electron-test','Asia/Seoul','ko-KR','miner');
select public.sd_miner_v3_bind_device(
  'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

-- Put the account one accepted claim below the cap.
update public.sd_miner_accounts
set daily_claim_day=private.sd_miner_economy_day(), daily_claims=3599
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

insert into quota_numbers(k,v)
select 'items_before',coalesce(sum(quantity),0)
from public.sd_user_item_balances
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into quota_numbers(k,v)
select 'mined_before',total_mined
from public.sd_miner_accounts
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

insert into quota_ids(k,v)
select 'cap_job',(public.sd_miner_v3_start(
  '71000000-0000-4000-8000-000000000001','miner-device-A',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','surface'
)->>'job_id')::uuid;

update public.sd_miner_jobs
set started_at=pg_catalog.clock_timestamp()-interval '2 seconds',
    ready_at=pg_catalog.clock_timestamp()-interval '1 second'
where job_id=(select v from quota_ids where k='cap_job');

select public.sd_miner_v3_claim(
  '72000000-0000-4000-8000-000000000001',
  (select v from quota_ids where k='cap_job'),
  'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

select pg_temp.assert_true(
  (select daily_claims from public.sd_miner_accounts
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=3600,
  '3600th claim must be accepted and counted once');
select pg_temp.assert_true(
  (select total_mined from public.sd_miner_accounts
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=
  (select v+1 from quota_numbers where k='mined_before'),
  '3600th claim must increment total_mined once');
select pg_temp.assert_true(
  (select coalesce(sum(quantity),0) from public.sd_user_item_balances
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=
  (select v+1 from quota_numbers where k='items_before'),
  '3600th claim must create exactly one item');
select pg_temp.assert_true(
  (select count(*) from public.sd_item_events
   where event_id='72000000-0000-4000-8000-000000000001')=1,
  '3600th claim must journal exactly one item event');

-- Lost-response retry must replay without consuming quota or inventory again.
select public.sd_miner_v3_claim(
  '72000000-0000-4000-8000-000000000001',
  (select v from quota_ids where k='cap_job'),
  'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
select pg_temp.assert_true(
  (select daily_claims from public.sd_miner_accounts
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=3600,
  'claim replay must not consume a second daily slot');
select pg_temp.assert_true(
  (select coalesce(sum(quantity),0) from public.sd_user_item_balances
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=
  (select v+1 from quota_numbers where k='items_before'),
  'claim replay must not duplicate inventory');

-- A new job cannot be started once the daily cap is exhausted.
do $$
begin
  perform public.sd_miner_v3_start(
    '71000000-0000-4000-8000-000000000002','miner-device-A',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','surface');
  raise exception 'expected MINER_DAILY_CLAIM_LIMIT';
exception when sqlstate 'P1064' then null;
end;
$$;
select pg_temp.assert_true(
  (select count(*) from public.sd_miner_jobs
   where start_request_id='71000000-0000-4000-8000-000000000002')=0,
  'blocked post-cap start must leave no job');
select pg_temp.assert_true(
  (select count(*) from public.sd_miner_actions
   where request_id='71000000-0000-4000-8000-000000000002')=0,
  'blocked post-cap start must leave no idempotency residue');

-- Device revocation still wins before any economy action.
update public.sd_access_devices
set revoked_at=now()
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and device_key='miner-device-A';
do $$
begin
  perform public.sd_miner_v3_get_state(
    'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  raise exception 'expected DEVICE_REVOKED';
exception when sqlstate 'P1006' then null;
end;
$$;
update public.sd_access_devices
set revoked_at=null,last_seen_at=now()
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and device_key='miner-device-A';

-- A stale prior-day counter resets server-side on the next valid job start.
update public.sd_miner_accounts
set daily_claim_day=private.sd_miner_economy_day()-1, daily_claims=3600
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

insert into quota_ids(k,v)
select 'rollover_job',(public.sd_miner_v3_start(
  '71000000-0000-4000-8000-000000000003','miner-device-A',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','surface'
)->>'job_id')::uuid;

select pg_temp.assert_true(
  (select daily_claim_day from public.sd_miner_accounts
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=private.sd_miner_economy_day(),
  'new economy day must reset the date on first start');
select pg_temp.assert_true(
  (select daily_claims from public.sd_miner_accounts
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=0,
  'new economy day must reset accepted claims to zero before claim');

-- Merely becoming ready never creates background income.
insert into quota_numbers(k,v)
select 'items_before_ready',coalesce(sum(quantity),0)
from public.sd_user_item_balances
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.sd_miner_jobs
set started_at=pg_catalog.clock_timestamp()-interval '2 seconds',
    ready_at=pg_catalog.clock_timestamp()-interval '1 second'
where job_id=(select v from quota_ids where k='rollover_job');
select pg_temp.assert_true(
  (select coalesce(sum(quantity),0) from public.sd_user_item_balances
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=
  (select v from quota_numbers where k='items_before_ready'),
  'ready job must not create background inventory without claim');
select pg_temp.assert_true(
  (select daily_claims from public.sd_miner_accounts
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=0,
  'ready job must not consume daily quota without claim');

update public.sd_miner_jobs
set status='cancelled',updated_at=now()
where job_id=(select v from quota_ids where k='rollover_job');

select pg_temp.assert_true(
  (select count(*) from public.sd_miner_jobs
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and status='active')=0,
  'quota regression must leave no active job');

select pg_temp.assert_true(
  (select current_value from public.sd_achievement_progress
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='miner-01')=86,
  'legacy miner-01 progress must remain monotonic after new claim');
select pg_temp.assert_true(
  (select unlocked from public.sd_achievement_progress
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='miner-06'),
  'legacy miner-06 unlock must remain after new claim');
select pg_temp.assert_true(
  (select current_value from public.sd_achievement_progress
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='miner-08')=5,
  'legacy miner-08 progress must remain monotonic after new claim');

select 'miner-economy daily quota PASS' as result;
