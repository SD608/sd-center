\set ON_ERROR_STOP on

create schema auth;
create role anon nologin;
create role authenticated nologin;
grant usage on schema public to anon, authenticated;
grant usage on schema auth to authenticated;

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to authenticated;

create table auth.users(id uuid primary key);
create table public.profiles(
  id uuid primary key references auth.users(id),
  nickname text not null,
  status text not null default 'active'
);
create table public.devices(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  device_key text not null,
  platform text not null,
  revoked_at timestamptz,
  link_status text not null default 'active',
  unique(user_id,device_key)
);
create table public.wallets(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id),
  balance bigint not null default 0
);
create table public.transactions(
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id),
  user_id uuid not null references auth.users(id),
  transaction_type text not null,
  description text not null,
  amount bigint not null,
  balance_before bigint not null,
  balance_after bigint not null,
  platform text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.sd_flea_items(
  id uuid primary key default gen_random_uuid(),
  origin_user_id uuid not null references auth.users(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete cascade,
  local_item_key text not null,
  box_id text,
  name text not null,
  tier text not null check(tier in ('worn','normal','fancy','premium','safe')),
  original_value bigint not null check(original_value>=0),
  current_value bigint not null check(current_value>=0),
  condition_percent numeric not null check(condition_percent between 0 and 100),
  source_text text not null,
  acquisition_kind text not null check(acquisition_kind in ('pc','system_purchase')),
  purchase_price bigint check(purchase_price is null or purchase_price>=0),
  status text not null check(status in ('owned','system_stock')),
  acquired_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(origin_user_id,local_item_key)
);
create table public.sd_flea_market_stock(
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null unique references public.sd_flea_items(id),
  last_seller_user_id uuid references auth.users(id),
  list_price bigint not null,
  listed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.sd_flea_market_actions(
  request_id uuid not null,
  user_id uuid not null references auth.users(id),
  action_type text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique(request_id,user_id,action_type)
);
create table public.sd_flea_company_snapshots(
  user_id uuid primary key references auth.users(id),
  logistics_rep bigint not null default 0,
  source_device_id uuid references public.devices(id),
  updated_at timestamptz not null default now()
);

insert into auth.users(id) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.profiles(id,nickname,status) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','flea-a','active'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','flea-b','active');
insert into public.wallets(user_id,balance) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1000000),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',500000);
insert into public.devices(id,user_id,device_key,platform,link_status) values
 ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('a',64),'windows','active');
insert into public.sd_flea_company_snapshots(user_id,logistics_rep,source_device_id) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',500,'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');

grant select on public.wallets, public.sd_flea_items, public.sd_flea_company_snapshots to authenticated;
