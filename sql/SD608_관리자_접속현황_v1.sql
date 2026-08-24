begin;

create table if not exists public.sd_presence_sessions (
  instance_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid null references public.devices(id) on delete set null,
  app_id text not null,
  app_name text not null,
  app_version text null,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  constraint sd_presence_app_id_format check (app_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  constraint sd_presence_app_name_length check (char_length(app_name) between 1 and 80),
  constraint sd_presence_app_version_length check (app_version is null or char_length(app_version) <= 32),
  constraint sd_presence_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint sd_presence_metadata_size check (octet_length(metadata::text) <= 4096),
  constraint sd_presence_time_order check (ended_at is null or ended_at >= started_at)
);

alter table public.sd_presence_sessions enable row level security;
revoke all on table public.sd_presence_sessions from public, anon, authenticated;

create index if not exists sd_presence_sessions_user_seen_idx
  on public.sd_presence_sessions (user_id, last_seen_at desc);
create index if not exists sd_presence_sessions_active_seen_idx
  on public.sd_presence_sessions (last_seen_at desc)
  where ended_at is null;
create index if not exists sd_presence_sessions_device_idx
  on public.sd_presence_sessions (device_id)
  where device_id is not null;

create or replace function public.sd_presence_v1_heartbeat(
  p_instance_id uuid,
  p_app_id text,
  p_app_name text,
  p_app_version text default null,
  p_device_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_existing_user uuid;
  v_existing_ended timestamptz;
  v_existing_app_id text;
  v_existing_device_id uuid;
  v_app_id text := lower(trim(coalesce(p_app_id, '')));
  v_app_name text := trim(coalesce(p_app_name, ''));
  v_app_version text := nullif(trim(coalesce(p_app_version, '')), '');
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if v_user_id is null then
    raise exception using errcode='P1001', message='AUTH_REQUIRED';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_user_id and p.status = 'active'
  ) then
    raise exception using errcode='P1002', message='ACCOUNT_INACTIVE';
  end if;
  if p_instance_id is null then
    raise exception using errcode='P1027', message='INVALID_INSTANCE_ID';
  end if;
  if v_app_id !~ '^[a-z0-9][a-z0-9._-]{0,63}$' then
    raise exception using errcode='P1027', message='INVALID_APP_ID';
  end if;
  if char_length(v_app_name) < 1 or char_length(v_app_name) > 80 then
    raise exception using errcode='P1027', message='INVALID_APP_NAME';
  end if;
  if v_app_version is not null and char_length(v_app_version) > 32 then
    raise exception using errcode='P1027', message='INVALID_APP_VERSION';
  end if;
  if jsonb_typeof(v_metadata) <> 'object' or octet_length(v_metadata::text) > 4096 then
    raise exception using errcode='P1026', message='INVALID_METADATA';
  end if;

  if p_device_id is not null and not exists (
    select 1 from public.devices d
    where d.id = p_device_id
      and d.user_id = v_user_id
      and d.link_status = 'active'
      and d.revoked_at is null
  ) then
    raise exception using errcode='P1003', message='DEVICE_NOT_FOUND_OR_INACTIVE';
  end if;

  select s.user_id, s.ended_at, s.app_id, s.device_id
    into v_existing_user, v_existing_ended, v_existing_app_id, v_existing_device_id
  from public.sd_presence_sessions s
  where s.instance_id = p_instance_id
  for update;

  if v_existing_user is not null and v_existing_user <> v_user_id then
    raise exception using errcode='P1015', message='INSTANCE_ID_CONFLICT';
  end if;
  if v_existing_ended is not null then
    raise exception using errcode='P1027', message='INSTANCE_ALREADY_ENDED';
  end if;
  if v_existing_app_id is not null and v_existing_app_id <> v_app_id then
    raise exception using errcode='P1015', message='INSTANCE_APP_CONFLICT';
  end if;
  if v_existing_device_id is not null and p_device_id is not null and v_existing_device_id <> p_device_id then
    raise exception using errcode='P1015', message='INSTANCE_DEVICE_CONFLICT';
  end if;

  insert into public.sd_presence_sessions (
    instance_id, user_id, device_id, app_id, app_name, app_version,
    started_at, last_seen_at, ended_at, metadata
  ) values (
    p_instance_id, v_user_id, p_device_id, v_app_id, v_app_name, v_app_version,
    v_now, v_now, null, v_metadata
  )
  on conflict (instance_id) do update
    set device_id = coalesce(public.sd_presence_sessions.device_id, excluded.device_id),
        app_name = excluded.app_name,
        app_version = excluded.app_version,
        last_seen_at = v_now,
        metadata = excluded.metadata
    where public.sd_presence_sessions.user_id = v_user_id
      and public.sd_presence_sessions.ended_at is null;

  return jsonb_build_object(
    'ok', true,
    'instance_id', p_instance_id,
    'server_time', v_now,
    'online_until', v_now + interval '90 seconds'
  );
end;
$$;

create or replace function public.sd_presence_v1_end(p_instance_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ended_at timestamptz;
begin
  if v_user_id is null then
    raise exception using errcode='P1001', message='AUTH_REQUIRED';
  end if;
  if p_instance_id is null then
    raise exception using errcode='P1027', message='INVALID_INSTANCE_ID';
  end if;

  update public.sd_presence_sessions
     set ended_at = coalesce(ended_at, now()),
         last_seen_at = greatest(last_seen_at, now())
   where instance_id = p_instance_id
     and user_id = v_user_id
  returning ended_at into v_ended_at;

  if v_ended_at is null then
    raise exception using errcode='P1016', message='PRESENCE_INSTANCE_NOT_FOUND';
  end if;

  return jsonb_build_object('ok', true, 'instance_id', p_instance_id, 'ended_at', v_ended_at);
end;
$$;

create or replace function public.sd_admin_v1_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode='P1001', message='AUTH_REQUIRED';
  end if;
  select * into v_profile from public.profiles p where p.id = v_user_id;
  if v_profile.id is null or v_profile.role <> 'admin' or v_profile.status <> 'active' then
    raise exception using errcode='P1005', message='ADMIN_REQUIRED';
  end if;
  return jsonb_build_object(
    'user_id', v_profile.id,
    'nickname', v_profile.nickname,
    'role', v_profile.role,
    'status', v_profile.status
  );
end;
$$;

create or replace function public.sd_admin_v1_list_users()
returns table(
  user_id uuid,
  nickname text,
  role text,
  status text,
  account_number text,
  balance bigint,
  online boolean,
  last_seen_at timestamptz,
  running_apps jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
begin
  if v_admin is null or not exists (
    select 1 from public.profiles p where p.id=v_admin and p.role='admin' and p.status='active'
  ) then
    raise exception using errcode='P1005', message='ADMIN_REQUIRED';
  end if;

  return query
  select
    p.id,
    p.nickname,
    p.role,
    p.status,
    w.account_number,
    w.balance,
    coalesce(pr.online, false),
    pr.last_seen_at,
    coalesce(pr.running_apps, '[]'::jsonb)
  from public.profiles p
  join public.wallets w on w.user_id = p.id
  left join lateral (
    select
      max(s.last_seen_at) as last_seen_at,
      bool_or(s.ended_at is null and s.last_seen_at >= now() - interval '90 seconds') as online,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'instance_id', s.instance_id,
            'app_id', s.app_id,
            'app_name', s.app_name,
            'app_version', s.app_version,
            'device_id', s.device_id,
            'started_at', s.started_at,
            'last_seen_at', s.last_seen_at
          ) order by s.started_at
        ) filter (where s.ended_at is null and s.last_seen_at >= now() - interval '90 seconds'),
        '[]'::jsonb
      ) as running_apps
    from public.sd_presence_sessions s
    where s.user_id = p.id
  ) pr on true
  order by coalesce(pr.online,false) desc, lower(p.nickname), p.id;
