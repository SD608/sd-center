-- SD Logistics authoritative schema + legacy baseline import v2

begin;

create table if not exists public.sd_logistics_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  logistics_rep bigint not null default 0 check (logistics_rep>=0),
  completed_contracts bigint not null default 0 check (completed_contracts>=0),
  headquarters_level int not null default 0 check (headquarters_level between 0 and 10),
  logistics_revenue bigint not null default 0 check (logistics_revenue>=0),
  direct_revenue bigint not null default 0 check (direct_revenue>=0),
  xlarge_completed bigint not null default 0 check (xlarge_completed>=0),
  warehouse_owned boolean not null default false,
  driver_revenue bigint not null default 0 check (driver_revenue>=0),
  hq_perk_points int not null default 0 check (hq_perk_points>=0),
  hq_perks jsonb not null default '{"driverIncome":0,"directIncome":0,"driverSpeed":0}'::jsonb
    check (pg_catalog.jsonb_typeof(hq_perks)='object'),
  overseas_completed bigint not null default 0 check (overseas_completed>=0),
  direct_success_streak bigint not null default 0 check (direct_success_streak>=0),
  max_direct_success_streak bigint not null default 0 check (max_direct_success_streak>=0),
  vehicle_purchases bigint not null default 0 check (vehicle_purchases>=0),
  baseline_source text not null default 'server-new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sd_logistics_vehicles (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_type text not null check (vehicle_type in ('small','medium','large','xlarge')),
  purchase_cost bigint not null check (purchase_cost>=0),
  starter boolean not null default false,
  acquired_at timestamptz not null default now(),
  sold_at timestamptz null,
  sale_transaction_id uuid null unique references public.transactions(id) on delete restrict,
  unique(user_id,id)
);
create unique index if not exists sd_logistics_one_starter_uidx
  on public.sd_logistics_vehicles(user_id) where starter and sold_at is null;
create index if not exists sd_logistics_vehicles_user_owned_idx
  on public.sd_logistics_vehicles(user_id,vehicle_type) where sold_at is null;

create table if not exists public.sd_logistics_vehicle_types_owned (
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_type text not null check (vehicle_type in ('small','medium','large','xlarge')),
  first_owned_at timestamptz not null default now(),
  primary key(user_id,vehicle_type)
);

create table if not exists public.sd_logistics_drivers (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  mission_id text null check (mission_id is null or mission_id in ('local','business','industrial','port')),
  active boolean not null default false,
  next_payout_at timestamptz null,
  next_payout_event_id uuid null unique,
  total_earned bigint not null default 0 check(total_earned>=0),
  hired_at timestamptz not null default now(),
  fired_at timestamptz null
);
create index if not exists sd_logistics_drivers_user_active_idx
  on public.sd_logistics_drivers(user_id,active) where fired_at is null;

create table if not exists public.sd_logistics_contract_offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  route_key text not null,
  from_name text not null,
  to_name text not null,
  cargo text not null,
  base_reward bigint not null check(base_reward>0),
  rep_reward bigint not null check(rep_reward>0),
  min_rank text not null check(min_rank in ('F','E','D','C','B','A','S')),
  risk text not null,
  required_stack int not null check(required_stack>0),
  category text not null check(category in ('일반','장거리','해외')),
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '30 minutes'),
  claimed_at timestamptz null
);
create index if not exists sd_logistics_contract_offers_user_idx
  on public.sd_logistics_contract_offers(user_id,offered_at desc);

create table if not exists public.sd_logistics_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contract_id uuid not null references public.sd_logistics_contract_offers(id) on delete restrict,
  reward bigint not null check(reward>0),
  rep_reward bigint not null check(rep_reward>0),
  required_stack int not null check(required_stack>0),
  category text not null check(category in ('일반','장거리','해외')),
  event_text text not null,
  started_at timestamptz not null default now(),
  end_at timestamptz not null,
  status text not null default 'active' check(status in ('active','completed','cancelled')),
  reward_transaction_id uuid null unique references public.transactions(id) on delete restrict,
  completed_at timestamptz null
);
create index if not exists sd_logistics_deliveries_user_status_idx
  on public.sd_logistics_deliveries(user_id,status,end_at);

