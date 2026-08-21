\set ON_ERROR_STOP on

create schema auth;
create role anon nologin;
create role authenticated nologin;
grant usage on schema public to authenticated,anon;
grant usage on schema auth to authenticated;

create function auth.uid()
returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant execute on function auth.uid() to authenticated;

create table auth.users(id uuid primary key);
create table public.profiles(
  id uuid primary key references auth.users(id),
  nickname text not null,
  role text not null default 'user',
  status text not null default 'active'
);
create table public.wallets(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id),
  account_number text not null unique,
  balance bigint not null default 0,
  updated_at timestamptz not null default now()
);
create sequence public.transactions_sync_seq_seq;
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
  sync_seq bigint not null default nextval('public.transactions_sync_seq_seq')
);
create table public.sd_logistics_wallet_events(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  wallet_id uuid not null references public.wallets(id),
  event_key text not null,
  reference_id text not null,
  amount bigint not null,
  request_id uuid not null,
  transaction_id uuid not null unique references public.transactions(id),
  created_at timestamptz not null default now(),
  unique(user_id,event_key,reference_id)
);

insert into auth.users(id) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.profiles(id,nickname,status) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','logistics-a','active'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','logistics-b','active');
insert into public.wallets(id,user_id,account_number,balance) values
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','608-LOG-0001',1000000),
 ('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','608-LOG-0002',500000);

grant select on public.wallets,public.transactions to authenticated;
