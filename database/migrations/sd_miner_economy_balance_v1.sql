-- Chapter 4-4: SD Miner economy balance v1
--
-- Final economy envelope for the remade miner.
-- - 5 second active mining cadence
-- - reviewed ore probabilities retained
-- - final sale prices: 50 / 200 / 500 / 1500 / 4000
-- - 3,600 accepted claims per Asia/Seoul economy day
-- - no repeating background income; one pending job still requires explicit claim
-- - Core wallet and shared-item exact-once paths remain unchanged

begin;

alter table public.sd_miner_accounts
  add column if not exists daily_claim_day date,
  add column if not exists daily_claims integer not null default 0 check (daily_claims >= 0);

comment on column public.sd_miner_accounts.daily_claim_day is
  'Asia/Seoul economy date used by the Chapter 4-4 accepted-claim counter.';
comment on column public.sd_miner_accounts.daily_claims is
  'Accepted miner claims on daily_claim_day. Server-authoritative anti-macro economy counter.';

create or replace function private.sd_miner_economy_day()
returns date
language sql
volatile
security definer
set search_path = ''
as $$
  select (pg_catalog.clock_timestamp() at time zone 'Asia/Seoul')::date
$$;

create or replace function private.sd_miner_daily_claim_limit()
returns integer
language sql
immutable
security definer
set search_path = ''
as $$
  select 3600::integer
$$;

create or replace function private.sd_miner_cycle_ms()
returns integer
language sql
immutable
security definer
set search_path = ''
as $$
  select 5000::integer
$$;

-- Deterministic bucket mapping makes the probability contract directly testable.
create or replace function private.sd_miner_ore_from_roll(p_roll integer)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when p_roll between 0 and 475 then 'stone'      -- 47.6%
    when p_roll between 476 and 713 then 'copper'  -- 23.8%
    when p_roll between 714 and 856 then 'iron'    -- 14.3%
    when p_roll between 857 and 951 then 'emerald' -- 9.5%
    when p_roll between 952 and 999 then 'diamond' -- 4.8%
    else null
  end
$$;

create or replace function private.sd_miner_roll_ore()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_roll integer := pg_catalog.floor(pg_catalog.random() * 1000)::integer;
begin
  return private.sd_miner_ore_from_roll(v_roll);
end;
$$;

create or replace function private.sd_miner_ore_price(p_key text)
returns bigint
language sql
immutable
security definer
set search_path = ''
as $$
  select case lower(trim(coalesce(p_key,'')))
    when 'stone' then 50
    when 'copper' then 200
    when 'iron' then 500
    when 'emerald' then 1500
    when 'diamond' then 4000
    else null
  end::bigint
$$;

revoke all on function private.sd_miner_economy_day() from public, anon, authenticated;
revoke all on function private.sd_miner_daily_claim_limit() from public, anon, authenticated;
revoke all on function private.sd_miner_cycle_ms() from public, anon, authenticated;
revoke all on function private.sd_miner_ore_from_roll(integer) from public, anon, authenticated;
revoke all on function private.sd_miner_roll_ore() from public, anon, authenticated;
revoke all on function private.sd_miner_ore_price(text) from public, anon, authenticated;

-- Preserve already-accepted usage if this migration is applied after v3 has run today.
with economy_day as (
  select private.sd_miner_economy_day() as d
)
update public.sd_miner_accounts a
set daily_claim_day = e.d,
    daily_claims = least(
      private.sd_miner_daily_claim_limit(),
      (
        select count(*)::integer
        from public.sd_miner_jobs j
        where j.user_id = a.user_id
          and j.status = 'claimed'
          and (j.claimed_at at time zone 'Asia/Seoul')::date = e.d
      )
    ),
    updated_at = now()
from economy_day e;

create or replace function private.enforce_sd_miner_daily_claim_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := private.sd_miner_economy_day();
  v_limit integer := private.sd_miner_daily_claim_limit();
  a public.sd_miner_accounts%rowtype;
  v_should_count boolean := false;
begin
  perform private.sd_miner_ensure_account(new.user_id);

  select * into a
  from public.sd_miner_accounts
  where user_id = new.user_id
  for update;

  if a.daily_claim_day is distinct from v_day then
    update public.sd_miner_accounts
    set daily_claim_day = v_day,
        daily_claims = 0,
        updated_at = now()
    where user_id = new.user_id
    returning * into a;
  end if;

  if tg_op = 'INSERT' then
    if new.status in ('active','claimed') and a.daily_claims >= v_limit then
      raise exception using errcode='P1064', message='MINER_DAILY_CLAIM_LIMIT';
    end if;
    v_should_count := new.status = 'claimed';
  elsif tg_op = 'UPDATE' then
    v_should_count := old.status is distinct from 'claimed' and new.status = 'claimed';
    if v_should_count and a.daily_claims >= v_limit then
      raise exception using errcode='P1064', message='MINER_DAILY_CLAIM_LIMIT';
    end if;
  end if;

  if v_should_count then
    update public.sd_miner_accounts
    set daily_claim_day = v_day,
        daily_claims = daily_claims + 1,
        updated_at = now()
    where user_id = new.user_id;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_sd_miner_daily_claim_v1() from public, anon, authenticated;

