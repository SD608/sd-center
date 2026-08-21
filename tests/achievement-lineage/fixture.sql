create extension if not exists pgcrypto;
create schema if not exists private;

create table public.sd_achievements (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  icon text,
  title_reward text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  hidden boolean not null default false
);

create table public.sd_achievement_progress (
  user_id uuid not null,
  achievement_id text not null,
  current_value numeric not null default 0,
  unlocked boolean not null default false,
  unlocked_at timestamptz,
  source_app text not null default 'fixture',
  updated_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

insert into public.sd_achievements(id, code, name, sort_order)
values
  ('11111111-1111-4111-8111-111111111111', 'wallet-01', 'Fixture Wallet', 1),
  ('22222222-2222-4222-8222-222222222222', 'miner-01', 'Fixture Miner', 2);

insert into public.sd_achievement_progress(user_id, achievement_id, current_value, unlocked)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'wallet-01', 1, true);
