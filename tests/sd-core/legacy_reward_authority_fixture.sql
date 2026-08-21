\set ON_ERROR_STOP on

create table public.wallet_migrations(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id),
  status text not null
);

create table public.sd_link_local_operations(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  wallet_id uuid not null references public.wallets(id),
  device_id uuid not null references public.devices(id),
  local_transaction_id text not null,
  server_transaction_id uuid not null unique references public.transactions(id),
  created_at timestamptz not null default now(),
  unique(device_id,local_transaction_id)
);

insert into public.wallet_migrations(user_id,status) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','completed'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','completed');
