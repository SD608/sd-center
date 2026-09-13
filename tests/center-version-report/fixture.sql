create schema if not exists auth;
create table auth.users(id uuid primary key, email text, last_sign_in_at timestamptz);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.profiles(
  id uuid primary key,
  nickname text not null,
  role text not null,
  status text not null,
  created_at timestamptz not null default now()
);
create table public.wallets(user_id uuid primary key, account_number text, balance bigint);
create table public.invite_codes(code text, used_by uuid, used_at timestamptz);
create table public.sd_access_devices(
  user_id uuid not null,
  device_key text not null,
  platform text,
  browser_label text,
  timezone text,
  locale text,
  last_page text,
  first_seen_at timestamptz,
  last_seen_at timestamptz
);
create table public.devices(
  id uuid primary key,
  user_id uuid not null,
  device_key text not null,
  device_name text not null,
  platform text not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  wallet_fingerprint text,
  previous_account_number text,
  link_status text not null default 'active',
  last_sync_at timestamptz,
  updated_at timestamptz not null default now()
);

create role anon nologin;
create role authenticated nologin;

create or replace function public.sd_assert_active_admin() returns void
language plpgsql security definer set search_path=''
as $$
begin
  if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin' and p.status='active') then
    raise exception using errcode='P1005',message='ADMIN_REQUIRED';
  end if;
end;
$$;

insert into public.profiles(id,nickname,role,status) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','관리자','admin','active'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','회원B','user','active'),
('cccccccc-cccc-4ccc-8ccc-cccccccccccc','회원C','user','active');
insert into auth.users(id,email,last_sign_in_at) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','admin@example.com',now()),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','b@example.com',now()),
('cccccccc-cccc-4ccc-8ccc-cccccccccccc','c@example.com',now());
insert into public.wallets(user_id,account_number,balance) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SD-ADMIN',100),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','SD-B',200),
('cccccccc-cccc-4ccc-8ccc-cccccccccccc','SD-C',300);
insert into public.devices(id,user_id,device_key,device_name,platform,link_status) values
('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',repeat('b',64),'B PC','windows','active'),
('22222222-2222-4222-8222-222222222222','cccccccc-cccc-4ccc-8ccc-cccccccccccc',repeat('c',64),'C PC','windows','active');
