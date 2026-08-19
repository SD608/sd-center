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
  v_tx_count bigint;
  v_event_count bigint;
  v_write_blocked boolean := false;
begin
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
  -- This query uses only the central database and the registered device identity.
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
    raise exception 'event journal count mismatch: %', v_event_count;
  end if;

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
end;
$$;

reset role;

select 'SD Core wallet regression PASS' as result;
