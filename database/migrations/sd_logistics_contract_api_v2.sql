-- SD Logistics authoritative contract APIs v2

begin;

create or replace function public.sd_logistics_get_state()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_result jsonb;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  perform sd_core_private.ensure_sd_logistics_account_impl(v_user);
  select pg_catalog.jsonb_build_object(
    'account',to_jsonb(a),
    'rank',sd_core_private.sd_logistics_rank_from_rep(a.logistics_rep),
    'vehicles',coalesce((select jsonb_agg(to_jsonb(v) order by v.acquired_at) from public.sd_logistics_vehicles v where v.user_id=v_user and v.sold_at is null),'[]'::jsonb),
    'drivers',coalesce((select jsonb_agg(to_jsonb(d) order by d.hired_at) from public.sd_logistics_drivers d where d.user_id=v_user and d.fired_at is null),'[]'::jsonb),
    'contracts',coalesce((select jsonb_agg(to_jsonb(c) order by c.offered_at,c.id) from public.sd_logistics_contract_offers c where c.user_id=v_user and c.claimed_at is null and c.expires_at>now()),'[]'::jsonb),
    'deliveries',coalesce((select jsonb_agg(to_jsonb(d) || jsonb_build_object('vehicle_ids',(select coalesce(jsonb_agg(dv.vehicle_id),'[]'::jsonb) from public.sd_logistics_delivery_vehicles dv where dv.delivery_id=d.id)) order by d.started_at) from public.sd_logistics_deliveries d where d.user_id=v_user and d.status='active'),'[]'::jsonb),
    'vehicle_types_owned',coalesce((select jsonb_agg(t.vehicle_type order by t.vehicle_type) from public.sd_logistics_vehicle_types_owned t where t.user_id=v_user),'[]'::jsonb),
    'server_time',now()
  ) into v_result
  from public.sd_logistics_accounts a where a.user_id=v_user;
  return v_result;
end;
$$;
revoke execute on function public.sd_logistics_get_state() from public,anon;
grant execute on function public.sd_logistics_get_state() to authenticated;

create or replace function public.sd_logistics_refresh_contracts()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_hq int; v_count int;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  perform sd_core_private.ensure_sd_logistics_account_impl(v_user);
  select headquarters_level into v_hq from public.sd_logistics_accounts where user_id=v_user for update;
  delete from public.sd_logistics_contract_offers where user_id=v_user and claimed_at is null;
  v_count:=case when v_hq>=8 then 8 when v_hq>=5 then 7 else 6 end;

  with catalog(route_key,from_name,to_name,cargo,base_reward,rep_reward,min_rank,risk,required_stack,category,min_hq) as (values
    ('n01','순천','광주','전자제품 소포',52000::bigint,22::bigint,'F','일반',1,'일반',0),
    ('n02','광주','목포','편의점 냉장품',76000,28,'F','냉장',2,'일반',0),
    ('n03','여수','순천','산업부품 팔레트',118000,36,'E','산업',3,'일반',0),
    ('n04','광주','전주','정밀기기',160000,45,'E','취급주의',4,'일반',0),
    ('n05','목포','대전','건축 자재',255000,62,'D','중량',6,'일반',0),
    ('n06','광주','부산','대형 기계부품',350000,74,'C','대형',8,'일반',0),
    ('n07','부산','광주','산업용 발전기',565000,92,'B','초대형',12,'일반',0),
    ('n08','여수','서울','특급 플랜트 장비',710000,112,'A','특급',12,'일반',0),
    ('l01','광주','서울','장거리 전자부품',900000,135,'S','장거리',12,'장거리',5),
    ('l02','여수','인천','장거리 산업설비',1150000,160,'S','장거리',15,'장거리',5),
    ('l03','부산','목포','장거리 냉장화물',980000,145,'S','장거리',12,'장거리',5),
    ('o01','광양항','오사카','수출 정밀장비',1650000,210,'S','해외',18,'해외',8),
    ('o02','부산항','요코하마','수출 산업기계',2050000,250,'S','해외',24,'해외',8),
    ('o03','광양항','상하이','대형 수출화물',2350000,280,'S','해외',24,'해외',8)
  ), pick as (
    select * from catalog where min_hq<=v_hq order by random() limit v_count
  )
  insert into public.sd_logistics_contract_offers(user_id,route_key,from_name,to_name,cargo,base_reward,rep_reward,min_rank,risk,required_stack,category)
  select v_user,route_key,from_name,to_name,cargo,base_reward,rep_reward,min_rank,risk,required_stack,category from pick;
  return public.sd_logistics_get_state();
