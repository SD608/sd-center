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

-- Public privilege contract: v3 is authenticated-only; legacy endpoints remain
-- callable only to return a controlled fail-closed upgrade error.
select pg_temp.assert_true(
  has_function_privilege('authenticated','public.sd_miner_v3_start(uuid,text,text,text)','EXECUTE'),
  'authenticated must be able to execute miner v3 start'
);
select pg_temp.assert_true(
  not has_function_privilege('anon','public.sd_miner_v3_start(uuid,text,text,text)','EXECUTE'),
  'anon must not execute miner v3 start'
);
select pg_temp.assert_true(
  not has_function_privilege('anon','public.sd_miner_v3_sell(text,bigint,uuid,text,text)','EXECUTE'),
  'anon must not execute miner v3 sell'
);

set request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","session_id":"aaaaaaaa-0000-4000-8000-000000000001"}';

-- Device must first be tied to the current live auth session by the common
-- PR #74 heartbeat boundary, then receive a miner-specific secret capability.
select public.record_sd_access_heartbeat(
  'miner-device-A','desktop','electron-test','Asia/Seoul','ko-KR','miner'
);
select public.sd_miner_v3_bind_device(
  'miner-device-A',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
);

select pg_temp.assert_true(
  exists(
    select 1
    from public.sd_miner_device_bindings b
    join public.sd_access_devices d on d.id=b.access_device_id
    where b.user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and d.device_key='miner-device-A'
      and d.bound_session_id='aaaaaaaa-0000-4000-8000-000000000001'
      and d.revoked_at is null
  ),
  'miner capability must be bound to the owned live-session device'
);

-- Existing server-evidenced auto ownership and legacy achievements are assets.
select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-A',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )->>'legacy_auto_mining_owned')::boolean,
  'legacy auto-mining ownership must be preserved'
);
select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-A',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )->'config'->>'cycle_ms')::integer = 5000,
  'server cycle must be 5000 ms'
);
select pg_temp.assert_true(
  (select current_value from public.sd_achievement_progress
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='miner-01') = 86,
  'legacy miner-01 progress must survive v2 baseline import'
);
select pg_temp.assert_true(
  (select unlocked from public.sd_achievement_progress
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='miner-06'),
  'legacy miner-06 unlock must survive v2 baseline import'
);

-- Start is exact-once. One user cannot overlap mining jobs even with distinct
-- request IDs, which removes click/macro throughput as an economic variable.
select (public.sd_miner_v3_start(
  '10000000-0000-4000-8000-000000000001',
  'miner-device-A',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'surface'
)->>'job_id') as job_id \gset

select pg_temp.assert_true(
  (public.sd_miner_v3_start(
    '10000000-0000-4000-8000-000000000001',
    'miner-device-A',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'surface'
  )->>'job_id')::uuid = :'job_id'::uuid,
  'start retry must replay the same job'
);

select pg_temp.assert_true(
  (select count(*) from public.sd_miner_jobs
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and status='active') = 1,
  'exactly one active job must exist'
);

do $$
begin
  perform public.sd_miner_v3_start(
    '10000000-0000-4000-8000-000000000002',
    'miner-device-A',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'surface'
  );
  raise exception 'expected MINER_JOB_ALREADY_ACTIVE';
exception when sqlstate 'P1054' then
  null;
end;
$$;

-- A claim before server ready_at must fail. Waiting/closing the client cannot
-- auto-credit anything: inventory changes only when one claim is accepted.
do $$
begin
  perform public.sd_miner_v3_claim(
    '20000000-0000-4000-8000-000000000001',
    :'job_id'::uuid,
    'miner-device-A',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  );
  raise exception 'expected MINER_JOB_NOT_READY';
exception when sqlstate 'P1053' then
  null;
end;
$$;

