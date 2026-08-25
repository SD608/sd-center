\set ON_ERROR_STOP on

create or replace function pg_temp.assert_true(p_value boolean,p_message text)
returns void language plpgsql as $$
begin
  if p_value is distinct from true then
    raise exception 'ASSERTION_FAILED: %',p_message;
  end if;
end;
$$;

create temp table equipment_v3_numbers(k text primary key,v bigint not null);
create temp table equipment_v3_ids(k text primary key,v uuid not null);

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

-- Existing legitimate assets remain intact.
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
  'miner-device-B','desktop','equipment-v3','Asia/Seoul','ko-KR','miner');
select public.sd_miner_v3_bind_device(
  'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

select pg_temp.assert_true(
  (public.sd_miner_v3_get_progression(
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  )->>'progression_authority')='miner-progression-v1',
  'progression API must expose server authority');
select pg_temp.assert_true(
  (public.sd_miner_v3_get_progression(
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  )->>'effective_cycle_ms')::integer=5000
  and (public.sd_miner_v3_get_progression(
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  )->>'storage_capacity')::bigint=500,
  'new miner must begin with level-one equipment effects');

-- RLS isolates user equipment rows.
set role authenticated;
select pg_temp.assert_true(
  (select count(*) from public.sd_miner_user_equipment
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=0,
  'RLS must hide another user equipment');
reset role;

-- Progress gate must block before any wallet/Core mutation.
insert into equipment_v3_numbers(k,v)
select 'wallet_initial',balance from public.wallets
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
begin
  perform public.sd_miner_v3_upgrade_equipment(
    'tool',1,'8e200000-0000-4000-8000-000000000001',
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  raise exception 'expected MINER_EQUIPMENT_PROGRESS_REQUIRED';
exception when sqlstate 'P1068' then null;
end;
$$;
select pg_temp.assert_true(
  (select level from public.sd_miner_user_equipment
   where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and slot_key='tool')=1
  and (select balance from public.wallets where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=
      (select v from equipment_v3_numbers where k='wallet_initial')
  and (select count(*) from public.sd_core_server_wallet_events
       where event_id='8e200000-0000-4000-8000-000000000001')=0,
  'progress-gated upgrade must be side-effect free');

-- First tool upgrade uses server cost and exact-once Core spend.
update public.sd_miner_accounts set total_mined=100,updated_at=now()
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
insert into equipment_v3_numbers(k,v)
select 'wallet_before_tool2',balance from public.wallets
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select public.sd_miner_v3_upgrade_equipment(
  'tool',1,'8e200000-0000-4000-8000-000000000002',
  'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
select pg_temp.assert_true(
  (select level from public.sd_miner_user_equipment
   where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and slot_key='tool')=2
  and (select balance from public.wallets where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=
      (select v-100000 from equipment_v3_numbers where k='wallet_before_tool2')
  and (select count(*) from public.transactions
       where request_id='8e200000-0000-4000-8000-000000000002')=1,
  'tool level two must spend exactly 100000 once');
select public.sd_miner_v3_upgrade_equipment(
  'tool',1,'8e200000-0000-4000-8000-000000000002',
  'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
select pg_temp.assert_true(
  (select level from public.sd_miner_user_equipment
   where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and slot_key='tool')=2
  and (select count(*) from public.transactions
       where request_id='8e200000-0000-4000-8000-000000000002')=1,
  'same request retry must not double-spend or double-level');

-- Fresh stale expected_level request is rejected.
insert into equipment_v3_numbers(k,v)
select 'wallet_before_stale',balance from public.wallets
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
begin
  perform public.sd_miner_v3_upgrade_equipment(
    'tool',1,'8e200000-0000-4000-8000-000000000003',
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  raise exception 'expected MINER_EQUIPMENT_STATE_CHANGED';
exception when sqlstate 'P1066' then null;
end;
$$;
select pg_temp.assert_true(
  (select balance from public.wallets where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=
  (select v from equipment_v3_numbers where k='wallet_before_stale'),
  'stale expected_level must not spend');

-- Tool effect is persisted in a server-created job.
select public.sd_miner_v3_start(
  '8e200000-0000-4000-8000-000000000004',
  'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','surface');
insert into equipment_v3_ids(k,v)
select 'tool2_job',job_id from public.sd_miner_jobs
where start_request_id='8e200000-0000-4000-8000-000000000004';
select pg_temp.assert_true(
  (select cycle_ms from public.sd_miner_jobs
   where job_id=(select v from equipment_v3_ids where k='tool2_job'))=4600,
  'tool level two must produce 4600ms server jobs');
select pg_temp.assert_true(
  abs((select extract(epoch from (ready_at-started_at))*1000
       from public.sd_miner_jobs
       where job_id=(select v from equipment_v3_ids where k='tool2_job'))-4600)<1,
  'server ready_at must equal selected tool cycle');
update public.sd_miner_jobs set status='cancelled',updated_at=now()
where job_id=(select v from equipment_v3_ids where k='tool2_job');

-- Storage level two uses its own server price/capacity.
insert into equipment_v3_numbers(k,v)
select 'wallet_before_storage2',balance from public.wallets
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select public.sd_miner_v3_upgrade_equipment(
  'storage',1,'8e200000-0000-4000-8000-000000000005',
  'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
select pg_temp.assert_true(
  (select level from public.sd_miner_user_equipment
   where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and slot_key='storage')=2
  and private.sd_miner_storage_capacity_v1('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=1000
  and (select balance from public.wallets where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=
      (select v-75000 from equipment_v3_numbers where k='wallet_before_storage2'),
  'storage level two must cost 75000 and set capacity 1000');

-- Inherited regressions may leave legitimate items on user B. Fill only the delta
-- required to reach capacity, rather than assuming the starting inventory is zero.
insert into equipment_v3_numbers(k,v)
values('inventory_before_fill',private.sd_miner_current_inventory_quantity_v1('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
select pg_temp.assert_true(
  (select v from equipment_v3_numbers where k='inventory_before_fill')<1000,
  'fixture must begin below level-two storage capacity');
select private.apply_sd_item_delta_impl(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'equipment-v3-fill-to-cap','miner.ore.stone',
  1000-(select v from equipment_v3_numbers where k='inventory_before_fill'),
  'sd-test','equipment_capacity_fixture','{}'::jsonb);
select pg_temp.assert_true(
  private.sd_miner_current_inventory_quantity_v1('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=1000,
  'dynamic fill must reach exact storage capacity');

do $$
begin
  perform public.sd_miner_v3_start(
    '8e200000-0000-4000-8000-000000000006',
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','surface');
  raise exception 'expected MINER_STORAGE_FULL';
exception when sqlstate 'P1065' then null;
end;
$$;
select pg_temp.assert_true(
  (select count(*) from public.sd_miner_jobs where start_request_id='8e200000-0000-4000-8000-000000000006')=0
  and (select count(*) from public.sd_miner_actions where request_id='8e200000-0000-4000-8000-000000000006')=0,
  'full storage must create neither job nor action');

-- At 999/1000 one explicit claim is accepted and lands exactly at capacity.
select private.apply_sd_item_delta_impl(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'equipment-v3-free-one','miner.ore.stone',-1,
  'sd-test','equipment_capacity_fixture','{}'::jsonb);
select pg_temp.assert_true(
  private.sd_miner_current_inventory_quantity_v1('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=999,
  'freeing one slot must produce 999/1000 state');
select public.sd_miner_v3_start(
  '8e200000-0000-4000-8000-000000000007',
  'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','surface');
insert into equipment_v3_ids(k,v)
select 'capacity_job',job_id from public.sd_miner_jobs
where start_request_id='8e200000-0000-4000-8000-000000000007';
update public.sd_miner_jobs
set started_at=pg_catalog.clock_timestamp()-interval '2 seconds',
    ready_at=pg_catalog.clock_timestamp()-interval '1 second'
where job_id=(select v from equipment_v3_ids where k='capacity_job');
select public.sd_miner_v3_claim(
  '8e200000-0000-4000-8000-000000000008',
  (select v from equipment_v3_ids where k='capacity_job'),
  'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
select pg_temp.assert_true(
  private.sd_miner_current_inventory_quantity_v1('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=1000
  and (select count(*) from public.sd_item_events
       where event_id='8e200000-0000-4000-8000-000000000008')=1,
  'capacity-bound claim must add exactly one shared item');

-- Insufficient funds at a valid next milestone must rollback state and Core event.
update public.sd_miner_accounts set total_mined=500,updated_at=now()
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
update public.wallets set balance=1000,updated_at=now()
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
begin
  perform public.sd_miner_v3_upgrade_equipment(
    'tool',2,'8e200000-0000-4000-8000-000000000009',
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  raise exception 'expected INSUFFICIENT_FUNDS';
exception when sqlstate 'P1013' then null;
end;
$$;
select pg_temp.assert_true(
  (select level from public.sd_miner_user_equipment
   where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and slot_key='tool')=2
  and (select count(*) from public.sd_core_server_wallet_events
       where event_id='8e200000-0000-4000-8000-000000000009')=0,
  'insufficient funds must leave tool and Core event unchanged');

-- Revoked device is blocked before economic mutation.
update public.sd_access_devices set revoked_at=now()
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and device_key='miner-device-B';
do $$
begin
  perform public.sd_miner_v3_upgrade_equipment(
    'storage',2,'8e200000-0000-4000-8000-000000000010',
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  raise exception 'expected DEVICE_REVOKED';
exception when sqlstate 'P1006' then null;
end;
$$;
select pg_temp.assert_true(
  (select count(*) from public.sd_core_server_wallet_events
   where event_id='8e200000-0000-4000-8000-000000000010')=0,
  'revoked device must not create Core equipment event');

-- Restore device for read-state assertions only.
update public.sd_access_devices set revoked_at=null,last_seen_at=now()
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and device_key='miner-device-B';
select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  )->>'progression_authority')='miner-progression-v1',
  'main state must expose progression authority');
select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  )->'config'->>'progression_stage')='ch4_4_equipment_growth_v1'
  and (public.sd_miner_v3_get_state(
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  )->'config'->>'economy_stage')='pre_ch4_7_guardrail_v1',
  'state metadata must distinguish 4-4 progression from pre-4-7 guardrail');

select 'miner equipment growth v1 regression v3 PASS' as result;