create table if not exists public.sd_logistics_delivery_vehicles (
  delivery_id uuid not null references public.sd_logistics_deliveries(id) on delete cascade,
  vehicle_id uuid not null references public.sd_logistics_vehicles(id) on delete restrict,
  primary key(delivery_id,vehicle_id)
);
create index if not exists sd_logistics_delivery_vehicles_vehicle_idx
  on public.sd_logistics_delivery_vehicles(vehicle_id,delivery_id);

do $$
declare v text;
begin
  foreach v in array array[
    'sd_logistics_accounts','sd_logistics_vehicles','sd_logistics_vehicle_types_owned',
    'sd_logistics_drivers','sd_logistics_contract_offers','sd_logistics_deliveries',
    'sd_logistics_delivery_vehicles'
  ] loop
    execute format('alter table public.%I enable row level security',v);
    execute format('revoke all on public.%I from anon',v);
    execute format('revoke insert,update,delete on public.%I from authenticated',v);
    execute format('grant select on public.%I to authenticated',v);
  end loop;
end $$;

drop policy if exists sd_logistics_accounts_select_own on public.sd_logistics_accounts;
create policy sd_logistics_accounts_select_own on public.sd_logistics_accounts for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists sd_logistics_vehicles_select_own on public.sd_logistics_vehicles;
create policy sd_logistics_vehicles_select_own on public.sd_logistics_vehicles for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists sd_logistics_vehicle_types_owned_select_own on public.sd_logistics_vehicle_types_owned;
create policy sd_logistics_vehicle_types_owned_select_own on public.sd_logistics_vehicle_types_owned for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists sd_logistics_drivers_select_own on public.sd_logistics_drivers;
create policy sd_logistics_drivers_select_own on public.sd_logistics_drivers for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists sd_logistics_contract_offers_select_own on public.sd_logistics_contract_offers;
create policy sd_logistics_contract_offers_select_own on public.sd_logistics_contract_offers for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists sd_logistics_deliveries_select_own on public.sd_logistics_deliveries;
create policy sd_logistics_deliveries_select_own on public.sd_logistics_deliveries for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists sd_logistics_delivery_vehicles_select_own on public.sd_logistics_delivery_vehicles;
create policy sd_logistics_delivery_vehicles_select_own on public.sd_logistics_delivery_vehicles for select to authenticated
using (exists(select 1 from public.sd_logistics_deliveries d where d.id=delivery_id and d.user_id=(select auth.uid())));

create or replace function sd_core_private.sd_logistics_rank_index(p_rank text)
returns int language sql immutable set search_path='' as $$
  select case p_rank when 'F' then 0 when 'E' then 1 when 'D' then 2 when 'C' then 3 when 'B' then 4 when 'A' then 5 when 'S' then 6 else -1 end
$$;
revoke all on function sd_core_private.sd_logistics_rank_index(text) from public,anon,authenticated;

create or replace function sd_core_private.sd_logistics_rank_from_rep(p_rep bigint)
returns text language sql immutable set search_path='' as $$
  select case when p_rep>=7000 then 'S' when p_rep>=4500 then 'A' when p_rep>=2800 then 'B' when p_rep>=1600 then 'C' when p_rep>=800 then 'D' when p_rep>=300 then 'E' else 'F' end
$$;
revoke all on function sd_core_private.sd_logistics_rank_from_rep(bigint) from public,anon,authenticated;