end;
$$;
revoke execute on function public.sd_logistics_refresh_contracts() from public,anon;
grant execute on function public.sd_logistics_refresh_contracts() to authenticated;

create or replace function public.sd_logistics_start_contract(p_contract_id uuid,p_vehicle_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid(); v_a public.sd_logistics_accounts%rowtype; v_c public.sd_logistics_contract_offers%rowtype;
  v_stack int:=0; v_speed numeric:=1; v_owned int:=0; v_busy int:=0; v_reward bigint; v_mult numeric; v_bonus boolean;
  v_base_seconds numeric; v_duration_seconds int; v_delivery uuid; v_rank text; v_id uuid;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  if p_contract_id is null or p_vehicle_ids is null or cardinality(p_vehicle_ids)=0 then raise exception using errcode='P1027',message='INVALID_LOGISTICS_CONTRACT_INPUT'; end if;
  if cardinality(p_vehicle_ids)<>cardinality(ARRAY(SELECT DISTINCT x FROM unnest(p_vehicle_ids) AS x)) then raise exception using errcode='P1027',message='DUPLICATE_VEHICLE'; end if;
  perform sd_core_private.ensure_sd_logistics_account_impl(v_user);
  select * into v_a from public.sd_logistics_accounts where user_id=v_user for update;
  select * into v_c from public.sd_logistics_contract_offers where id=p_contract_id and user_id=v_user for update;
  if v_c.id is null or v_c.claimed_at is not null or v_c.expires_at<=now() then raise exception using errcode='P1032',message='CONTRACT_NOT_AVAILABLE'; end if;
  v_rank:=sd_core_private.sd_logistics_rank_from_rep(v_a.logistics_rep);
  if sd_core_private.sd_logistics_rank_index(v_rank)<sd_core_private.sd_logistics_rank_index(v_c.min_rank) then raise exception using errcode='P1033',message='LOGISTICS_RANK_TOO_LOW'; end if;

  select count(*),coalesce(sum(case vehicle_type when 'small' then 1 when 'medium' then 3 when 'large' then 6 when 'xlarge' then 12 end),0),
         coalesce(min(case vehicle_type when 'small' then 1.00 when 'medium' then .86 when 'large' then .72 when 'xlarge' then .58 end),1)
    into v_owned,v_stack,v_speed
  from public.sd_logistics_vehicles
  where user_id=v_user and sold_at is null and id=any(p_vehicle_ids);
  if v_owned<>cardinality(p_vehicle_ids) then raise exception using errcode='P1034',message='VEHICLE_NOT_OWNED'; end if;
  select count(*) into v_busy
  from public.sd_logistics_delivery_vehicles dv
  join public.sd_logistics_deliveries d on d.id=dv.delivery_id
  where dv.vehicle_id=any(p_vehicle_ids) and d.status='active';
  if v_busy>0 then raise exception using errcode='P1035',message='VEHICLE_BUSY'; end if;
  if v_stack<v_c.required_stack then raise exception using errcode='P1036',message='INSUFFICIENT_CARGO_STACK'; end if;

  v_mult:=0.15;
  if v_a.warehouse_owned then v_mult:=v_mult*1.10; end if;
  if v_a.headquarters_level>=10 then v_mult:=v_mult*1.10; end if;
  v_mult:=v_mult*(1+greatest(0,coalesce((v_a.hq_perks->>'directIncome')::int,0))*0.05);
  v_reward:=round(v_c.base_reward*v_mult);
  v_bonus:=random()>.90;
  if v_bonus then v_reward:=round(v_reward*1.10); end if;
  v_base_seconds:=6+ceil(v_c.required_stack*.55);
  v_duration_seconds:=greatest(1,round((v_base_seconds/v_speed+random()*4)*4));

  insert into public.sd_logistics_deliveries(user_id,contract_id,reward,rep_reward,required_stack,category,event_text,end_at)
  values(v_user,v_c.id,v_reward,v_c.rep_reward,v_c.required_stack,v_c.category,case when v_bonus then '빠른 배송 · 보너스 10%' else '정상 운송 완료' end,now()+make_interval(secs=>v_duration_seconds))
  returning id into v_delivery;
  foreach v_id in array p_vehicle_ids loop
    insert into public.sd_logistics_delivery_vehicles(delivery_id,vehicle_id) values(v_delivery,v_id);
  end loop;
  update public.sd_logistics_contract_offers set claimed_at=now() where id=v_c.id;
  return public.sd_logistics_get_state();
end;
$$;
revoke execute on function public.sd_logistics_start_contract(uuid,uuid[]) from public,anon;
grant execute on function public.sd_logistics_start_contract(uuid,uuid[]) to authenticated;

create or replace function public.sd_logistics_finish_contract(p_delivery_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_d public.sd_logistics_deliveries%rowtype; v_c public.sd_logistics_contract_offers%rowtype; v_wallet jsonb;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  select * into v_d from public.sd_logistics_deliveries where id=p_delivery_id and user_id=v_user for update;
  if v_d.id is null then raise exception using errcode='P1037',message='DELIVERY_NOT_FOUND'; end if;
  if v_d.status='completed' then return public.sd_logistics_get_state(); end if;
  if v_d.status<>'active' then raise exception using errcode='P1038',message='DELIVERY_NOT_ACTIVE'; end if;
  if now()<v_d.end_at then raise exception using errcode='P1039',message='DELIVERY_NOT_DUE'; end if;
  select * into v_c from public.sd_logistics_contract_offers where id=v_d.contract_id;
  v_wallet:=sd_core_private.apply_server_wallet_delta_impl(v_user,v_d.id,'logistics_direct_contract_reward',v_d.reward,'sd_logistics',
    'SD 물류회사 · 직접 배송 보상',jsonb_build_object('delivery_id',v_d.id,'contract_id',v_d.contract_id,'category',v_d.category));
  update public.sd_logistics_deliveries set status='completed',reward_transaction_id=(v_wallet->>'transaction_id')::uuid,completed_at=now() where id=v_d.id;
  update public.sd_logistics_accounts set
    logistics_rep=logistics_rep+v_d.rep_reward,
    completed_contracts=completed_contracts+1,
    logistics_revenue=logistics_revenue+v_d.reward,
    direct_revenue=direct_revenue+v_d.reward,
    xlarge_completed=xlarge_completed+case when v_d.required_stack>=12 then 1 else 0 end,
    overseas_completed=overseas_completed+case when v_d.category='해외' then 1 else 0 end,
    direct_success_streak=direct_success_streak+1,
    max_direct_success_streak=greatest(max_direct_success_streak,direct_success_streak+1),
    headquarters_level=case when logistics_rep+v_d.rep_reward>=7000 and headquarters_level<1 then 1 else headquarters_level end,
    updated_at=now()
  where user_id=v_user;
  return public.sd_logistics_get_state();
end;
$$;
revoke execute on function public.sd_logistics_finish_contract(uuid) from public,anon;
grant execute on function public.sd_logistics_finish_contract(uuid) to authenticated;

commit;
