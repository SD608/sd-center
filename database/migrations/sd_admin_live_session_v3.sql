begin;

-- Central admin predicates must reject stale/revoked Supabase sessions.
create or replace function public.is_sd_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and private.is_active_sd_admin(auth.uid())
     and private.get_current_sd_session_id_v2(auth.uid()) is not null
$$;

revoke execute on function public.is_sd_admin() from public, anon;
grant execute on function public.is_sd_admin() to authenticated;

create or replace function public.sd_assert_active_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
begin
  if v_admin is null then
    raise exception using errcode='P1001', message='AUTH_REQUIRED';
  end if;
  if not private.is_active_sd_admin(v_admin) then
    raise exception using errcode='P1005', message='ADMIN_REQUIRED';
  end if;
  if private.get_current_sd_session_id_v2(v_admin) is null then
    raise exception using errcode='P1008', message='SESSION_REVOKED';
  end if;
end;
$$;

revoke all on function public.sd_assert_active_admin() from public, anon, authenticated;

-- Keep the reviewed legacy implementations byte-semantically intact, but move
-- them behind private names. Public wrappers below add a live-session gate
-- without changing their return contracts or business behavior.
alter function public.admin_approve_sd_wallet_migration(uuid) set schema private;
alter function private.admin_approve_sd_wallet_migration(uuid) rename to admin_approve_sd_wallet_migration_pre_v3;

alter function public.admin_reject_sd_wallet_migration(uuid,text) set schema private;
alter function private.admin_reject_sd_wallet_migration(uuid,text) rename to admin_reject_sd_wallet_migration_pre_v3;

alter function public.admin_create_invite_codes(integer,integer,text) set schema private;
alter function private.admin_create_invite_codes(integer,integer,text) rename to admin_create_invite_codes_pre_v3;

alter function public.admin_create_sd_invite(text,integer) set schema private;
alter function private.admin_create_sd_invite(text,integer) rename to admin_create_sd_invite_pre_v3;

alter function public.admin_list_sd_wallet_migrations() set schema private;
alter function private.admin_list_sd_wallet_migrations() rename to admin_list_sd_wallet_migrations_pre_v3;

alter function public.sd_admin_v1_me() set schema private;
alter function private.sd_admin_v1_me() rename to sd_admin_v1_me_pre_v3;

alter function public.sd_admin_v1_get_user(uuid) set schema private;
alter function private.sd_admin_v1_get_user(uuid) rename to sd_admin_v1_get_user_pre_v3;

alter function public.sd_admin_v1_list_users() set schema private;
alter function private.sd_admin_v1_list_users() rename to sd_admin_v1_list_users_pre_v3;

alter function public.sd_admin_v1_list_transactions(uuid,bigint,integer) set schema private;
alter function private.sd_admin_v1_list_transactions(uuid,bigint,integer) rename to sd_admin_v1_list_transactions_pre_v3;

alter function public.sd_admin_v1_list_roadmap_events() set schema private;
alter function private.sd_admin_v1_list_roadmap_events() rename to sd_admin_v1_list_roadmap_events_pre_v3;

revoke all on function private.admin_approve_sd_wallet_migration_pre_v3(uuid) from public, anon, authenticated, service_role;
revoke all on function private.admin_reject_sd_wallet_migration_pre_v3(uuid,text) from public, anon, authenticated, service_role;
revoke all on function private.admin_create_invite_codes_pre_v3(integer,integer,text) from public, anon, authenticated, service_role;
revoke all on function private.admin_create_sd_invite_pre_v3(text,integer) from public, anon, authenticated, service_role;
revoke all on function private.admin_list_sd_wallet_migrations_pre_v3() from public, anon, authenticated, service_role;
revoke all on function private.sd_admin_v1_me_pre_v3() from public, anon, authenticated, service_role;
revoke all on function private.sd_admin_v1_get_user_pre_v3(uuid) from public, anon, authenticated, service_role;
revoke all on function private.sd_admin_v1_list_users_pre_v3() from public, anon, authenticated, service_role;
revoke all on function private.sd_admin_v1_list_transactions_pre_v3(uuid,bigint,integer) from public, anon, authenticated, service_role;
revoke all on function private.sd_admin_v1_list_roadmap_events_pre_v3() from public, anon, authenticated, service_role;