select pg_temp.assert_true(
  (select coalesce(sum(quantity),0) from public.sd_miner_inventory
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 0,
  'a merely ready/pending job must not generate background inventory'
);

-- Test clock advancement without sleeping in CI. Only the test owner writes the
-- server table directly; authenticated clients have no table write privilege.
update public.sd_miner_jobs
set ready_at = clock_timestamp() - interval '1 millisecond'
where job_id=:'job_id'::uuid;

select public.sd_miner_v3_claim(
  '20000000-0000-4000-8000-000000000001',
  :'job_id'::uuid,
  'miner-device-A',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
) as first_claim \gset

select pg_temp.assert_true(
  (select total_mined from public.sd_miner_accounts
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 1,
  'one accepted claim must increment total_mined once'
);
select pg_temp.assert_true(
  (select coalesce(sum(quantity),0) from public.sd_miner_inventory
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 1,
  'one accepted claim must add exactly one inventory item'
);

select public.sd_miner_v3_claim(
  '20000000-0000-4000-8000-000000000001',
  :'job_id'::uuid,
  'miner-device-A',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
);
select pg_temp.assert_true(
  (select total_mined from public.sd_miner_accounts
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 1,
  'same claim request retry must not duplicate mining'
);

do $$
begin
  perform public.sd_miner_v3_claim(
    '20000000-0000-4000-8000-000000000002',
    :'job_id'::uuid,
    'miner-device-A',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  );
  raise exception 'expected MINER_JOB_ALREADY_CLAIMED';
exception when sqlstate 'P1055' then
  null;
end;
$$;

-- Achievement refresh is monotonic: new server count=1 cannot erase legal
-- historical progress/unlocks that were already greater.
select pg_temp.assert_true(
  (select current_value from public.sd_achievement_progress
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='miner-01') = 86,
  'miner-01 progress must not decrease to new server total_mined=1'
);
select pg_temp.assert_true(
  (select unlocked from public.sd_achievement_progress
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='miner-06'),
  'miner-06 legacy unlock must remain unlocked after refresh'
);
select pg_temp.assert_true(
  (select current_value from public.sd_achievement_progress
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='miner-08') = 5,
  'miner-08 legacy progress must not move backward'
);

-- Bind secret cannot be silently replaced.
do $$
begin
  perform public.sd_miner_v3_get_state(
    'miner-device-A',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  );
  raise exception 'expected MINER_DEVICE_SECRET_MISMATCH';
exception when sqlstate 'P1009' then
  null;
end;
$$;

-- Revoked access device blocks economy/game state actions even with a valid JWT.
update public.sd_access_devices
set revoked_at=now()
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and device_key='miner-device-A';

do $$
begin
  perform public.sd_miner_v3_get_state(
    'miner-device-A',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  );
  raise exception 'expected DEVICE_REVOKED';
exception when sqlstate 'P1006' then
  null;
end;
$$;

update public.sd_access_devices
set revoked_at=null, last_seen_at=now()
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and device_key='miner-device-A';

-- Missing/revoked auth session blocks a still-unexpired JWT on sensitive miner RPCs.
delete from auth.sessions where id='aaaaaaaa-0000-4000-8000-000000000001';
do $$
begin
  perform public.sd_miner_v3_get_state(
    'miner-device-A',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  );
  raise exception 'expected SESSION_REVOKED';
exception when sqlstate 'P1008' then
  null;
end;
$$;
insert into auth.sessions(id,user_id,not_after) values(
  'aaaaaaaa-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  now()+interval '1 day'
);
select public.record_sd_access_heartbeat(
  'miner-device-A','desktop','electron-test','Asia/Seoul','ko-KR','miner'
);

-- Stale device presence also blocks. A fresh common heartbeat restores access.
update public.sd_access_devices
set last_seen_at=now()-interval '11 minutes'
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and device_key='miner-device-A';

do $$
begin
  perform public.sd_miner_v3_get_state(
    'miner-device-A',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  );
  raise exception 'expected DEVICE_INACTIVE';
exception when sqlstate 'P1004' then
  null;
end;
$$;
select public.record_sd_access_heartbeat(
  'miner-device-A','desktop','electron-test','Asia/Seoul','ko-KR','miner'
);

-- Cross-user access key cannot be used by another authenticated user.
set request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","session_id":"bbbbbbbb-0000-4000-8000-000000000001"}';
do $$
begin
  perform public.sd_miner_v3_bind_device(
    'miner-device-A',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  );
  raise exception 'expected DEVICE_NOT_FOUND';
exception when sqlstate 'P1003' then
  null;
end;
$$;

-- Inactive profile cannot bind or operate even with a live session/device row.
insert into public.sd_access_devices(
  user_id,device_key,platform,last_seen_at,bound_session_id
) values(
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc','miner-device-C','desktop',now(),
  'cccccccc-0000-4000-8000-000000000001'
);
set request.jwt.claims = '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","session_id":"cccccccc-0000-4000-8000-000000000001"}';
do $$
begin
  perform public.sd_miner_v3_bind_device(
    'miner-device-C',
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  );
  raise exception 'expected ACCOUNT_INACTIVE';
exception when sqlstate 'P1002' then
  null;
end;
$$;

-- Return to active miner and verify Core-routed sale exact-once.
set request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","session_id":"aaaaaaaa-0000-4000-8000-000000000001"}';
select public.record_sd_access_heartbeat(
  'miner-device-A','desktop','electron-test','Asia/Seoul','ko-KR','miner'
);

-- Deterministic sale inventory for the regression. Authenticated clients cannot
-- perform this table write because inventory DML was revoked by the authority schema.
update public.sd_miner_inventory
set quantity=quantity+10, acquired_count=acquired_count+10
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and ore_key='stone';

select public.sd_miner_v3_sell(
  'stone',3,
  '30000000-0000-4000-8000-000000000001',
  'miner-device-A',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
);
select pg_temp.assert_true(
  (select balance from public.wallets where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 10000300,
  'first v3 sale must credit exactly 300 through Core'
);
select pg_temp.assert_true(
  (select count(*) from public.transactions
   where request_id='30000000-0000-4000-8000-000000000001') = 1,
  'Core transaction must exist exactly once'
);

select public.sd_miner_v3_sell(
  'stone',3,
  '30000000-0000-4000-8000-000000000001',
  'miner-device-A',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
);
select pg_temp.assert_true(
  (select balance from public.wallets where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 10000300,
  'sale retry must not duplicate wallet credit'
);
select pg_temp.assert_true(
  (select count(*) from public.transactions
   where request_id='30000000-0000-4000-8000-000000000001') = 1,
  'sale retry must not duplicate transaction'
);

do $$
begin
  perform public.sd_miner_v3_sell(
    'stone',4,
    '30000000-0000-4000-8000-000000000001',
    'miner-device-A',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  );
  raise exception 'expected MINER_REQUEST_IDEMPOTENCY_CONFLICT';
exception when sqlstate 'P1015' then
  null;
end;
$$;

-- Legacy 300ms/auto endpoints are fail-closed, not silently still economic.
do $$
begin
  perform public.sd_miner_mine('40000000-0000-4000-8000-000000000001');
  raise exception 'expected MINER_V3_REQUIRED';
exception when sqlstate 'P1059' then
  null;
end;
$$;

do $$
begin
  perform public.sd_miner_buy_auto_mining('40000000-0000-4000-8000-000000000002');
  raise exception 'expected MINER_AUTO_REDESIGN_PENDING';
exception when sqlstate 'P1058' then
  null;
end;
$$;

select pg_temp.assert_true(
  (select count(*) from public.sd_miner_actions
   where action_type='mine') = 0,
  'legacy 300ms mine action must not execute after v3 cutover'
);

-- One more job proves a ready job still does not repeat in the background.
select (public.sd_miner_v3_start(
  '50000000-0000-4000-8000-000000000001',
  'miner-device-A',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'surface'
)->>'job_id') as pending_job_id \gset
update public.sd_miner_jobs
set ready_at=clock_timestamp()-interval '1 minute'
where job_id=:'pending_job_id'::uuid;
select pg_temp.assert_true(
  (select status from public.sd_miner_jobs where job_id=:'pending_job_id'::uuid)='active',
  'ready job must remain one pending claim, not auto-repeat'
);
select pg_temp.assert_true(
  (select count(*) from public.sd_miner_jobs
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and status='active')=1,
  'background queue must stay capped at one job'
);

do $$
begin
  perform public.sd_miner_v3_start(
    '50000000-0000-4000-8000-000000000002',
    'miner-device-A',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'surface'
  );
  raise exception 'expected MINER_JOB_ALREADY_ACTIVE';
exception when sqlstate 'P1054' then
  null;
end;
$$;

select 'miner-work-loop-v3 regression PASS' as result;
