begin;

alter table public.sd_access_devices
  add column if not exists revoked_at timestamptz,
  add column if not exists bound_session_id uuid,
  add column if not exists admin_secret_hash bytea;

create unique index if not exists sd_access_devices_user_session_unique_idx
  on public.sd_access_devices(user_id, bound_session_id)
  where bound_session_id is not null;

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
  p_platform text default 'web',
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
  v_platform text := left(trim(coalesce(p_platform, 'web')), 40);
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
      insert into public.sd_access_devices (
        user_id, device_key, platform, browser_label, timezone, locale, last_page,
        first_seen_at, last_seen_at, bound_session_id
      ) values (
        v_user_id, v_device_key, v_platform, v_browser, v_timezone, v_locale, v_page,
        now(), now(), v_session_id
      )
      returning id into v_device_id;
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

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'device_id', v_device_id,
    'session_bound', true,
    'last_seen_at', now()
  );
end;
$$;

revoke execute on function public.record_sd_access_heartbeat(text,text,text,text,text,text) from public, anon;
grant execute on function public.record_sd_access_heartbeat(text,text,text,text,text,text) to authenticated;

create or replace function public.admin_bind_sd_wallet_device_v2(
  p_device_key text,
  p_device_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_session_id uuid;
  v_device_id uuid;
  v_bound_session_id uuid;
  v_revoked_at timestamptz;
  v_last_seen_at timestamptz;
  v_secret_hash bytea;
  v_existing_secret_hash bytea;
  v_device_key text := trim(coalesce(p_device_key, ''));
  v_device_secret text := lower(trim(coalesce(p_device_secret, '')));
begin
  if v_admin is null then
    raise exception using errcode='P1001', message='AUTH_REQUIRED';
  end if;

  v_session_id := private.get_current_sd_session_id_v2(v_admin);
  if v_session_id is null then
    raise exception using errcode='P1008', message='SESSION_REVOKED';
  end if;

  if not private.is_active_sd_admin(v_admin) then
    raise exception using errcode='P1005', message='ADMIN_REQUIRED';
  end if;

  if char_length(v_device_key) < 8 or char_length(v_device_key) > 120
     or v_device_key !~ '^[A-Za-z0-9._:-]+$' then
    raise exception using errcode='P1019', message='INVALID_DEVICE_KEY';
  end if;
  if v_device_secret !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='P1027', message='INVALID_DEVICE_SECRET';
  end if;

  v_secret_hash := extensions.digest(v_device_secret, 'sha256');

  select d.id, d.bound_session_id, d.revoked_at, d.last_seen_at, d.admin_secret_hash
    into v_device_id, v_bound_session_id, v_revoked_at, v_last_seen_at, v_existing_secret_hash
  from public.sd_access_devices d
  where d.user_id = v_admin
    and d.device_key = v_device_key
  for update;

  if v_device_id is null then
    raise exception using errcode='P1003', message='DEVICE_NOT_FOUND';
  end if;
  if v_revoked_at is not null then
    raise exception using errcode='P1006', message='DEVICE_REVOKED';
  end if;
  if v_bound_session_id is distinct from v_session_id then
    raise exception using errcode='P1009', message='SESSION_DEVICE_MISMATCH';
  end if;
  if v_last_seen_at < now() - interval '10 minutes' then
    raise exception using errcode='P1004', message='DEVICE_INACTIVE';
  end if;

  if v_existing_secret_hash is null then
    update public.sd_access_devices
    set admin_secret_hash = v_secret_hash
    where id = v_device_id;
  elsif v_existing_secret_hash is distinct from v_secret_hash then
    raise exception using errcode='P1009', message='DEVICE_SECRET_MISMATCH';
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'device_id', v_device_id,
    'session_bound', true,
    'secret_bound', true
  );
end;
$$;

revoke execute on function public.admin_bind_sd_wallet_device_v2(text,text) from public, anon;
grant execute on function public.admin_bind_sd_wallet_device_v2(text,text) to authenticated;

