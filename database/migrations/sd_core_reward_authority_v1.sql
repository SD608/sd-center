-- SD Core reward authority hardening v1
-- Clients may spend/transfer their own balance but may not mint reward amounts.
-- Reward creation stays behind server/Core-owned implementation paths.
-- Legacy SD Link reward replays that were already committed remain duplicate-only.

begin;

create or replace function sd_core_private.apply_client_wallet_event_impl(
  p_device_id uuid,
  p_event_id uuid,
  p_event_type text,
  p_amount bigint,
  p_target_account_number text default null,
  p_source_app text default 'sd_link',
  p_description text default '',
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text := lower(trim(coalesce(p_event_type, '')));
begin
  if v_event_type = 'reward' then
    raise exception using errcode = 'P1030', message = 'REWARD_CAPABILITY_REQUIRED';
  end if;

  return sd_core_private.apply_wallet_event_impl(
    p_device_id,
    p_event_id,
    v_event_type,
    p_amount,
    p_target_account_number,
    p_source_app,
    p_description,
    p_metadata
  );
end;
$$;

revoke execute on function sd_core_private.apply_wallet_event_impl(uuid, uuid, text, bigint, text, text, text, jsonb)
  from public, anon, authenticated;
revoke execute on function sd_core_private.apply_client_wallet_event_impl(uuid, uuid, text, bigint, text, text, text, jsonb)
  from public, anon;
grant execute on function sd_core_private.apply_client_wallet_event_impl(uuid, uuid, text, bigint, text, text, text, jsonb)
  to authenticated;

create or replace function public.sd_core_apply_wallet_event(
  p_device_id uuid,
  p_event_id uuid,
  p_event_type text,
  p_amount bigint,
  p_target_account_number text default null,
  p_source_app text default 'sd_link',
  p_description text default '',
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select sd_core_private.apply_client_wallet_event_impl(
    p_device_id,
    p_event_id,
    p_event_type,
    p_amount,
    p_target_account_number,
    p_source_app,
    p_description,
    p_metadata
  )
$$;

create or replace function sd_core_private.apply_sd_link_event_impl(
  p_device_id uuid,
  p_event_id uuid,
  p_local_transaction_id text,
  p_event_type text,
  p_amount bigint,
  p_source_app text default 'sd_link',
  p_description text default '',
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_device_key text;
  v_local_transaction_id text := trim(coalesce(p_local_transaction_id, ''));
  v_event_type text := lower(trim(coalesce(p_event_type, '')));
  v_existing_tx_id uuid;
  v_existing_seq bigint;
  v_existing_amount bigint;
  v_existing_balance_after bigint;
  v_expected_signed_amount bigint;
begin
  if v_user_id is null then
    raise exception using errcode = 'P1001', message = 'AUTH_REQUIRED';
  end if;
  if p_device_id is null then
    raise exception using errcode = 'P1003', message = 'DEVICE_NOT_FOUND';
  end if;
  if char_length(v_local_transaction_id) < 1 or char_length(v_local_transaction_id) > 160 then
    raise exception using errcode = 'P1027', message = 'INVALID_LOCAL_TRANSACTION_ID';
  end if;
  if v_event_type not in ('reward', 'spend') then
    raise exception using errcode = 'P1010', message = 'INVALID_EVENT_TYPE';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000000 then
    raise exception using errcode = 'P1011', message = 'INVALID_AMOUNT';
  end if;

  select d.device_key
    into v_device_key
  from public.devices d
  where d.id = p_device_id
    and d.user_id = v_user_id;

  if v_device_key is null then
    raise exception using errcode = 'P1003', message = 'DEVICE_NOT_FOUND';
  end if;

  select t.id, t.sync_seq, t.amount, t.balance_after
    into v_existing_tx_id, v_existing_seq, v_existing_amount, v_existing_balance_after
  from public.transactions t
  where t.user_id = v_user_id
    and t.metadata ->> 'sd_link_device_key' = v_device_key
    and t.metadata ->> 'sd_link_local_transaction_id' = v_local_transaction_id
  order by t.sync_seq asc
  limit 1;

  if v_existing_tx_id is not null then
    v_expected_signed_amount := case when v_event_type = 'reward' then p_amount else -p_amount end;
    if v_existing_amount is distinct from v_expected_signed_amount then
      raise exception using errcode = 'P1015', message = 'IDEMPOTENCY_CONFLICT';
    end if;

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'legacy_duplicate', true,
      'event_id', p_event_id,
      'transaction_id', v_existing_tx_id,
      'sync_seq', v_existing_seq,
      'balance_after', v_existing_balance_after,
      'current_balance', (select w.balance from public.wallets w where w.user_id = v_user_id),
      'server_time', now()
    );
  end if;

  if v_event_type = 'reward' then
    raise exception using errcode = 'P1030', message = 'REWARD_CAPABILITY_REQUIRED';
  end if;

  return sd_core_private.apply_wallet_event_impl(
    p_device_id,
    p_event_id,
    v_event_type,
    p_amount,
    null,
    p_source_app,
    p_description,
    coalesce(p_metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object(
      'sd_link_device_key', v_device_key,
      'sd_link_local_transaction_id', v_local_transaction_id
    )
  );
end;
$$;

revoke execute on function sd_core_private.apply_sd_link_event_impl(uuid, uuid, text, text, bigint, text, text, jsonb)
  from public, anon;
grant execute on function sd_core_private.apply_sd_link_event_impl(uuid, uuid, text, text, bigint, text, text, jsonb)
  to authenticated;

comment on function sd_core_private.apply_client_wallet_event_impl(uuid, uuid, text, bigint, text, text, text, jsonb) is
  'Authenticated client mutation boundary. Reward is rejected; spend/transfer delegate to the server-owned implementation.';
comment on function public.sd_core_apply_wallet_event(uuid, uuid, text, bigint, text, text, text, jsonb) is
  'Client wallet mutation API. New reward events require a validated server/Core capability.';
comment on function public.sd_core_apply_sd_link_event(uuid, uuid, text, text, bigint, text, text, jsonb) is
  'Transition-safe SD Link API. Legacy committed reward replay is duplicate-only; new client reward is rejected.';

commit;
