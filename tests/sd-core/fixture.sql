\set ON_ERROR_STOP on

create schema auth;

create role anon nologin;
create role authenticated nologin;

grant usage on schema public to anon, authenticated;
grant usage on schema auth to authenticated;

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant execute on function auth.uid() to authenticated;

create table auth.users (
  id uuid primary key
);

create table public.profiles (
  id uuid primary key references auth.users(id),
  nickname text not null,
  role text not null default 'user',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.wallets (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null unique references auth.users(id),
  account_number text not null unique,
  balance bigint not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence public.transactions_sync_seq_seq;

create table public.transactions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id),
  user_id uuid not null references auth.users(id),
  transaction_type text not null,
  description text not null,
  amount bigint not null check (amount <> 0),
  balance_before bigint not null check (balance_before >= 0),
  balance_after bigint not null check (balance_after >= 0),
  request_id uuid unique,
  platform text not null default 'web' check (platform in ('web', 'windows', 'android', 'server', 'admin')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sync_seq bigint not null default nextval('public.transactions_sync_seq_seq')
);

create table public.devices (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  device_key text not null,
  device_name text not null,
  platform text not null check (platform in ('windows', 'android', 'web')),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  wallet_fingerprint text null,
  previous_account_number text null,
  link_status text not null default 'active' check (link_status in ('active', 'paused')),
  last_sync_at timestamptz null,
  updated_at timestamptz not null default now(),
  unique (user_id, device_key)
);

alter table public.wallets enable row level security;
alter table public.transactions enable row level security;
alter table public.devices enable row level security;

create policy wallets_select_own
  on public.wallets
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy transactions_select_own
  on public.transactions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy devices_select_own
  on public.devices
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.wallets, public.transactions, public.devices to authenticated;

insert into auth.users (id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

insert into public.profiles (id, nickname, status) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'core-test-a', 'active'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'core-test-b', 'active');

insert into public.wallets (id, user_id, account_number, balance) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '608-CORE-0001', 1000000),
  ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '608-CORE-0002', 50000);
