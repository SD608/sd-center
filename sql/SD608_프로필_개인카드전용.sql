-- SD608 공개 프로필을 개인 카드 전용으로 정리
-- live migration: profile_personal_card_only
-- 제거: showcase_items, achievements 공개 프로필 payload
-- 유지: 업적 기반 장착 칭호는 title 필드 계산에만 내부 사용

create or replace function public.get_sd_public_profile(p_user_id uuid default null::uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_viewer uuid := auth.uid();
  v_target uuid := coalesce(p_user_id, auth.uid());
  v_is_me boolean;
  v_nickname text;
  v_status text;
  v_profile public.sd_public_profiles%rowtype;
  v_gold_bars bigint := 0;
  v_gold_grams numeric := 0;
  v_gold_kilograms numeric := 0;
  v_gold_value bigint := 0;
  v_coins jsonb := '[]'::jsonb;
  v_avatar_url text;
  v_title text;
  v_raw_layout jsonb;
  v_card_layout jsonb;
  v_order text[] := array[]::text[];
  v_allowed constant text[] := array['photo','identity','assets','gold','coins'];
  v_key text;
  v_gold_display text;
  v_coin_codes text[] := array[]::text[];
  v_coin_code text;
  v_show_photo boolean;
  v_show_identity boolean;
  v_show_assets boolean;
  v_show_gold boolean;
  v_show_coins boolean;
  v_data_photo boolean;
  v_data_identity boolean;
  v_data_assets boolean;
  v_data_gold boolean;
  v_data_coins boolean;
  v_assets jsonb;
begin
  if v_viewer is null then raise exception '로그인이 필요합니다.'; end if;
  if v_target is null then raise exception '프로필 대상이 없습니다.'; end if;
  v_is_me := v_target = v_viewer;

  select nickname,status into v_nickname,v_status from public.profiles where id=v_target;
  if v_nickname is null or v_status <> 'active' then raise exception '조회할 수 없는 회원입니다.'; end if;

  select * into v_profile from public.sd_public_profiles where user_id=v_target;
  if not found then
    return jsonb_build_object('created',false,'is_me',v_is_me,'user_id',v_target,'nickname',v_nickname);
  end if;
  if not v_profile.enabled and not v_is_me then raise exception '비공개 프로필입니다.'; end if;

  v_raw_layout := coalesce(v_profile.card_layout, '{}'::jsonb);
  if jsonb_typeof(v_raw_layout->'order') = 'array' then
    for v_key in select jsonb_array_elements_text(v_raw_layout->'order') loop
      if v_key = any(v_allowed) and not (v_key = any(v_order)) then v_order := array_append(v_order, v_key); end if;
    end loop;
  end if;
  foreach v_key in array v_allowed loop
    if not (v_key = any(v_order)) then v_order := array_append(v_order, v_key); end if;
  end loop;

  v_gold_display := lower(coalesce(v_raw_layout->'settings'->>'gold_display', 'count'));
  if v_gold_display = 'weight' then v_gold_display := 'g'; end if;
  if v_gold_display not in ('count','g','kg') then v_gold_display := 'count'; end if;

  if jsonb_typeof(v_raw_layout->'settings'->'coin_codes') = 'array' then
    for v_coin_code in
      select c.code
      from public.sd_coins c
      join (
        select distinct upper(value) as code
        from jsonb_array_elements_text(v_raw_layout->'settings'->'coin_codes')
      ) requested on requested.code = upper(c.code)
      where c.is_active = true
      order by c.sort_order
    loop
      v_coin_codes := array_append(v_coin_codes, v_coin_code);
    end loop;
  else
    select coalesce(array_agg(c.code order by c.sort_order), array[]::text[])
      into v_coin_codes
    from public.sd_coins c where c.is_active = true;
  end if;

  v_show_photo := case when jsonb_typeof(v_raw_layout->'visible'->'photo')='boolean' then (v_raw_layout->'visible'->>'photo')::boolean else true end;
  v_show_identity := case when jsonb_typeof(v_raw_layout->'visible'->'identity')='boolean' then (v_raw_layout->'visible'->>'identity')::boolean else true end;
  v_show_assets := case when jsonb_typeof(v_raw_layout->'visible'->'assets')='boolean' then (v_raw_layout->'visible'->>'assets')::boolean else true end;
  v_show_gold := case when jsonb_typeof(v_raw_layout->'visible'->'gold')='boolean' then (v_raw_layout->'visible'->>'gold')::boolean else true end;
  v_show_coins := case when jsonb_typeof(v_raw_layout->'visible'->'coins')='boolean' then (v_raw_layout->'visible'->>'coins')::boolean else true end;

  v_card_layout := jsonb_build_object(
    'version', 4,
    'order', to_jsonb(v_order),
    'visible', jsonb_build_object('photo',v_show_photo,'identity',v_show_identity,'assets',v_show_assets,'gold',v_show_gold,'coins',v_show_coins),
    'settings', jsonb_build_object('gold_display',v_gold_display,'coin_codes',to_jsonb(v_coin_codes))
  );

  v_data_photo := v_is_me or v_show_photo;
  v_data_identity := v_is_me or v_show_identity;
  v_data_assets := v_is_me or v_show_assets;
  v_data_gold := v_is_me or v_show_gold;
  v_data_coins := v_is_me or v_show_coins;

  if v_data_assets or v_data_gold then
    select coalesce(gold_bars,0),coalesce(gold_grams,0) into v_gold_bars,v_gold_grams
    from public.sd_flea_gold_snapshots where user_id=v_target;
    v_gold_kilograms := v_gold_grams / 1000;
    v_gold_value := v_gold_bars * 826000;
  end if;

  if v_data_coins then
    select coalesce(jsonb_agg(jsonb_build_object('code',c.code,'name',c.name,'quantity',coalesce(h.quantity,0)) order by c.sort_order), '[]'::jsonb)
    into v_coins
    from public.sd_coins c
    left join public.sd_coin_holdings h on h.coin_id=c.id and h.user_id=v_target
    where c.is_active=true and (v_is_me or c.code = any(v_coin_codes));
  else
    v_coins := null;
  end if;

  if v_data_photo then
    select c.asset_url into v_avatar_url
    from public.sd_profile_cosmetics c
    where c.id=v_profile.avatar_cosmetic_id and c.kind='avatar';
  end if;

  if v_data_identity then
    select a.title_reward into v_title
    from public.sd_achievements a
    join public.sd_user_achievements ua on ua.achievement_id=a.id and ua.user_id=v_target
    where a.id=v_profile.equipped_title_achievement_id;
  end if;

  v_assets := jsonb_strip_nulls(jsonb_build_object(
    'gold_bars', case when v_data_gold and (v_is_me or v_gold_display='count') then v_gold_bars else null end,
    'gold_grams', case when v_data_gold and (v_is_me or v_gold_display='g') then v_gold_grams else null end,
    'gold_kilograms', case when v_data_gold and (v_is_me or v_gold_display='kg') then v_gold_kilograms else null end,
    'gold_value', case when v_data_assets then v_gold_value else null end,
    'total', case when v_data_assets then v_gold_value else null end,
    'wallet_included', false,
    'coin_included', false
  ));

  return jsonb_build_object(
    'created',true,
    'is_me',v_is_me,
    'user_id',v_target,
    'nickname',v_nickname,
    'avatar_url',case when v_data_photo then v_avatar_url else null end,
    'title',case when v_data_identity then v_title else null end,
    'card_layout',v_card_layout,
    'assets',v_assets,
    'coins',v_coins
  );
end;
$function$;
