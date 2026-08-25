-- Chapter 4-2: SD Miner server-timed work loop v3
--
-- Goals:
-- - server time, RNG, inventory and sale value are authoritative
-- - one in-flight mining job per user; click/macro speed cannot exceed the server cycle
-- - live Supabase session + owned, recent, non-revoked access device are required
-- - every wallet delta still routes through SD Core exact-once helper
-- - legacy auto-mining ownership is preserved, but the old unbounded auto loop is retired
-- - old v2 public RPCs fail closed after the v3 client cutover

begin;

create table if not exists public.sd_miner_device_bindings (
  access_device_id uuid primary key references public.sd_access_devices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  secret_hash bytea not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, access_device_id)
);

create index if not exists sd_miner_device_bindings_user_idx
  on public.sd_miner_device_bindings(user_id);

alter table public.sd_miner_device_bindings enable row level security;
revoke all on public.sd_miner_device_bindings from public, anon, authenticated;

create table if not exists public.sd_miner_jobs (
  job_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_request_id uuid not null unique,
  mine_key text not null check (mine_key in ('surface')),
  status text not null default 'active' check (status in ('active','claimed','cancelled')),
  cycle_ms integer not null check (cycle_ms between 1000 and 3600000),
  started_at timestamptz not null,
  ready_at timestamptz not null,
  claimed_at timestamptz,
  claim_request_id uuid unique,
  result_ore_key text check (result_ore_key is null or result_ore_key in ('stone','copper','iron','emerald','diamond')),
  result_quantity bigint check (result_quantity is null or result_quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ready_at > started_at),
  check (
    (status = 'active' and claimed_at is null and claim_request_id is null and result_ore_key is null and result_quantity is null)
    or
    (status = 'claimed' and claimed_at is not null and claim_request_id is not null and result_ore_key is not null and result_quantity is not null)
    or
    (status = 'cancelled' and claimed_at is null and claim_request_id is null and result_ore_key is null and result_quantity is null)
  )
);

create unique index if not exists sd_miner_jobs_one_active_per_user_idx
  on public.sd_miner_jobs(user_id)
  where status = 'active';

create index if not exists sd_miner_jobs_user_created_idx
  on public.sd_miner_jobs(user_id, created_at desc);

alter table public.sd_miner_jobs enable row level security;
revoke all on public.sd_miner_jobs from public, anon, authenticated;