end;
$$;

create or replace function public.sd_admin_v1_get_user(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_result jsonb;
begin
  if v_admin is null or not exists (
    select 1 from public.profiles p where p.id=v_admin and p.role='admin' and p.status='active'
  ) then
    raise exception using errcode='P1005', message='ADMIN_REQUIRED';
  end if;
  if p_user_id is null then
    raise exception using errcode='P1027', message='INVALID_USER_ID';
  end if;

  select jsonb_build_object(
    'user_id', p.id,
    'nickname', p.nickname,
    'role', p.role,
    'status', p.status,
    'account_number', w.account_number,
    'balance', w.balance,
    'last_seen_at', (
      select max(s.last_seen_at) from public.sd_presence_sessions s where s.user_id=p.id
    ),
    'running_apps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'instance_id', s.instance_id,
        'app_id', s.app_id,
        'app_name', s.app_name,
        'app_version', s.app_version,
        'device_id', s.device_id,
        'started_at', s.started_at,
        'last_seen_at', s.last_seen_at
      ) order by s.started_at)
      from public.sd_presence_sessions s
      where s.user_id=p.id
        and s.ended_at is null
        and s.last_seen_at >= now() - interval '90 seconds'
    ), '[]'::jsonb),
    'recent_sessions', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb order by x.started_at desc)
      from (
        select s.instance_id,s.app_id,s.app_name,s.app_version,s.device_id,s.started_at,s.last_seen_at,s.ended_at
        from public.sd_presence_sessions s
        where s.user_id=p.id
        order by s.started_at desc
        limit 30
      ) x
    ), '[]'::jsonb)
  ) into v_result
  from public.profiles p
  join public.wallets w on w.user_id=p.id
  where p.id=p_user_id;

  if v_result is null then
    raise exception using errcode='P1016', message='USER_NOT_FOUND';
  end if;
  return v_result;
end;
$$;

