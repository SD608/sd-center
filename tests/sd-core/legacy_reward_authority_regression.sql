\set ON_ERROR_STOP on

-- Run after fixture.sql + legacy_reward_authority_fixture.sql +
-- sd_core_legacy_reward_authority_v1.sql.

insert into public.devices(
  id,user_id,device_key,device_name,platform,link_status,wallet_fingerprint
) values(
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  repeat('c',64),
  'Legacy Authority PC',
  'windows',
  'active',
  repeat('f',64)
);

set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);

do $$
declare
  v_balance bigint;
  v_tx_count bigint;
  v_result jsonb;
begin
  begin
    perform public.push_sd_link_transaction(
      repeat('c',64), 'forged-positive-1', 'deposit', 'forged local reward',
      500000000, now(), '{"forged":true}'::jsonb
    );
    raise exception 'expected REWARD_CAPABILITY_REQUIRED';
  exception when sqlstate 'P1030' then null;
  end;

  select balance into v_balance from public.wallets where user_id=auth.uid();
  select count(*) into v_tx_count from public.transactions where user_id=auth.uid();
  if v_balance <> 1000000 or v_tx_count <> 0 then
    raise exception 'blocked legacy reward left state balance=% tx=%',v_balance,v_tx_count;
  end if;

  v_result := public.push_sd_link_transaction(
    repeat('c',64), 'legacy-spend-1', 'withdraw', 'legacy spend',
    -100000, now(), '{}'::jsonb
  );
  if (v_result->>'balance_after')::bigint <> 900000
     or coalesce((v_result->>'duplicate')::boolean,false) then
    raise exception 'legacy spend failed: %',v_result;
  end if;

  v_result := public.push_sd_link_transaction(
    repeat('c',64), 'legacy-spend-1', 'withdraw', 'retry wording may differ',
    -100000, now(), '{"retry":true}'::jsonb
  );
  if coalesce((v_result->>'duplicate')::boolean,false) is not true then
    raise exception 'legacy exact amount retry was not duplicate: %',v_result;
  end if;

  select balance into v_balance from public.wallets where user_id=auth.uid();
  if v_balance <> 900000 then raise exception 'legacy spend retry changed balance %',v_balance; end if;

  begin
    perform public.push_sd_link_transaction(
      repeat('c',64), 'legacy-spend-1', 'withdraw', 'changed amount',
      -100001, now(), '{}'::jsonb
    );
    raise exception 'expected IDEMPOTENCY_CONFLICT';
  exception when sqlstate 'P1015' then null;
  end;

  select balance into v_balance from public.wallets where user_id=auth.uid();
  if v_balance <> 900000 then raise exception 'legacy conflict changed balance %',v_balance; end if;
end;
$$;

reset role;

-- The rejected fresh reward must not have created an internal operation row.
do $$
begin
  if exists (
    select 1 from public.sd_link_local_operations
    where local_transaction_id='forged-positive-1'
  ) then
    raise exception 'blocked legacy reward left operation residue';
  end if;
end;
$$;

-- Simulate a positive legacy operation that had committed before hardening.
insert into public.transactions(
  id,wallet_id,user_id,transaction_type,description,amount,
  balance_before,balance_after,request_id,platform,metadata
) values(
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'sd_link_local_deposit',
  'pre-hardening committed reward',
  25000,
  900000,
  925000,
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'windows',
  jsonb_build_object('sd_link_device_key',repeat('c',64),'sd_link_local_transaction_id','pre-hardening-reward-1')
);
update public.wallets set balance=925000 where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into public.sd_link_local_operations(
  user_id,wallet_id,device_id,local_transaction_id,server_transaction_id
) values(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'pre-hardening-reward-1',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
);

set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);

do $$
declare
  v_result jsonb;
  v_balance bigint;
begin
  v_result := public.push_sd_link_transaction(
    repeat('c',64), 'pre-hardening-reward-1', 'deposit', 'lost response replay',
    25000, now(), '{}'::jsonb
  );
  if coalesce((v_result->>'duplicate')::boolean,false) is not true
     or (v_result->>'transaction_id')::uuid <> 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid then
    raise exception 'pre-hardening positive replay was not duplicate-only: %',v_result;
  end if;

  select balance into v_balance from public.wallets where user_id=auth.uid();
  if v_balance <> 925000 then raise exception 'pre-hardening replay changed balance %',v_balance; end if;

  begin
    perform public.push_sd_link_transaction(
      repeat('c',64), 'pre-hardening-reward-1', 'deposit', 'mismatched replay',
      25001, now(), '{}'::jsonb
    );
    raise exception 'expected positive replay conflict';
  exception when sqlstate 'P1015' then null;
  end;
end;
$$;

reset role;
select 'Legacy SD Link reward authority regression PASS' as result;
