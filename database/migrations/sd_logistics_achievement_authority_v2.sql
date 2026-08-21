-- SD Logistics 16/16 server-authoritative achievements v2
begin;

create or replace function private.refresh_sd_logistics_achievements(p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_a public.sd_logistics_accounts%rowtype;
  v_owned bigint:=0;
  v_types bigint:=0;
  v_starter_xlarge numeric:=0;
begin
  if p_user_id is null then return; end if;
  select * into v_a from public.sd_logistics_accounts where user_id=p_user_id;
  if v_a.user_id is null then return; end if;

  select count(*) into v_owned from public.sd_logistics_vehicles
   where user_id=p_user_id and sold_at is null;
  select count(*) into v_types from public.sd_logistics_vehicle_types_owned
   where user_id=p_user_id;
  select case when exists(
    select 1 from public.sd_logistics_vehicles
     where user_id=p_user_id and starter and sold_at is null and vehicle_type='xlarge'
  ) then 1 else 0 end into v_starter_xlarge;

  perform private.upsert_sd_authoritative_achievement(p_user_id,'logistics-01',v_a.overseas_completed,1,jsonb_build_object('metric','overseas_completed'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'logistics-02',v_a.logistics_rep,7000,jsonb_build_object('metric','logistics_rep'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'logistics-03',v_a.headquarters_level,5,jsonb_build_object('metric','headquarters_level'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'logistics-04',v_a.headquarters_level,10,jsonb_build_object('metric','headquarters_level'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'logistics-05',v_starter_xlarge,1,jsonb_build_object('metric','starter_xlarge'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'logistics-06',v_a.direct_revenue,100000000,jsonb_build_object('metric','direct_revenue'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'logistics-07',v_a.direct_revenue,1000000000,jsonb_build_object('metric','direct_revenue'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'logistics-08',v_a.direct_revenue,10000000000,jsonb_build_object('metric','direct_revenue'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'logistics-09',v_a.vehicle_purchases,1,jsonb_build_object('metric','vehicle_purchases'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'logistics-10',v_owned,5,jsonb_build_object('metric','vehicles_owned'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'logistics-11',v_owned,10,jsonb_build_object('metric','vehicles_owned'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'logistics-12',v_a.completed_contracts,100,jsonb_build_object('metric','completed_contracts'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'logistics-13',v_a.completed_contracts,1000,jsonb_build_object('metric','completed_contracts'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'logistics-14',v_a.overseas_completed,100,jsonb_build_object('metric','overseas_completed'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'logistics-15',v_a.max_direct_success_streak,100,jsonb_build_object('metric','max_direct_success_streak'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'logistics-16',v_types,4,jsonb_build_object('metric','vehicle_types_ever_owned'));
end;
$$;
revoke all on function private.refresh_sd_logistics_achievements(uuid) from public,anon,authenticated;

create or replace function public.sd_logistics_achievement_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_user uuid;
begin
  v_user:=coalesce(new.user_id,old.user_id);
  perform private.refresh_sd_logistics_achievements(v_user);
  return coalesce(new,old);
end;
$$;
revoke all on function public.sd_logistics_achievement_trigger() from public,anon,authenticated;

drop trigger if exists trg_sd_logistics_account_achievements on public.sd_logistics_accounts;
create trigger trg_sd_logistics_account_achievements
 after insert or update on public.sd_logistics_accounts
 for each row execute function public.sd_logistics_achievement_trigger();

drop trigger if exists trg_sd_logistics_vehicle_achievements on public.sd_logistics_vehicles;
create trigger trg_sd_logistics_vehicle_achievements
 after insert or update of vehicle_type,sold_at on public.sd_logistics_vehicles
 for each row execute function public.sd_logistics_achievement_trigger();

drop trigger if exists trg_sd_logistics_type_owned_achievements on public.sd_logistics_vehicle_types_owned;
create trigger trg_sd_logistics_type_owned_achievements
 after insert on public.sd_logistics_vehicle_types_owned
 for each row execute function public.sd_logistics_achievement_trigger();

update public.sd_achievements set active=true where code=any(array[
 'logistics-01','logistics-02','logistics-03','logistics-04','logistics-05','logistics-06','logistics-07','logistics-08',
 'logistics-09','logistics-10','logistics-11','logistics-12','logistics-13','logistics-14','logistics-15','logistics-16'
]::text[]);

do $$ declare r record; begin
  for r in select user_id from public.sd_logistics_accounts loop
    perform private.refresh_sd_logistics_achievements(r.user_id);
  end loop;
end $$;

commit;
