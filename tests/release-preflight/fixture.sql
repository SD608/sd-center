\set ON_ERROR_STOP on

create schema auth;
create table auth.users(id uuid primary key);

create table public.profiles (
  id uuid primary key references auth.users(id),
  nickname text not null,
  role text not null default 'user',
  status text not null default 'active'
);

create table public.wallets (
  id uuid primary key,
  user_id uuid not null unique references auth.users(id),
  account_number text not null unique,
  balance bigint not null
);

create sequence public.transactions_sync_seq_seq;
create table public.transactions (
  id uuid primary key,
  wallet_id uuid not null references public.wallets(id),
  user_id uuid not null references auth.users(id),
  transaction_type text not null,
  description text not null,
  amount bigint not null,
  balance_before bigint not null,
  balance_after bigint not null,
  request_id uuid,
  platform text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sync_seq bigint not null default nextval('public.transactions_sync_seq_seq')
);

create table public.devices (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  device_key text not null,
  device_name text not null,
  platform text not null,
  link_status text not null default 'active',
  revoked_at timestamptz
);

create table public.sd_achievements (
  id uuid primary key,
  code text not null unique
);

create table public.sd_user_achievements (
  user_id uuid not null references auth.users(id),
  achievement_id uuid not null references public.sd_achievements(id),
  unlocked_at timestamptz not null,
  primary key(user_id, achievement_id)
);

create table public.sd_achievement_progress (
  user_id uuid not null references auth.users(id),
  achievement_id text not null,
  current_value numeric not null default 0,
  unlocked boolean not null default false,
  unlocked_at timestamptz,
  source_app text not null default 'unknown',
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key(user_id, achievement_id)
);

insert into auth.users(id) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

insert into public.profiles(id,nickname,role,status) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','alpha','user','active'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','beta','user','active');

insert into public.wallets(id,user_id,account_number,balance) values
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','608-TEST-0001',1000000),
 ('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','608-TEST-0002',250000);

insert into public.transactions(id,wallet_id,user_id,transaction_type,description,amount,balance_before,balance_after,request_id,platform) values
 ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','deposit','fixture',1000000,0,1000000,'55555555-5555-4555-8555-555555555555','windows'),
 ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','deposit','fixture',250000,0,250000,'66666666-6666-4666-8666-666666666666','android');

insert into public.devices(id,user_id,device_key,device_name,platform,link_status) values
 ('77777777-7777-4777-8777-777777777777','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('a',64),'Alpha PC','windows','active'),
 ('88888888-8888-4888-8888-888888888888','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',repeat('b',64),'Beta Phone','android','active');

insert into public.sd_achievements(id,code) values
 ('99999999-9999-4999-8999-999999999991','wallet-02'),
 ('99999999-9999-4999-8999-999999999992','slot-01');

insert into public.sd_user_achievements(user_id,achievement_id,unlocked_at) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','99999999-9999-4999-8999-999999999991','2026-08-01T00:00:00Z');

insert into public.sd_achievement_progress(user_id,achievement_id,current_value,unlocked,unlocked_at,source_app) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','wallet-02',10000000,true,'2026-08-01T00:00:00Z','server-fixture'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','slot-01',12,false,null,'server-fixture');
