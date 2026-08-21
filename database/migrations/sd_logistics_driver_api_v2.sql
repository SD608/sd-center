-- SD Logistics authoritative driver APIs v2

begin;

create or replace function public.sd_logistics_hire_driver(p_driver_name text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_a public.sd_logistics_accounts%rowtype; v_limit int; v_count int;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  p_driver_name:=left(trim(coalesce(p_driver_name,'SD 기사')),40);
  select * into v_a from public.sd_logistics_accounts where user_id=v_user for update;
  if v_a.headquarters_level<2 then raise exception using errcode='P1046',message='DRIVER_SYSTEM_LOCKED'; end if;
  v_limit:=floor(v_a.headquarters_level/2.0)*2;
  select count(*) into v_count from public.sd_logistics_drivers where user_id=v_user and fired_at is null;
  if v_count>=v_limit then raise exception using errcode='P1047',message='DRIVER_LIMIT_REACHED'; end if;
  if exists(select 1 from public.sd_logistics_drivers where id=p_request_id and user_id=v_user and fired_at is null) then return public.sd_logistics_get_state(); end if;
  perform sd_core_private.apply_server_wallet_delta_impl(v_user,p_request_id,'logistics_driver_hire',-300000,'sd_logistics','SD 물류 본부 · 기사 채용',jsonb_build_object('driver_name',p_driver_name));
  insert into public.sd_logistics_drivers(id,user_id,name) values(p_request_id,v_user,p_driver_name) on conflict(id) do nothing;
  return public.sd_logistics_get_state();
end;
$$;
revoke execute on function public.sd_logistics_hire_driver(text,uuid) from public,anon;
grant execute on function public.sd_logistics_hire_driver(text,uuid) to authenticated;

create or replace function public.sd_logistics_fire_driver(p_driver_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_d public.sd_logistics_drivers%rowtype;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  select * into v_d from public.sd_logistics_drivers where id=p_driver_id and user_id=v_user for update;
  if v_d.id is null or v_d.fired_at is not null then return public.sd_logistics_get_state(); end if;
  if v_d.active then raise exception using errcode='P1048',message='DRIVER_ACTIVE'; end if;
  update public.sd_logistics_drivers set fired_at=now(),mission_id=null,next_payout_at=null,next_payout_event_id=null where id=v_d.id;
  return public.sd_logistics_get_state();
end;
$$;
revoke execute on function public.sd_logistics_fire_driver(uuid) from public,anon;
grant execute on function public.sd_logistics_fire_driver(uuid) to authenticated;

create or replace function public.sd_logistics_start_driver(p_driver_id uuid,p_mission_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_d public.sd_logistics_drivers%rowtype; v_a public.sd_logistics_accounts%rowtype; v_level int; v_seconds int; v_reduction numeric; v_duration int;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  p_mission_id:=lower(trim(coalesce(p_mission_id,'')));
  select level,seconds into v_level,v_seconds from (values ('local',2,14),('business',4,20),('industrial',6,27),('port',8,36)) q(id,level,seconds) where id=p_mission_id;
  if v_level is null then raise exception using errcode='P1010',message='INVALID_DRIVER_MISSION'; end if;
  select * into v_a from public.sd_logistics_accounts where user_id=v_user for update;
  if v_a.headquarters_level<v_level then raise exception using errcode='P1049',message='DRIVER_MISSION_LOCKED'; end if;
  select * into v_d from public.sd_logistics_drivers where id=p_driver_id and user_id=v_user and fired_at is null for update;
  if v_d.id is null then raise exception using errcode='P1050',message='DRIVER_NOT_FOUND'; end if;
  v_reduction:=least(.45,greatest(0,coalesce((v_a.hq_perks->>'driverSpeed')::int,0))*.08);
  v_duration:=greatest(12,round(v_seconds*4*(1-v_reduction)));
  update public.sd_logistics_drivers set mission_id=p_mission_id,active=true,next_payout_at=now()+make_interval(secs=>v_duration),next_payout_event_id=gen_random_uuid() where id=v_d.id;
  return public.sd_logistics_get_state();
end;
$$;
revoke execute on function public.sd_logistics_start_driver(uuid,text) from public,anon;
grant execute on function public.sd_logistics_start_driver(uuid,text) to authenticated;

create or replace function public.sd_logistics_stop_driver(p_driver_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  update public.sd_logistics_drivers set active=false,next_payout_at=null,next_payout_event_id=null where id=p_driver_id and user_id=v_user and fired_at is null;
  return public.sd_logistics_get_state();
end;
$$;
revoke execute on function public.sd_logistics_stop_driver(uuid) from public,anon;
grant execute on function public.sd_logistics_stop_driver(uuid) to authenticated;

create or replace function public.sd_logistics_settle_driver(p_driver_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_d public.sd_logistics_drivers%rowtype; v_a public.sd_logistics_accounts%rowtype; v_level int; v_seconds int; v_base bigint; v_reduction numeric; v_duration int; v_mult numeric; v_payout bigint; v_event uuid; v_wallet jsonb;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  select * into v_d from public.sd_logistics_drivers where id=p_driver_id and user_id=v_user and fired_at is null for update;
  if v_d.id is null then raise exception using errcode='P1050',message='DRIVER_NOT_FOUND'; end if;
  if not v_d.active or v_d.mission_id is null or v_d.next_payout_at is null or v_d.next_payout_event_id is null then raise exception using errcode='P1051',message='DRIVER_NOT_RUNNING'; end if;
  if now()<v_d.next_payout_at then raise exception using errcode='P1052',message='DRIVER_PAYOUT_NOT_DUE'; end if;
  select level,seconds,base into v_level,v_seconds,v_base from (values ('local',2,14,22000::bigint),('business',4,20,38000),('industrial',6,27,65000),('port',8,36,105000)) q(id,level,seconds,base) where id=v_d.mission_id;
  select * into v_a from public.sd_logistics_accounts where user_id=v_user for update;
  if v_a.headquarters_level<v_level then raise exception using errcode='P1049',message='DRIVER_MISSION_LOCKED'; end if;
  v_mult:=0.10;
  if v_a.warehouse_owned then v_mult:=v_mult*1.10; end if;
  if v_a.headquarters_level>=10 then v_mult:=v_mult*1.10; end if;
  v_mult:=v_mult*(1+greatest(0,coalesce((v_a.hq_perks->>'driverIncome')::int,0))*.10);
  v_payout:=round(v_base*v_mult);
  v_event:=v_d.next_payout_event_id;
  v_wallet:=sd_core_private.apply_server_wallet_delta_impl(v_user,v_event,'logistics_driver_income',v_payout,'sd_logistics','SD 물류 본부 · 기사 수익',jsonb_build_object('driver_id',v_d.id,'mission_id',v_d.mission_id));
  v_reduction:=least(.45,greatest(0,coalesce((v_a.hq_perks->>'driverSpeed')::int,0))*.08);
  v_duration:=greatest(12,round(v_seconds*4*(1-v_reduction)));
  update public.sd_logistics_drivers set total_earned=total_earned+v_payout,next_payout_at=v_d.next_payout_at+make_interval(secs=>v_duration),next_payout_event_id=gen_random_uuid() where id=v_d.id;
  update public.sd_logistics_accounts set driver_revenue=driver_revenue+v_payout,logistics_revenue=logistics_revenue+v_payout,updated_at=now() where user_id=v_user;
  return public.sd_logistics_get_state();
end;
$$;
revoke execute on function public.sd_logistics_settle_driver(uuid) from public,anon;
grant execute on function public.sd_logistics_settle_driver(uuid) to authenticated;

do $$
begin
  if to_regclass('public.sd_logistics_progress') is not null then
    execute 'revoke insert,update,delete on public.sd_logistics_progress from anon,authenticated';
  end if;
end $$;

comment on table public.sd_logistics_accounts is 'Authoritative logistics progression after v0.24 cutover. Client snapshots are not trusted for new progression.';
comment on function public.sd_logistics_finish_contract(uuid) is 'Settles only a server-issued, server-timed delivery and credits the server-computed reward exactly once.';

commit;
