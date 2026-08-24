begin;

alter table public.devices
  add column if not exists center_version text,
  add column if not exists center_build_id text,
  add column if not exists center_version_reported_at timestamptz;

comment on column public.devices.center_version is
  'Client-reported SD Center version for admin diagnostics only. Never authoritative for economy/security decisions.';
comment on column public.devices.center_build_id is
  'Client-reported SD Center build fingerprint for admin diagnostics only.';
comment on column public.devices.center_version_reported_at is
  'Server timestamp of the latest accepted SD Center version report.';

create or replace function public.sd_core_report_center_version(
  p_device_id uuid,
  p_center_version text,
  p_build_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_version text := nullif(trim(coalesce(p_center_version, '')), '');
  v_build_id text := nullif(trim(coalesce(p_build_id, '')), '');
  v_device public.devices%rowtype;
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

  if v_version is null
     or char_length(v_version) > 32
     or v_version !~ '^[0-9A-Za-z][0-9A-Za-z._+-]*$' then
    raise exception using errcode='P1027', message='INVALID_CENTER_VERSION';
  end if;
  if v_build_id is not null and (
    char_length(v_build_id) > 64
    or v_build_id !~ '^[0-9A-Za-z][0-9A-Za-z._:+-]*$'
  ) then
    raise exception using errcode='P1027', message='INVALID_CENTER_BUILD_ID';
  end if;

  select d.* into v_device
  from public.devices d
  where d.id = p_device_id
  for update;

  if v_device.id is null or v_device.user_id <> v_user_id then
    raise exception using errcode='P1003', message='DEVICE_NOT_FOUND';
  end if;
  if v_device.revoked_at is not null or v_device.link_status <> 'active' then
    raise exception using errcode='P1006', message='DEVICE_REVOKED';
  end if;
  if v_device.platform <> 'windows' then
    raise exception using errcode='P1021', message='INVALID_PLATFORM';
  end if;

  update public.devices d
  set center_version = v_version,
      center_build_id = v_build_id,
      center_version_reported_at = pg_catalog.now(),
      last_seen_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where d.id = v_device.id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'device_id', v_device.id,
    'center_version', v_version,
    'center_build_id', v_build_id,
    'reported_at', pg_catalog.now()
  );
end;
$$;

revoke execute on function public.sd_core_report_center_version(uuid,text,text) from public, anon;
grant execute on function public.sd_core_report_center_version(uuid,text,text) to authenticated;

create or replace function public.admin_list_sd_members_v2()
returns table(
  user_id uuid,
  nickname text,
  email text,
  member_role text,
  member_status text,
  joined_at timestamptz,
  last_sign_in_at timestamptz,
  account_number text,
  balance bigint,
  linked_pc_count bigint,
  browser_device_count bigint,
  latest_device_key text,
  latest_platform text,
  latest_browser text,
  latest_timezone text,
  latest_locale text,
  latest_page text,
  latest_device_first_seen_at timestamptz,
  latest_device_last_seen_at timestamptz,
  used_invite_code text,
  invite_used_at timestamptz,
  latest_center_version text,
  latest_center_build_id text,
  latest_center_version_reported_at timestamptz
)
language plpgsql
stable
security definer
set search_path = 'public', 'auth', 'pg_temp'
as $$
begin
  perform public.sd_assert_active_admin();

  return query
  select
    p.id,
    p.nickname,
    u.email::text,
    p.role,
    p.status,
    p.created_at,
    u.last_sign_in_at,
    w.account_number,
    w.balance,
    coalesce(pc.pc_count, 0),
    coalesce(bd.browser_count, 0),
    lastdev.device_key,
    lastdev.platform,
    lastdev.browser_label,
    lastdev.timezone,
    lastdev.locale,
    lastdev.last_page,
    lastdev.first_seen_at,
    lastdev.last_seen_at,
    inv.code,
    inv.used_at,
    centerdev.center_version,
    centerdev.center_build_id,
    centerdev.center_version_reported_at
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.wallets w on w.user_id = p.id
  left join public.invite_codes inv on inv.used_by = p.id
  left join lateral (
    select count(*)::bigint as pc_count
    from public.devices d
    where d.user_id = p.id
      and d.platform = 'windows'
      and d.revoked_at is null
      and d.link_status = 'active'
  ) pc on true
  left join lateral (
    select count(*)::bigint as browser_count
    from public.sd_access_devices d
    where d.user_id = p.id
  ) bd on true
  left join lateral (
    select
      d.device_key, d.platform, d.browser_label, d.timezone, d.locale,
      d.last_page, d.first_seen_at, d.last_seen_at
    from public.sd_access_devices d
    where d.user_id = p.id
    order by d.last_seen_at desc
    limit 1
  ) lastdev on true
  left join lateral (
    select d.center_version, d.center_build_id, d.center_version_reported_at
    from public.devices d
    where d.user_id = p.id
      and d.platform = 'windows'
      and d.revoked_at is null
      and d.link_status = 'active'
      and d.center_version is not null
    order by d.center_version_reported_at desc nulls last, d.last_seen_at desc
    limit 1
  ) centerdev on true
  order by p.created_at desc;
end;
$$;

revoke execute on function public.admin_list_sd_members_v2() from public, anon;
grant execute on function public.admin_list_sd_members_v2() to authenticated;

comment on function public.sd_core_report_center_version(uuid,text,text) is
  'Authenticated active Windows device reports diagnostic SD Center version/build. Not trusted for economy/security authority.';
comment on function public.admin_list_sd_members_v2() is
  'Active-admin member diagnostics including latest client-reported SD Center version/build.';

commit;
