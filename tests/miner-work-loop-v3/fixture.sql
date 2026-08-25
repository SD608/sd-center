\set ON_ERROR_STOP on

create schema auth;
create schema private;
create schema sd_core_private;
create schema extensions;
create role anon nologin;
create role authenticated nologin;
grant usage on schema public, auth to authenticated;
revoke all on schema private, sd_core_private from public, anon, authenticated;

create extension if not exists pgcrypto with schema extensions;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt()->>'sub','')::uuid
$$;

grant execute on function auth.jwt() to authenticated;
grant execute on function auth.uid() to authenticated;

create table auth.users(
  id uuid primary key
);

create table auth.sessions(
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  not_after timestamptz
);

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
grant select on public.profiles, public.wallets, public.transactions to authenticated;

create table public.sd_access_devices(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_key text not null,
  platform text,
  browser_label text,
  timezone text,
  locale text,
  last_page text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  bound_session_id uuid,
  admin_secret_hash bytea,
  unique(user_id, device_key)
);
create unique index sd_access_devices_user_session_unique_idx
  on public.sd_access_devices(user_id, bound_session_id)
  where bound_session_id is not null;
alter table public.sd_access_devices enable row level security;
revoke all on public.sd_access_devices from public, anon, authenticated;

create or replace function private.get_current_sd_session_id_v2(p_user_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session_text text;
  v_session_id uuid;
begin
  if p_user_id is null then
    return null;
  end if;

  v_session_text := nullif(auth.jwt()->>'session_id', '');
  if v_session_text is null then
    return null;
  end if;

  begin
    v_session_id := v_session_text::uuid;
  exception when invalid_text_representation then
    return null;
  end;

  if not exists (
    select 1
    from auth.sessions s
    where s.id = v_session_id
      and s.user_id = p_user_id
      and (s.not_after is null or s.not_after > now())
  ) then
    return null;
  end if;

  return v_session_id;
end;
$$;
revoke all on function private.get_current_sd_session_id_v2(uuid) from public, anon, authenticated;

create or replace function public.record_sd_access_heartbeat(
  p_device_key text,
  p_platform text default 'desktop',
  p_browser_label text default null,
  p_timezone text default null,
  p_locale text default null,
  p_page text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile_status text;
  v_session_id uuid;
  v_device_id uuid;
  v_bound_session_id uuid;
  v_revoked_at timestamptz;
  v_device_key text := trim(coalesce(p_device_key, ''));
  v_platform text := left(trim(coalesce(p_platform, 'desktop')), 40);
  v_browser text := nullif(left(trim(coalesce(p_browser_label, '')), 80), '');
  v_timezone text := nullif(left(trim(coalesce(p_timezone, '')), 80), '');
  v_locale text := nullif(left(trim(coalesce(p_locale, '')), 40), '');
  v_page text := nullif(left(trim(coalesce(p_page, '')), 160), '');
begin
  if v_user_id is null then
    raise exception using errcode='P1001', message='AUTH_REQUIRED';
  end if;

  v_session_id := private.get_current_sd_session_id_v2(v_user_id);
  if v_session_id is null then
    raise exception using errcode='P1008', message='SESSION_REVOKED';
  end if;

  select p.status into v_profile_status
  from public.profiles p
  where p.id = v_user_id;

  if v_profile_status is distinct from 'active' then
    raise exception using errcode='P1002', message='ACCOUNT_INACTIVE';
  end if;

  if char_length(v_device_key) < 8 or char_length(v_device_key) > 120
     or v_device_key !~ '^[A-Za-z0-9._:-]+$' then
    raise exception using errcode='P1019', message='INVALID_DEVICE_KEY';
  end if;

  select d.id, d.bound_session_id, d.revoked_at
    into v_device_id, v_bound_session_id, v_revoked_at
  from public.sd_access_devices d
  where d.user_id = v_user_id
    and d.device_key = v_device_key
  for update;

  if v_device_id is not null and v_revoked_at is not null then
    raise exception using errcode='P1006', message='DEVICE_REVOKED';
  end if;

  if exists (
    select 1
    from public.sd_access_devices d
    where d.user_id = v_user_id
      and d.bound_session_id = v_session_id
      and (v_device_id is null or d.id <> v_device_id)
  ) then
    raise exception using errcode='P1009', message='SESSION_DEVICE_MISMATCH';
  end if;

  begin
    if v_device_id is null then
      insert into public.sd_access_devices(
        user_id, device_key, platform, browser_label, timezone, locale, last_page,
        first_seen_at, last_seen_at, bound_session_id
      ) values(
        v_user_id, v_device_key, v_platform, v_browser, v_timezone, v_locale, v_page,
        now(), now(), v_session_id
      ) returning id into v_device_id;
    else
      update public.sd_access_devices
      set platform = v_platform,
          browser_label = v_browser,
          timezone = v_timezone,
          locale = v_locale,
          last_page = v_page,
          last_seen_at = now(),
          bound_session_id = v_session_id
      where id = v_device_id;
    end if;
  exception when unique_violation then
    raise exception using errcode='P1009', message='SESSION_DEVICE_MISMATCH';
  end;

  return jsonb_build_object('ok', true, 'device_id', v_device_id, 'session_bound', true);
end;
$$;
revoke execute on function public.record_sd_access_heartbeat(text,text,text,text,text,text) from public, anon;
grant execute on function public.record_sd_access_heartbeat(text,text,text,text,text,text) to authenticated;

create table public.sd_achievement_progress(
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
alter table public.sd_achievement_progress enable row level security;
revoke insert, update, delete on public.sd_achievement_progress from anon, authenticated;
grant select on public.sd_achievement_progress to authenticated;

create or replace function private.upsert_sd_authoritative_achievement(
  p_user_id uuid,
  p_achievement_id text,
  p_server_value numeric,
  p_target numeric,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value numeric := greatest(0, coalesce(p_server_value,0));
  v_target numeric := greatest(0, coalesce(p_target,0));
begin
  if p_user_id is null then return; end if;

  insert into public.sd_achievement_progress as p
    (user_id,achievement_id,current_value,unlocked,unlocked_at,source_app,metadata,updated_at)
  values(
    p_user_id,p_achievement_id,v_value,v_value >= v_target,
    case when v_value >= v_target then now() else null end,
    'server-authority',coalesce(p_metadata,'{}'::jsonb),now()
  )
  on conflict on constraint sd_achievement_progress_pkey do update
    set current_value = greatest(p.current_value, excluded.current_value),
        unlocked = p.unlocked or excluded.unlocked,
        unlocked_at = case
          when p.unlocked_at is not null then p.unlocked_at
          when p.unlocked or excluded.unlocked then now()
          else null
        end,
        source_app = case when excluded.current_value >= p.current_value then excluded.source_app else p.source_app end,
        metadata = coalesce(p.metadata,'{}'::jsonb) || excluded.metadata,
        updated_at = now();
end;
$$;
revoke all on function private.upsert_sd_authoritative_achievement(uuid,text,numeric,numeric,jsonb)
  from public, anon, authenticated;

insert into auth.users(id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc');

insert into public.profiles(id,nickname,status) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','miner-active','active'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','other-active','active'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','miner-inactive','inactive');

insert into public.wallets(id,user_id,account_number,balance) values
  ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','608-MINER-0001',10000000),
  ('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','608-MINER-0002',10000000),
  ('33333333-3333-4333-8333-333333333333','cccccccc-cccc-4ccc-8ccc-cccccccccccc','608-MINER-0003',10000000);

-- Server-evidenced legacy miner data. The v2 baseline importer must preserve these.
insert into public.transactions(
  id,wallet_id,user_id,transaction_type,description,amount,balance_before,balance_after,request_id,platform,metadata
) values
  ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'legacy','SD광산 · 자동 채굴 업그레이드',-500000,10500000,10000000,'55555555-5555-4555-8555-555555555555','legacy','{}'),
  ('66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'legacy','SD광산 · 철 판매',2000000,8000000,10000000,'77777777-7777-4777-8777-777777777777','legacy','{}');

-- Legitimate legacy progress must never move backward during the remake.
insert into public.sd_achievement_progress(
  user_id, achievement_id, current_value, unlocked, unlocked_at, source_app, metadata
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','miner-01',86,false,null,'sdlink-desktop','{}'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','miner-06',1,true,now() - interval '30 days','sdlink-desktop','{}'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','miner-08',5,false,null,'sdlink-desktop','{}');

insert into auth.sessions(id,user_id,not_after) values
  ('aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now() + interval '1 day'),
  ('bbbbbbbb-0000-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',now() + interval '1 day'),
  ('cccccccc-0000-4000-8000-000000000001','cccccccc-cccc-4ccc-8ccc-cccccccccccc',now() + interval '1 day');
