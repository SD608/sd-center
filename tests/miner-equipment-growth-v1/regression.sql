\set ON_ERROR_STOP on

create or replace function pg_temp.assert_true(p_value boolean,p_message text)
returns void language plpgsql as $$
begin
  if p_value is distinct from true then
    raise exception 'ASSERTION_FAILED: %',p_message;
  end if;
end;
$$;

create temp table equipment_numbers(k text primary key,v bigint not null);
create temp table equipment_ids(k text primary key,v uuid not null);

-- Catalog contract and client authority boundary.
select pg_temp.assert_true(
  (select count(*) from public.sd_miner_equipment_catalog)=10,
  'equipment catalog must contain two five-level tracks');
select pg_temp.assert_true(
  (select count(*) from public.sd_miner_equipment_catalog where slot_key='tool')=5
  and (select count(*) from public.sd_miner_equipment_catalog where slot_key='storage')=5,
  'tool and storage tracks must each contain five levels');
select pg_temp.assert_true(
  (select cycle_ms from public.sd_miner_equipment_catalog where slot_key='tool' and level=1)=5000
  and (select cycle_ms from public.sd_miner_equipment_catalog where slot_key='tool' and level=2)=4600
  and (select cycle_ms from public.sd_miner_equipment_catalog where slot_key='tool' and level=3)=4200
  and (select cycle_ms from public.sd_miner_equipment_catalog where slot_key='tool' and level=4)=3800
  and (select cycle_ms from public.sd_miner_equipment_catalog where slot_key='tool' and level=5)=3400,
  'tool cycle progression must match reviewed v1 values');
select pg_temp.assert_true(
  (select storage_capacity from public.sd_miner_equipment_catalog where slot_key='storage' and level=1)=500
  and (select storage_capacity from public.sd_miner_equipment_catalog where slot_key='storage' and level=2)=1000
  and (select storage_capacity from public.sd_miner_equipment_catalog where slot_key='storage' and level=3)=2000
  and (select storage_capacity from public.sd_miner_equipment_catalog where slot_key='storage' and level=4)=4000
  and (select storage_capacity from public.sd_miner_equipment_catalog where slot_key='storage' and level=5)=8000,
  'storage capacity progression must match reviewed v1 values');

select pg_temp.assert_true(
  not has_table_privilege('authenticated','public.sd_miner_equipment_catalog','INSERT')
  and not has_table_privilege('authenticated','public.sd_miner_equipment_catalog','UPDATE')
  and not has_table_privilege('authenticated','public.sd_miner_equipment_catalog','DELETE'),
  'authenticated client must not mutate equipment catalog');
select pg_temp.assert_true(
  not has_table_privilege('authenticated','public.sd_miner_user_equipment','INSERT')
  and not has_table_privilege('authenticated','public.sd_miner_user_equipment','UPDATE')
  and not has_table_privilege('authenticated','public.sd_miner_user_equipment','DELETE'),
  'authenticated client must not mutate user equipment');
select pg_temp.assert_true(
  not has_function_privilege('authenticated','private.ensure_sd_miner_equipment_v1(uuid)','EXECUTE')
  and not has_function_privilege('authenticated','private.sd_miner_effective_cycle_ms_v1(uuid)','EXECUTE')
  and not has_function_privilege('authenticated','private.sd_miner_storage_capacity_v1(uuid)','EXECUTE')
  and not has_function_privilege('authenticated','private.enforce_sd_miner_storage_claim_v1()','EXECUTE'),
  'client must not execute private progression helpers');
select pg_temp.assert_true(
  has_function_privilege('authenticated','public.sd_miner_v3_get_progression(text,text)','EXECUTE')
  and has_function_privilege('authenticated','public.sd_miner_v3_upgrade_equipment(text,integer,uuid,text,text)','EXECUTE'),
  'authenticated miner client must have progression read/upgrade RPCs');

