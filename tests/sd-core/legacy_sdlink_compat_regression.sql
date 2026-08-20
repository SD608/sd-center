\set ON_ERROR_STOP on

-- Simulate a legacy SD Link transaction that committed on the server while
-- the client did not receive the response / mark its local transaction processed.
insert into public.devices (
  id, user_id, device_key, device_name, platform, link_status
) values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  repeat('c', 64),
  'Legacy Transition Device',
  'windows',
  'active'
);

insert into public.transactions (
  id, wallet_id, user_id, transaction_type, description, amount,
  balance_before, balance_after, request_id, platform, metadata
) values (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'sd_link_local_deposit',
  'legacy committed reward',
  100000,
  900000,
  1000000,
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'windows',
  jsonb_build_object(
    'sd_link_device_key', repeat('c', 64),
    'sd_link_local_transaction_id', 'legacy-local-reward-1',
    'local_transaction_type', 'deposit'
  )
);

set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);

do $$
declare
  v_result jsonb;
  v_balance bigint;
  v_tx_count bigint;
  v_event_count bigint;
begin
  v_result := public.sd_core_apply_sd_link_event(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'ffffffff-ffff-4fff-8fff-fffffffffff1',
    'legacy-local-reward-1',
    'reward',
    100000,
    'sd_link',
    'retry after lost response',
    '{}'::jsonb
  );

  if coalesce((v_result ->> 'duplicate')::boolean, false) is not true
     or coalesce((v_result ->> 'legacy_duplicate')::boolean, false) is not true
     or (v_result ->> 'transaction_id')::uuid <> 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid then
    raise exception 'legacy duplicate was not recognized: %', v_result;
  end if;

  select balance into v_balance from public.wallets where user_id=auth.uid();
  select count(*) into v_tx_count from public.transactions
    where metadata ->> 'sd_link_local_transaction_id'='legacy-local-reward-1';
  select count(*) into v_event_count from public.sd_core_wallet_events
    where event_id='ffffffff-ffff-4fff-8fff-fffffffffff1';

  if v_balance <> 1000000 or v_tx_count <> 1 or v_event_count <> 0 then
    raise exception 'legacy duplicate changed state balance=% tx=% event=%', v_balance, v_tx_count, v_event_count;
  end if;

  -- Same local ID but different amount must be treated as a conflict, never silently skipped/applied.
  begin
    perform public.sd_core_apply_sd_link_event(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'ffffffff-ffff-4fff-8fff-fffffffffff2',
      'legacy-local-reward-1',
      'reward',
      100001,
      'sd_link',
      'mismatched retry',
      '{}'::jsonb
    );
    raise exception 'expected IDEMPOTENCY_CONFLICT';
  exception when sqlstate 'P1015' then null; end;

  -- A genuinely new local transaction must go through Core once and exact retry must not repeat it.
  v_result := public.sd_core_apply_sd_link_event(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'ffffffff-ffff-4fff-8fff-fffffffffff3',
    'core-local-spend-1',
    'spend',
    200000,
    'sd_link',
    'new Core spend',
    '{"transition":"core"}'::jsonb
  );
  if coalesce((v_result ->> 'duplicate')::boolean, false) is true
     or (v_result ->> 'balance_after')::bigint <> 800000 then
    raise exception 'new Core SD Link event failed: %', v_result;
  end if;

  v_result := public.sd_core_apply_sd_link_event(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'ffffffff-ffff-4fff-8fff-fffffffffff3',
    'core-local-spend-1',
    'spend',
    200000,
    'sd_link',
    'new Core spend',
    '{"transition":"core"}'::jsonb
  );
  if coalesce((v_result ->> 'duplicate')::boolean, false) is not true then
    raise exception 'Core exact retry was not duplicate: %', v_result;
  end if;

  select balance into v_balance from public.wallets where user_id=auth.uid();
  select count(*) into v_tx_count from public.transactions
    where metadata ->> 'sd_link_local_transaction_id'='core-local-spend-1';
  if v_balance <> 800000 or v_tx_count <> 1 then
    raise exception 'Core retry changed state balance=% tx=%', v_balance, v_tx_count;
  end if;

  -- Cross-account device ownership remains rejected.
  perform set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', false);
  begin
    perform public.sd_core_apply_sd_link_event(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      gen_random_uuid(),
      'cross-user',
      'reward',
      1,
      'sd_link',
      '',
      '{}'::jsonb
    );
    raise exception 'expected DEVICE_NOT_FOUND';
  exception when sqlstate 'P1003' then null; end;
end;
$$;

reset role;
select 'SD Core legacy SD Link compatibility regression PASS' as result;
