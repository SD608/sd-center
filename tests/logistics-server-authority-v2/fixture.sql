\set ON_ERROR_STOP on

create schema auth;
create schema sd_core_private;
create schema private;
create role anon nologin;
create role authenticated nologin;
grant usage on schema public,auth to authenticated;
revoke all on schema sd_core_private,private from public,anon,authenticated;

create function auth.uid()
returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant execute on function auth.uid() to authenticated;

create table auth.users(id uuid primary key);
create table public.profiles(
  id uuid primary key references auth.users(id),
  nickname text not null,
  role text not null default 'user',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.wallets(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id),
  account_number text not null unique,
  balance bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create sequence public.transactions_sync_seq_seq as bigint;
create table public.transactions(
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id),
  user_id uuid not null references auth.users(id),
  transaction_type text not null,
  description text not null,
  amount bigint not null,
  balance_before bigint not null,
  balance_after bigint not null,
  request_id uuid unique,
  platform text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sync_seq bigint not null default nextval('public.transactions_sync_seq_seq') unique
);

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.transactions enable row level security;
grant select on public.profiles,public.wallets,public.transactions to authenticated;

create table public.sd_achievements(
 id uuid primary key default gen_random_uuid(),
 code text not null unique,
 name text not null,
 description text null,
 icon text null,
 title_reward text null,
 sort_order int not null default 0,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 hidden boolean not null default false
);
create table public.sd_achievement_progress(
 user_id uuid not null references auth.users(id),
 achievement_id text not null,
 current_value numeric not null default 0,
 unlocked boolean not null default false,
 unlocked_at timestamptz null,
 source_app text not null default 'unknown',
 metadata jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now(),
 primary key(user_id,achievement_id)
);
create table public.sd_user_achievements(
 user_id uuid not null references auth.users(id),
 achievement_id uuid not null references public.sd_achievements(id),
 unlocked_at timestamptz not null default now(),
 primary key(user_id,achievement_id)
);
alter table public.sd_achievements enable row level security;
alter table public.sd_achievement_progress enable row level security;
alter table public.sd_user_achievements enable row level security;
grant select on public.sd_achievements,public.sd_achievement_progress,public.sd_user_achievements to authenticated;
revoke insert,update,delete on public.sd_achievement_progress from anon,authenticated;

create or replace function private.upsert_sd_authoritative_achievement(
  p_user_id uuid,p_achievement_id text,p_server_value numeric,p_target numeric,p_metadata jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path='' as $$
declare v_value numeric:=greatest(0,coalesce(p_server_value,0)); v_target numeric:=greatest(0,coalesce(p_target,0));
begin
  if p_user_id is null then return; end if;
  insert into public.sd_achievement_progress as p(user_id,achievement_id,current_value,unlocked,unlocked_at,source_app,metadata,updated_at)
  values(p_user_id,p_achievement_id,v_value,v_value>=v_target,case when v_value>=v_target then now() else null end,'server-authority',coalesce(p_metadata,'{}'::jsonb),now())
  on conflict on constraint sd_achievement_progress_pkey do update set
    current_value=greatest(p.current_value,excluded.current_value),
    unlocked=p.unlocked or excluded.unlocked,
    unlocked_at=case when p.unlocked_at is not null then p.unlocked_at when p.unlocked or excluded.unlocked then now() else null end,
    source_app=case when excluded.current_value>=p.current_value then excluded.source_app else p.source_app end,
    metadata=coalesce(p.metadata,'{}'::jsonb)||excluded.metadata,
    updated_at=now();
end;$$;
revoke all on function private.upsert_sd_authoritative_achievement(uuid,text,numeric,numeric,jsonb) from public,anon,authenticated;

insert into public.sd_achievements(code,name,sort_order,active)
select 'logistics-'||lpad(g::text,2,'0'),'Logistics '||g,200+g,false
from generate_series(1,16) g;

-- Production-shaped legacy logistics snapshot for cutover regression.
create table public.sd_logistics_progress(
  user_id uuid primary key references auth.users(id),
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sd_logistics_progress enable row level security;
grant select,insert,update on public.sd_logistics_progress to authenticated;

insert into auth.users(id) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.profiles(id,nickname,status) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','legacy-logistics','active'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','fresh-logistics','active');
insert into public.wallets(id,user_id,account_number,balance) values
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','608-LOG-0001',10000000),
 ('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','608-LOG-0002',10000000);

insert into public.sd_logistics_progress(user_id,state) values(
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 jsonb_build_object(
  'logisticsRep',8517,
  'completedContracts',168,
  'headquartersLevel',2,
  'logisticsRevenue',6151550,
  'xlargeCompleted',4,
  'warehouseOwned',false,
  'driverRevenue',0,
  'hqPerkPoints',1,
  'hqPerks',jsonb_build_object('driverIncome',0,'directIncome',0,'driverSpeed',0),
  'activeDeliveries','[]'::jsonb,
  'fleet',jsonb_build_array(jsonb_build_object(
    'id','aaaaaaaa-0000-4000-8000-000000000001',
    'type','small','purchaseCost',0,'starter',true,'acquiredAt',1700000000000
  )),
  'employees','[]'::jsonb,
  'contracts','[]'::jsonb
 )
);