-- Existing legal legacy auto entitlement remains preserved and disabled.
select pg_temp.assert_true(
  (select auto_mining_unlocked from public.sd_miner_accounts
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'legacy auto-mining entitlement must remain owned');

-- Use the second active user for clean progression tests.
set request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","session_id":"bbbbbbbb-0000-4000-8000-000000000001"}';
select public.record_sd_access_heartbeat(
  'miner-device-B','desktop','electron-equipment-test','Asia/Seoul','ko-KR','miner');
select public.sd_miner_v3_bind_device(
  'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

select pg_temp.assert_true(
  (public.sd_miner_v3_get_progression(
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  )->>'progression_authority')='miner-progression-v1',
  'progression state must identify server authority');
select pg_temp.assert_true(
  (public.sd_miner_v3_get_progression(
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  )->>'effective_cycle_ms')::integer=5000,
  'new miner must start with 5000ms tool');
select pg_temp.assert_true(
  (public.sd_miner_v3_get_progression(
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  )->>'storage_capacity')::bigint=500,
  'new miner must start with 500 storage');
select pg_temp.assert_true(
  (select level from public.sd_miner_user_equipment
   where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and slot_key='tool')=1
  and (select level from public.sd_miner_user_equipment
   where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and slot_key='storage')=1,
  'new miner must have level-one equipment only');

-- RLS hides another user's equipment while authenticated as user B.
set role authenticated;
select pg_temp.assert_true(
  (select count(*) from public.sd_miner_user_equipment
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=0,
  'equipment RLS must hide another user');
reset role;

insert into equipment_numbers(k,v)
select 'wallet_before_gate',balance from public.wallets
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

-- Growth gate: money alone cannot skip the server total_mined requirement.
do $$
begin
  perform public.sd_miner_v3_upgrade_equipment(
    'tool',1,'71000000-0000-4000-8000-000000000001',
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  raise exception 'expected MINER_EQUIPMENT_PROGRESS_REQUIRED';
exception when sqlstate 'P1068' then null;
end;
$$;
select pg_temp.assert_true(
  (select level from public.sd_miner_user_equipment
   where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and slot_key='tool')=1,
  'failed growth gate must not upgrade tool');
select pg_temp.assert_true(
  (select balance from public.wallets where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=
  (select v from equipment_numbers where k='wallet_before_gate'),
  'failed growth gate must not spend wallet');
select pg_temp.assert_true(
  (select count(*) from public.sd_core_server_wallet_events
   where event_id='71000000-0000-4000-8000-000000000001')=0,
  'failed growth gate must leave no Core event');

-- Reach the first server-owned growth milestone, then buy tool level 2.
update public.sd_miner_accounts
set total_mined=100,updated_at=now()
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
insert into equipment_numbers(k,v)
select 'wallet_before_tool2',balance from public.wallets
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

select public.sd_miner_v3_upgrade_equipment(
  'tool',1,'71000000-0000-4000-8000-000000000002',
  'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
select pg_temp.assert_true(
  (select level from public.sd_miner_user_equipment
   where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and slot_key='tool')=2,
  'tool must advance exactly one level');
select pg_temp.assert_true(
  (select balance from public.wallets where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=
  (select v-100000 from equipment_numbers where k='wallet_before_tool2'),
  'tool level two must cost exactly 100000');
select pg_temp.assert_true(
  (select count(*) from public.sd_core_server_wallet_events
   where event_id='71000000-0000-4000-8000-000000000002'
     and amount=-100000 and event_key='miner_equipment_upgrade')=1,
  'equipment purchase must create one exact Core spend event');
select pg_temp.assert_true(
  (select count(*) from public.sd_miner_actions
   where request_id='71000000-0000-4000-8000-000000000002'
     and action_type='v3_equipment_upgrade')=1,
  'equipment purchase must save one miner action');

-- Lost-response retry must not double-spend or level twice.
select public.sd_miner_v3_upgrade_equipment(
  'tool',1,'71000000-0000-4000-8000-000000000002',
  'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
select pg_temp.assert_true(
  (select level from public.sd_miner_user_equipment
   where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and slot_key='tool')=2,
  'exact retry must not add another tool level');
select pg_temp.assert_true(
  (select count(*) from public.transactions
   where request_id='71000000-0000-4000-8000-000000000002')=1,
  'exact retry must not duplicate Core transaction');

-- A second click carrying stale expected state must fail instead of silently buying level 3.
insert into equipment_numbers(k,v)
select 'wallet_before_stale',balance from public.wallets
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
begin
  perform public.sd_miner_v3_upgrade_equipment(
    'tool',1,'71000000-0000-4000-8000-000000000003',
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  raise exception 'expected MINER_EQUIPMENT_STATE_CHANGED';
exception when sqlstate 'P1066' then null;
end;
$$;
select pg_temp.assert_true(
  (select balance from public.wallets where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=
  (select v from equipment_numbers where k='wallet_before_stale'),
  'stale expected level must not spend wallet');

-- Tool effect is applied by the server start RPC and persisted in the job.
select public.sd_miner_v3_start(
  '71000000-0000-4000-8000-000000000004',
  'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','surface');
insert into equipment_ids(k,v)
select 'tool2_job',job_id from public.sd_miner_jobs
where start_request_id='71000000-0000-4000-8000-000000000004';
select pg_temp.assert_true(
  (select cycle_ms from public.sd_miner_jobs where job_id=(select v from equipment_ids where k='tool2_job'))=4600,
  'tool level two must produce a 4600ms server job');
select pg_temp.assert_true(
  abs((select extract(epoch from (ready_at-started_at))*1000
       from public.sd_miner_jobs where job_id=(select v from equipment_ids where k='tool2_job'))-4600)<1,
  'server ready_at must match equipment cycle');
update public.sd_miner_jobs set status='cancelled',updated_at=now()
where job_id=(select v from equipment_ids where k='tool2_job');

-- Storage upgrade uses the same Core exact-once boundary.
insert into equipment_numbers(k,v)
select 'wallet_before_storage2',balance from public.wallets
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select public.sd_miner_v3_upgrade_equipment(
  'storage',1,'71000000-0000-4000-8000-000000000005',
  'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
select pg_temp.assert_true(
  (select level from public.sd_miner_user_equipment
   where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and slot_key='storage')=2,
  'storage must advance to level two');
select pg_temp.assert_true(
  private.sd_miner_storage_capacity_v1('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=1000,
  'storage level two must provide 1000 capacity');
select pg_temp.assert_true(
  (select balance from public.wallets where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=
  (select v-75000 from equipment_numbers where k='wallet_before_storage2'),
  'storage level two must cost exactly 75000');

-- Fill canonical shared inventory to capacity. New jobs must fail closed without action residue.
select private.apply_sd_item_delta_impl(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'equipment-test-fill-1000','miner.ore.stone',1000,
  'sd-test','equipment_capacity_fixture','{}'::jsonb);
do $$
begin
  perform public.sd_miner_v3_start(
    '71000000-0000-4000-8000-000000000006',
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','surface');
  raise exception 'expected MINER_STORAGE_FULL';
exception when sqlstate 'P1065' then null;
end;
$$;
select pg_temp.assert_true(
  (select count(*) from public.sd_miner_jobs
   where start_request_id='71000000-0000-4000-8000-000000000006')=0,
  'full storage must not create a job');
select pg_temp.assert_true(
  (select count(*) from public.sd_miner_actions
   where request_id='71000000-0000-4000-8000-000000000006')=0,
  'full storage must not save a start action');

-- At 999/1000, one explicit claim is allowed and lands exactly at capacity.
select private.apply_sd_item_delta_impl(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'equipment-test-free-one','miner.ore.stone',-1,
  'sd-test','equipment_capacity_fixture','{}'::jsonb);
select public.sd_miner_v3_start(
  '71000000-0000-4000-8000-000000000007',
  'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','surface');
insert into equipment_ids(k,v)
select 'capacity_job',job_id from public.sd_miner_jobs
where start_request_id='71000000-0000-4000-8000-000000000007';
update public.sd_miner_jobs
set started_at=pg_catalog.clock_timestamp()-interval '2 seconds',
    ready_at=pg_catalog.clock_timestamp()-interval '1 second'
where job_id=(select v from equipment_ids where k='capacity_job');
select public.sd_miner_v3_claim(
  '71000000-0000-4000-8000-000000000008',
  (select v from equipment_ids where k='capacity_job'),
  'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
select pg_temp.assert_true(
  private.sd_miner_current_inventory_quantity_v1('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=1000,
  'claim at 999 capacity must land exactly at 1000');

-- Insufficient funds at a later milestone must not consume equipment state.
update public.sd_miner_accounts
set total_mined=500,updated_at=now()
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
update public.wallets set balance=1000,updated_at=now()
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
begin
  perform public.sd_miner_v3_upgrade_equipment(
    'tool',2,'71000000-0000-4000-8000-000000000009',
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  raise exception 'expected INSUFFICIENT_FUNDS';
exception when sqlstate 'P1013' then null;
end;
$$;
select pg_temp.assert_true(
  (select level from public.sd_miner_user_equipment
   where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and slot_key='tool')=2,
  'insufficient funds must not change tool level');
select pg_temp.assert_true(
  (select count(*) from public.sd_core_server_wallet_events
   where event_id='71000000-0000-4000-8000-000000000009')=0,
  'insufficient funds must leave no committed Core event');

-- Revocation blocks progression writes before any economic mutation.
update public.sd_access_devices
set revoked_at=now()
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and device_key='miner-device-B';
do $$
begin
  perform public.sd_miner_v3_upgrade_equipment(
    'storage',2,'71000000-0000-4000-8000-000000000010',
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  raise exception 'expected DEVICE_REVOKED';
exception when sqlstate 'P1006' then null;
end;
$$;
select pg_temp.assert_true(
  (select count(*) from public.sd_core_server_wallet_events
   where event_id='71000000-0000-4000-8000-000000000010')=0,
  'revoked device must not create Core upgrade event');

-- Main state must advertise progression without falsely calling the guardrail final 4-4 economy.
update public.sd_access_devices
set revoked_at=null,last_seen_at=now()
where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and device_key='miner-device-B';
select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  )->>'progression_authority')='miner-progression-v1',
  'main miner state must expose progression authority');
select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  )->'config'->>'progression_stage')='ch4_4_equipment_growth_v1',
  'main miner state must expose official 4-4 stage');
select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-B','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  )->'config'->>'economy_stage')='pre_ch4_7_guardrail_v1',
  'economy metadata must remain a pre-4-7 guardrail candidate');

-- Existing legitimate achievement assets remain monotonic and untouched by equipment purchases.
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

select 'miner equipment growth v1 regression PASS' as result;
