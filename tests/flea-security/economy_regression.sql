\set ON_ERROR_STOP on

-- Anonymous bridge execution must be gone.
do $$ begin
  if pg_catalog.has_function_privilege('anon','public.sync_sd_flea_pc_inventory_by_device(uuid,text,jsonb,bigint)','EXECUTE') then
    raise exception 'anon still has flea PC inventory bridge EXECUTE';
  end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);

do $$
declare v_result jsonb; begin
  begin
    perform public.sync_sd_flea_pc_inventory_by_device(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',repeat('a',64),'[]'::jsonb,100000000
    );
    raise exception 'cross-user flea sync unexpectedly succeeded';
  exception when sqlstate 'P1032' then null; end;

  v_result := public.sync_sd_flea_pc_inventory_by_device(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    repeat('a',64),
    jsonb_build_array(jsonb_build_object(
      'local_item_id','forged-billion-item',
      'name','위조 고가 아이템',
      'tier','safe',
      'original_value',1000000000,
      'current_value',1000000000,
      'condition_percent',100,
      'source','authority regression'
    )),
    100000000
  );
  if (v_result->>'logistics_rep')::bigint <> 500 then
    raise exception 'client logistics rep overwrote server snapshot: %',v_result;
  end if;
end;
$$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
do $$
declare
  v_item_id uuid;
  v_balance bigint;
begin
  select id into v_item_id
  from public.sd_flea_items
  where origin_user_id=auth.uid() and local_item_key='forged-billion-item';

  begin
    perform public.sell_my_sd_flea_item(v_item_id,'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa','windows');
    raise exception 'unvalidated PC item unexpectedly minted money';
  exception when sqlstate 'P1031' then null; end;

  select balance into v_balance from public.wallets where user_id=auth.uid();
  if v_balance <> 1000000 then raise exception 'blocked PC sale changed wallet %',v_balance; end if;
end;
$$;
reset role;

-- Blocked PC item must remain owned and create no stock/action/ledger payout.
do $$
declare
  v_item_id uuid;
  v_count bigint;
begin
  select id into v_item_id
  from public.sd_flea_items
  where origin_user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and local_item_key='forged-billion-item';

  if not exists(select 1 from public.sd_flea_items where id=v_item_id and status='owned' and owner_user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then
    raise exception 'blocked PC item was removed or transferred';
  end if;
  select count(*) into v_count from public.transactions where metadata->>'item_id'=v_item_id::text;
  if v_count <> 0 then raise exception 'blocked PC item created a ledger row'; end if;
  if exists(select 1 from public.sd_flea_market_stock where item_id=v_item_id) then raise exception 'blocked PC item entered market stock'; end if;
  if exists(select 1 from public.sd_flea_market_actions where request_id='aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa') then raise exception 'blocked PC sale created action row'; end if;
  if (select logistics_rep from public.sd_flea_company_snapshots where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 500 then
    raise exception 'client-supplied logistics rep changed snapshot';
  end if;
end $$;

-- Legitimate server-purchased item resale remains available at 50%.
insert into public.sd_flea_items(
  id,origin_user_id,owner_user_id,local_item_key,name,tier,original_value,current_value,condition_percent,
  source_text,acquisition_kind,purchase_price,status,acquired_at,created_at,updated_at
) values(
  'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'server-purchase-1','정상 서버 구매품','premium',100000,100000,100,
  'server market','system_purchase',100000,'owned',now(),now(),now()
);

set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
do $$
declare v_result jsonb; begin
  v_result := public.sell_my_sd_flea_item(
    'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa',
    'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa',
    'windows'
  );
  if (v_result->>'payout')::bigint <> 50000 or (v_result->>'balance_after')::bigint <> 1050000 then
    raise exception 'server-purchased resale regression %',v_result;
  end if;
end;
$$;
reset role;

select 'SD Flea PC inventory economy authority regression PASS' as result;
