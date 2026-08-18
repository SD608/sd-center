-- SD608 공개 프로필: 슬롯 카드 항목 완전 삭제
-- Live migration: remove_profile_slot_block
-- 적용 후 카드 구성은 photo / identity / assets / gold / coins 5개만 허용한다.

create or replace function public.save_sd_profile_card_layout(p_layout jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_allowed constant text[] := array['photo','identity','assets','gold','coins'];
  v_order text[] := array[]::text[];
  v_key text;
  v_visible jsonb;
  v_gold_display text;
  v_coin_codes text[] := array[]::text[];
  v_coin_code text;
  v_result jsonb;
begin
  if v_user_id is null then raise exception '로그인이 필요합니다.'; end if;
  if not exists (select 1 from public.sd_public_profiles where user_id = v_user_id) then
    raise exception '먼저 공개 프로필을 만들어 주세요.';
  end if;
  if p_layout is null or jsonb_typeof(p_layout) <> 'object' then
    raise exception '프로필 카드 배치 정보가 올바르지 않습니다.';
  end if;

  if jsonb_typeof(p_layout->'order') = 'array' then
    for v_key in select jsonb_array_elements_text(p_layout->'order') loop
      if v_key = any(v_allowed) and not (v_key = any(v_order)) then v_order := array_append(v_order, v_key); end if;
    end loop;
  end if;
  foreach v_key in array v_allowed loop
    if not (v_key = any(v_order)) then v_order := array_append(v_order, v_key); end if;
  end loop;

  v_visible := jsonb_build_object(
    'photo', case when jsonb_typeof(p_layout->'visible'->'photo')='boolean' then (p_layout->'visible'->>'photo')::boolean else true end,
    'identity', case when jsonb_typeof(p_layout->'visible'->'identity')='boolean' then (p_layout->'visible'->>'identity')::boolean else true end,
    'assets', case when jsonb_typeof(p_layout->'visible'->'assets')='boolean' then (p_layout->'visible'->>'assets')::boolean else true end,
    'gold', case when jsonb_typeof(p_layout->'visible'->'gold')='boolean' then (p_layout->'visible'->>'gold')::boolean else true end,
    'coins', case when jsonb_typeof(p_layout->'visible'->'coins')='boolean' then (p_layout->'visible'->>'coins')::boolean else true end
  );

  v_gold_display := lower(coalesce(p_layout->'settings'->>'gold_display','count'));
  if v_gold_display='weight' then v_gold_display := 'g'; end if;
  if v_gold_display not in ('count','g','kg') then v_gold_display := 'count'; end if;

  if jsonb_typeof(p_layout->'settings'->'coin_codes')='array' then
    for v_coin_code in
      select c.code
      from public.sd_coins c
      join (select distinct upper(value) code from jsonb_array_elements_text(p_layout->'settings'->'coin_codes')) r
        on r.code=upper(c.code)
      where c.is_active=true
      order by c.sort_order
    loop
      v_coin_codes := array_append(v_coin_codes,v_coin_code);
    end loop;
  else
    select coalesce(array_agg(c.code order by c.sort_order),array[]::text[])
      into v_coin_codes from public.sd_coins c where c.is_active=true;
  end if;

  v_result := jsonb_build_object(
    'version',4,
    'order',to_jsonb(v_order),
    'visible',v_visible,
    'settings',jsonb_build_object('gold_display',v_gold_display,'coin_codes',to_jsonb(v_coin_codes))
  );

  update public.sd_public_profiles set card_layout=v_result,updated_at=now() where user_id=v_user_id;
  return jsonb_build_object('ok',true,'card_layout',v_result);
end;
$function$;

-- get_sd_public_profile()도 같은 허용 목록을 사용하고 slot_best를 응답에 포함하지 않는다.
-- 기존 저장값에서 slot_best를 제거한다.
update public.sd_public_profiles p
set card_layout = jsonb_build_object(
  'version',4,
  'order',coalesce((
    select jsonb_agg(value order by ord)
    from jsonb_array_elements_text(coalesce(p.card_layout->'order','[]'::jsonb)) with ordinality t(value,ord)
    where value in ('photo','identity','assets','gold','coins')
  ), '["photo","identity","assets","gold","coins"]'::jsonb),
  'visible',jsonb_build_object(
    'photo',coalesce((p.card_layout->'visible'->>'photo')::boolean,true),
    'identity',coalesce((p.card_layout->'visible'->>'identity')::boolean,true),
    'assets',coalesce((p.card_layout->'visible'->>'assets')::boolean,true),
    'gold',coalesce((p.card_layout->'visible'->>'gold')::boolean,true),
    'coins',coalesce((p.card_layout->'visible'->>'coins')::boolean,true)
  ),
  'settings',jsonb_build_object(
    'gold_display',case when lower(coalesce(p.card_layout->'settings'->>'gold_display','count'))='weight' then 'g' else lower(coalesce(p.card_layout->'settings'->>'gold_display','count')) end,
    'coin_codes',coalesce(p.card_layout->'settings'->'coin_codes',(select coalesce(jsonb_agg(c.code order by c.sort_order),'[]'::jsonb) from public.sd_coins c where c.is_active=true))
  )
),updated_at=now();
