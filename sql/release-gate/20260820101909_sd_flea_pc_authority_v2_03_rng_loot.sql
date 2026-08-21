-- SD Flea PC authority v2 segment 3/6
begin;

create or replace function private.sd_flea_pc_roll_tier(p_location text,p_special boolean default false)
returns text language plpgsql volatile security definer set search_path='' as $$
declare v_roll numeric:=random()*100;
begin
  if p_location='alley' then
    if p_special then return 'normal'; end if;
    return case when v_roll<80 then 'worn' else 'normal' end;
  elsif p_location='abandoned_store' then
    if p_special then return 'fancy'; end if;
    return case when v_roll<30 then 'worn' when v_roll<80 then 'normal' else 'fancy' end;
  elsif p_location='logistics' then
    if p_special then return case when v_roll<70 then 'fancy' else 'premium' end; end if;
    return case when v_roll<8 then 'worn' when v_roll<43 then 'normal' when v_roll<83 then 'fancy' else 'premium' end;
  end if;
  return 'worn';
end;
$$;
revoke all on function private.sd_flea_pc_roll_tier(text,boolean) from public,anon,authenticated;

create or replace function private.sd_flea_pc_pick_item(p_tier text)
returns public.sd_flea_pc_item_catalog language plpgsql volatile security definer set search_path='' as $$
declare v public.sd_flea_pc_item_catalog%rowtype; v_total int; v_roll numeric;
begin
  if p_tier='safe' and random() < 0.00001 then
    select * into v from public.sd_flea_pc_item_catalog where item_key='safe:red-diamond';
    return v;
  end if;
  if p_tier='safe' then
    select coalesce(sum(loot_weight),0) into v_total from public.sd_flea_pc_item_catalog where tier='safe' and not limited;
    v_roll:=random()*greatest(v_total,1);
    select q.item_key,q.name,q.tier,q.server_value,q.loot_weight,q.collection_required,q.limited,q.sellable
      into v
    from (
      select i.*,sum(i.loot_weight) over(order by i.item_key) as cumulative
      from public.sd_flea_pc_item_catalog i where i.tier='safe' and not i.limited
    ) q where q.cumulative>v_roll order by q.cumulative limit 1;
  else
    select * into v from public.sd_flea_pc_item_catalog where tier=p_tier and not limited order by random() limit 1;
  end if;
  if v.item_key is null then raise exception using errcode='P1031',message='FLEA_ITEM_CATALOG_EMPTY'; end if;
  return v;
end;
$$;
revoke all on function private.sd_flea_pc_pick_item(text) from public,anon,authenticated;

create or replace function private.sd_flea_pc_grant_box_item(p_box_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_box public.sd_flea_pc_boxes%rowtype;
  v_item public.sd_flea_pc_item_catalog%rowtype;
  v_flea_item_id uuid;
  v_receipt_id uuid;
  v_local_key text;
begin
  select * into v_box from public.sd_flea_pc_boxes where id=p_box_id for update;
  if v_box.id is null then raise exception using errcode='P1031',message='FLEA_BOX_NOT_FOUND'; end if;
  if v_box.opened_at is not null then
    select r.id,r.flea_item_id into v_receipt_id,v_flea_item_id from public.sd_flea_pc_loot_receipts r where r.box_id=v_box.id;
    if v_receipt_id is null then return jsonb_build_object('ok',true,'empty',true,'box_id',v_box.id); end if;
    select c.* into v_item from public.sd_flea_pc_loot_receipts r join public.sd_flea_pc_item_catalog c on c.item_key=r.catalog_key where r.id=v_receipt_id;
    return jsonb_build_object('ok',true,'duplicate',true,'empty',false,'box_id',v_box.id,'receipt_id',v_receipt_id,'item_id',v_flea_item_id,'catalog_key',v_item.item_key,'name',v_item.name,'tier',v_item.tier,'value',v_item.server_value,'limited',v_item.limited,'sellable',v_item.sellable);
  end if;

  update public.sd_flea_pc_boxes set opened_at=now() where id=v_box.id;
  insert into public.sd_flea_pc_accounts(user_id,boxes_looted) values(v_box.user_id,1)
  on conflict(user_id) do update set boxes_looted=public.sd_flea_pc_accounts.boxes_looted+1,updated_at=now();

  if v_box.empty then
    perform private.refresh_sd_flea_pc_achievements(v_box.user_id);
    return jsonb_build_object('ok',true,'empty',true,'box_id',v_box.id);
  end if;

  v_item:=private.sd_flea_pc_pick_item(v_box.tier);
  v_local_key:='SERVER-'||replace(gen_random_uuid()::text,'-','');
  insert into public.sd_flea_items(
    origin_user_id,owner_user_id,local_item_key,box_id,name,tier,original_value,current_value,condition_percent,
    source_text,acquisition_kind,purchase_price,status,acquired_at,created_at,updated_at
  ) values(
    v_box.user_id,v_box.user_id,v_local_key,v_box.id::text,v_item.name,v_item.tier,v_item.server_value,v_item.server_value,100,
    case when v_box.source_kind='bank_safe' then 'PC 플리마켓 서버 은행 금고' else 'PC 플리마켓 서버 루팅' end,
    'server_loot',null,'owned',now(),now(),now()
  ) returning id into v_flea_item_id;

  insert into public.sd_flea_pc_loot_receipts(user_id,mission_id,box_id,flea_item_id,catalog_key,sellable,server_value)
  values(v_box.user_id,v_box.mission_id,v_box.id,v_flea_item_id,v_item.item_key,v_item.sellable,v_item.server_value)
  returning id into v_receipt_id;

  insert into public.sd_flea_pc_item_counts(user_id,catalog_key,acquired_count)
  values(v_box.user_id,v_item.item_key,1)
  on conflict(user_id,catalog_key) do update set acquired_count=public.sd_flea_pc_item_counts.acquired_count+1,last_acquired_at=now();

  update public.sd_flea_pc_accounts set
    red_diamond_found=red_diamond_found or (v_item.item_key='safe:red-diamond'),
    highest_tier_found=highest_tier_found or (v_item.tier='safe'),
    lowest_only_boxes=lowest_only_boxes + case when v_box.tier='worn' and v_item.tier='worn' then 1 else 0 end,
    updated_at=now()
  where user_id=v_box.user_id;

  perform private.refresh_sd_flea_pc_achievements(v_box.user_id);
  return jsonb_build_object('ok',true,'empty',false,'box_id',v_box.id,'receipt_id',v_receipt_id,'item_id',v_flea_item_id,'local_item_id',v_local_key,'catalog_key',v_item.item_key,'name',v_item.name,'tier',v_item.tier,'value',v_item.server_value,'limited',v_item.limited,'sellable',v_item.sellable);
end;
$$;
revoke all on function private.sd_flea_pc_grant_box_item(uuid) from public,anon,authenticated;

commit;
