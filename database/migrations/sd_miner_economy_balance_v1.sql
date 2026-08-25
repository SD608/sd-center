-- Chapter 4-4: SD Miner economy balance v1
--
-- Finalizes the server-side economy envelope for the remade miner:
-- - retain the 5 second active mining cadence
-- - retain the reviewed ore probabilities
-- - reduce sale prices to a sustainable active-play curve
-- - cap accepted claims at 3,600 per Asia/Seoul economy day
-- - keep background income at zero (one pending job still requires an explicit claim)
-- - preserve Core/item exact-once and all existing legitimate assets

begin;

alter table public.sd_miner_accounts
  add column if not exists daily_claim_day date,
  add column if not exists daily_claims integer not null default 0 check (daily_claims >= 0);

comment on column public.sd_miner_accounts.daily_claim_day is
  'Asia/Seoul economy date for the Chapter 4-4 accepted-claim counter.';
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

-- Stable deterministic bucket mapping makes the probability contract testable.
-- 0..475 stone (47.6%), 476..713 copper (23.8%), 714..856 iron (14.3%),
-- 857..951 emerald (9.5%), 952..999 diamond (4.8%).
create or replace function private.sd_miner_ore_from_roll(p_roll integer)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when p_roll between 0 and 475 then 'stone'
    when p_roll between 476 and 713 then 'copper'
    when p_roll between 714 and 856 then 'iron'
    when p_roll between 857 and 951 then 'emerald'
    when p_roll between 952 and 999 then 'diamond'
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

