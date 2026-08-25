\set ON_ERROR_STOP on

create or replace function pg_temp.assert_true(p_value boolean,p_message text)
returns void language plpgsql as $$
begin
  if p_value is distinct from true then
    raise exception 'ASSERTION_FAILED: %',p_message;
  end if;
end;
$$;

create temp table equipment_v2_numbers(k text primary key,v bigint not null);
create temp table equipment_v2_ids(k text primary key,v uuid not null);

-- Catalog and privilege contract.
select pg_temp.assert_true(
  (select count(*) from public.sd_miner_equipment_catalog)=10,
  'equipment catalog must contain exactly ten rows');
select pg_temp.assert_true(
  (select count(*) from public.sd_miner_equipment_catalog where slot_key='tool')=5
  and (select count(*) from public.sd_miner_equipment_catalog where slot_key='storage')=5,
  'equipment catalog must contain five tool and five storage levels');
select pg_temp.assert_true(
  (select string_agg(cycle_ms::text,',' order by level) from public.sd_miner_equipment_catalog where slot_key='tool')='5000,4600,4200,3800,3400',
  'tool server cycles must match v1 progression');
select pg_temp.assert_true(
  (select string_agg(storage_capacity::text,',' order by level) from public.sd_miner_equipment_catalog where slot_key='storage')='500,1000,2000,4000,8000',
  'storage capacities must match v1 progression');
select pg_temp.assert_true(
  not has_table_privilege('authenticated','public.sd_miner_equipment_catalog','INSERT')
  and not has_table_privilege('authenticated','public.sd_miner_equipment_catalog','UPDATE')
  and not has_table_privilege('authenticated','public.sd_miner_user_equipment','INSERT')
  and not has_table_privilege('authenticated','public.sd_miner_user_equipment','UPDATE'),
  'authenticated clients must not mutate equipment authority tables');
select pg_temp.assert_true(
  not has_function_privilege('authenticated','private.ensure_sd_miner_equipment_v1(uuid)','EXECUTE')
  and not has_function_privilege('authenticated','private.sd_miner_effective_cycle_ms_v1(uuid)','EXECUTE')
  and not has_function_privilege('authenticated','private.sd_miner_storage_capacity_v1(uuid)','EXECUTE')
  and not has_function_privilege('authenticated','private.enforce_sd_miner_storage_claim_v1()','EXECUTE'),
  'authenticated clients must not execute private progression helpers');

