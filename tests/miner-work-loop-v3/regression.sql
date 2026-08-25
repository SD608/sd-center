\set ON_ERROR_STOP on

create or replace function pg_temp.assert_true(p_value boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_value is distinct from true then
    raise exception 'ASSERTION_FAILED: %', p_message;
  end if;
end;
$$;

create temp table miner_test_context(k text primary key, v uuid not null);

select pg_temp.assert_true(
  has_function_privilege('authenticated','public.sd_miner_v3_start(uuid,text,text,text)','EXECUTE'),
  'authenticated must execute v3 start');
select pg_temp.assert_true(
  not has_function_privilege('anon','public.sd_miner_v3_start(uuid,text,text,text)','EXECUTE'),
  'anon must not execute v3 start');
select pg_temp.assert_true(
  not has_function_privilege('anon','public.sd_miner_v3_sell(text,bigint,uuid,text,text)','EXECUTE'),
  'anon must not execute v3 sell');

set request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","session_id":"aaaaaaaa-0000-4000-8000-000000000001"}';

select public.record_sd_access_heartbeat(
  'miner-device-A','desktop','electron-test','Asia/Seoul','ko-KR','miner');
select public.sd_miner_v3_bind_device(
  'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

select pg_temp.assert_true(exists(
  select 1
  from public.sd_miner_device_bindings b
  join public.sd_access_devices d on d.id=b.access_device_id
  where b.user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and d.device_key='miner-device-A'
    and d.bound_session_id='aaaaaaaa-0000-4000-8000-000000000001'
    and d.revoked_at is null
), 'miner capability must bind to owned live-session device');

select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )->>'legacy_auto_mining_owned')::boolean,
  'legacy auto-mining ownership must be preserved');
select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )->'config'->>'cycle_ms')::integer=5000,
  'server cycle must be 5000ms');
select pg_temp.assert_true(
  (select current_value from public.sd_achievement_progress
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='miner-01')=86,
  'legacy miner-01 progress must survive');
select pg_temp.assert_true(
  (select unlocked from public.sd_achievement_progress
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='miner-06'),
  'legacy miner-06 unlock must survive');

insert into miner_test_context(k,v)
select 'job1',(public.sd_miner_v3_start(
  '10000000-0000-4000-8000-000000000001','miner-device-A',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','surface'
)->>'job_id')::uuid;

select pg_temp.assert_true(
  (public.sd_miner_v3_start(
    '10000000-0000-4000-8000-000000000001','miner-device-A',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','surface'
  )->>'job_id')::uuid=(select v from miner_test_context where k='job1'),
  'start retry must replay same job');
select pg_temp.assert_true(
  (select count(*) from public.sd_miner_jobs
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and status='active')=1,
  'exactly one active job must exist');

