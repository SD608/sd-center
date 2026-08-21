-- SD Core development baseline
-- DEV/TEST ONLY. Do not apply this file to production SD608-Online.
-- Recreates only the production tables/constraints/indexes SD Core v1 depends on.
-- It intentionally contains no production data and no legacy RPCs.

begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  account_number text not null unique,
  balance bigint not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence public.transactions_sync_seq_seq as bigint;

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_type text not null,
  description text not null,
  amount bigint not null check (amount <> 0),
  balance_before bigint not null check (balance_before >= 0),
  balance_after bigint not null check (balance_after >= 0),
  request_id uuid null unique,
  platform text not null default 'web' check (platform in ('web', 'windows', 'android', 'server', 'admin')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sync_seq bigint not null default nextval('public.transactions_sync_seq_seq'::regclass) unique
);

alter sequence public.transactions_sync_seq_seq owned by public.transactions.sync_seq;

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
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

-- Match the production indexes that matter to Core read/write paths.
create index devices_user_active_idx
  on public.devices (user_id, platform, revoked_at, last_seen_at desc);
create index transactions_user_created_idx
  on public.transactions (user_id, created_at desc);
create index transactions_user_sync_idx
  on public.transactions (user_id, sync_seq);

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.transactions enable row level security;
alter table public.devices enable row level security;

create policy profiles_select_own
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
create policy wallets_select_own
  on public.wallets for select to authenticated
  using ((select auth.uid()) = user_id);
create policy transactions_select_own
  on public.transactions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy devices_select_own
  on public.devices for select to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.profiles, public.wallets, public.transactions, public.devices to authenticated;
revoke insert, update, delete on public.profiles, public.wallets, public.transactions, public.devices from anon, authenticated;

commit;
