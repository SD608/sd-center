-- SD Core wallet v1
-- Additive migration: does not remove or change legacy SD Link RPCs.
-- Target: Supabase Postgres 17 / public schema

begin;

create table public.sd_core_wallet_events (
  event_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete restrict,
  event_type text not null check (event_type in ('reward', 'spend', 'transfer')),
  amount bigint not null check (amount > 0 and amount <= 1000000000000),
  target_user_id uuid null references auth.users(id) on delete restrict,
  source_app text not null check (char_length(source_app) between 1 and 80),
  description text not null default '' check (char_length(description) <= 160),
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'processing' check (status in ('processing', 'completed')),
  primary_transaction_id uuid null references public.transactions(id) on delete restrict,
  counterparty_transaction_id uuid null references public.transactions(id) on delete restrict,
  balance_before bigint null check (balance_before is null or balance_before >= 0),
  balance_after bigint null check (balance_after is null or balance_after >= 0),
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint sd_core_wallet_events_transfer_target_ck check (
    (event_type = 'transfer' and target_user_id is not null)
    or (event_type <> 'transfer' and target_user_id is null)
  )
);

create index sd_core_wallet_events_user_created_idx
  on public.sd_core_wallet_events (user_id, created_at desc);

create index sd_core_wallet_events_device_created_idx
  on public.sd_core_wallet_events (device_id, created_at desc);

alter table public.sd_core_wallet_events enable row level security;

create policy sd_core_wallet_events_select_own
  on public.sd_core_wallet_events
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.sd_core_wallet_events from anon;
revoke insert, update, delete on table public.sd_core_wallet_events from authenticated;
grant select on table public.sd_core_wallet_events to authenticated;

-- The client may read its wallet and ledger, but may never write final balances
-- or ledger rows directly. Mutations go through server-owned RPCs only.
revoke insert, update, delete on table public.wallets from anon, authenticated;
revoke insert, update, delete on table public.transactions from anon, authenticated;

create or replace function public.sd_core_register_device(
  p_device_key text,
  p_device_name text,
  p_platform text default 'windows'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile_status text;
  v_wallet_id uuid;
  v_account_number text;
  v_balance bigint;
  v_device_id uuid;
  v_existing_status text;
  v_existing_revoked_at timestamptz;
  v_device_key text := lower(trim(coalesce(p_device_key, '')));
  v_device_name text := left(trim(coalesce(p_device_name, '')), 80);
  v_platform text := lower(trim(coalesce(p_platform, 'windows')));
begin
  if v_user_id is null then
    raise exception using errcode = 'P1001', message = 'AUTH_REQUIRED';
  end if;

  if v_device_key !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P1019', message = 'INVALID_DEVICE_KEY';
  end if;

  if char_length(v_device_name) < 2 then
    raise exception using errcode = 'P1020', message = 'INVALID_DEVICE_NAME';
  end if;

  if v_platform not in ('windows', 'android', 'web') then
    raise exception using errcode = 'P1021', message = 'INVALID_PLATFORM';
  end if;

  select p.status, w.id, w.account_number, w.balance
    into v_profile_status, v_wallet_id, v_account_number, v_balance
  from public.profiles p
  join public.wallets w on w.user_id = p.id
  where p.id = v_user_id;

  if v_wallet_id is null then
    raise exception using errcode = 'P1016', message = 'WALLET_NOT_FOUND';
  end if;

  if v_profile_status <> 'active' then
    raise exception using errcode = 'P1002', message = 'ACCOUNT_INACTIVE';
  end if;

  select d.id, d.link_status, d.revoked_at
    into v_device_id, v_existing_status, v_existing_revoked_at
  from public.devices d
  where d.user_id = v_user_id
    and d.device_key = v_device_key;

  if v_device_id is not null then
    if v_existing_revoked_at is not null then
      raise exception using errcode = 'P1006', message = 'DEVICE_REVOKED';
    end if;

    update public.devices
       set device_name = v_device_name,
           platform = v_platform,
           last_seen_at = now(),
           updated_at = now()
     where id = v_device_id;
  else
    insert into public.devices (
      user_id,
      device_key,
      device_name,
      platform,
      link_status,
      last_seen_at,
      revoked_at,
      updated_at
    ) values (
      v_user_id,
      v_device_key,
      v_device_name,
      v_platform,
      'active',
      now(),
      null,
      now()
    )
    returning id, link_status into v_device_id, v_existing_status;
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'device_id', v_device_id,
    'device_status', v_existing_status,
    'platform', v_platform,
    'account_number', v_account_number,
    'wallet_balance', v_balance,
    'server_time', now()
  );
