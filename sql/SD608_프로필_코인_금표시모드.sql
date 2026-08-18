-- SD608 공개 프로필: 코인 보유 수량 + 금 표시 방식 선택
-- Live migration: add_profile_coin_holdings_and_gold_display_mode

create or replace function public.save_sd_profile_card_layout(p_layout jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_allowed constant text[] := array['photo','identity','assets','gold','coins','slot_best'];
  v_order text[] := array[]::text[];
  v_key text;
  v_visible jsonb;
  v_gold_display text;
  v_result jsonb;
begin
  if v_user_id is null then raise exception '로그인이 필요합니다.'; end if;
  if not exists (select 1 from public.sd_public_profiles where user_id=v_user_id) then
    raise exception '먼저 공개 프로필을 만들어 주세요.';
  end if;
  if p_layout is null or jsonb_typeof(p_layout) <> 'object' then
    raise exception '프로필 카드 배치 정보가 올바르지 않습니다.';
  end if;

  if jsonb_typeof(p_layout->'order')='array' then
    for v_key in select jsonb_array_elements_text(p_layout->'order') loop
      if v_key=any(v_allowed) and not (v_key=any(v_order)) then v_order:=array_append(v_order,v_key); end if;
    end loop;
  end if;
  foreach v_key in array v_allowed loop
    if not (v_key=any(v_order)) then v_order:=array_append(v_order,v_key); end if;
  end loop;

  v_visible := jsonb_build_object(
    'photo',case when jsonb_typeof(p_layout->'visible'->'photo')='boolean' then (p_layout->'visible'->>'photo')::boolean else true end,
    'identity',case when jsonb_typeof(p_layout->'visible'->'identity')='boolean' then (p_layout->'visible'->>'identity')::boolean else true end,
    'assets',case when jsonb_typeof(p_layout->'visible'->'assets')='boolean' then (p_layout->'visible'->>'assets')::boolean else true end,
    'gold',case when jsonb_typeof(p_layout->'visible'->'gold')='boolean' then (p_layout->'visible'->>'gold')::boolean else true end,
    'coins',case when jsonb_typeof(p_layout->'visible'->'coins')='boolean' then (p_layout->'visible'->>'coins')::boolean else true end,
    'slot_best',case when jsonb_typeof(p_layout->'visible'->'slot_best')='boolean' then (p_layout->'visible'->>'slot_best')::boolean else true end
  );

  v_gold_display := lower(coalesce(p_layout->'settings'->>'gold_display','count'));
  if v_gold_display not in ('count','weight') then v_gold_display:='count'; end if;

  v_result := jsonb_build_object(
    'version',2,
    'order',to_jsonb(v_order),
    'visible',v_visible,
    'settings',jsonb_build_object('gold_display',v_gold_display)
  );

  update public.sd_public_profiles set card_layout=v_result,updated_at=now() where user_id=v_user_id;
  return jsonb_build_object('ok',true,'card_layout',v_result);
end;
$function$;

create or replace function public.get_sd_public_profile(p_user_id uuid default null::uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = ''
as $function$
declare
  v_viewer uuid := auth.uid();
  v_target uuid := coalesce(p_user_id,auth.uid());
  v_is_me boolean;
  v_nickname text;
  v_status text;
  v_profile public.sd_public_profiles%rowtype;
  v_gold_bars bigint := 0;
  v_gold_grams numeric := 0;
  v_gold_value bigint := 0;
  v_showcase jsonb := '[]'::jsonb;
  v_achievements jsonb := '[]'::jsonb;
  v_coins jsonb := '[]'::jsonb;
  v_avatar_url text;
  v_title text;
  v_slot_label text;
  v_slot_icon text;
  v_slot_score numeric := 0;
  v_slot_jackpot boolean := false;
  v_raw_layout jsonb;
  v_card_layout jsonb;
  v_order text[] := array[]::text[];
  v_allowed constant text[] := array['photo','identity','assets','gold','coins','slot_best'];
  v_key text;
  v_gold_display text;
  v_show_photo boolean; v_show_identity boolean; v_show_assets boolean; v_show_gold boolean; v_show_coins boolean; v_show_slot boolean;
  v_data_photo boolean; v_data_identity boolean; v_data_assets boolean; v_data_gold boolean; v_data_coins boolean; v_data_slot boolean;
  v_assets jsonb;
  v_slot_best jsonb;
begin
  if v_viewer is null then raise exception '로그인이 필요합니다.'; end if;
  if v_target is null then raise exception '프로필 대상이 없습니다.'; end if;
  v_is_me := v_target=v_viewer;

  select nickname,status into v_nickname,v_status from public.profiles where id=v_target;
  if v_nickname is null or v_status<>'active' then raise exception '조회할 수 없는 회원입니다.'; end if;
  select * into v_profile from public.sd_public_profiles where user_id=v_target;
  if not found then return jsonb_build_object('created',false,'is_me',v_is_me,'user_id',v_target,'nickname',v_nickname); end if;
  if not v_profile.enabled and not v_is_me then raise exception '비공개 프로필입니다.'; end if;

  v_raw_layout:=coalesce(v_profile.card_layout,'{}'::jsonb);
  if jsonb_typeof(v_raw_layout->'order')='array' then
    for v_key in select jsonb_array_elements_text(v_raw_layout->'order') loop
      if v_key=any(v_allowed) and not (v_key=any(v_order)) then v_order:=array_append(v_order,v_key); end if;
    end loop;
  end if;
  foreach v_key in array v_allowed loop if not (v_key=any(v_order)) then v_order:=array_append(v_order,v_key); end if; end loop;

  v_gold_display:=lower(coalesce(v_raw_layout->'settings'->>'gold_display','count'));
  if v_gold_display not in ('count','weight') then v_gold_display:='count'; end if;
  v_show_photo:=case when jsonb_typeof(v_raw_layout->'visible'->'photo')='boolean' then (v_raw_layout->'visible'->>'photo')::boolean else true end;
  v_show_identity:=case when jsonb_typeof(v_raw_layout->'visible'->'identity')='boolean' then (v_raw_layout->'visible'->>'identity')::boolean else true end;
  v_show_assets:=case when jsonb_typeof(v_raw_layout->'visible'->'assets')='boolean' then (v_raw_layout->'visible'->>'assets')::boolean else true end;
  v_show_gold:=case when jsonb_typeof(v_raw_layout->'visible'->'gold')='boolean' then (v_raw_layout->'visible'->>'gold')::boolean else true end;
  v_show_coins:=case when jsonb_typeof(v_raw_layout->'visible'->'coins')='boolean' then (v_raw_layout->'visible'->>'coins')::boolean else true end;
  v_show_slot:=case when jsonb_typeof(v_raw_layout->'visible'->'slot_best')='boolean' then (v_raw_layout->'visible'->>'slot_best')::boolean else true end;

  v_card_layout:=jsonb_build_object(
    'version',2,'order',to_jsonb(v_order),
    'visible',jsonb_build_object('photo',v_show_photo,'identity',v_show_identity,'assets',v_show_assets,'gold',v_show_gold,'coins',v_show_coins,'slot_best',v_show_slot),
    'settings',jsonb_build_object('gold_display',v_gold_display)
  );

  v_data_photo:=v_is_me or v_show_photo; v_data_identity:=v_is_me or v_show_identity; v_data_assets:=v_is_me or v_show_assets;
  v_data_gold:=v_is_me or v_show_gold; v_data_coins:=v_is_me or v_show_coins; v_data_slot:=v_is_me or v_show_slot;

  if v_data_assets or v_data_gold then
    select coalesce(gold_bars,0),coalesce(gold_grams,0) into v_gold_bars,v_gold_grams from public.sd_flea_gold_snapshots where user_id=v_target;
    v_gold_bars:=coalesce(v_gold_bars,0); v_gold_grams:=coalesce(v_gold_grams,0); v_gold_value:=v_gold_bars*826000;
  end if;

  if v_data_coins then
    select coalesce(jsonb_agg(jsonb_build_object('code',c.code,'name',c.name,'quantity',coalesce(h.quantity,0)) order by c.sort_order),'[]'::jsonb)
      into v_coins
    from public.sd_coins c left join public.sd_coin_holdings h on h.coin_id=c.id and h.user_id=v_target
    where c.is_active=true;
  else v_coins:=null; end if;

  if v_data_photo then select c.asset_url into v_avatar_url from public.sd_profile_cosmetics c where c.id=v_profile.avatar_cosmetic_id and c.kind='avatar'; end if;
  if v_data_identity then
    select a.title_reward into v_title from public.sd_achievements a join public.sd_user_achievements ua on ua.achievement_id=a.id and ua.user_id=v_target where a.id=v_profile.equipped_title_achievement_id;
  end if;
  if v_data_slot then
    select best_label,best_icon,best_score,jackpot into v_slot_label,v_slot_icon,v_slot_score,v_slot_jackpot from public.sd_flea_slot_stats where user_id=v_target;
    v_slot_best:=jsonb_build_object('label',coalesce(v_slot_label,'기록 없음'),'icon',coalesce(v_slot_icon,'🎰'),'score',coalesce(v_slot_score,0),'jackpot',coalesce(v_slot_jackpot,false));
  else v_slot_best:=null; end if;

  v_assets:=jsonb_strip_nulls(jsonb_build_object(
    'gold_bars',case when v_data_gold and (v_is_me or v_gold_display='count') then v_gold_bars else null end,
    'gold_grams',case when v_data_gold and (v_is_me or v_gold_display='weight') then v_gold_grams else null end,
    'gold_value',case when v_data_assets then v_gold_value else null end,
    'total',case when v_data_assets then v_gold_value else null end,
    'wallet_included',false,'coin_included',false
  ));

  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'tier',i.tier,'current_value',i.current_value,'original_value',i.original_value,'origin_user_id',i.origin_user_id,'origin_nickname',coalesce(op.nickname,'회원')) order by sc.display_order,sc.created_at),'[]'::jsonb)
    into v_showcase
  from public.sd_flea_profile_showcases sc join public.sd_flea_items i on i.id=sc.item_id and i.owner_user_id=v_target and i.status='owned'
  left join public.profiles op on op.id=i.origin_user_id where sc.user_id=v_target;

  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'code',a.code,'name',a.name,'description',a.description,'icon',a.icon,'title_reward',a.title_reward,'unlocked_at',ua.unlocked_at) order by a.sort_order,ua.unlocked_at),'[]'::jsonb)
    into v_achievements
  from public.sd_user_achievements ua join public.sd_achievements a on a.id=ua.achievement_id and a.active=true where ua.user_id=v_target;

  return jsonb_build_object('created',true,'is_me',v_is_me,'user_id',v_target,'nickname',v_nickname,
    'avatar_url',case when v_data_photo then v_avatar_url else null end,
    'title',case when v_data_identity then v_title else null end,
    'card_layout',v_card_layout,'assets',v_assets,'coins',v_coins,
    'showcase_items',coalesce(v_showcase,'[]'::jsonb),'slot_best',v_slot_best,'achievements',coalesce(v_achievements,'[]'::jsonb));
end;
$function$;

revoke all on function public.save_sd_profile_card_layout(jsonb) from public, anon;
grant execute on function public.save_sd_profile_card_layout(jsonb) to authenticated;
revoke all on function public.get_sd_public_profile(uuid) from public, anon;
grant execute on function public.get_sd_public_profile(uuid) to authenticated;