-- If this migration is applied over an already-running v3 database, preserve today's
-- actual accepted usage instead of granting a fresh quota at migration time.
with economy_day as (
  select private.sd_miner_economy_day() as d
)
update public.sd_miner_accounts a
set daily_claim_day = e.d,
    daily_claims = pg_catalog.least(
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
    'daily_claims_remaining',pg_catalog.greatest(v_limit-v_used,0),
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
  v_mine_key text := lower(trim(coalesce(p_mine_key,'')));
  v_input jsonb;
  v_replay jsonb;
  a public.sd_miner_accounts%rowtype;
  v_existing_job uuid;
  v_job_id uuid;
  v_started_at timestamptz := pg_catalog.clock_timestamp();
  v_ready_at timestamptz;
  v_result jsonb;
  v_day date := private.sd_miner_economy_day();
  v_limit integer := private.sd_miner_daily_claim_limit();
  v_cycle_ms integer := private.sd_miner_cycle_ms();
begin
  v_device_id := private.assert_sd_miner_device_v3(v_user,p_device_key,p_device_secret);

  if p_request_id is null then
    raise exception using errcode='P1007',message='REQUEST_ID_REQUIRED';
  end if;
  if v_mine_key <> 'surface' then
    raise exception using errcode='P1027',message='INVALID_MINER_MINE';
  end if;

  v_input := pg_catalog.jsonb_build_object('mine_key',v_mine_key);
  v_replay := private.sd_miner_action_replay(v_user,p_request_id,'v3_start',v_input);
  if v_replay is not null then return v_replay; end if;

  perform private.sd_miner_ensure_account(v_user);
  select * into a
  from public.sd_miner_accounts
  where user_id=v_user
  for update;

  select j.job_id into v_existing_job
  from public.sd_miner_jobs j
  where j.user_id=v_user and j.status='active'
  for update;

  if v_existing_job is not null then
    raise exception using errcode='P1054',message='MINER_JOB_ALREADY_ACTIVE';
  end if;

  if a.daily_claim_day is distinct from v_day then
    update public.sd_miner_accounts
    set daily_claim_day=v_day,daily_claims=0,updated_at=now()
    where user_id=v_user
    returning * into a;
  end if;

  if a.daily_claims >= v_limit then
    raise exception using errcode='P1064',message='MINER_DAILY_CLAIM_LIMIT';
  end if;

  v_ready_at := v_started_at + (v_cycle_ms * interval '1 millisecond');

  insert into public.sd_miner_jobs(
    user_id,start_request_id,mine_key,status,cycle_ms,started_at,ready_at
  ) values(
    v_user,p_request_id,v_mine_key,'active',v_cycle_ms,v_started_at,v_ready_at
  ) returning job_id into v_job_id;

  v_result := pg_catalog.jsonb_build_object(
    'ok',true,
    'authority','server-v3',
    'economy_authority','miner-economy-v1',
    'job_id',v_job_id,
    'mine_key',v_mine_key,
    'status','active',
    'cycle_ms',v_cycle_ms,
    'started_at',v_started_at,
    'ready_at',v_ready_at,
    'daily_claims_used',a.daily_claims,
    'daily_claims_remaining',pg_catalog.greatest(v_limit-a.daily_claims,0),
    'access_device_id',v_device_id
  );

  return private.sd_miner_save_action(v_user,p_request_id,'v3_start',v_input,v_result);
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
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_ore text;
  v_item_key text;
  v_price bigint;
  v_item jsonb;
  v_q bigint;
  v_result jsonb;
  v_day date := private.sd_miner_economy_day();
  v_limit integer := private.sd_miner_daily_claim_limit();
begin
  v_device_id := private.assert_sd_miner_device_v3(v_user,p_device_key,p_device_secret);
  if p_request_id is null or p_job_id is null then
    raise exception using errcode='P1007',message='REQUEST_ID_REQUIRED';
  end if;

  v_input := pg_catalog.jsonb_build_object('job_id',p_job_id);
  v_replay := private.sd_miner_action_replay(v_user,p_request_id,'v3_claim',v_input);
  if v_replay is not null then return v_replay; end if;

  perform private.sd_miner_ensure_account(v_user);
  perform private.ensure_sd_miner_common_balances(v_user);
  select * into a
  from public.sd_miner_accounts
  where user_id=v_user
  for update;

  if a.daily_claim_day is distinct from v_day then
    update public.sd_miner_accounts
    set daily_claim_day=v_day,daily_claims=0,updated_at=now()
    where user_id=v_user
    returning * into a;
  end if;

  select * into j
  from public.sd_miner_jobs
  where job_id=p_job_id and user_id=v_user
  for update;

  if j.job_id is null then raise exception using errcode='P1016',message='MINER_JOB_NOT_FOUND'; end if;
  if j.status='claimed' then raise exception using errcode='P1055',message='MINER_JOB_ALREADY_CLAIMED'; end if;
  if j.status<>'active' then raise exception using errcode='P1056',message='MINER_JOB_NOT_ACTIVE'; end if;
  if v_now<j.ready_at then raise exception using errcode='P1053',message='MINER_JOB_NOT_READY'; end if;
  if a.daily_claims >= v_limit then
    raise exception using errcode='P1064',message='MINER_DAILY_CLAIM_LIMIT';
  end if;

  v_ore := private.sd_miner_roll_ore();
  v_item_key := private.sd_miner_v3_resource_key(v_ore);
  v_price := private.sd_miner_ore_price(v_ore);
  v_item := private.apply_sd_item_delta_impl(
    v_user,p_request_id::text,v_item_key,1,'sd_miner_v3','mine_claim',
    pg_catalog.jsonb_build_object(
      'job_id',p_job_id,'ore_key',v_ore,'miner_access_device_id',v_device_id,
      'miner_api_version','v3','economy_version','miner-economy-v1'
    )
  );
  v_q := (v_item->>'quantity_after')::bigint;

  update public.sd_miner_accounts
  set total_mined=total_mined+1,
      last_mine_at=v_now,
      highest_tier_found=highest_tier_found or v_ore='diamond',
      current_diamond_streak=case when v_ore='diamond' then current_diamond_streak+1 else 0 end,
      max_diamond_streak=pg_catalog.greatest(
        max_diamond_streak,
        case when v_ore='diamond' then current_diamond_streak+1 else 0 end
      ),
      daily_claim_day=v_day,
      daily_claims=daily_claims+1,
      updated_at=now()
  where user_id=v_user
  returning * into a;

  update public.sd_miner_jobs
  set status='claimed',claimed_at=v_now,claim_request_id=p_request_id,
      result_ore_key=v_ore,result_quantity=1,updated_at=now()
  where job_id=p_job_id;

  perform private.refresh_sd_miner_achievements(v_user);

  v_result := pg_catalog.jsonb_build_object(
    'ok',true,
    'authority','server-v3',
    'inventory_authority','sd-item-v1',
    'economy_authority','miner-economy-v1',
    'job_id',p_job_id,
    'status','claimed',
    'ore_key',v_ore,
    'resource_key',v_item_key,
    'ore_name',case v_ore when 'stone' then '돌' when 'copper' then '구리' when 'iron' then '철' when 'emerald' then '에메랄드' else '다이아몬드' end,
    'quantity_gained',1,
    'inventory_quantity',v_q,
    'current_sale_price',v_price,
    'total_mined',a.total_mined,
    'max_diamond_streak',a.max_diamond_streak,
    'daily_claims_used',a.daily_claims,
    'daily_claims_remaining',pg_catalog.greatest(v_limit-a.daily_claims,0),
    'claimed_at',v_now,
    'access_device_id',v_device_id,
    'item_event_id',p_request_id::text
  );

  return private.sd_miner_save_action(v_user,p_request_id,'v3_claim',v_input,v_result);
end;
$$;

revoke execute on function public.sd_miner_v3_get_state(text,text) from public, anon;
revoke execute on function public.sd_miner_v3_start(uuid,text,text,text) from public, anon;
revoke execute on function public.sd_miner_v3_claim(uuid,uuid,text,text) from public, anon;
grant execute on function public.sd_miner_v3_get_state(text,text) to authenticated;
grant execute on function public.sd_miner_v3_start(uuid,text,text,text) to authenticated;
grant execute on function public.sd_miner_v3_claim(uuid,uuid,text,text) to authenticated;

commit;
