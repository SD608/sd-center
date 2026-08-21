-- SD Flea Market PC inventory economy authority hardening v1
-- Preserve existing PC inventory, but do not let unvalidated client item values mint online wallet money.
-- Also remove anonymous/cross-user device bridge access and ignore client-supplied logistics reputation.

begin;

create or replace function public.sync_sd_flea_pc_inventory_by_device(
  p_user_id uuid,
  p_device_key text,
  p_items jsonb,
  p_logistics_rep bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_device_id uuid;
  v_status text;
  v_nickname text;
  v_entry jsonb;
  v_local_id text;
  v_name text;
  v_tier text;
  v_original bigint;
  v_current bigint;
  v_condition numeric;
  v_acquired timestamptz;
  v_source text;
  v_box_id text;
  v_synced integer := 0;
  v_owned_ids jsonb := '[]'::jsonb;
  v_rep bigint := 0;
begin
  if v_auth_user_id is null then
    raise exception using errcode = 'P1001', message = '로그인이 필요합니다.';
  end if;
  if p_user_id is null or p_user_id is distinct from v_auth_user_id then
    raise exception using errcode = 'P1032', message = '로그인 계정과 동기화 계정이 일치하지 않습니다.';
  end if;
  p_user_id := v_auth_user_id;

  p_device_key := lower(trim(coalesce(p_device_key, '')));
  if p_device_key !~ '^[0-9a-f]{64}$' then
    raise exception 'SD Link 기기키 형식이 올바르지 않습니다.';
  end if;

  select d.id
    into v_device_id
  from public.devices d
  where d.user_id = p_user_id
    and d.device_key = p_device_key
    and d.platform = 'windows'
    and d.revoked_at is null
    and coalesce(d.link_status, 'active') = 'active'
  limit 1;

  if v_device_id is null then
    raise exception '등록된 SD Link PC가 아닙니다.';
  end if;

  select p.status, p.nickname
    into v_status, v_nickname
  from public.profiles p
  where p.id = p_user_id;

  if coalesce(v_status, '') <> 'active' then
    raise exception '현재 이용할 수 없는 계정입니다.';
  end if;

  if p_items is null then p_items := '[]'::jsonb; end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception '아이템 목록 형식이 올바르지 않습니다.';
  end if;
  if jsonb_array_length(p_items) > 5000 then
    raise exception '한 번에 동기화할 수 있는 아이템 수를 초과했습니다.';
  end if;

  for v_entry in select value from jsonb_array_elements(p_items)
  loop
    v_local_id := left(trim(coalesce(v_entry->>'local_item_id','')), 120);
    v_name := left(trim(coalesce(v_entry->>'name','')), 120);
    v_tier := lower(trim(coalesce(v_entry->>'tier','worn')));
    v_original := greatest(0, least(1000000000, coalesce((v_entry->>'original_value')::bigint, 0)));
    v_current := greatest(0, least(1000000000, coalesce((v_entry->>'current_value')::bigint, v_original)));
    v_condition := greatest(0, least(100, coalesce((v_entry->>'condition_percent')::numeric, 100)));
    v_source := left(trim(coalesce(v_entry->>'source','PC 플리마켓')), 160);
    v_box_id := nullif(left(trim(coalesce(v_entry->>'box_id','')), 120), '');

    if v_local_id = '' or v_name = '' then
      raise exception '아이템 ID 또는 이름이 비어 있습니다.';
    end if;
    if v_tier not in ('worn','normal','fancy','premium','safe') then
      raise exception '알 수 없는 아이템 등급입니다: %', v_tier;
    end if;

    begin
      v_acquired := nullif(trim(coalesce(v_entry->>'acquired_at','')), '')::timestamptz;
    exception when others then
      v_acquired := now();
    end;
    v_acquired := coalesce(v_acquired, now());

    insert into public.sd_flea_items as i (
      origin_user_id, owner_user_id, local_item_key, box_id,
      name, tier, original_value, current_value, condition_percent,
      source_text, acquisition_kind, purchase_price, status, acquired_at,
      created_at, updated_at
    ) values (
      p_user_id, p_user_id, v_local_id, v_box_id,
      v_name, v_tier, v_original, v_current, v_condition,
      v_source, 'pc', null, 'owned', v_acquired,
      now(), now()
    )
    on conflict (origin_user_id, local_item_key) do update set
      box_id = excluded.box_id,
      name = excluded.name,
      tier = excluded.tier,
      original_value = excluded.original_value,
      current_value = excluded.current_value,
      condition_percent = excluded.condition_percent,
      source_text = excluded.source_text,
      acquired_at = excluded.acquired_at,
      updated_at = now()
    where i.owner_user_id = p_user_id
      and i.status = 'owned'
      and i.acquisition_kind = 'pc';

    v_synced := v_synced + 1;
  end loop;

  select coalesce(jsonb_agg(i.local_item_key order by i.created_at), '[]'::jsonb)
    into v_owned_ids
  from public.sd_flea_items i
  where i.origin_user_id = p_user_id
    and i.owner_user_id = p_user_id
    and i.status = 'owned'
    and exists (
      select 1
      from jsonb_array_elements(p_items) e
      where trim(coalesce(e->>'local_item_id','')) = i.local_item_key
    );

  -- p_logistics_rep is intentionally ignored. A client/device proves identity, not company rank.
  select coalesce(s.logistics_rep, 0)
    into v_rep
  from public.sd_flea_company_snapshots s
  where s.user_id = p_user_id;
  v_rep := coalesce(v_rep, 0);

  return jsonb_build_object(
    'ok', true,
    'synced_count', v_synced,
    'owned_local_item_ids', coalesce(v_owned_ids, '[]'::jsonb),
    'nickname', v_nickname,
    'logistics_rep', v_rep,
    'device_verified', true
  );
end;
$$;

revoke execute on function public.sync_sd_flea_pc_inventory_by_device(uuid, text, jsonb, bigint)
  from public, anon;
grant execute on function public.sync_sd_flea_pc_inventory_by_device(uuid, text, jsonb, bigint)
  to authenticated;

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
  v_existing jsonb;
  v_item public.sd_flea_items%rowtype;
  v_wallet_id uuid;
  v_balance_before bigint;
  v_balance_after bigint;
  v_payout bigint;
  v_list_price bigint;
  v_result jsonb;
begin
  if v_user_id is null then raise exception '로그인이 필요합니다.'; end if;
  if p_item_id is null or p_request_id is null then raise exception '요청 정보가 없습니다.'; end if;
  p_platform := lower(trim(coalesce(p_platform, 'android')));
  if p_platform not in ('android','web','windows') then p_platform := 'web'; end if;

  select a.result into v_existing
  from public.sd_flea_market_actions a
  where a.request_id = p_request_id and a.user_id = v_user_id and a.action_type = 'sell';
  if found then return v_existing; end if;

  select * into v_item
  from public.sd_flea_items i
  where i.id = p_item_id
  for update;

  if not found or v_item.owner_user_id <> v_user_id or v_item.status <> 'owned' then
    raise exception '판매할 수 있는 아이템을 찾지 못했습니다.';
  end if;

  if v_item.acquisition_kind = 'pc' then
    raise exception using errcode = 'P1031', message = 'PC에서 획득한 물건은 서버 검증이 완료될 때까지 온라인 판매할 수 없습니다.';
  end if;
  if v_item.acquisition_kind <> 'system_purchase' then
    raise exception '판매할 수 있는 아이템 유형이 아닙니다.';
  end if;

  select w.id, w.balance into v_wallet_id, v_balance_before
  from public.wallets w
  where w.user_id = v_user_id
  for update;
  if v_wallet_id is null then raise exception 'SD 가상지갑을 찾지 못했습니다.'; end if;

  v_payout := floor(greatest(0, coalesce(v_item.purchase_price, v_item.current_value)) * 0.50)::bigint;
  v_list_price := greatest(0, coalesce(v_item.purchase_price, v_item.current_value));
  v_balance_after := v_balance_before + v_payout;

  update public.wallets set balance = v_balance_after where id = v_wallet_id;

  update public.sd_flea_items
  set owner_user_id = null,
      status = 'system_stock',
      updated_at = now()
  where id = v_item.id;

  insert into public.sd_flea_market_stock(item_id, last_seller_user_id, list_price, listed_at, updated_at)
  values (v_item.id, v_user_id, v_list_price, now(), now())
  on conflict (item_id) do update set
    last_seller_user_id = excluded.last_seller_user_id,
    list_price = excluded.list_price,
    listed_at = now(),
    updated_at = now();

  insert into public.transactions (
    wallet_id, user_id, transaction_type, description,
    amount, balance_before, balance_after, platform, metadata
  ) values (
    v_wallet_id, v_user_id, 'flea_sell',
    'SD 플리마켓 시스템 재판매 · ' || v_item.name,
    v_payout, v_balance_before, v_balance_after, p_platform,
    jsonb_build_object(
      'item_id', v_item.id,
      'acquisition_kind', v_item.acquisition_kind,
      'system_list_price', v_list_price,
      'sale_rule', 'system_purchase_resale_50pct'
    )
  );

  v_result := jsonb_build_object(
    'ok', true,
    'item_id', v_item.id,
    'name', v_item.name,
    'payout', v_payout,
    'list_price', v_list_price,
    'balance_after', v_balance_after,
    'resale_rule', '50%'
  );

  insert into public.sd_flea_market_actions(request_id, user_id, action_type, result)
  values (p_request_id, v_user_id, 'sell', v_result);

  return v_result;
end;
$$;

revoke execute on function public.sell_my_sd_flea_item(uuid, uuid, text)
  from public, anon;
grant execute on function public.sell_my_sd_flea_item(uuid, uuid, text)
  to authenticated;

comment on function public.sync_sd_flea_pc_inventory_by_device(uuid,text,jsonb,bigint) is
  'Authenticated PC inventory sync. Caller identity must equal auth.uid(); client-supplied logistics reputation is ignored.';
comment on function public.sell_my_sd_flea_item(uuid,uuid,text) is
  'Online sale authority. Unvalidated PC-origin inventory cannot mint wallet money; server-purchased items retain 50% resale.';

commit;
