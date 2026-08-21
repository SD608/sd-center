-- SD Flea PC authority v2 segment 6/6
begin;

-- Extend the existing flea sale authority to server-issued PC loot. Client-supplied PC inventory remains blocked.
create or replace function public.sell_my_sd_flea_item(
  p_item_id uuid,
  p_request_id uuid,
  p_platform text default 'android'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.sd_flea_market_actions%rowtype;
  v_item public.sd_flea_items%rowtype;
  v_receipt public.sd_flea_pc_loot_receipts%rowtype;
  v_payout bigint;
  v_list_price bigint;
  v_wallet jsonb;
  v_result jsonb;
begin
  if v_user_id is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  if p_item_id is null or p_request_id is null then raise exception using errcode='P1007',message='REQUEST_ID_REQUIRED'; end if;
  p_platform := lower(trim(coalesce(p_platform,'android')));
  if p_platform not in ('android','web','windows') then p_platform := 'web'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into v_existing from public.sd_flea_market_actions where request_id=p_request_id;
  if v_existing.request_id is not null then
    if v_existing.user_id is distinct from v_user_id or v_existing.action_type<>'sell'
       or coalesce(v_existing.result->>'item_id','')<>p_item_id::text then
      raise exception using errcode='P1015',message='FLEA_SALE_REQUEST_IDEMPOTENCY_CONFLICT';
    end if;
    return v_existing.result;
  end if;

  select * into v_item from public.sd_flea_items where id=p_item_id for update;
  if v_item.id is null or v_item.owner_user_id is distinct from v_user_id or v_item.status<>'owned' then
    raise exception using errcode='P1031',message='FLEA_ITEM_NOT_SELLABLE';
  end if;

  if v_item.acquisition_kind='pc' then
    raise exception using errcode='P1031',message='UNVALIDATED_PC_FLEA_ITEM';
  elsif v_item.acquisition_kind='system_purchase' then
    v_list_price:=greatest(0,coalesce(v_item.purchase_price,v_item.current_value));
    v_payout:=floor(v_list_price*0.50)::bigint;
  elsif v_item.acquisition_kind='server_loot' then
    select * into v_receipt from public.sd_flea_pc_loot_receipts where flea_item_id=v_item.id and user_id=v_user_id;
    if v_receipt.id is null or not v_receipt.sellable then
      raise exception using errcode='P1031',message='SERVER_LOOT_NOT_SELLABLE';
    end if;
    v_list_price:=greatest(0,v_receipt.server_value);
    v_payout:=v_list_price;
  else
    raise exception using errcode='P1031',message='FLEA_ITEM_KIND_NOT_SELLABLE';
  end if;
  if v_payout<=0 then raise exception using errcode='P1031',message='FLEA_ITEM_ZERO_VALUE'; end if;

  v_wallet:=sd_core_private.apply_server_wallet_delta_impl(
    v_user_id,p_request_id,'flea_sell',v_payout,'sd_flea',
    'SD 플리마켓 판매 · '||v_item.name,
    jsonb_build_object('item_id',v_item.id,'acquisition_kind',v_item.acquisition_kind,'list_price',v_list_price,'platform',p_platform)
  );

  update public.sd_flea_items set owner_user_id=null,status='system_stock',updated_at=now() where id=v_item.id;
  insert into public.sd_flea_market_stock(item_id,last_seller_user_id,list_price,listed_at,updated_at)
  values(v_item.id,v_user_id,v_list_price,now(),now())
  on conflict(item_id) do update set last_seller_user_id=excluded.last_seller_user_id,list_price=excluded.list_price,listed_at=now(),updated_at=now();

  v_result:=jsonb_build_object(
    'ok',true,'item_id',v_item.id,'name',v_item.name,'payout',v_payout,'list_price',v_list_price,
    'balance_after',(v_wallet->>'balance_after')::bigint,
    'resale_rule',case when v_item.acquisition_kind='system_purchase' then '50%' else 'server-loot-value' end
  );
  insert into public.sd_flea_market_actions(request_id,user_id,action_type,result)
  values(p_request_id,v_user_id,'sell',v_result);
  return v_result;
end;
$$;
revoke execute on function public.sell_my_sd_flea_item(uuid,uuid,text) from public,anon;
grant execute on function public.sell_my_sd_flea_item(uuid,uuid,text) to authenticated;
comment on function public.sell_my_sd_flea_item(uuid,uuid,text) is
  'Server-authoritative sale. Unvalidated PC inventory remains blocked; system purchases resell at 50%, server-issued PC loot uses its immutable server receipt value.';

-- These 13 PC-only flea achievements now have a server-owned producer/validator path.
update public.sd_achievements set active=true where code=any(array[
 'flea-01','flea-02','flea-03','flea-04','flea-08','flea-09','flea-10','flea-11','flea-14','flea-15','flea-16','flea-17','flea-18'
]::text[]);

-- Preserve any already-earned higher progress/unlocks and only add authoritative current state.
do $$ declare r record; begin
  for r in select user_id from public.sd_flea_pc_accounts loop
    perform private.refresh_sd_flea_pc_achievements(r.user_id);
  end loop;
end $$;

comment on table public.sd_flea_pc_missions is 'Server-owned PC flea missions. Clients request actions but do not submit loot value, RNG result, achievement progress or bank counters.';
comment on function public.sd_flea_pc_bank_finish(uuid,boolean,uuid) is 'Settles a server-issued bank mission. Success is accepted only after an active server escape window and checkpoint sequence; loot, timing-derived max-speed distance and achievement counters are server-computed.';

commit;
