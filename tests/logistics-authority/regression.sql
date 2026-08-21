\set ON_ERROR_STOP on

set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);

do $$
declare
  v_balance bigint;
  v_tx_count bigint;
  v_result jsonb;
begin
  -- Arbitrary direct-contract reward must not mint.
  begin
    perform public.apply_sd_logistics_wallet_event(
      'direct_contract_reward','forged-contract-1',5000000,
      'aaaaaaaa-0000-4000-8000-000000000001','{"from":"A","to":"B"}'::jsonb
    );
    raise exception 'expected logistics reward authority rejection';
  exception when sqlstate 'P1030' then null;
  end;

  -- Fixed-price vehicle sale is also positive and cannot be trusted from client state alone.
  begin
    perform public.apply_sd_logistics_wallet_event(
      'vehicle_sale_xlarge','forged-sale-1',1500000,
      'aaaaaaaa-0000-4000-8000-000000000002','{}'::jsonb
    );
    raise exception 'expected logistics sale authority rejection';
  exception when sqlstate 'P1030' then null;
  end;

  select balance into v_balance from public.wallets where user_id=auth.uid();
  select count(*) into v_tx_count from public.transactions where user_id=auth.uid();
  if v_balance<>1000000 or v_tx_count<>0 then
    raise exception 'blocked logistics reward changed state balance=% tx=%',v_balance,v_tx_count;
  end if;

  -- A validated-price client spend remains allowed.
  v_result:=public.apply_sd_logistics_wallet_event(
    'vehicle_buy_small','buy-small-1',-250000,
    'aaaaaaaa-0000-4000-8000-000000000003','{}'::jsonb
  );
  if (v_result->>'balance_after')::bigint<>750000
     or coalesce((v_result->>'duplicate')::boolean,false) then
    raise exception 'logistics spend failed: %',v_result;
  end if;

  -- Same economic event retries once only.
  v_result:=public.apply_sd_logistics_wallet_event(
    'vehicle_buy_small','buy-small-1',-250000,
    'aaaaaaaa-0000-4000-8000-000000000004','{"retry":true}'::jsonb
  );
  if coalesce((v_result->>'duplicate')::boolean,false) is not true then
    raise exception 'logistics spend retry was not duplicate: %',v_result;
  end if;

  select balance into v_balance from public.wallets where user_id=auth.uid();
  if v_balance<>750000 then raise exception 'logistics retry changed balance %',v_balance; end if;

  begin
    perform public.apply_sd_logistics_wallet_event(
      'vehicle_buy_small','buy-small-1',-250001,
      'aaaaaaaa-0000-4000-8000-000000000005','{}'::jsonb
    );
    raise exception 'expected logistics idempotency conflict';
  exception when sqlstate 'P1015' then null;
  end;
end;
$$;

reset role;

-- Rejected fresh positive events must leave no internal event rows.
do $$
begin
  if exists(select 1 from public.sd_logistics_wallet_events where reference_id in ('forged-contract-1','forged-sale-1')) then
    raise exception 'blocked logistics reward left event residue';
  end if;
end;
$$;

-- Simulate one reward that committed before hardening but whose response was lost.
insert into public.transactions(
  id,wallet_id,user_id,transaction_type,description,amount,balance_before,balance_after,
  request_id,platform,metadata
) values(
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'sd_logistics_direct_contract_reward','pre-hardening reward',25000,750000,775000,
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','web','{}'::jsonb
);
update public.wallets set balance=775000 where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into public.sd_logistics_wallet_events(
  user_id,wallet_id,event_key,reference_id,amount,request_id,transaction_id
) values(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'direct_contract_reward','pre-hardening-reward-1',25000,
  'eeeeeeee-0000-4000-8000-000000000001',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
);

set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);

do $$
declare
  v_result jsonb;
  v_balance bigint;
begin
  v_result:=public.apply_sd_logistics_wallet_event(
    'direct_contract_reward','pre-hardening-reward-1',25000,
    'aaaaaaaa-0000-4000-8000-000000000006','{}'::jsonb
  );
  if coalesce((v_result->>'duplicate')::boolean,false) is not true
     or (v_result->>'transaction_id')::uuid<>'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid then
    raise exception 'pre-hardening logistics reward was not duplicate-only: %',v_result;
  end if;
  select balance into v_balance from public.wallets where user_id=auth.uid();
  if v_balance<>775000 then raise exception 'positive replay changed balance %',v_balance; end if;

  begin
    perform public.apply_sd_logistics_wallet_event(
      'direct_contract_reward','pre-hardening-reward-1',25001,
      'aaaaaaaa-0000-4000-8000-000000000007','{}'::jsonb
    );
    raise exception 'expected pre-hardening reward conflict';
  exception when sqlstate 'P1015' then null;
  end;
end;
$$;

reset role;
select 'Logistics reward authority regression PASS' as result;