create or replace function private.sd_miner_v3_resource_key(p_ore_key text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case p_ore_key
    when 'stone' then 'miner.ore.stone'
    when 'copper' then 'miner.ore.copper'
    when 'iron' then 'miner.ore.iron'
    when 'emerald' then 'miner.gem.emerald'
    when 'diamond' then 'miner.gem.diamond'
    else null
  end
$$;

create or replace function private.assert_sd_miner_device_v3(
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
  v_bound_session_id uuid;
  v_revoked_at timestamptz;
  v_last_seen_at timestamptz;
  v_secret_hash bytea;
  v_profile_status text;
  v_device_key text := trim(coalesce(p_device_key, ''));
  v_device_secret text := lower(trim(coalesce(p_device_secret, '')));
begin
  if p_user_id is null then
    raise exception using errcode='P1001', message='AUTH_REQUIRED';
  end if;

  v_session_id := private.get_current_sd_session_id_v2(p_user_id);
  if v_session_id is null then
    raise exception using errcode='P1008', message='SESSION_REVOKED';
  end if;

  select p.status into v_profile_status
  from public.profiles p
  where p.id = p_user_id;

  if v_profile_status is distinct from 'active' then
    raise exception using errcode='P1002', message='ACCOUNT_INACTIVE';
  end if;

  if char_length(v_device_key) < 8 or char_length(v_device_key) > 120
     or v_device_key !~ '^[A-Za-z0-9._:-]+$' then
    raise exception using errcode='P1019', message='INVALID_DEVICE_KEY';
  end if;
  if v_device_secret !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='P1027', message='INVALID_DEVICE_SECRET';
  end if;

  select d.id, d.bound_session_id, d.revoked_at, d.last_seen_at
    into v_device_id, v_bound_session_id, v_revoked_at, v_last_seen_at
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
  if v_last_seen_at is null or v_last_seen_at < now() - interval '10 minutes' then
    raise exception using errcode='P1004', message='DEVICE_INACTIVE';
  end if;

  select b.secret_hash into v_secret_hash
  from public.sd_miner_device_bindings b
  where b.user_id = p_user_id
    and b.access_device_id = v_device_id;

  if v_secret_hash is null
     or v_secret_hash is distinct from extensions.digest(v_device_secret, 'sha256') then
    raise exception using errcode='P1009', message='MINER_DEVICE_SECRET_MISMATCH';
  end if;

  return v_device_id;
end;
$$;

create or replace function public.sd_miner_v3_bind_device(
  p_device_key text,
  p_device_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_session_id uuid;
  v_device_id uuid;
  v_bound_session_id uuid;
  v_revoked_at timestamptz;
  v_last_seen_at timestamptz;
  v_existing_hash bytea;
  v_secret_hash bytea;
  v_profile_status text;
  v_device_key text := trim(coalesce(p_device_key, ''));
  v_device_secret text := lower(trim(coalesce(p_device_secret, '')));
begin
  if v_user is null then
    raise exception using errcode='P1001', message='AUTH_REQUIRED';
  end if;

  v_session_id := private.get_current_sd_session_id_v2(v_user);
  if v_session_id is null then
    raise exception using errcode='P1008', message='SESSION_REVOKED';
  end if;

  select p.status into v_profile_status
  from public.profiles p
  where p.id = v_user;
  if v_profile_status is distinct from 'active' then
    raise exception using errcode='P1002', message='ACCOUNT_INACTIVE';
  end if;

  if char_length(v_device_key) < 8 or char_length(v_device_key) > 120
     or v_device_key !~ '^[A-Za-z0-9._:-]+$' then
    raise exception using errcode='P1019', message='INVALID_DEVICE_KEY';
  end if;
  if v_device_secret !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='P1027', message='INVALID_DEVICE_SECRET';
  end if;

  select d.id, d.bound_session_id, d.revoked_at, d.last_seen_at
    into v_device_id, v_bound_session_id, v_revoked_at, v_last_seen_at
  from public.sd_access_devices d
  where d.user_id = v_user
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
  if v_last_seen_at is null or v_last_seen_at < now() - interval '10 minutes' then
    raise exception using errcode='P1004', message='DEVICE_INACTIVE';
  end if;

  v_secret_hash := extensions.digest(v_device_secret, 'sha256');

  select b.secret_hash into v_existing_hash
  from public.sd_miner_device_bindings b
  where b.access_device_id = v_device_id
  for update;

  if v_existing_hash is null then
    insert into public.sd_miner_device_bindings(access_device_id, user_id, secret_hash)
    values(v_device_id, v_user, v_secret_hash);
  elsif v_existing_hash is distinct from v_secret_hash then
    raise exception using errcode='P1009', message='MINER_DEVICE_SECRET_MISMATCH';
  else
    update public.sd_miner_device_bindings
    set updated_at = now()
    where access_device_id = v_device_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'access_device_id', v_device_id,
    'session_bound', true,
    'miner_capability_bound', true
  );
end;
$$;

create or replace function public.sd_miner_v3_get_state(
  p_device_key text,
  p_device_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_device_id uuid;
  a public.sd_miner_accounts%rowtype;
  v_inv jsonb;
  v_current bigint;
  v_kinds bigint;
  v_job jsonb := null;
begin
  v_device_id := private.assert_sd_miner_device_v3(v_user, p_device_key, p_device_secret);
  perform private.sd_miner_ensure_account(v_user);
  select * into a from public.sd_miner_accounts where user_id = v_user;

  select coalesce(
           pg_catalog.jsonb_object_agg(
             ore_key,
             pg_catalog.jsonb_build_object(
               'resource_key', private.sd_miner_v3_resource_key(ore_key),
               'quantity', quantity,
               'acquired_count', acquired_count
             )
           ),
           '{}'::jsonb
         ),
         coalesce(sum(quantity),0),
         count(*) filter (where acquired_count > 0)
    into v_inv, v_current, v_kinds
  from public.sd_miner_inventory
  where user_id = v_user;

  select pg_catalog.jsonb_build_object(
           'job_id', j.job_id,
           'mine_key', j.mine_key,
           'status', j.status,
           'started_at', j.started_at,
           'ready_at', j.ready_at,
           'cycle_ms', j.cycle_ms
         )
    into v_job
  from public.sd_miner_jobs j
  where j.user_id = v_user
    and j.status = 'active';

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'authority', 'server-v3',
    'access_device_id', v_device_id,
    'total_mined', a.total_mined,
    'total_sales_krw', a.total_sales_krw,
    'legacy_auto_mining_owned', a.auto_mining_unlocked,
    'auto_mining_status', 'disabled_pending_redesign',
    'highest_tier_found', a.highest_tier_found,
    'max_diamond_streak', a.max_diamond_streak,
    'ore_kinds', v_kinds,
    'current_inventory_quantity', v_current,
    'inventory', v_inv,
    'active_job', v_job,
    'config', pg_catalog.jsonb_build_object(
      'mine_key', 'surface',
      'cycle_ms', 5000,
      'max_parallel_jobs', 1,
      'offline_queue_limit', 1,
      'economy_stage', 'provisional_ch4_2',
      'ores', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('key','stone','resource_key','miner.ore.stone','name','돌','probability',47.6,'price',100),
        pg_catalog.jsonb_build_object('key','copper','resource_key','miner.ore.copper','name','구리','probability',23.8,'price',500),
        pg_catalog.jsonb_build_object('key','iron','resource_key','miner.ore.iron','name','철','probability',14.3,'price',1200),
        pg_catalog.jsonb_build_object('key','emerald','resource_key','miner.gem.emerald','name','에메랄드','probability',9.5,'price',3000),
        pg_catalog.jsonb_build_object('key','diamond','resource_key','miner.gem.diamond','name','다이아몬드','probability',4.8,'price',8000)
      )
    )
  );
end;
$$;

create or replace function public.sd_miner_v3_start(
  p_request_id uuid,
  p_device_key text,
  p_device_secret text,
  p_mine_key text default 'surface'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_device_id uuid;
  v_mine_key text := lower(trim(coalesce(p_mine_key, '')));
  v_input jsonb;
  v_replay jsonb;
  a public.sd_miner_accounts%rowtype;
  v_existing_job uuid;
  v_job_id uuid;
  v_started_at timestamptz := clock_timestamp();
  v_ready_at timestamptz;
  v_result jsonb;
begin
  v_device_id := private.assert_sd_miner_device_v3(v_user, p_device_key, p_device_secret);

  if p_request_id is null then
    raise exception using errcode='P1007', message='REQUEST_ID_REQUIRED';
  end if;
  if v_mine_key <> 'surface' then
    raise exception using errcode='P1027', message='INVALID_MINER_MINE';
  end if;

  v_input := pg_catalog.jsonb_build_object('mine_key', v_mine_key);
  v_replay := private.sd_miner_action_replay(v_user, p_request_id, 'v3_start', v_input);
  if v_replay is not null then
    return v_replay;
  end if;

  perform private.sd_miner_ensure_account(v_user);
  select * into a
  from public.sd_miner_accounts
  where user_id = v_user
  for update;

  select j.job_id into v_existing_job
  from public.sd_miner_jobs j
  where j.user_id = v_user
    and j.status = 'active'
  for update;

  if v_existing_job is not null then
    raise exception using errcode='P1054', message='MINER_JOB_ALREADY_ACTIVE';
  end if;

  v_ready_at := v_started_at + interval '5 seconds';

  insert into public.sd_miner_jobs(
    user_id, start_request_id, mine_key, status, cycle_ms, started_at, ready_at
  ) values(
    v_user, p_request_id, v_mine_key, 'active', 5000, v_started_at, v_ready_at
  ) returning job_id into v_job_id;

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'authority', 'server-v3',
    'job_id', v_job_id,
    'mine_key', v_mine_key,
    'status', 'active',
    'cycle_ms', 5000,
    'started_at', v_started_at,
    'ready_at', v_ready_at,
    'access_device_id', v_device_id
  );

  return private.sd_miner_save_action(v_user, p_request_id, 'v3_start', v_input, v_result);
end;
$$;

create or replace function public.sd_miner_v3_claim(
  p_request_id uuid,
  p_job_id uuid,
  p_device_key text,
  p_device_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_device_id uuid;
  v_input jsonb;
  v_replay jsonb;
  a public.sd_miner_accounts%rowtype;
  j public.sd_miner_jobs%rowtype;
  v_now timestamptz := clock_timestamp();
  v_ore text;
  v_price bigint;
  v_q bigint;
  v_result jsonb;
begin
  v_device_id := private.assert_sd_miner_device_v3(v_user, p_device_key, p_device_secret);

  if p_request_id is null or p_job_id is null then
    raise exception using errcode='P1007', message='REQUEST_ID_REQUIRED';
  end if;

  v_input := pg_catalog.jsonb_build_object('job_id', p_job_id);
  v_replay := private.sd_miner_action_replay(v_user, p_request_id, 'v3_claim', v_input);
  if v_replay is not null then
    return v_replay;
  end if;

  perform private.sd_miner_ensure_account(v_user);
  select * into a
  from public.sd_miner_accounts
  where user_id = v_user
  for update;

  select * into j
  from public.sd_miner_jobs
  where job_id = p_job_id
    and user_id = v_user
  for update;

  if j.job_id is null then
    raise exception using errcode='P1016', message='MINER_JOB_NOT_FOUND';
  end if;
  if j.status = 'claimed' then
    raise exception using errcode='P1055', message='MINER_JOB_ALREADY_CLAIMED';
  end if;
  if j.status <> 'active' then
    raise exception using errcode='P1056', message='MINER_JOB_NOT_ACTIVE';
  end if;
  if v_now < j.ready_at then
    raise exception using errcode='P1053', message='MINER_JOB_NOT_READY';
  end if;

  v_ore := private.sd_miner_roll_ore();
  v_price := private.sd_miner_ore_price(v_ore);

  update public.sd_miner_inventory
  set quantity = quantity + 1,
      acquired_count = acquired_count + 1,
      updated_at = now()
  where user_id = v_user
    and ore_key = v_ore
  returning quantity into v_q;

  update public.sd_miner_accounts
  set total_mined = total_mined + 1,
      last_mine_at = v_now,
      highest_tier_found = highest_tier_found or v_ore = 'diamond',
      current_diamond_streak = case when v_ore = 'diamond' then current_diamond_streak + 1 else 0 end,
      max_diamond_streak = greatest(
        max_diamond_streak,
        case when v_ore = 'diamond' then current_diamond_streak + 1 else 0 end
      ),
      updated_at = now()
  where user_id = v_user
  returning * into a;

  update public.sd_miner_jobs
  set status = 'claimed',
      claimed_at = v_now,
      claim_request_id = p_request_id,
      result_ore_key = v_ore,
      result_quantity = 1,
      updated_at = now()
  where job_id = p_job_id;

  perform private.refresh_sd_miner_achievements(v_user);

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'authority', 'server-v3',
    'job_id', p_job_id,
    'status', 'claimed',
    'ore_key', v_ore,
    'resource_key', private.sd_miner_v3_resource_key(v_ore),
    'ore_name', case v_ore when 'stone' then '돌' when 'copper' then '구리' when 'iron' then '철' when 'emerald' then '에메랄드' else '다이아몬드' end,
    'quantity_gained', 1,
    'inventory_quantity', v_q,
    'current_sale_price', v_price,
    'total_mined', a.total_mined,
    'max_diamond_streak', a.max_diamond_streak,
    'claimed_at', v_now,
    'access_device_id', v_device_id
  );

  return private.sd_miner_save_action(v_user, p_request_id, 'v3_claim', v_input, v_result);
end;
$$;

create or replace function public.sd_miner_v3_sell(
  p_ore_key text,
  p_quantity bigint,
  p_request_id uuid,
  p_device_key text,
  p_device_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_device_id uuid;
  v_ore text := lower(trim(coalesce(p_ore_key, '')));
  v_qty bigint := coalesce(p_quantity, 0);
  v_owned bigint;
  v_price bigint;
  v_amount bigint;
  v_input jsonb;
  v_replay jsonb;
  v_wallet jsonb;
  v_result jsonb;
  a public.sd_miner_accounts%rowtype;
begin
  v_device_id := private.assert_sd_miner_device_v3(v_user, p_device_key, p_device_secret);

  if v_ore not in ('stone','copper','iron','emerald','diamond')
     or v_qty <= 0 or v_qty > 1000000000 then
    raise exception using errcode='P1010', message='INVALID_MINER_SALE';
  end if;

  v_input := pg_catalog.jsonb_build_object('ore_key', v_ore, 'quantity', v_qty);
  v_replay := private.sd_miner_action_replay(v_user, p_request_id, 'v3_sell', v_input);
  if v_replay is not null then
    return v_replay;
  end if;

  perform private.sd_miner_ensure_account(v_user);
  select * into a
  from public.sd_miner_accounts
  where user_id = v_user
  for update;

  select quantity into v_owned
  from public.sd_miner_inventory
  where user_id = v_user
    and ore_key = v_ore
  for update;

  if coalesce(v_owned, 0) < v_qty then
    raise exception using errcode='P1013', message='INSUFFICIENT_ORE';
  end if;

  v_price := private.sd_miner_ore_price(v_ore);
  v_amount := v_price * v_qty;
  if v_amount <= 0 or v_amount > 1000000000000 then
    raise exception using errcode='P1011', message='MINER_SALE_TOO_LARGE';
  end if;

  v_wallet := sd_core_private.apply_server_wallet_delta_impl(
    v_user,
    p_request_id,
    'miner_sell_v3',
    v_amount,
    'sd_miner_v3',
    'SD광산 · ' || case v_ore when 'stone' then '돌' when 'copper' then '구리' when 'iron' then '철' when 'emerald' then '에메랄드' else '다이아몬드' end || ' 판매',
    pg_catalog.jsonb_build_object(
      'ore_key', v_ore,
      'resource_key', private.sd_miner_v3_resource_key(v_ore),
      'quantity', v_qty,
      'unit_price', v_price,
      'miner_access_device_id', v_device_id,
      'miner_api_version', 'v3'
    )
  );

  update public.sd_miner_inventory
  set quantity = quantity - v_qty,
      updated_at = now()
  where user_id = v_user
    and ore_key = v_ore;

  update public.sd_miner_accounts
  set total_sales_krw = total_sales_krw + v_amount,
      updated_at = now()
  where user_id = v_user
  returning * into a;

  perform private.refresh_sd_miner_achievements(v_user);

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'ore_key', v_ore,
    'resource_key', private.sd_miner_v3_resource_key(v_ore),
    'quantity', v_qty,
    'unit_price', v_price,
    'amount', v_amount,
    'remaining', v_owned - v_qty,
    'total_sales_krw', a.total_sales_krw,
    'balance_after', (v_wallet->>'balance_after')::bigint,
    'duplicate', coalesce((v_wallet->>'duplicate')::boolean, false)
  );

  return private.sd_miner_save_action(v_user, p_request_id, 'v3_sell', v_input, v_result);
end;
$$;

create or replace function public.sd_miner_v3_sell_all(
  p_request_id uuid,
  p_device_key text,
  p_device_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_device_id uuid;
  v_replay jsonb;
  v_amount bigint := 0;
  r record;
  v_wallet jsonb;
  v_result jsonb;
  a public.sd_miner_accounts%rowtype;
begin
  v_device_id := private.assert_sd_miner_device_v3(v_user, p_device_key, p_device_secret);

  v_replay := private.sd_miner_action_replay(v_user, p_request_id, 'v3_sell_all', '{}'::jsonb);
  if v_replay is not null then
    return v_replay;
  end if;

  perform private.sd_miner_ensure_account(v_user);
  select * into a
  from public.sd_miner_accounts
  where user_id = v_user
  for update;

  for r in
    select ore_key, quantity
    from public.sd_miner_inventory
    where user_id = v_user
    order by ore_key
    for update
  loop
    v_amount := v_amount + r.quantity * private.sd_miner_ore_price(r.ore_key);
  end loop;

  if v_amount <= 0 then
    raise exception using errcode='P1031', message='MINER_NOTHING_TO_SELL';
  end if;
  if v_amount > 1000000000000 then
    raise exception using errcode='P1011', message='MINER_SALE_TOO_LARGE';
  end if;

  v_wallet := sd_core_private.apply_server_wallet_delta_impl(
    v_user,
    p_request_id,
    'miner_sell_all_v3',
    v_amount,
    'sd_miner_v3',
    'SD광산 · 광석 전체 판매',
    pg_catalog.jsonb_build_object(
      'miner_access_device_id', v_device_id,
      'miner_api_version', 'v3'
    )
  );

  update public.sd_miner_inventory
  set quantity = 0,
      updated_at = now()
  where user_id = v_user;

  update public.sd_miner_accounts
  set total_sales_krw = total_sales_krw + v_amount,
      updated_at = now()
  where user_id = v_user
  returning * into a;

  perform private.refresh_sd_miner_achievements(v_user);

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'amount', v_amount,
    'total_sales_krw', a.total_sales_krw,
    'balance_after', (v_wallet->>'balance_after')::bigint,
    'duplicate', coalesce((v_wallet->>'duplicate')::boolean, false)
  );

  return private.sd_miner_save_action(v_user, p_request_id, 'v3_sell_all', '{}'::jsonb, v_result);
end;
$$;

revoke all on function private.sd_miner_v3_resource_key(text) from public, anon, authenticated;
revoke all on function private.assert_sd_miner_device_v3(uuid,text,text) from public, anon, authenticated;

revoke execute on function public.sd_miner_v3_bind_device(text,text) from public, anon;
revoke execute on function public.sd_miner_v3_get_state(text,text) from public, anon;
revoke execute on function public.sd_miner_v3_start(uuid,text,text,text) from public, anon;
revoke execute on function public.sd_miner_v3_claim(uuid,uuid,text,text) from public, anon;
revoke execute on function public.sd_miner_v3_sell(text,bigint,uuid,text,text) from public, anon;
revoke execute on function public.sd_miner_v3_sell_all(uuid,text,text) from public, anon;

grant execute on function public.sd_miner_v3_bind_device(text,text) to authenticated;
grant execute on function public.sd_miner_v3_get_state(text,text) to authenticated;
grant execute on function public.sd_miner_v3_start(uuid,text,text,text) to authenticated;
grant execute on function public.sd_miner_v3_claim(uuid,uuid,text,text) to authenticated;
grant execute on function public.sd_miner_v3_sell(text,bigint,uuid,text,text) to authenticated;
grant execute on function public.sd_miner_v3_sell_all(uuid,text,text) to authenticated;

-- Fail closed for the old 300 ms/unbounded API after client cutover.
create or replace function public.sd_miner_get_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode='P1059', message='MINER_V3_REQUIRED';
end;
$$;

create or replace function public.sd_miner_mine(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode='P1059', message='MINER_V3_REQUIRED';
end;
$$;

create or replace function public.sd_miner_buy_auto_mining(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode='P1058', message='MINER_AUTO_REDESIGN_PENDING';
end;
$$;

create or replace function public.sd_miner_sell(p_ore_key text,p_quantity bigint,p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode='P1059', message='MINER_V3_REQUIRED';
end;
$$;

create or replace function public.sd_miner_sell_all(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode='P1059', message='MINER_V3_REQUIRED';
end;
$$;

revoke execute on function public.sd_miner_get_state() from public, anon;
revoke execute on function public.sd_miner_mine(uuid) from public, anon;
revoke execute on function public.sd_miner_buy_auto_mining(uuid) from public, anon;
revoke execute on function public.sd_miner_sell(text,bigint,uuid) from public, anon;
revoke execute on function public.sd_miner_sell_all(uuid) from public, anon;
grant execute on function public.sd_miner_get_state() to authenticated;
grant execute on function public.sd_miner_mine(uuid) to authenticated;
grant execute on function public.sd_miner_buy_auto_mining(uuid) to authenticated;
grant execute on function public.sd_miner_sell(text,bigint,uuid) to authenticated;
grant execute on function public.sd_miner_sell_all(uuid) to authenticated;

commit;