create function public.admin_approve_sd_wallet_migration(p_migration_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.sd_assert_active_admin();
  return private.admin_approve_sd_wallet_migration_pre_v3(p_migration_id);
end;
$$;

create function public.admin_reject_sd_wallet_migration(
  p_migration_id uuid,
  p_reason text default '관리자 확인 후 거절'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.sd_assert_active_admin();
  return private.admin_reject_sd_wallet_migration_pre_v3(p_migration_id,p_reason);
end;
$$;

create function public.admin_create_invite_codes(
  p_count integer default 1,
  p_expires_days integer default 30,
  p_note text default null
)
returns table(invite_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.sd_assert_active_admin();
  return query
  select * from private.admin_create_invite_codes_pre_v3(p_count,p_expires_days,p_note);
end;
$$;

create function public.admin_create_sd_invite(
  p_code text default null,
  p_valid_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.sd_assert_active_admin();
  return private.admin_create_sd_invite_pre_v3(p_code,p_valid_days);
end;
$$;

create function public.admin_list_sd_wallet_migrations()
returns table(
  migration_id uuid,
  user_id uuid,
  nickname text,
  online_account_number text,
  previous_account_number text,
  local_username text,
  local_owner_name text,
  migrated_balance bigint,
  status text,
  created_at timestamptz,
  reviewed_at timestamptz,
  rejection_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.sd_assert_active_admin();
  return query select * from private.admin_list_sd_wallet_migrations_pre_v3();
end;
$$;

create function public.sd_admin_v1_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.sd_assert_active_admin();
  return private.sd_admin_v1_me_pre_v3();
end;
$$;

create function public.sd_admin_v1_get_user(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.sd_assert_active_admin();
  return private.sd_admin_v1_get_user_pre_v3(p_user_id);
end;
$$;

create function public.sd_admin_v1_list_users()
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
begin
  perform public.sd_assert_active_admin();
  return query select * from private.sd_admin_v1_list_users_pre_v3();
end;
$$;

create function public.sd_admin_v1_list_transactions(
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
begin
  perform public.sd_assert_active_admin();
  return query
  select * from private.sd_admin_v1_list_transactions_pre_v3(p_user_id,p_before_seq,p_limit);
end;
$$;

create function public.sd_admin_v1_list_roadmap_events()
returns table(
  event_id text,
  step_id text,
  signal text,
  occurred_at timestamptz,
  evidence_type text,
  evidence_ref text,
  source text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.sd_assert_active_admin();
  return query select * from private.sd_admin_v1_list_roadmap_events_pre_v3();
end;
$$;

revoke execute on function public.admin_approve_sd_wallet_migration(uuid) from public, anon;
revoke execute on function public.admin_reject_sd_wallet_migration(uuid,text) from public, anon;
revoke execute on function public.admin_create_invite_codes(integer,integer,text) from public, anon;
revoke execute on function public.admin_create_sd_invite(text,integer) from public, anon;
revoke execute on function public.admin_list_sd_wallet_migrations() from public, anon;
revoke execute on function public.sd_admin_v1_me() from public, anon;
revoke execute on function public.sd_admin_v1_get_user(uuid) from public, anon;
revoke execute on function public.sd_admin_v1_list_users() from public, anon;
revoke execute on function public.sd_admin_v1_list_transactions(uuid,bigint,integer) from public, anon;
revoke execute on function public.sd_admin_v1_list_roadmap_events() from public, anon;

grant execute on function public.admin_approve_sd_wallet_migration(uuid) to authenticated;
grant execute on function public.admin_reject_sd_wallet_migration(uuid,text) to authenticated;
grant execute on function public.admin_create_invite_codes(integer,integer,text) to authenticated;
grant execute on function public.admin_create_sd_invite(text,integer) to authenticated;
grant execute on function public.admin_list_sd_wallet_migrations() to authenticated;
grant execute on function public.sd_admin_v1_me() to authenticated, service_role;
grant execute on function public.sd_admin_v1_get_user(uuid) to authenticated, service_role;
grant execute on function public.sd_admin_v1_list_users() to authenticated, service_role;
grant execute on function public.sd_admin_v1_list_transactions(uuid,bigint,integer) to authenticated, service_role;
grant execute on function public.sd_admin_v1_list_roadmap_events() to authenticated;

commit;