end;
$$;

create or replace function public.sd_core_get_snapshot(
  p_device_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile_status text;
  v_device_status text;
  v_revoked_at timestamptz;
  v_wallet_id uuid;
  v_account_number text;
  v_balance bigint;
  v_latest_sync_seq bigint;
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

  select p.status, w.id, w.account_number, w.balance
    into v_profile_status, v_wallet_id, v_account_number, v_balance
  from public.profiles p
  join public.wallets w on w.user_id = p.id
  where p.id = v_user_id;

  if v_wallet_id is null then
    raise exception using errcode = 'P1016', message = 'WALLET_NOT_FOUND';
  end if;

  if v_profile_status <> 'active' then
    raise exception using errcode = 'P1002', message = 'ACCOUNT_INACTIVE';
  end if;

  select coalesce(max(t.sync_seq), 0)
    into v_latest_sync_seq
  from public.transactions t
  where t.user_id = v_user_id;

  update public.devices
     set last_seen_at = now(),
         last_sync_at = now(),
         updated_at = now()
   where id = p_device_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'device_id', p_device_id,
    'wallet_id', v_wallet_id,
    'account_number', v_account_number,
    'balance', v_balance,
    'latest_sync_seq', v_latest_sync_seq,
    'server_time', now()
  );
end;
$$;

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
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile_status text;
  v_device_status text;
  v_device_revoked_at timestamptz;
  v_device_platform text;
  v_event_type text := lower(trim(coalesce(p_event_type, '')));
  v_source_app text := lower(trim(coalesce(p_source_app, '')));
  v_description text := left(trim(coalesce(p_description, '')), 160);
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_target_account_number text := trim(coalesce(p_target_account_number, ''));
  v_sender_wallet_id uuid;
  v_sender_balance_before bigint;
  v_sender_balance_after bigint;
  v_target_user_id uuid;
  v_target_profile_status text;
  v_target_wallet_id uuid;
  v_target_balance_before bigint;
  v_target_balance_after bigint;
  v_inserted integer;
  v_existing public.sd_core_wallet_events%rowtype;
  v_primary_tx_id uuid;
  v_counterparty_tx_id uuid;
  v_primary_description text;
  v_counterparty_description text;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = 'P1001', message = 'AUTH_REQUIRED';
  end if;

  if p_device_id is null then
    raise exception using errcode = 'P1003', message = 'DEVICE_NOT_FOUND';
  end if;

  if p_event_id is null then
    raise exception using errcode = 'P1007', message = 'EVENT_ID_REQUIRED';
  end if;

  if v_event_type not in ('reward', 'spend', 'transfer') then
    raise exception using errcode = 'P1010', message = 'INVALID_EVENT_TYPE';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount > 1000000000000 then
    raise exception using errcode = 'P1011', message = 'INVALID_AMOUNT';
  end if;

  if char_length(v_source_app) < 1 or char_length(v_source_app) > 80 then
    raise exception using errcode = 'P1022', message = 'INVALID_SOURCE_APP';
  end if;

  if pg_catalog.jsonb_typeof(v_metadata) <> 'object' then
    raise exception using errcode = 'P1026', message = 'INVALID_METADATA';
  end if;

  if pg_catalog.pg_column_size(v_metadata) > 16384 then
    raise exception using errcode = 'P1023', message = 'METADATA_TOO_LARGE';
  end if;

  select d.link_status, d.revoked_at, d.platform
    into v_device_status, v_device_revoked_at, v_device_platform
  from public.devices d
  where d.id = p_device_id
    and d.user_id = v_user_id;

  if v_device_status is null then
    raise exception using errcode = 'P1003', message = 'DEVICE_NOT_FOUND';
  end if;

  if v_device_revoked_at is not null then
    raise exception using errcode = 'P1006', message = 'DEVICE_REVOKED';
  end if;

  if v_device_status <> 'active' then
    raise exception using errcode = 'P1004', message = 'DEVICE_INACTIVE';
  end if;

  select p.status, w.id
    into v_profile_status, v_sender_wallet_id
  from public.profiles p
  join public.wallets w on w.user_id = p.id
  where p.id = v_user_id;

  if v_sender_wallet_id is null then
    raise exception using errcode = 'P1016', message = 'WALLET_NOT_FOUND';
  end if;

  if v_profile_status <> 'active' then
    raise exception using errcode = 'P1002', message = 'ACCOUNT_INACTIVE';
  end if;

  if v_event_type = 'transfer' then
    if v_target_account_number = '' then
      raise exception using errcode = 'P1012', message = 'INVALID_TARGET';
    end if;

    select w.user_id, p.status, w.id
      into v_target_user_id, v_target_profile_status, v_target_wallet_id
    from public.wallets w
    join public.profiles p on p.id = w.user_id
    where w.account_number = v_target_account_number;

    if v_target_wallet_id is null then
      raise exception using errcode = 'P1017', message = 'TARGET_NOT_FOUND';
    end if;

    if v_target_user_id = v_user_id then
      raise exception using errcode = 'P1018', message = 'SELF_TRANSFER_NOT_ALLOWED';
    end if;

    if v_target_profile_status <> 'active' then
      raise exception using errcode = 'P1024', message = 'TARGET_ACCOUNT_INACTIVE';
    end if;
  else
    if v_target_account_number <> '' then
      raise exception using errcode = 'P1012', message = 'TARGET_NOT_ALLOWED';
    end if;
    v_target_user_id := null;
    v_target_wallet_id := null;
  end if;

  insert into public.sd_core_wallet_events (
    event_id,
    user_id,
    device_id,
    event_type,
    amount,
    target_user_id,
    source_app,
    description,
    metadata,
    status
  ) values (
    p_event_id,
    v_user_id,
    p_device_id,
    v_event_type,
    p_amount,
    v_target_user_id,
    v_source_app,
    v_description,
    v_metadata,
    'processing'
  )
  on conflict (event_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select *
      into v_existing
    from public.sd_core_wallet_events e
    where e.event_id = p_event_id;

    if v_existing.user_id is distinct from v_user_id
       or v_existing.device_id is distinct from p_device_id
       or v_existing.event_type is distinct from v_event_type
       or v_existing.amount is distinct from p_amount
       or v_existing.target_user_id is distinct from v_target_user_id
       or v_existing.source_app is distinct from v_source_app
       or v_existing.description is distinct from v_description
       or v_existing.metadata is distinct from v_metadata then
      raise exception using errcode = 'P1015', message = 'IDEMPOTENCY_CONFLICT';
    end if;

    if v_existing.status <> 'completed' then
      raise exception using errcode = 'P1025', message = 'EVENT_NOT_COMPLETED';
    end if;

    select w.balance
      into v_sender_balance_after
    from public.wallets w
    where w.id = v_sender_wallet_id;

    return v_existing.result || pg_catalog.jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'event_id', p_event_id,
      'current_balance', v_sender_balance_after
    );
  end if;

  if v_event_type = 'transfer' then
    -- Lock both wallets in deterministic UUID order to avoid cross-transfer deadlocks.
    perform 1
    from public.wallets w
    where w.id in (v_sender_wallet_id, v_target_wallet_id)
    order by w.id
    for update;

    select w.balance into v_sender_balance_before
    from public.wallets w
    where w.id = v_sender_wallet_id;

    select w.balance into v_target_balance_before
    from public.wallets w
    where w.id = v_target_wallet_id;

    if v_sender_balance_before < p_amount then
      raise exception using errcode = 'P1013', message = 'INSUFFICIENT_FUNDS';
    end if;

    v_sender_balance_after := v_sender_balance_before - p_amount;
    v_target_balance_after := v_target_balance_before + p_amount;

    if v_target_balance_after > 1000000000000 then
      raise exception using errcode = 'P1014', message = 'BALANCE_LIMIT_EXCEEDED';
    end if;

    update public.wallets
       set balance = v_sender_balance_after
     where id = v_sender_wallet_id;

    update public.wallets
       set balance = v_target_balance_after
     where id = v_target_wallet_id;

    v_primary_description := coalesce(nullif(v_description, ''), 'SD Core transfer');
    v_counterparty_description := 'SD Core transfer received';

    insert into public.transactions (
      wallet_id,
      user_id,
      transaction_type,
      description,
      amount,
      balance_before,
      balance_after,
      request_id,
      platform,
      metadata
    ) values (
      v_sender_wallet_id,
      v_user_id,
      'sd_core_transfer_out',
      v_primary_description,
      -p_amount,
      v_sender_balance_before,
      v_sender_balance_after,
      pg_catalog.gen_random_uuid(),
      v_device_platform,
      v_metadata || pg_catalog.jsonb_build_object(
        'sd_core_event_id', p_event_id,
        'sd_core_type', v_event_type,
        'sd_core_source', v_source_app,
        'device_id', p_device_id,
        'target_user_id', v_target_user_id
      )
    ) returning id into v_primary_tx_id;

    insert into public.transactions (
      wallet_id,
      user_id,
      transaction_type,
      description,
      amount,
      balance_before,
      balance_after,
      request_id,
      platform,
      metadata
    ) values (
      v_target_wallet_id,
      v_target_user_id,
      'sd_core_transfer_in',
      v_counterparty_description,
      p_amount,
      v_target_balance_before,
      v_target_balance_after,
      pg_catalog.gen_random_uuid(),
      'server',
      pg_catalog.jsonb_build_object(
        'sd_core_event_id', p_event_id,
        'sd_core_type', v_event_type,
        'sd_core_source', v_source_app,
        'counterparty_user_id', v_user_id
      )
    ) returning id into v_counterparty_tx_id;
  else
    select w.balance
      into v_sender_balance_before
    from public.wallets w
    where w.id = v_sender_wallet_id
    for update;

    if v_event_type = 'reward' then
      v_sender_balance_after := v_sender_balance_before + p_amount;
      if v_sender_balance_after > 1000000000000 then
        raise exception using errcode = 'P1014', message = 'BALANCE_LIMIT_EXCEEDED';
      end if;
    else
      if v_sender_balance_before < p_amount then
        raise exception using errcode = 'P1013', message = 'INSUFFICIENT_FUNDS';
      end if;
      v_sender_balance_after := v_sender_balance_before - p_amount;
    end if;

    update public.wallets
       set balance = v_sender_balance_after
     where id = v_sender_wallet_id;

    v_primary_description := coalesce(
      nullif(v_description, ''),
      case v_event_type
        when 'reward' then 'SD Core reward'
        when 'spend' then 'SD Core spend'
      end
    );

    insert into public.transactions (
      wallet_id,
      user_id,
      transaction_type,
      description,
      amount,
      balance_before,
      balance_after,
      request_id,
      platform,
      metadata
    ) values (
      v_sender_wallet_id,
      v_user_id,
      'sd_core_' || v_event_type,
      v_primary_description,
      case when v_event_type = 'reward' then p_amount else -p_amount end,
      v_sender_balance_before,
      v_sender_balance_after,
      pg_catalog.gen_random_uuid(),
      v_device_platform,
      v_metadata || pg_catalog.jsonb_build_object(
        'sd_core_event_id', p_event_id,
        'sd_core_type', v_event_type,
        'sd_core_source', v_source_app,
        'device_id', p_device_id
      )
    ) returning id into v_primary_tx_id;
  end if;

  update public.devices
     set last_seen_at = now(),
         last_sync_at = now(),
         updated_at = now()
   where id = p_device_id;

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'event_id', p_event_id,
    'type', v_event_type,
    'amount', p_amount,
    'transaction_id', v_primary_tx_id,
    'counterparty_transaction_id', v_counterparty_tx_id,
    'balance_before', v_sender_balance_before,
    'balance_after', v_sender_balance_after,
    'current_balance', v_sender_balance_after,
    'server_time', now()
  );

  update public.sd_core_wallet_events
     set status = 'completed',
         primary_transaction_id = v_primary_tx_id,
         counterparty_transaction_id = v_counterparty_tx_id,
         balance_before = v_sender_balance_before,
         balance_after = v_sender_balance_after,
         result = v_result,
         completed_at = now()
   where event_id = p_event_id;

  return v_result;
end;
$$;

revoke execute on function public.sd_core_register_device(text, text, text) from public, anon;
revoke execute on function public.sd_core_get_snapshot(uuid) from public, anon;
revoke execute on function public.sd_core_apply_wallet_event(uuid, uuid, text, bigint, text, text, text, jsonb) from public, anon;

grant execute on function public.sd_core_register_device(text, text, text) to authenticated;
grant execute on function public.sd_core_get_snapshot(uuid) to authenticated;
grant execute on function public.sd_core_apply_wallet_event(uuid, uuid, text, bigint, text, text, text, jsonb) to authenticated;

comment on table public.sd_core_wallet_events is
  'SD Core v1 idempotency/event journal. Clients cannot insert/update/delete directly.';

comment on function public.sd_core_apply_wallet_event(uuid, uuid, text, bigint, text, text, text, jsonb) is
  'Meaning-based wallet mutation API. Amount is always positive; server decides balance direction.';

commit;