create or replace function sd_core_private.ensure_sd_logistics_account_impl(p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_starter uuid;
begin
  if p_user_id is null then return; end if;
  insert into public.sd_logistics_accounts(user_id) values(p_user_id) on conflict do nothing;
  if not exists(select 1 from public.sd_logistics_vehicles where user_id=p_user_id and starter and sold_at is null) then
    v_starter:=gen_random_uuid();
    insert into public.sd_logistics_vehicles(id,user_id,vehicle_type,purchase_cost,starter)
    values(v_starter,p_user_id,'small',0,true);
    insert into public.sd_logistics_vehicle_types_owned(user_id,vehicle_type) values(p_user_id,'small') on conflict do nothing;
  end if;
end;
$$;
revoke all on function sd_core_private.ensure_sd_logistics_account_impl(uuid) from public,anon,authenticated;

do $$
declare r record; v_state jsonb; v_user uuid; v_fleet jsonb; v_vehicle jsonb; v_id uuid; v_type text; v_starter boolean; v_cost bigint; v_acquired timestamptz;
begin
  if to_regclass('public.sd_logistics_progress') is null then return; end if;
  for r in execute 'select user_id,state from public.sd_logistics_progress' loop
    v_user:=r.user_id; v_state:=coalesce(r.state,'{}'::jsonb);
    if jsonb_array_length(coalesce(v_state->'activeDeliveries','[]'::jsonb))>0 then
      raise exception 'LOGISTICS_ACTIVE_DELIVERY_PRESENT_FOR_MIGRATION';
    end if;
    insert into public.sd_logistics_accounts(
      user_id,logistics_rep,completed_contracts,headquarters_level,logistics_revenue,direct_revenue,
      xlarge_completed,warehouse_owned,driver_revenue,hq_perk_points,hq_perks,
      overseas_completed,direct_success_streak,max_direct_success_streak,vehicle_purchases,baseline_source
    ) values(
      v_user,
      greatest(0,coalesce((v_state->>'logisticsRep')::bigint,0)),
      greatest(0,coalesce((v_state->>'completedContracts')::bigint,0)),
      least(10,greatest(0,coalesce((v_state->>'headquartersLevel')::int,0))),
      greatest(0,coalesce((v_state->>'logisticsRevenue')::bigint,0)),
      greatest(0,coalesce((v_state->>'logisticsRevenue')::bigint,0)-coalesce((v_state->>'driverRevenue')::bigint,0)),
      greatest(0,coalesce((v_state->>'xlargeCompleted')::bigint,0)),
      coalesce((v_state->>'warehouseOwned')::boolean,false),
      greatest(0,coalesce((v_state->>'driverRevenue')::bigint,0)),
      greatest(0,coalesce((v_state->>'hqPerkPoints')::int,0)),
      case when jsonb_typeof(v_state->'hqPerks')='object' then v_state->'hqPerks' else '{"driverIncome":0,"directIncome":0,"driverSpeed":0}'::jsonb end,
      0,
      greatest(0,coalesce((v_state->>'completedContracts')::bigint,0)),
      greatest(0,coalesce((v_state->>'completedContracts')::bigint,0)),
      greatest(0,jsonb_array_length(coalesce(v_state->'fleet','[]'::jsonb))-1),
      'legacy-sd_logistics_progress'
    ) on conflict(user_id) do nothing;

    v_fleet:=coalesce(v_state->'fleet','[]'::jsonb);
    for v_vehicle in select value from jsonb_array_elements(v_fleet) loop
      begin v_id:=(v_vehicle->>'id')::uuid; exception when others then v_id:=gen_random_uuid(); end;
      v_type:=case when v_vehicle->>'type' in ('small','medium','large','xlarge') then v_vehicle->>'type' else 'small' end;
      v_starter:=coalesce((v_vehicle->>'starter')::boolean,false);
      v_cost:=greatest(0,coalesce((v_vehicle->>'purchaseCost')::bigint,0));
      begin v_acquired:=to_timestamp((v_vehicle->>'acquiredAt')::double precision/1000.0); exception when others then v_acquired:=now(); end;
      insert into public.sd_logistics_vehicles(id,user_id,vehicle_type,purchase_cost,starter,acquired_at)
      values(v_id,v_user,v_type,v_cost,v_starter,v_acquired) on conflict(id) do nothing;
      insert into public.sd_logistics_vehicle_types_owned(user_id,vehicle_type,first_owned_at)
      values(v_user,v_type,v_acquired) on conflict do nothing;
    end loop;
    perform sd_core_private.ensure_sd_logistics_account_impl(v_user);
  end loop;
end $$;

commit;