do $$
begin
  perform public.sd_miner_v3_start(
    '10000000-0000-4000-8000-000000000002','miner-device-A',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','surface');
  raise exception 'expected MINER_JOB_ALREADY_ACTIVE';
exception when sqlstate 'P1054' then null;
end;$$;

do $$
begin
  perform public.sd_miner_v3_claim(
    '20000000-0000-4000-8000-000000000001',
    (select v from pg_temp.miner_test_context where k='job1'),
    'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  raise exception 'expected MINER_JOB_NOT_READY';
exception when sqlstate 'P1053' then null;
end;$$;
select pg_temp.assert_true(
  (select coalesce(sum(quantity),0) from public.sd_miner_inventory
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=0,
  'pending job must not create background inventory');

update public.sd_miner_jobs
set started_at=clock_timestamp()-interval '2 seconds',
    ready_at=clock_timestamp()-interval '1 second'
where job_id=(select v from miner_test_context where k='job1');

select public.sd_miner_v3_claim(
  '20000000-0000-4000-8000-000000000001',
  (select v from miner_test_context where k='job1'),
  'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
select pg_temp.assert_true(
  (select total_mined from public.sd_miner_accounts
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=1,
  'one accepted claim increments total_mined once');
select pg_temp.assert_true(
  (select coalesce(sum(quantity),0) from public.sd_miner_inventory
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=1,
  'one accepted claim adds one item');

select public.sd_miner_v3_claim(
  '20000000-0000-4000-8000-000000000001',
  (select v from miner_test_context where k='job1'),
  'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
select pg_temp.assert_true(
  (select total_mined from public.sd_miner_accounts
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=1,
  'claim retry must not duplicate mining');

do $$
begin
  perform public.sd_miner_v3_claim(
    '20000000-0000-4000-8000-000000000002',
    (select v from pg_temp.miner_test_context where k='job1'),
    'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  raise exception 'expected MINER_JOB_ALREADY_CLAIMED';
exception when sqlstate 'P1055' then null;
end;$$;

select pg_temp.assert_true(
  (select current_value from public.sd_achievement_progress
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='miner-01')=86,
  'miner-01 must not fall from 86 to server total 1');
select pg_temp.assert_true(
  (select unlocked from public.sd_achievement_progress
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='miner-06'),
  'miner-06 legacy unlock must remain');
select pg_temp.assert_true(
  (select current_value from public.sd_achievement_progress
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='miner-08')=5,
  'miner-08 legacy progress must remain');

do $$
begin
  perform public.sd_miner_v3_get_state(
    'miner-device-A','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  raise exception 'expected MINER_DEVICE_SECRET_MISMATCH';
exception when sqlstate 'P1009' then null;
end;$$;

update public.sd_access_devices set revoked_at=now()
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and device_key='miner-device-A';
do $$
begin
  perform public.sd_miner_v3_get_state(
    'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  raise exception 'expected DEVICE_REVOKED';
exception when sqlstate 'P1006' then null;
end;$$;
update public.sd_access_devices set revoked_at=null,last_seen_at=now()
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and device_key='miner-device-A';

delete from auth.sessions where id='aaaaaaaa-0000-4000-8000-000000000001';
do $$
begin
  perform public.sd_miner_v3_get_state(
    'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  raise exception 'expected SESSION_REVOKED';
exception when sqlstate 'P1008' then null;
end;$$;
insert into auth.sessions(id,user_id,not_after) values(
  'aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now()+interval '1 day');
select public.record_sd_access_heartbeat(
  'miner-device-A','desktop','electron-test','Asia/Seoul','ko-KR','miner');

update public.sd_access_devices set last_seen_at=now()-interval '11 minutes'
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and device_key='miner-device-A';
do $$
begin
  perform public.sd_miner_v3_get_state(
    'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  raise exception 'expected DEVICE_INACTIVE';
exception when sqlstate 'P1004' then null;
end;$$;
select public.record_sd_access_heartbeat(
  'miner-device-A','desktop','electron-test','Asia/Seoul','ko-KR','miner');

set request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","session_id":"bbbbbbbb-0000-4000-8000-000000000001"}';
do $$
begin
  perform public.sd_miner_v3_bind_device(
    'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  raise exception 'expected DEVICE_NOT_FOUND';
exception when sqlstate 'P1003' then null;
end;$$;

insert into public.sd_access_devices(user_id,device_key,platform,last_seen_at,bound_session_id)
values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','miner-device-C','desktop',now(),
       'cccccccc-0000-4000-8000-000000000001');
set request.jwt.claims = '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","session_id":"cccccccc-0000-4000-8000-000000000001"}';
do $$
begin
  perform public.sd_miner_v3_bind_device(
    'miner-device-C','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc');
  raise exception 'expected ACCOUNT_INACTIVE';
exception when sqlstate 'P1002' then null;
end;$$;

set request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","session_id":"aaaaaaaa-0000-4000-8000-000000000001"}';
select public.record_sd_access_heartbeat(
  'miner-device-A','desktop','electron-test','Asia/Seoul','ko-KR','miner');

update public.sd_miner_inventory
set quantity=quantity+10,acquired_count=acquired_count+10
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and ore_key='stone';

select public.sd_miner_v3_sell(
  'stone',3,'30000000-0000-4000-8000-000000000001','miner-device-A',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
select pg_temp.assert_true(
  (select balance from public.wallets where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=10000300,
  'first sale must credit 300 through Core');
select pg_temp.assert_true(
  (select count(*) from public.transactions
   where request_id='30000000-0000-4000-8000-000000000001')=1,
  'Core sale transaction must exist once');

select public.sd_miner_v3_sell(
  'stone',3,'30000000-0000-4000-8000-000000000001','miner-device-A',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
select pg_temp.assert_true(
  (select balance from public.wallets where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=10000300,
  'sale retry must not duplicate credit');
select pg_temp.assert_true(
  (select count(*) from public.transactions
   where request_id='30000000-0000-4000-8000-000000000001')=1,
  'sale retry must not duplicate transaction');

do $$
begin
  perform public.sd_miner_v3_sell(
    'stone',4,'30000000-0000-4000-8000-000000000001','miner-device-A',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  raise exception 'expected MINER_REQUEST_IDEMPOTENCY_CONFLICT';
exception when sqlstate 'P1015' then null;
end;$$;

do $$
begin
  perform public.sd_miner_mine('40000000-0000-4000-8000-000000000001');
  raise exception 'expected MINER_V3_REQUIRED';
exception when sqlstate 'P1059' then null;
end;$$;
do $$
begin
  perform public.sd_miner_buy_auto_mining('40000000-0000-4000-8000-000000000002');
  raise exception 'expected MINER_AUTO_REDESIGN_PENDING';
exception when sqlstate 'P1058' then null;
end;$$;
select pg_temp.assert_true(
  (select count(*) from public.sd_miner_actions where action_type='mine')=0,
  'legacy mine action must not execute');

insert into miner_test_context(k,v)
select 'job2',(public.sd_miner_v3_start(
  '50000000-0000-4000-8000-000000000001','miner-device-A',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','surface'
)->>'job_id')::uuid;
update public.sd_miner_jobs
set started_at=clock_timestamp()-interval '2 seconds',
    ready_at=clock_timestamp()-interval '1 second'
where job_id=(select v from miner_test_context where k='job2');
select pg_temp.assert_true(
  (select status from public.sd_miner_jobs
   where job_id=(select v from miner_test_context where k='job2'))='active',
  'ready job must stay pending, not auto-repeat');
select pg_temp.assert_true(
  (select count(*) from public.sd_miner_jobs
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and status='active')=1,
  'background queue must stay capped at one');
do $$
begin
  perform public.sd_miner_v3_start(
    '50000000-0000-4000-8000-000000000002','miner-device-A',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','surface');
  raise exception 'expected MINER_JOB_ALREADY_ACTIVE';
exception when sqlstate 'P1054' then null;
end;$$;

select 'miner-work-loop-v3 regression PASS' as result;
