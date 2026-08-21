-- SD Core ledger read API v1
-- Additive and read-only. Does not change legacy pull_sd_link_transactions.

begin;

create or replace function public.sd_core_list_transactions(
  p_device_id uuid,
  p_after_seq bigint default 0,
  p_limit integer default 100
)
returns table (
  sync_seq bigint,
  transaction_id uuid,
  transaction_type text,
  description text,
  amount bigint,
  balance_before bigint,
  balance_after bigint,
  platform text,
  metadata jsonb,
  created_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_device_status text;
  v_revoked_at timestamptz;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_after_seq bigint := greatest(coalesce(p_after_seq, 0), 0);
begin
  if v_user_id is null then
    raise exception using errcode = 'P1001', message = 'AUTH_REQUIRED';
  end if;

  if p_device_id is null then
    raise exception using errcode = 'P1003', message = 'DEVICE_NOT_FOUND';
  end if;

  select d.link_status, d.revoked_at
    into v_device_status, v_revoked_at
  from public.devices d
  where d.id = p_device_id
    and d.user_id = v_user_id;

  if v_device_status is null then
    raise exception using errcode = 'P1003', message = 'DEVICE_NOT_FOUND';
  end if;

  if v_revoked_at is not null then
    raise exception using errcode = 'P1006', message = 'DEVICE_REVOKED';
  end if;

  if v_device_status <> 'active' then
    raise exception using errcode = 'P1004', message = 'DEVICE_INACTIVE';
  end if;

  return query
  select
    t.sync_seq,
    t.id,
    t.transaction_type,
    t.description,
    t.amount,
    t.balance_before,
    t.balance_after,
    t.platform,
    t.metadata,
    t.created_at
  from public.transactions t
  where t.user_id = v_user_id
    and t.sync_seq > v_after_seq
  order by t.sync_seq asc
  limit v_limit;
end;
$$;

revoke execute on function public.sd_core_list_transactions(uuid, bigint, integer) from public, anon;
grant execute on function public.sd_core_list_transactions(uuid, bigint, integer) to authenticated;

comment on function public.sd_core_list_transactions(uuid, bigint, integer) is
  'Read-only SD Core ledger API. Device-bound, RLS-preserving, ascending sync_seq pagination.';

commit;