create or replace function private.assert_sd_admin_wallet_device_v2(
  p_user_id uuid,
  p_device_key text,
  p_device_secret text
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_device_id uuid;
  v_revoked_at timestamptz;
  v_bound_session_id uuid;
  v_last_seen_at timestamptz;
  v_secret_hash bytea;
  v_device_key text := trim(coalesce(p_device_key, ''));
  v_device_secret text := lower(trim(coalesce(p_device_secret, '')));
begin
  v_session_id := private.get_current_sd_session_id_v2(p_user_id);
  if v_session_id is null then
    raise exception using errcode='P1008', message='SESSION_REVOKED';
  end if;

  if v_device_secret !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='P1027', message='INVALID_DEVICE_SECRET';
  end if;

  select d.id, d.revoked_at, d.bound_session_id, d.last_seen_at, d.admin_secret_hash
    into v_device_id, v_revoked_at, v_bound_session_id, v_last_seen_at, v_secret_hash
  from public.sd_access_devices d
  where d.user_id = p_user_id
    and d.device_key = v_device_key;

  if v_device_id is null then
    raise exception using errcode='P1003', message='DEVICE_NOT_FOUND';
  end if;
  if v_revoked_at is not null then
    raise exception using errcode='P1006', message='DEVICE_REVOKED';
  end if;
  if v_bound_session_id is distinct from v_session_id then
    raise exception using errcode='P1009', message='SESSION_DEVICE_MISMATCH';
  end if;
  if v_last_seen_at < now() - interval '10 minutes' then
    raise exception using errcode='P1004', message='DEVICE_INACTIVE';
  end if;
  if v_secret_hash is null
     or v_secret_hash is distinct from extensions.digest(v_device_secret, 'sha256') then
    raise exception using errcode='P1009', message='DEVICE_SECRET_MISMATCH';
  end if;

  return v_device_id;
end;
$$;

revoke all on function private.assert_sd_admin_wallet_device_v2(uuid,text,text) from public, anon, authenticated;

create or replace function public.sd_admin_v2_adjust_wallet(
  p_target_user_id uuid,
  p_direction text,
  p_amount bigint,
  p_request_id uuid,
  p_device_key text,
  p_device_secret text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_direction text := lower(trim(coalesce(p_direction, '')));
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_signed_amount bigint;
  v_event_key text;
  v_nickname text;
  v_account_number text;
  v_device_id uuid;
  v_result jsonb;
begin
  if v_admin is null then
    raise exception using errcode='P1001', message='AUTH_REQUIRED';
  end if;
  if not private.is_active_sd_admin(v_admin) then
    raise exception using errcode='P1005', message='ADMIN_REQUIRED';
  end if;

  v_device_id := private.assert_sd_admin_wallet_device_v2(v_admin, p_device_key, p_device_secret);

  if p_target_user_id is null or p_target_user_id = v_admin then
    raise exception using errcode='P1027', message='INVALID_ADMIN_WALLET_TARGET';
  end if;
  if p_request_id is null then
    raise exception using errcode='P1027', message='REQUEST_ID_REQUIRED';
  end if;
  if v_direction not in ('credit', 'debit') then
    raise exception using errcode='P1027', message='INVALID_DIRECTION';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 1000000000 then
    raise exception using errcode='P1011', message='INVALID_AMOUNT';
  end if;
  if v_note is not null and char_length(v_note) > 80 then
    raise exception using errcode='P1027', message='NOTE_TOO_LONG';
  end if;

  select p.nickname, w.account_number
    into v_nickname, v_account_number
  from public.profiles p
  join public.wallets w on w.user_id = p.id
  where p.id = p_target_user_id
    and p.status = 'active'
    and p.role <> 'admin';

  if v_nickname is null then
    raise exception using errcode='P1016', message='WALLET_TARGET_NOT_FOUND';
  end if;

  v_signed_amount := case when v_direction = 'credit' then p_amount else -p_amount end;
  v_event_key := case when v_direction = 'credit' then 'admin_credit' else 'admin_debit' end;

  v_result := sd_core_private.apply_server_wallet_delta_impl(
    p_target_user_id,
    p_request_id,
    v_event_key,
    v_signed_amount,
    'sd_admin_v2',
    case
      when v_note is null and v_direction = 'credit' then '관리자 가상잔액 지급'
      when v_note is null then '관리자 가상잔액 차감'
      when v_direction = 'credit' then '관리자 지급 · ' || v_note
      else '관리자 가상잔액 차감 · ' || v_note
    end,
    pg_catalog.jsonb_build_object(
      'admin_user_id', v_admin,
      'admin_access_device_id', v_device_id,
      'note', v_note,
      'admin_api_version', 'v2'
    )
  );

  return v_result || pg_catalog.jsonb_build_object(
    'nickname', v_nickname,
    'account_number', v_account_number,
    'direction', v_direction,
    'requested_amount', p_amount
  );
end;
$$;

revoke execute on function public.sd_admin_v2_adjust_wallet(uuid,text,bigint,uuid,text,text,text) from public, anon;
grant execute on function public.sd_admin_v2_adjust_wallet(uuid,text,bigint,uuid,text,text,text) to authenticated;

-- Retire the non-idempotent authenticated legacy adjustment paths.
create or replace function public.admin_credit_sd_wallet(p_target_user_id uuid, p_amount bigint, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode='P1030', message='ADMIN_WALLET_V2_REQUIRED';
end;
$$;

create or replace function public.admin_debit_sd_wallet(p_target_user_id uuid, p_amount bigint, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode='P1030', message='ADMIN_WALLET_V2_REQUIRED';
end;
$$;

revoke execute on function public.admin_credit_sd_wallet(uuid,bigint,text) from public, anon, authenticated;
revoke execute on function public.admin_debit_sd_wallet(uuid,bigint,text) from public, anon, authenticated;
revoke execute on function public.sd_admin_v1_adjust_wallet(uuid,text,bigint,text,uuid) from public, anon, authenticated;

-- Do not expose reusable access-device keys through the admin member listing.
create or replace function public.admin_list_sd_members()
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
  invite_used_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_active_sd_admin(auth.uid()) then
    raise exception using errcode='P1005', message='ADMIN_REQUIRED';
  end if;
  if private.get_current_sd_session_id_v2(auth.uid()) is null then
    raise exception using errcode='P1008', message='SESSION_REVOKED';
  end if;

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
    case
      when lastdev.device_key is null then null
      when char_length(lastdev.device_key) <= 14 then '등록됨'
      else left(lastdev.device_key, 8) || '…' || right(lastdev.device_key, 4)
    end,
    lastdev.platform,
    lastdev.browser_label,
    lastdev.timezone,
    lastdev.locale,
    lastdev.last_page,
    lastdev.first_seen_at,
    lastdev.last_seen_at,
    inv.code,
    inv.used_at
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
  ) pc on true
  left join lateral (
    select count(*)::bigint as browser_count
    from public.sd_access_devices d
    where d.user_id = p.id
      and d.revoked_at is null
  ) bd on true
  left join lateral (
    select d.device_key, d.platform, d.browser_label, d.timezone, d.locale,
           d.last_page, d.first_seen_at, d.last_seen_at
    from public.sd_access_devices d
    where d.user_id = p.id
      and d.revoked_at is null
    order by d.last_seen_at desc
    limit 1
  ) lastdev on true
  order by p.created_at desc;
end;
$$;

revoke execute on function public.admin_list_sd_members() from public, anon;
grant execute on function public.admin_list_sd_members() to authenticated;

comment on function public.sd_admin_v2_adjust_wallet(uuid,text,bigint,uuid,text,text,text)
  is 'Idempotent admin wallet adjustment: live auth session + bound non-revoked recent access device + per-device secret; Core is final balance authority.';

commit;
