-- SD Logistics authoritative economy APIs v2

begin;

create or replace function public.sd_logistics_purchase_vehicle(p_vehicle_type text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_a public.sd_logistics_accounts%rowtype; v_cost bigint; v_min_rank text; v_limit int; v_count int; v_wallet jsonb;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  p_vehicle_type:=lower(trim(coalesce(p_vehicle_type,'')));
  select cost,min_rank into v_cost,v_min_rank from (values
    ('small',250000::bigint,'F'),('medium',700000,'E'),('large',1500000,'C'),('xlarge',3000000,'A')
  ) q(vehicle_type,cost,min_rank) where vehicle_type=p_vehicle_type;
  if v_cost is null then raise exception using errcode='P1010',message='INVALID_VEHICLE_TYPE'; end if;
  perform sd_core_private.ensure_sd_logistics_account_impl(v_user);
  select * into v_a from public.sd_logistics_accounts where user_id=v_user for update;
  if sd_core_private.sd_logistics_rank_index(sd_core_private.sd_logistics_rank_from_rep(v_a.logistics_rep))<sd_core_private.sd_logistics_rank_index(v_min_rank) then raise exception using errcode='P1033',message='LOGISTICS_RANK_TOO_LOW'; end if;
  v_limit:=case when v_a.headquarters_level>=9 then 12 when v_a.headquarters_level>=3 then 10 else 8 end;
  select count(*) into v_count from public.sd_logistics_vehicles where user_id=v_user and sold_at is null;
  if v_count>=v_limit then raise exception using errcode='P1040',message='FLEET_LIMIT_REACHED'; end if;
  if exists(select 1 from public.sd_logistics_vehicles where id=p_request_id and user_id=v_user and sold_at is null) then return public.sd_logistics_get_state(); end if;
  v_wallet:=sd_core_private.apply_server_wallet_delta_impl(v_user,p_request_id,'logistics_vehicle_buy_'||p_vehicle_type,-v_cost,'sd_logistics','SD 물류회사 · 차량 구매',jsonb_build_object('vehicle_type',p_vehicle_type));
  insert into public.sd_logistics_vehicles(id,user_id,vehicle_type,purchase_cost,starter) values(p_request_id,v_user,p_vehicle_type,v_cost,false) on conflict(id) do nothing;
  insert into public.sd_logistics_vehicle_types_owned(user_id,vehicle_type) values(v_user,p_vehicle_type) on conflict do nothing;
  update public.sd_logistics_accounts set vehicle_purchases=vehicle_purchases+1,updated_at=now() where user_id=v_user;
  return public.sd_logistics_get_state();
end;
$$;
revoke execute on function public.sd_logistics_purchase_vehicle(text,uuid) from public,anon;
grant execute on function public.sd_logistics_purchase_vehicle(text,uuid) to authenticated;

create or replace function public.sd_logistics_sell_vehicle(p_vehicle_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_v public.sd_logistics_vehicles%rowtype; v_sale bigint; v_wallet jsonb;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  select * into v_v from public.sd_logistics_vehicles where id=p_vehicle_id and user_id=v_user for update;
  if v_v.id is null then raise exception using errcode='P1034',message='VEHICLE_NOT_OWNED'; end if;
  if v_v.starter then raise exception using errcode='P1041',message='STARTER_NOT_SELLABLE'; end if;
  if v_v.sold_at is not null then return public.sd_logistics_get_state(); end if;
  if exists(select 1 from public.sd_logistics_delivery_vehicles dv join public.sd_logistics_deliveries d on d.id=dv.delivery_id where dv.vehicle_id=v_v.id and d.status='active') then raise exception using errcode='P1035',message='VEHICLE_BUSY'; end if;
  v_sale:=floor(v_v.purchase_cost*.5);
  v_wallet:=sd_core_private.apply_server_wallet_delta_impl(v_user,p_request_id,'logistics_vehicle_sale_'||v_v.vehicle_type,v_sale,'sd_logistics','SD 물류회사 · 차량 판매',jsonb_build_object('vehicle_id',v_v.id,'vehicle_type',v_v.vehicle_type));
  update public.sd_logistics_vehicles set sold_at=now(),sale_transaction_id=(v_wallet->>'transaction_id')::uuid where id=v_v.id;
  return public.sd_logistics_get_state();
end;
$$;
revoke execute on function public.sd_logistics_sell_vehicle(uuid,uuid) from public,anon;
grant execute on function public.sd_logistics_sell_vehicle(uuid,uuid) to authenticated;

create or replace function public.sd_logistics_upgrade_starter(p_vehicle_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_v public.sd_logistics_vehicles%rowtype; v_next text; v_cost bigint; v_min_rank text; v_wallet jsonb;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  select * into v_v from public.sd_logistics_vehicles where id=p_vehicle_id and user_id=v_user and sold_at is null for update;
  if v_v.id is null or not v_v.starter then raise exception using errcode='P1042',message='STARTER_NOT_FOUND'; end if;
  if exists(select 1 from public.sd_logistics_delivery_vehicles dv join public.sd_logistics_deliveries d on d.id=dv.delivery_id where dv.vehicle_id=v_v.id and d.status='active') then raise exception using errcode='P1035',message='VEHICLE_BUSY'; end if;
  select next_type,cost,min_rank into v_next,v_cost,v_min_rank from (values
    ('small','medium',450000::bigint,'E'),('medium','large',800000,'C'),('large','xlarge',1500000,'A')
  ) q(cur,next_type,cost,min_rank) where cur=v_v.vehicle_type;
  if v_next is null then return public.sd_logistics_get_state(); end if;
  if sd_core_private.sd_logistics_rank_index(sd_core_private.sd_logistics_rank_from_rep((select logistics_rep from public.sd_logistics_accounts where user_id=v_user)))<sd_core_private.sd_logistics_rank_index(v_min_rank) then raise exception using errcode='P1033',message='LOGISTICS_RANK_TOO_LOW'; end if;
  v_wallet:=sd_core_private.apply_server_wallet_delta_impl(v_user,p_request_id,'logistics_starter_upgrade_'||v_v.vehicle_type||'_'||v_next,-v_cost,'sd_logistics','SD 물류회사 · 스타터 차량 업그레이드',jsonb_build_object('vehicle_id',v_v.id,'from_type',v_v.vehicle_type,'to_type',v_next));
  update public.sd_logistics_vehicles set vehicle_type=v_next where id=v_v.id;
  insert into public.sd_logistics_vehicle_types_owned(user_id,vehicle_type) values(v_user,v_next) on conflict do nothing;
  return public.sd_logistics_get_state();
end;
$$;
revoke execute on function public.sd_logistics_upgrade_starter(uuid,uuid) from public,anon;
grant execute on function public.sd_logistics_upgrade_starter(uuid,uuid) to authenticated;

create or replace function public.sd_logistics_upgrade_hq(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_a public.sd_logistics_accounts%rowtype; v_next int; v_contracts bigint; v_xlarge bigint; v_revenue bigint; v_fleet int; v_fee bigint; v_unlock text; v_count int;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  perform sd_core_private.ensure_sd_logistics_account_impl(v_user);
  select * into v_a from public.sd_logistics_accounts where user_id=v_user for update;
  v_next:=v_a.headquarters_level+1;
  select contracts,xlarge,revenue,fleet,fee,unlock into v_contracts,v_xlarge,v_revenue,v_fleet,v_fee,v_unlock from (values
    (2,35::bigint,3::bigint,4000000::bigint,6,500000::bigint,'기사 시스템 · 정원 2명'),
    (3,50,5,7000000,8,750000,'차량 슬롯 10대'),(4,70,8,11000000,8,1000000,'기사 정원 4명'),
    (5,95,12,17000000,8,1500000,'장거리 계약'),(6,125,16,25000000,8,2000000,'기사 정원 6명 · 물류창고'),
    (7,160,21,35000000,8,3000000,'본부 경영 특성 강화'),(8,200,27,48000000,10,4000000,'기사 정원 8명 · 해외 화물'),
    (9,245,34,65000000,10,5500000,'차량 슬롯 12대'),(10,300,42,90000000,12,8000000,'기사 정원 10명 · 대형 물류기업')
  ) q(level,contracts,xlarge,revenue,fleet,fee,unlock) where level=v_next;
  if v_fee is null then return public.sd_logistics_get_state(); end if;
  select count(*) into v_count from public.sd_logistics_vehicles where user_id=v_user and sold_at is null;
  if v_a.completed_contracts<v_contracts or v_a.xlarge_completed<v_xlarge or v_a.logistics_revenue<v_revenue or v_count<v_fleet then raise exception using errcode='P1043',message='HQ_REQUIREMENTS_NOT_MET'; end if;
  perform sd_core_private.apply_server_wallet_delta_impl(v_user,p_request_id,'logistics_hq_upgrade_'||v_next,-v_fee,'sd_logistics','SD 물류 본부 승급',jsonb_build_object('level',v_next));
  update public.sd_logistics_accounts set headquarters_level=v_next,hq_perk_points=hq_perk_points+1,updated_at=now() where user_id=v_user;
  return public.sd_logistics_get_state();
end;
$$;
revoke execute on function public.sd_logistics_upgrade_hq(uuid) from public,anon;
grant execute on function public.sd_logistics_upgrade_hq(uuid) to authenticated;

create or replace function public.sd_logistics_buy_warehouse(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_a public.sd_logistics_accounts%rowtype;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  select * into v_a from public.sd_logistics_accounts where user_id=v_user for update;
  if v_a.headquarters_level<6 then raise exception using errcode='P1044',message='WAREHOUSE_LOCKED'; end if;
  if v_a.warehouse_owned then return public.sd_logistics_get_state(); end if;
  perform sd_core_private.apply_server_wallet_delta_impl(v_user,p_request_id,'logistics_warehouse_buy',-3000000,'sd_logistics','SD 물류 본부 · 물류창고 구매','{}'::jsonb);
  update public.sd_logistics_accounts set warehouse_owned=true,updated_at=now() where user_id=v_user;
  return public.sd_logistics_get_state();
end;
$$;
revoke execute on function public.sd_logistics_buy_warehouse(uuid) from public,anon;
grant execute on function public.sd_logistics_buy_warehouse(uuid) to authenticated;

create or replace function public.sd_logistics_choose_perk(p_kind text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_a public.sd_logistics_accounts%rowtype; v_now int;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  p_kind:=trim(coalesce(p_kind,''));
  if p_kind not in ('driverIncome','directIncome','driverSpeed') then raise exception using errcode='P1010',message='INVALID_PERK'; end if;
  select * into v_a from public.sd_logistics_accounts where user_id=v_user for update;
  if v_a.hq_perk_points<=0 then raise exception using errcode='P1045',message='NO_PERK_POINTS'; end if;
  v_now:=greatest(0,coalesce((v_a.hq_perks->>p_kind)::int,0));
  update public.sd_logistics_accounts set hq_perks=jsonb_set(hq_perks,array[p_kind],to_jsonb(v_now+1),true),hq_perk_points=hq_perk_points-1,updated_at=now() where user_id=v_user;
  return public.sd_logistics_get_state();
end;
$$;
revoke execute on function public.sd_logistics_choose_perk(text) from public,anon;
grant execute on function public.sd_logistics_choose_perk(text) to authenticated;

create or replace function public.sd_logistics_reset_perks()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_a public.sd_logistics_accounts%rowtype; v_spent int;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  select * into v_a from public.sd_logistics_accounts where user_id=v_user for update;
  v_spent:=greatest(0,coalesce((v_a.hq_perks->>'driverIncome')::int,0))+greatest(0,coalesce((v_a.hq_perks->>'directIncome')::int,0))+greatest(0,coalesce((v_a.hq_perks->>'driverSpeed')::int,0));
  update public.sd_logistics_accounts set hq_perks='{"driverIncome":0,"directIncome":0,"driverSpeed":0}'::jsonb,hq_perk_points=hq_perk_points+v_spent,updated_at=now() where user_id=v_user;
  return public.sd_logistics_get_state();
end;
$$;
revoke execute on function public.sd_logistics_reset_perks() from public,anon;
grant execute on function public.sd_logistics_reset_perks() to authenticated;

commit;
