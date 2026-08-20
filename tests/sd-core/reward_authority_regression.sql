\set ON_ERROR_STOP on

-- Final-state authority regression. Run after sd_core_reward_authority_v1.sql.
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);

do $$
declare
  v_device jsonb;
  v_device_id uuid;
  v_balance bigint;
  v_events bigint;
  v_txs bigint;
  v_result jsonb;
  v_blocked boolean := false;
begin
  v_device := public.sd_core_register_device(repeat('d',64), 'Authority Regression PC', 'windows');
  v_device_id := (v_device ->> 'device_id')::uuid;

  if pg_catalog.has_function_privilege(
    'authenticated',
    'sd_core_private.apply_wallet_event_impl(uuid,uuid,text,bigint,text,text,text,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'authenticated still has unrestricted Core wallet implementation EXECUTE';
  end if;

  if not pg_catalog.has_function_privilege(
    'authenticated',
    'sd_core_private.apply_client_wallet_event_impl(uuid,uuid,text,bigint,text,text,text,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'authenticated lacks restricted client Core implementation EXECUTE';
  end if;

  select balance into v_balance from public.wallets where user_id = auth.uid();
  if v_balance <> 1000000 then raise exception 'unexpected authority-test start balance %', v_balance; end if;

  begin
    perform public.sd_core_apply_wallet_event(
      v_device_id,
      'aaaaaaaa-0000-4000-8000-000000000001',
      'reward',
      500000000,
      null,
      'forged-client',
      'must not mint',
      '{"forged":true}'::jsonb
    );
    raise exception 'expected REWARD_CAPABILITY_REQUIRED';
  exception when sqlstate 'P1030' then
    v_blocked := true;
  end;

  if not v_blocked then raise exception 'client reward was not blocked'; end if;

  select balance into v_balance from public.wallets where user_id = auth.uid();
  select count(*) into v_events from public.sd_core_wallet_events where event_id='aaaaaaaa-0000-4000-8000-000000000001';
  select count(*) into v_txs from public.transactions where metadata ->> 'sd_core_event_id'='aaaaaaaa-0000-4000-8000-000000000001';
  if v_balance <> 1000000 or v_events <> 0 or v_txs <> 0 then
    raise exception 'blocked reward left state balance=% events=% txs=%', v_balance, v_events, v_txs;
  end if;

  v_result := public.sd_core_apply_wallet_event(
    v_device_id,
    'aaaaaaaa-0000-4000-8000-000000000002',
    'spend',
    100000,
    null,
    'authority-regression',
    'client spend',
    '{}'::jsonb
  );
  if (v_result ->> 'balance_after')::bigint <> 900000 then
    raise exception 'client spend failed after authority hardening: %', v_result;
  end if;

  begin
    perform sd_core_private.apply_wallet_event_impl(
      v_device_id,
      'aaaaaaaa-0000-4000-8000-000000000003',
      'reward',
      1,
      null,
      'direct-private-bypass',
      '',
      '{}'::jsonb
    );
    raise exception 'authenticated bypassed restricted Core API';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);
do $$
declare
  v_device_id uuid;
  v_result jsonb;
  v_balance bigint;
begin
  select id into v_device_id
  from public.devices
  where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and device_key=repeat('d',64);

  v_result := sd_core_private.apply_wallet_event_impl(
    v_device_id,
    'aaaaaaaa-0000-4000-8000-000000000010',
    'reward',
    50000,
    null,
    'trusted-server-regression',
    'validated server reward',
    '{"validated":true}'::jsonb
  );
  if (v_result ->> 'balance_after')::bigint <> 950000 then
    raise exception 'trusted server reward failed: %', v_result;
  end if;

  v_result := sd_core_private.apply_wallet_event_impl(
    v_device_id,
    'aaaaaaaa-0000-4000-8000-000000000010',
    'reward',
    50000,
    null,
    'trusted-server-regression',
    'validated server reward',
    '{"validated":true}'::jsonb
  );
  if coalesce((v_result ->> 'duplicate')::boolean,false) is not true
     or (v_result ->> 'current_balance')::bigint <> 950000 then
    raise exception 'trusted reward replay was not exactly-once: %', v_result;
  end if;

  update public.wallets set balance=975000 where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  insert into public.transactions(
    wallet_id,user_id,transaction_type,description,amount,balance_before,balance_after,request_id,platform,metadata
  )
  select w.id,w.user_id,'deposit','legacy committed reward',25000,950000,975000,
         'aaaaaaaa-0000-4000-8000-000000000011','windows',
         jsonb_build_object('sd_link_device_key',repeat('d',64),'sd_link_local_transaction_id','legacy-reward-1')
  from public.wallets w where w.user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  select balance into v_balance from public.wallets where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if v_balance <> 975000 then raise exception 'legacy setup balance mismatch %',v_balance; end if;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);
do $$
declare
  v_device_id uuid;
  v_result jsonb;
  v_balance bigint;
begin
  select id into v_device_id from public.devices where user_id=auth.uid() and device_key=repeat('d',64);

  v_result := public.sd_core_apply_sd_link_event(
    v_device_id,
    'aaaaaaaa-0000-4000-8000-000000000012',
    'legacy-reward-1',
    'reward',
    25000,
    'sd_link',
    'legacy replay',
    '{}'::jsonb
  );
  if coalesce((v_result ->> 'legacy_duplicate')::boolean,false) is not true then
    raise exception 'legacy reward replay was not deduplicated: %',v_result;
  end if;

  select balance into v_balance from public.wallets where user_id=auth.uid();
  if v_balance <> 975000 then raise exception 'legacy reward replay changed balance %',v_balance; end if;

  begin
    perform public.sd_core_apply_sd_link_event(
      v_device_id,
      'aaaaaaaa-0000-4000-8000-000000000013',
      'new-forged-reward',
      'reward',
      25000,
      'sd_link',
      'new reward must fail',
      '{}'::jsonb
    );
    raise exception 'expected new SD Link reward to require capability';
  exception when sqlstate 'P1030' then null;
  end;

  select balance into v_balance from public.wallets where user_id=auth.uid();
  if v_balance <> 975000 then raise exception 'blocked SD Link reward changed balance %',v_balance; end if;

  v_result := public.sd_core_apply_sd_link_event(
    v_device_id,
    'aaaaaaaa-0000-4000-8000-000000000014',
    'new-spend-1',
    'spend',
    1000,
    'sd_link',
    'new spend remains allowed',
    '{}'::jsonb
  );
  if (v_result ->> 'balance_after')::bigint <> 974000 then
    raise exception 'SD Link spend failed after reward hardening: %',v_result;
  end if;
end;
$$;

reset role;
select 'SD Core reward authority regression PASS' as result;