-- Existing legal entitlement/assets remain intact.
select pg_temp.assert_true(
  (select auto_mining_unlocked from public.sd_miner_accounts
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'legacy auto-mining ownership must remain preserved');
select pg_temp.assert_true(
  (select current_value from public.sd_achievement_progress
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='miner-01')>=86,
  'legacy miner-01 progress must not decrease');
select pg_temp.assert_true(
  (select unlocked from public.sd_achievement_progress
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='miner-06'),
  'legacy miner-06 unlock must remain');
select pg_temp.assert_true(
  (select current_value from public.sd_achievement_progress
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='miner-08')>=5,
  'legacy miner-08 progress must not decrease');

-- Use active user B and a dedicated device capability.
set request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","session_id":"bbbbbbbb-0000-4000-8000-000000000001"}';
select public.record_sd_access_heartbeat(
  'miner-device-B','desktop','equipment-v2','Asia/Seoul','ko-KR','miner');
select public.sd_miner_v3_bind_device(
  'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

select pg_temp.assert_true(
  (public.sd_miner_v3_get_progression(
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  )->>'progression_authority')='miner-progression-v1',
  'progression API must expose server progression authority');
select pg_temp.assert_true(
  (public.sd_miner_v3_get_progression(
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  )->>'effective_cycle_ms')::integer=5000
  and (public.sd_miner_v3_get_progression(
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  )->>'storage_capacity')::bigint=500,
  'new miner must start with level-one tool and storage effects');

-- Own-read RLS only.
set role authenticated;
select pg_temp.assert_true(
  (select count(*) from public.sd_miner_user_equipment
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=0,
  'RLS must hide another user equipment rows');
reset role;

-- Progress gate: having money is not sufficient before server total_mined=100.
insert into equipment_v2_numbers(k,v)
select 'wallet_initial',balance from public.wallets
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
begin
  perform public.sd_miner_v3_upgrade_equipment(
    'tool',1,'8e100000-0000-4000-8000-000000000001',
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  raise exception 'expected MINER_EQUIPMENT_PROGRESS_REQUIRED';
exception when sqlstate 'P1068' then null;
end;
$$;
select pg_temp.assert_true(
  (select level from public.sd_miner_user_equipment
   where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and slot_key='tool')=1,
  'failed progress gate must leave tool level unchanged');
select pg_temp.assert_true(
  (select balance from public.wallets where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=
  (select v from equipment_v2_numbers where k='wallet_initial'),
  'failed progress gate must leave wallet unchanged');
select pg_temp.assert_true(
  (select count(*) from public.sd_core_server_wallet_events
   where event_id='8e100000-0000-4000-8000-000000000001')=0,
  'failed progress gate must leave no Core event');

-- Tool level two: server requirement + fixed Core cost + exact replay.
update public.sd_miner_accounts set total_mined=100,updated_at=now()
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
insert into equipment_v2_numbers(k,v)
select 'wallet_before_tool2',balance from public.wallets
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select public.sd_miner_v3_upgrade_equipment(
  'tool',1,'8e100000-0000-4000-8000-000000000002',
  'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
select pg_temp.assert_true(
  (select level from public.sd_miner_user_equipment
   where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and slot_key='tool')=2,
  'tool must advance exactly to level two');
select pg_temp.assert_true(
  (select balance from public.wallets where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=
  (select v-100000 from equipment_v2_numbers where k='wallet_before_tool2'),
  'tool level two must cost exactly 100000');
select pg_temp.assert_true(
  (select count(*) from public.transactions
   where request_id='8e100000-0000-4000-8000-000000000002')=1
  and (select count(*) from public.sd_core_server_wallet_events
   where event_id='8e100000-0000-4000-8000-000000000002' and amount=-100000)=1,
  'tool purchase must create exactly one Core spend');

select public.sd_miner_v3_upgrade_equipment(
  'tool',1,'8e100000-0000-4000-8000-000000000002',
  'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
select pg_temp.assert_true(
  (select level from public.sd_miner_user_equipment
   where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and slot_key='tool')=2
  and (select count(*) from public.transactions
   where request_id='8e100000-0000-4000-8000-000000000002')=1,
  'lost-response retry must neither double-level nor double-spend');

-- Fresh stale-state request must fail instead of buying level three.
insert into equipment_v2_numbers(k,v)
select 'wallet_before_stale',balance from public.wallets
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
begin
  perform public.sd_miner_v3_upgrade_equipment(
    'tool',1,'8e100000-0000-4000-8000-000000000003',
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  raise exception 'expected MINER_EQUIPMENT_STATE_CHANGED';
exception when sqlstate 'P1066' then null;
end;
$$;
select pg_temp.assert_true(
  (select balance from public.wallets where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=
  (select v from equipment_v2_numbers where k='wallet_before_stale'),
  'stale expected_level request must not spend');

-- Tool effect must be used by server start/ready_at.
select public.sd_miner_v3_start(
  '8e100000-0000-4000-8000-000000000004',
  'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','surface');
insert into equipment_v2_ids(k,v)
select 'tool2_job',job_id from public.sd_miner_jobs
where start_request_id='8e100000-0000-4000-8000-000000000004';
select pg_temp.assert_true(
  (select cycle_ms from public.sd_miner_jobs where job_id=(select v from equipment_v2_ids where k='tool2_job'))=4600,
  'tool level two must create a 4600ms job');
select pg_temp.assert_true(
  abs((select extract(epoch from (ready_at-started_at))*1000
       from public.sd_miner_jobs where job_id=(select v from equipment_v2_ids where k='tool2_job'))-4600)<1,
  'server ready_at must match tool cycle');
update public.sd_miner_jobs set status='cancelled',updated_at=now()
where job_id=(select v from equipment_v2_ids where k='tool2_job');

-- Storage level two uses its own fixed Core cost/capacity.
insert into equipment_v2_numbers(k,v)
select 'wallet_before_storage2',balance from public.wallets
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select public.sd_miner_v3_upgrade_equipment(
  'storage',1,'8e100000-0000-4000-8000-000000000005',
  'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
select pg_temp.assert_true(
  (select level from public.sd_miner_user_equipment
   where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and slot_key='storage')=2
  and private.sd_miner_storage_capacity_v1('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=1000,
  'storage level two must set capacity to 1000');
select pg_temp.assert_true(
  (select balance from public.wallets where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=
  (select v-75000 from equipment_v2_numbers where k='wallet_before_storage2'),
  'storage level two must cost exactly 75000');

-- Fill to capacity: new work must fail closed with no job/action residue.
select private.apply_sd_item_delta_impl(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'equipment-v2-fill-1000','miner.ore.stone',1000,
  'sd-test','equipment_capacity_fixture','{}'::jsonb);
do $$
begin
  perform public.sd_miner_v3_start(
    '8e100000-0000-4000-8000-000000000006',
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','surface');
  raise exception 'expected MINER_STORAGE_FULL';
exception when sqlstate 'P1065' then null;
end;
$$;
select pg_temp.assert_true(
  (select count(*) from public.sd_miner_jobs where start_request_id='8e100000-0000-4000-8000-000000000006')=0
  and (select count(*) from public.sd_miner_actions where request_id='8e100000-0000-4000-8000-000000000006')=0,
  'full storage must create neither job nor saved action');

-- At 999/1000, one explicit claim may land exactly at capacity.
select private.apply_sd_item_delta_impl(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'equipment-v2-free-one','miner.ore.stone',-1,
  'sd-test','equipment_capacity_fixture','{}'::jsonb);
select public.sd_miner_v3_start(
  '8e100000-0000-4000-8000-000000000007',
  'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','surface');
insert into equipment_v2_ids(k,v)
select 'capacity_job',job_id from public.sd_miner_jobs
where start_request_id='8e100000-0000-4000-8000-000000000007';
update public.sd_miner_jobs
set started_at=pg_catalog.clock_timestamp()-interval '2 seconds',
    ready_at=pg_catalog.clock_timestamp()-interval '1 second'
where job_id=(select v from equipment_v2_ids where k='capacity_job');
select public.sd_miner_v3_claim(
  '8e100000-0000-4000-8000-000000000008',
  (select v from equipment_v2_ids where k='capacity_job'),
  'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
select pg_temp.assert_true(
  private.sd_miner_current_inventory_quantity_v1('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=1000,
  'claim at 999/1000 must land exactly at capacity');
select pg_temp.assert_true(
  (select count(*) from public.sd_item_events where event_id='8e100000-0000-4000-8000-000000000008')=1,
  'capacity-bound claim must create exactly one shared item event');

-- Insufficient funds at a valid later milestone must rollback the Core event and equipment state.
update public.sd_miner_accounts set total_mined=500,updated_at=now()
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
update public.wallets set balance=1000,updated_at=now()
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
begin
  perform public.sd_miner_v3_upgrade_equipment(
    'tool',2,'8e100000-0000-4000-8000-000000000009',
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  raise exception 'expected INSUFFICIENT_FUNDS';
exception when sqlstate 'P1013' then null;
end;
$$;
select pg_temp.assert_true(
  (select level from public.sd_miner_user_equipment
   where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and slot_key='tool')=2
  and (select count(*) from public.sd_core_server_wallet_events
   where event_id='8e100000-0000-4000-8000-000000000009')=0,
  'insufficient funds must leave tool and Core event unchanged');

-- Revoked device must be rejected before economic mutation.
update public.sd_access_devices set revoked_at=now()
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and device_key='miner-device-B';
do $$
begin
  perform public.sd_miner_v3_upgrade_equipment(
    'storage',2,'8e100000-0000-4000-8000-000000000010',
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  raise exception 'expected DEVICE_REVOKED';
exception when sqlstate 'P1006' then null;
end;
$$;
select pg_temp.assert_true(
  (select count(*) from public.sd_core_server_wallet_events
   where event_id='8e100000-0000-4000-8000-000000000010')=0,
  'revoked device must not create an equipment Core event');

-- Restore device only for read-state assertions.
update public.sd_access_devices set revoked_at=null,last_seen_at=now()
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and device_key='miner-device-B';
select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  )->>'progression_authority')='miner-progression-v1',
  'main miner state must expose progression authority');
select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  )->'config'->>'progression_stage')='ch4_4_equipment_growth_v1'
  and (public.sd_miner_v3_get_state(
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  )->'config'->>'economy_stage')='pre_ch4_7_guardrail_v1',
  'state metadata must distinguish official 4-4 progression from pre-4-7 economy guardrail');

select 'miner equipment growth v1 regression v2 PASS' as result;