drop trigger if exists sd_miner_daily_claim_insert_v1 on public.sd_miner_jobs;
create trigger sd_miner_daily_claim_insert_v1
before insert on public.sd_miner_jobs
for each row execute function private.enforce_sd_miner_daily_claim_v1();

drop trigger if exists sd_miner_daily_claim_status_v1 on public.sd_miner_jobs;
create trigger sd_miner_daily_claim_status_v1
before update of status on public.sd_miner_jobs
for each row execute function private.enforce_sd_miner_daily_claim_v1();

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
  v_day date := private.sd_miner_economy_day();
  v_limit integer := private.sd_miner_daily_claim_limit();
  v_used integer := 0;
  v_next_reset timestamptz;
begin
  v_device_id := private.assert_sd_miner_device_v3(v_user,p_device_key,p_device_secret);
  perform private.sd_miner_ensure_account(v_user);
  perform private.ensure_sd_miner_common_balances(v_user);
  select * into a from public.sd_miner_accounts where user_id=v_user;

  v_used := case when a.daily_claim_day = v_day then a.daily_claims else 0 end;
  v_next_reset := ((v_day + 1)::timestamp at time zone 'Asia/Seoul');

  select coalesce(
           pg_catalog.jsonb_object_agg(
             c.metadata->>'legacy_ore_key',
             pg_catalog.jsonb_build_object(
               'resource_key',c.item_key,
               'quantity',coalesce(b.quantity,0),
               'acquired_count',coalesce(b.lifetime_acquired,0)
             ) order by c.item_key
           ),
           '{}'::jsonb
         ),
         coalesce(sum(coalesce(b.quantity,0)),0),
         count(*) filter (where coalesce(b.lifetime_acquired,0)>0)
    into v_inv,v_current,v_kinds
  from public.sd_item_catalog c
  left join public.sd_user_item_balances b
    on b.user_id=v_user and b.item_key=c.item_key
  where c.source_app='sd-miner'
    and coalesce(c.metadata->>'legacy_ore_key','') in ('stone','copper','iron','emerald','diamond');

  select pg_catalog.jsonb_build_object(
           'job_id',j.job_id,
           'mine_key',j.mine_key,
           'status',j.status,
           'started_at',j.started_at,
           'ready_at',j.ready_at,
           'cycle_ms',j.cycle_ms
         ) into v_job
  from public.sd_miner_jobs j
  where j.user_id=v_user and j.status='active';

  return pg_catalog.jsonb_build_object(
    'ok',true,
    'authority','server-v3',
    'inventory_authority','sd-item-v1',
    'economy_authority','miner-economy-v1',
    'access_device_id',v_device_id,
    'total_mined',a.total_mined,
    'total_sales_krw',a.total_sales_krw,
    'legacy_auto_mining_owned',a.auto_mining_unlocked,
    'auto_mining_status','disabled_pending_redesign',
    'highest_tier_found',a.highest_tier_found,
    'max_diamond_streak',a.max_diamond_streak,
    'ore_kinds',v_kinds,
    'current_inventory_quantity',v_current,
    'inventory',v_inv,
    'active_job',v_job,
    'daily_claims_used',v_used,
    'daily_claim_limit',v_limit,
    'daily_claims_remaining',greatest(v_limit-v_used,0),
    'daily_reset_timezone','Asia/Seoul',
    'next_daily_reset_at',v_next_reset,
    'config',pg_catalog.jsonb_build_object(
      'mine_key','surface',
      'cycle_ms',private.sd_miner_cycle_ms(),
      'max_parallel_jobs',1,
      'offline_queue_limit',1,
      'daily_claim_limit',v_limit,
      'daily_reset_timezone','Asia/Seoul',
      'economy_stage','final_ch4_4_v1',
      'economy_version','miner-economy-v1',
      'item_authority','sd-item-v1',
      'ores',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('key','stone','resource_key','miner.ore.stone','name','돌','probability',47.6,'price',50),
        pg_catalog.jsonb_build_object('key','copper','resource_key','miner.ore.copper','name','구리','probability',23.8,'price',200),
        pg_catalog.jsonb_build_object('key','iron','resource_key','miner.ore.iron','name','철','probability',14.3,'price',500),
        pg_catalog.jsonb_build_object('key','emerald','resource_key','miner.gem.emerald','name','에메랄드','probability',9.5,'price',1500),
        pg_catalog.jsonb_build_object('key','diamond','resource_key','miner.gem.diamond','name','다이아몬드','probability',4.8,'price',4000)
      )
    )
  );
end;
$$;

revoke execute on function public.sd_miner_v3_get_state(text,text) from public, anon;
grant execute on function public.sd_miner_v3_get_state(text,text) to authenticated;

comment on function public.sd_miner_v3_get_state(text,text) is
  'Miner v3 state using shared item authority plus Chapter 4-4 final economy limits/prices.';

commit;