create or replace function public.sd_admin_v1_list_transactions(
  p_user_id uuid,
  p_before_seq bigint default null,
  p_limit integer default 50
)
returns table(
  sync_seq bigint,
  transaction_id uuid,
  transaction_type text,
  description text,
  amount bigint,
  balance_before bigint,
  balance_after bigint,
  platform text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit,50),1),100);
begin
  if v_admin is null or not exists (
    select 1 from public.profiles p where p.id=v_admin and p.role='admin' and p.status='active'
  ) then
    raise exception using errcode='P1005', message='ADMIN_REQUIRED';
  end if;
  if p_user_id is null then
    raise exception using errcode='P1027', message='INVALID_USER_ID';
  end if;

  return query
  select t.sync_seq,t.id,t.transaction_type,t.description,t.amount,
         t.balance_before,t.balance_after,t.platform,t.created_at
  from public.transactions t
  where t.user_id=p_user_id
    and (p_before_seq is null or t.sync_seq < p_before_seq)
  order by t.sync_seq desc
  limit v_limit;
end;
$$;

create or replace function public.sd_admin_v1_adjust_wallet(
  p_target_user_id uuid,
  p_direction text,
  p_amount bigint,
  p_note text default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_direction text := lower(trim(coalesce(p_direction,'')));
  v_note text := nullif(trim(coalesce(p_note,'')), '');
  v_signed_amount bigint;
  v_event_key text;
  v_nickname text;
  v_account_number text;
  v_result jsonb;
begin
  if v_admin is null or not exists (
    select 1 from public.profiles p where p.id=v_admin and p.role='admin' and p.status='active'
  ) then
    raise exception using errcode='P1005', message='ADMIN_REQUIRED';
  end if;
  if p_target_user_id is null or p_target_user_id=v_admin then
    raise exception using errcode='P1027', message='INVALID_ADMIN_WALLET_TARGET';
  end if;
  if p_request_id is null then
    raise exception using errcode='P1027', message='REQUEST_ID_REQUIRED';
  end if;
  if v_direction not in ('credit','debit') then
    raise exception using errcode='P1027', message='INVALID_DIRECTION';
  end if;
  if p_amount is null or p_amount<1 or p_amount>1000000000 then
    raise exception using errcode='P1011', message='INVALID_AMOUNT';
  end if;
  if v_note is not null and char_length(v_note)>80 then
    raise exception using errcode='P1027', message='NOTE_TOO_LONG';
  end if;

  select p.nickname,w.account_number
    into v_nickname,v_account_number
  from public.profiles p
  join public.wallets w on w.user_id=p.id
  where p.id=p_target_user_id and p.status='active' and p.role<>'admin';
  if v_nickname is null then
    raise exception using errcode='P1016', message='WALLET_TARGET_NOT_FOUND';
  end if;

  v_signed_amount := case when v_direction='credit' then p_amount else -p_amount end;
  v_event_key := case when v_direction='credit' then 'admin_credit' else 'admin_debit' end;

  v_result := sd_core_private.apply_server_wallet_delta_impl(
    p_target_user_id,
    p_request_id,
    v_event_key,
    v_signed_amount,
    'sd_admin_monitor',
    case
      when v_note is null and v_direction='credit' then '관리자 가상잔액 지급'
      when v_note is null then '관리자 가상잔액 차감'
      when v_direction='credit' then '관리자 지급 · '||v_note
      else '관리자 가상잔액 차감 · '||v_note
    end,
    jsonb_build_object('admin_user_id',v_admin,'note',v_note,'admin_api_version','v1')
  );

  return v_result || jsonb_build_object(
    'nickname',v_nickname,
    'account_number',v_account_number,
    'direction',v_direction,
    'requested_amount',p_amount
  );
end;
$$;

revoke all on function public.sd_presence_v1_heartbeat(uuid,text,text,text,uuid,jsonb) from public, anon;
revoke all on function public.sd_presence_v1_end(uuid) from public, anon;
revoke all on function public.sd_admin_v1_me() from public, anon, authenticated;
revoke all on function public.sd_admin_v1_list_users() from public, anon, authenticated;
revoke all on function public.sd_admin_v1_get_user(uuid) from public, anon, authenticated;
revoke all on function public.sd_admin_v1_list_transactions(uuid,bigint,integer) from public, anon, authenticated;
revoke all on function public.sd_admin_v1_adjust_wallet(uuid,text,bigint,text,uuid) from public, anon, authenticated;

grant execute on function public.sd_presence_v1_heartbeat(uuid,text,text,text,uuid,jsonb) to authenticated;
grant execute on function public.sd_presence_v1_end(uuid) to authenticated;
grant execute on function public.sd_admin_v1_me() to authenticated;
grant execute on function public.sd_admin_v1_list_users() to authenticated;
grant execute on function public.sd_admin_v1_get_user(uuid) to authenticated;
grant execute on function public.sd_admin_v1_list_transactions(uuid,bigint,integer) to authenticated;
grant execute on function public.sd_admin_v1_adjust_wallet(uuid,text,bigint,text,uuid) to authenticated;

commit;
