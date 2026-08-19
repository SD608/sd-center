\set ON_ERROR_STOP on

set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);

do $$
declare
  v_device jsonb;
  v_device_id uuid;
  v_result jsonb;
  v_snapshot jsonb;
  v_balance bigint;
  v_target_balance bigint;
  v_tx_count bigint;
  v_target_tx_count bigint;
  v_event_count bigint;
  v_public_api_count integer;
  v_public_api_all_invoker boolean;
  v_private_impl_count integer;
  v_private_impl_all_definer boolean;
  v_rls_enabled boolean;
  v_write_blocked boolean := false;
  v_event_write_blocked boolean := false;
begin
  -- Public API must not itself run with definer privileges.
  select count(*), bool_and(not p.prosecdef)
    into v_public_api_count, v_public_api_all_invoker
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'sd_core_register_device',
      'sd_core_get_snapshot',
      'sd_core_apply_wallet_event'
    );

  if v_public_api_count <> 3 or coalesce(v_public_api_all_invoker, false) is not true then
    raise exception 'public SD Core API is not fully SECURITY INVOKER';
  end if;

  select count(*), bool_and(p.prosecdef)
    into v_private_impl_count, v_private_impl_all_definer
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'sd_core_private'
    and p.proname in (
      'register_device_impl',
      'get_snapshot_impl',
      'apply_wallet_event_impl'
    );

  if v_private_impl_count <> 3 or coalesce(v_private_impl_all_definer, false) is not true then
    raise exception 'private SD Core implementation privilege boundary mismatch';
  end if;

  if pg_catalog.has_function_privilege(
    'anon',
    'public.sd_core_apply_wallet_event(uuid,uuid,text,bigint,text,text,text,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'anon unexpectedly has public SD Core wallet mutation EXECUTE';
  end if;

  if pg_catalog.has_function_privilege(
    'anon',
    'sd_core_private.apply_wallet_event_impl(uuid,uuid,text,bigint,text,text,text,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'anon unexpectedly has private SD Core wallet mutation EXECUTE';
  end if;

  select c.relrowsecurity into v_rls_enabled
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'sd_core_wallet_events';

  if coalesce(v_rls_enabled, false) is not true then
    raise exception 'sd_core_wallet_events RLS is not enabled';
  end if;

  v_device := public.sd_core_register_device(
    repeat('a', 64),
    'SD Core Regression PC',
    'windows'
  );
  v_device_id := (v_device ->> 'device_id')::uuid;

  if v_device_id is null then
    raise exception 'register_device did not return device_id';
  end if;

  v_snapshot := public.sd_core_get_snapshot(v_device_id);
  if (v_snapshot ->> 'balance')::bigint <> 1000000 then
    raise exception 'start balance mismatch: %', v_snapshot;
  end if;

  -- Required regression 1: 1,000,000 + reward 100,000 = 1,100,000.
  v_result := public.sd_core_apply_wallet_event(
    v_device_id,
    '33333333-3333-4333-8333-333333333333',
    'reward',
    100000,
    null,
    'regression',
    'reward +100,000',
    '{"case":"required-reward"}'::jsonb
  );

  if (v_result ->> 'balance_after')::bigint <> 1100000 then
    raise exception 'reward result mismatch: %', v_result;
  end if;

  -- Required regression 2: 1,100,000 - spend 200,000 = 900,000.
  v_result := public.sd_core_apply_wallet_event(
    v_device_id,
    '44444444-4444-4444-8444-444444444444',
    'spend',
    200000,
    null,
    'regression',
    'spend 200,000',
    '{"case":"required-spend"}'::jsonb
  );

  if (v_result ->> 'balance_after')::bigint <> 900000 then
    raise exception 'spend result mismatch: %', v_result;
  end if;

  -- Required regression 3: replay the exact reward event. It must not mint again.
  v_result := public.sd_core_apply_wallet_event(
    v_device_id,
    '33333333-3333-4333-8333-333333333333',
    'reward',
    100000,
    null,
    'regression',
    'reward +100,000',
    '{"case":"required-reward"}'::jsonb
  );

  if coalesce((v_result ->> 'duplicate')::boolean, false) is not true then
    raise exception 'reward replay was not marked duplicate: %', v_result;
  end if;

  if (v_result ->> 'current_balance')::bigint <> 900000 then
    raise exception 'reward replay changed or reported wrong current balance: %', v_result;
  end if;

  select balance into v_balance
  from public.wallets
  where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  if v_balance <> 900000 then
    raise exception 'reward replay changed wallet balance: %', v_balance;
  end if;

  -- Reusing event_id with a different request must be rejected, not silently reused.
  begin
    perform public.sd_core_apply_wallet_event(
      v_device_id,
      '33333333-3333-4333-8333-333333333333',
      'reward',
      100001,
      null,
      'regression',
      'reward +100,001',
      '{"case":"conflict"}'::jsonb
    );
    raise exception 'expected IDEMPOTENCY_CONFLICT';
  exception
    when sqlstate 'P1015' then
      null;
  end;

  -- Amount direction is server-owned. Negative client amounts are invalid.
  begin
    perform public.sd_core_apply_wallet_event(
      v_device_id,
      '55555555-5555-4555-8555-555555555555',
      'spend',
      -1,
      null,
      'regression',
      'negative amount must fail',
      '{}'::jsonb
    );
    raise exception 'expected INVALID_AMOUNT';
  exception
    when sqlstate 'P1011' then
      null;
  end;

  -- Required regression 4: simulate re-login/re-sync and fetch server truth again.
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);
  v_snapshot := public.sd_core_get_snapshot(v_device_id);

  if (v_snapshot ->> 'balance')::bigint <> 900000 then
    raise exception 're-login/re-sync balance mismatch: %', v_snapshot;
  end if;

  -- Required regression 5: server-side state is available without PC-local DB/files.
  v_snapshot := public.sd_core_get_snapshot(v_device_id);
  if (v_snapshot ->> 'balance')::bigint <> 900000 then
    raise exception 'server-only snapshot balance mismatch: %', v_snapshot;
  end if;

  select count(*) into v_tx_count
  from public.transactions
  where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and transaction_type in ('sd_core_reward', 'sd_core_spend');

  if v_tx_count <> 2 then
    raise exception 'ledger row count mismatch; duplicate may have been applied: %', v_tx_count;
  end if;

  select count(*) into v_event_count
  from public.sd_core_wallet_events
  where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  if v_event_count <> 2 then
    raise exception 'event journal count mismatch after required regression: %', v_event_count;
  end if;

  -- Extra regression: transfer must update both wallets and create both ledger rows atomically.
  v_result := public.sd_core_apply_wallet_event(
    v_device_id,
    '66666666-6666-4666-8666-666666666666',
    'transfer',
    100000,
    '608-CORE-0002',
    'regression',
    'atomic transfer',
    '{"case":"transfer"}'::jsonb
  );

  if (v_result ->> 'balance_after')::bigint <> 800000
     or nullif(v_result ->> 'counterparty_transaction_id', '') is null then
    raise exception 'transfer response mismatch: %', v_result;
  end if;

  -- Sender can see only its own wallet/ledger under RLS.
  select balance into v_balance
  from public.wallets
  where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  select count(*) into v_tx_count
  from public.transactions
  where metadata ->> 'sd_core_event_id' = '66666666-6666-4666-8666-666666666666';

  if v_balance <> 800000 or v_tx_count <> 1 then
    raise exception 'sender transfer view mismatch balance=% visible_tx=%', v_balance, v_tx_count;
  end if;

  -- Switch JWT identity to receiver and verify the other half independently through RLS.
  perform set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', false);

  select balance into v_target_balance
  from public.wallets
  where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  select count(*) into v_target_tx_count
  from public.transactions
  where metadata ->> 'sd_core_event_id' = '66666666-6666-4666-8666-666666666666';

  if v_target_balance <> 150000 or v_target_tx_count <> 1 then
    raise exception 'receiver transfer view mismatch balance=% visible_tx=%', v_target_balance, v_target_tx_count;
  end if;

  -- The receiver must not see the sender-owned event journal row.
  select count(*) into v_event_count
  from public.sd_core_wallet_events
  where event_id = '66666666-6666-4666-8666-666666666666';

  if v_event_count <> 0 then
    raise exception 'receiver unexpectedly sees sender event journal row';
  end if;

  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);

  -- Transfer replay must not move either wallet again.
  v_result := public.sd_core_apply_wallet_event(
    v_device_id,
    '66666666-6666-4666-8666-666666666666',
    'transfer',
    100000,
    '608-CORE-0002',
    'regression',
    'atomic transfer',
    '{"case":"transfer"}'::jsonb
  );

  select balance into v_balance
  from public.wallets
  where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  if coalesce((v_result ->> 'duplicate')::boolean, false) is not true
     or v_balance <> 800000 then
    raise exception 'transfer replay changed sender state: result=% sender=%', v_result, v_balance;
  end if;

  perform set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', false);
  select balance into v_target_balance
  from public.wallets
  where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  if v_target_balance <> 150000 then
    raise exception 'transfer replay changed receiver state: %', v_target_balance;
  end if;

  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);

  -- A failed transfer must roll back the attempted event and leave both wallets unchanged.
  begin
    perform public.sd_core_apply_wallet_event(
      v_device_id,
      '77777777-7777-4777-8777-777777777777',
      'transfer',
      900000,
      '608-CORE-0002',
      'regression',
      'insufficient transfer',
      '{"case":"transfer-insufficient"}'::jsonb
    );
    raise exception 'expected INSUFFICIENT_FUNDS';
  exception
    when sqlstate 'P1013' then
      null;
  end;

  select balance into v_balance
  from public.wallets
  where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  if v_balance <> 800000 then
    raise exception 'failed transfer changed sender balance=%', v_balance;
  end if;

  if exists (
    select 1 from public.sd_core_wallet_events
    where event_id = '77777777-7777-4777-8777-777777777777'
  ) then
    raise exception 'failed transfer left an event journal row';
  end if;

  perform set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', false);
  select balance into v_target_balance
  from public.wallets
  where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  if v_target_balance <> 150000 then
    raise exception 'failed transfer changed receiver balance=%', v_target_balance;
  end if;

  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);

  -- Direct balance overwrite must remain impossible to authenticated clients.
  begin
    update public.wallets
       set balance = 999999999
     where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  exception
    when insufficient_privilege then
      v_write_blocked := true;
  end;

  if not v_write_blocked then
    raise exception 'authenticated client unexpectedly gained direct wallet UPDATE';
  end if;

  -- Event journal itself is also server-owned for writes.
  begin
    insert into public.sd_core_wallet_events (
      event_id, user_id, device_id, event_type, amount, source_app
    ) values (
      '88888888-8888-4888-8888-888888888888',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      v_device_id,
      'reward',
      1,
      'forbidden-client-write'
    );
  exception
    when insufficient_privilege then
      v_event_write_blocked := true;
  end;

  if not v_event_write_blocked then
    raise exception 'authenticated client unexpectedly gained direct event INSERT';
  end if;
end;
$$;

reset role;

select 'SD Core wallet regression PASS' as result;
