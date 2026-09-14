begin;

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
    select 1 from public.profiles p
    where p.id = v_admin and p.role = 'admin' and p.status = 'active'
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
    coalesce(pr.last_seen_at, au.last_sign_in_at),
    coalesce(pr.running_apps, '[]'::jsonb)
  from public.profiles p
  join public.wallets w on w.user_id = p.id
  left join auth.users au on au.id = p.id
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
  order by coalesce(pr.online, false) desc, lower(p.nickname), p.id;
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
    select 1 from public.profiles p
    where p.id = v_admin and p.role = 'admin' and p.status = 'active'
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
    'last_seen_at', coalesce(
      (select max(s.last_seen_at) from public.sd_presence_sessions s where s.user_id = p.id),
      au.last_sign_in_at
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
      where s.user_id = p.id
        and s.ended_at is null
        and s.last_seen_at >= now() - interval '90 seconds'
    ), '[]'::jsonb),
    'recent_sessions', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb order by x.started_at desc)
      from (
        select s.instance_id, s.app_id, s.app_name, s.app_version,
               s.device_id, s.started_at, s.last_seen_at, s.ended_at
        from public.sd_presence_sessions s
        where s.user_id = p.id
        order by s.started_at desc
        limit 30
      ) x
    ), '[]'::jsonb)
  ) into v_result
  from public.profiles p
  join public.wallets w on w.user_id = p.id
  left join auth.users au on au.id = p.id
  where p.id = p_user_id;

  if v_result is null then
    raise exception using errcode='P1016', message='USER_NOT_FOUND';
  end if;
  return v_result;
end;
$$;

commit;
