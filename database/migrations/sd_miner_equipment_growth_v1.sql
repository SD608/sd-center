-- Chapter 4-4: SD Miner equipment, cost and growth authority v1
--
-- Official roadmap scope:
-- - server-owned equipment catalog and player equipment state
-- - sequential progression gated by server total_mined
-- - upgrade costs paid only through SD Core exact-once wallet delta
-- - tool tier changes server job cycle
-- - storage tier changes server inventory capacity
-- - legacy auto-mining entitlement is preserved but not converted or consumed

begin;

create table if not exists public.sd_miner_equipment_catalog (
  slot_key text not null check (slot_key in ('tool','storage')),
  level integer not null check (level between 1 and 5),
  equipment_key text not null unique check (equipment_key ~ '^[a-z0-9._:-]+$'),
  display_name text not null check (char_length(display_name) between 1 and 80),
  upgrade_cost bigint not null check (upgrade_cost >= 0),
  required_total_mined bigint not null check (required_total_mined >= 0),
  cycle_ms integer,
  storage_capacity bigint,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (slot_key, level),
  check (
    (slot_key='tool' and cycle_ms between 1000 and 3600000 and storage_capacity is null)
    or
    (slot_key='storage' and storage_capacity > 0 and cycle_ms is null)
  )
);

alter table public.sd_miner_equipment_catalog enable row level security;
revoke all on public.sd_miner_equipment_catalog from public, anon, authenticated;
grant select on public.sd_miner_equipment_catalog to authenticated;
drop policy if exists sd_miner_equipment_catalog_read_v1 on public.sd_miner_equipment_catalog;
create policy sd_miner_equipment_catalog_read_v1
  on public.sd_miner_equipment_catalog for select to authenticated
  using (active);

insert into public.sd_miner_equipment_catalog(
  slot_key,level,equipment_key,display_name,upgrade_cost,required_total_mined,
  cycle_ms,storage_capacity,active,metadata
) values
  ('tool',1,'miner.tool.worn_pickaxe','낡은 곡괭이',0,0,5000,null,true,
    pg_catalog.jsonb_build_object('growth_stage','starter')),
  ('tool',2,'miner.tool.reinforced_pickaxe','보강 곡괭이',100000,100,4600,null,true,
    pg_catalog.jsonb_build_object('growth_stage','apprentice')),
  ('tool',3,'miner.tool.steel_pickaxe','강철 곡괭이',500000,500,4200,null,true,
    pg_catalog.jsonb_build_object('growth_stage','skilled')),
  ('tool',4,'miner.tool.power_drill','전동 드릴',2000000,1500,3800,null,true,
    pg_catalog.jsonb_build_object('growth_stage','expert')),
  ('tool',5,'miner.tool.industrial_drill','산업용 드릴',6000000,4000,3400,null,true,
    pg_catalog.jsonb_build_object('growth_stage','master')),
  ('storage',1,'miner.storage.canvas_sack','광석 자루',0,0,null,500,true,
    pg_catalog.jsonb_build_object('growth_stage','starter')),
  ('storage',2,'miner.storage.ore_crate','광석 상자',75000,100,null,1000,true,
    pg_catalog.jsonb_build_object('growth_stage','apprentice')),
  ('storage',3,'miner.storage.mine_cart','광산 수레',300000,500,null,2000,true,
    pg_catalog.jsonb_build_object('growth_stage','skilled')),
  ('storage',4,'miner.storage.reinforced_cart','보강 광차',1000000,1500,null,4000,true,
    pg_catalog.jsonb_build_object('growth_stage','expert')),
  ('storage',5,'miner.storage.powered_hauler','동력 운반차',3000000,4000,null,8000,true,
    pg_catalog.jsonb_build_object('growth_stage','master'))
on conflict (slot_key,level) do update set
  equipment_key=excluded.equipment_key,
  display_name=excluded.display_name,
  upgrade_cost=excluded.upgrade_cost,
  required_total_mined=excluded.required_total_mined,
  cycle_ms=excluded.cycle_ms,
  storage_capacity=excluded.storage_capacity,
  active=excluded.active,
  metadata=excluded.metadata,
  updated_at=now();

create table if not exists public.sd_miner_user_equipment (
  user_id uuid not null references auth.users(id) on delete cascade,
  slot_key text not null,
  level integer not null,
  acquired_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id,slot_key),
  foreign key (slot_key,level)
    references public.sd_miner_equipment_catalog(slot_key,level)
    on update restrict on delete restrict
);

create index if not exists sd_miner_user_equipment_slot_idx
  on public.sd_miner_user_equipment(slot_key,level,user_id);

alter table public.sd_miner_user_equipment enable row level security;
revoke all on public.sd_miner_user_equipment from public, anon, authenticated;
grant select on public.sd_miner_user_equipment to authenticated;
drop policy if exists sd_miner_user_equipment_read_own_v1 on public.sd_miner_user_equipment;
create policy sd_miner_user_equipment_read_own_v1
  on public.sd_miner_user_equipment for select to authenticated
  using ((select auth.uid())=user_id);

insert into public.sd_miner_user_equipment(user_id,slot_key,level)
select a.user_id,s.slot_key,1
from public.sd_miner_accounts a
cross join (values ('tool'::text),('storage'::text)) as s(slot_key)
on conflict(user_id,slot_key) do nothing;

create or replace function private.ensure_sd_miner_equipment_v1(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_user_id is null then return; end if;
  perform private.sd_miner_ensure_account(p_user_id);
  insert into public.sd_miner_user_equipment(user_id,slot_key,level)
  values(p_user_id,'tool',1),(p_user_id,'storage',1)
  on conflict(user_id,slot_key) do nothing;
end;
$$;

create or replace function private.sd_miner_effective_cycle_ms_v1(p_user_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_cycle integer;
begin
  select c.cycle_ms into v_cycle
  from public.sd_miner_user_equipment u
  join public.sd_miner_equipment_catalog c
    on c.slot_key=u.slot_key and c.level=u.level
  where u.user_id=p_user_id and u.slot_key='tool' and c.active;
  return coalesce(v_cycle,5000);
end;
$$;

create or replace function private.sd_miner_storage_capacity_v1(p_user_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_capacity bigint;
begin
  select c.storage_capacity into v_capacity
  from public.sd_miner_user_equipment u
  join public.sd_miner_equipment_catalog c
    on c.slot_key=u.slot_key and c.level=u.level
  where u.user_id=p_user_id and u.slot_key='storage' and c.active;
  return coalesce(v_capacity,500);
end;
$$;

create or replace function private.sd_miner_current_inventory_quantity_v1(p_user_id uuid)
returns bigint
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(sum(b.quantity),0)::bigint
  from public.sd_user_item_balances b
  join public.sd_item_catalog c on c.item_key=b.item_key
  where b.user_id=p_user_id
    and c.source_app='sd-miner'
    and coalesce(c.metadata->>'legacy_ore_key','') in ('stone','copper','iron','emerald','diamond')
$$;

create or replace function private.sd_miner_equipment_slot_state_v1(
  p_user_id uuid,
  p_slot_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_slot text := lower(trim(coalesce(p_slot_key,'')));
  v_level integer;
  v_current public.sd_miner_equipment_catalog%rowtype;
  v_next public.sd_miner_equipment_catalog%rowtype;
begin
  select u.level into v_level
  from public.sd_miner_user_equipment u
  where u.user_id=p_user_id and u.slot_key=v_slot;

  if v_level is null then return null; end if;

  select * into v_current
  from public.sd_miner_equipment_catalog c
  where c.slot_key=v_slot and c.level=v_level;

  select * into v_next
  from public.sd_miner_equipment_catalog c
  where c.slot_key=v_slot and c.level=v_level+1 and c.active;

  return pg_catalog.jsonb_build_object(
    'slot_key',v_slot,
    'level',v_current.level,
    'max_level',5,
    'equipment_key',v_current.equipment_key,
    'display_name',v_current.display_name,
    'cycle_ms',v_current.cycle_ms,
    'storage_capacity',v_current.storage_capacity,
    'next',case when v_next.level is null then null else pg_catalog.jsonb_build_object(
      'level',v_next.level,
      'equipment_key',v_next.equipment_key,
      'display_name',v_next.display_name,
      'upgrade_cost',v_next.upgrade_cost,
      'required_total_mined',v_next.required_total_mined,
      'cycle_ms',v_next.cycle_ms,
      'storage_capacity',v_next.storage_capacity
    ) end
  );
end;
$$;

revoke all on function private.ensure_sd_miner_equipment_v1(uuid) from public,anon,authenticated;
revoke all on function private.sd_miner_effective_cycle_ms_v1(uuid) from public,anon,authenticated;
revoke all on function private.sd_miner_storage_capacity_v1(uuid) from public,anon,authenticated;
revoke all on function private.sd_miner_current_inventory_quantity_v1(uuid) from public,anon,authenticated;
revoke all on function private.sd_miner_equipment_slot_state_v1(uuid,text) from public,anon,authenticated;

create or replace function public.sd_miner_v3_get_progression(
  p_device_key text,
  p_device_secret text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid := auth.uid();
  v_device_id uuid;
  a public.sd_miner_accounts%rowtype;
  v_inventory bigint;
  v_capacity bigint;
begin
  v_device_id := private.assert_sd_miner_device_v3(v_user,p_device_key,p_device_secret);
  perform private.ensure_sd_miner_equipment_v1(v_user);
  select * into a from public.sd_miner_accounts where user_id=v_user;
  v_inventory := private.sd_miner_current_inventory_quantity_v1(v_user);
  v_capacity := private.sd_miner_storage_capacity_v1(v_user);

  return pg_catalog.jsonb_build_object(
    'ok',true,
    'authority','server-v3',
    'progression_authority','miner-progression-v1',
    'access_device_id',v_device_id,
    'total_mined',a.total_mined,
    'inventory_quantity',v_inventory,
    'storage_capacity',v_capacity,
    'storage_remaining',greatest(v_capacity-v_inventory,0),
    'effective_cycle_ms',private.sd_miner_effective_cycle_ms_v1(v_user),
    'legacy_auto_mining_owned',a.auto_mining_unlocked,
    'legacy_auto_mining_status','preserved_disabled',
    'equipment',pg_catalog.jsonb_build_object(
      'tool',private.sd_miner_equipment_slot_state_v1(v_user,'tool'),
      'storage',private.sd_miner_equipment_slot_state_v1(v_user,'storage')
    )
  );
end;
$$;

revoke execute on function public.sd_miner_v3_get_progression(text,text) from public,anon;
grant execute on function public.sd_miner_v3_get_progression(text,text) to authenticated;

create or replace function public.sd_miner_v3_upgrade_equipment(
  p_slot_key text,
  p_expected_level integer,
  p_request_id uuid,
  p_device_key text,
  p_device_secret text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid := auth.uid();
  v_device_id uuid;
  v_slot text := lower(trim(coalesce(p_slot_key,'')));
  v_input jsonb;
  v_replay jsonb;
  v_current_level integer;
  v_next public.sd_miner_equipment_catalog%rowtype;
  a public.sd_miner_accounts%rowtype;
  v_wallet jsonb;
  v_result jsonb;
begin
  v_device_id := private.assert_sd_miner_device_v3(v_user,p_device_key,p_device_secret);

  if p_request_id is null then
    raise exception using errcode='P1007',message='REQUEST_ID_REQUIRED';
  end if;
  if v_slot not in ('tool','storage') or p_expected_level not between 1 and 5 then
    raise exception using errcode='P1010',message='INVALID_MINER_EQUIPMENT';
  end if;

  v_input := pg_catalog.jsonb_build_object('slot_key',v_slot,'expected_level',p_expected_level);
  v_replay := private.sd_miner_action_replay(v_user,p_request_id,'v3_equipment_upgrade',v_input);
  if v_replay is not null then return v_replay; end if;

  perform private.ensure_sd_miner_equipment_v1(v_user);

  select * into a
  from public.sd_miner_accounts
  where user_id=v_user
  for update;

  select u.level into v_current_level
  from public.sd_miner_user_equipment u
  where u.user_id=v_user and u.slot_key=v_slot
  for update;

  if v_current_level is distinct from p_expected_level then
    raise exception using errcode='P1066',message='MINER_EQUIPMENT_STATE_CHANGED';
  end if;

  select * into v_next
  from public.sd_miner_equipment_catalog c
  where c.slot_key=v_slot and c.level=v_current_level+1 and c.active;

  if v_next.level is null then
    raise exception using errcode='P1067',message='MINER_EQUIPMENT_MAX_LEVEL';
  end if;

  if a.total_mined < v_next.required_total_mined then
    raise exception using errcode='P1068',message='MINER_EQUIPMENT_PROGRESS_REQUIRED';
  end if;

  v_wallet := sd_core_private.apply_server_wallet_delta_impl(
    v_user,
    p_request_id,
    'miner_equipment_upgrade',
    -v_next.upgrade_cost,
    'sd_miner_v3',
    'SD광산 · ' || v_next.display_name || ' 업그레이드',
    pg_catalog.jsonb_build_object(
      'slot_key',v_slot,
      'from_level',v_current_level,
      'to_level',v_next.level,
      'equipment_key',v_next.equipment_key,
      'required_total_mined',v_next.required_total_mined,
      'miner_access_device_id',v_device_id,
      'progression_version','miner-progression-v1'
    )
  );

  update public.sd_miner_user_equipment
  set level=v_next.level,
      acquired_at=now(),
      updated_at=now()
  where user_id=v_user and slot_key=v_slot;

  v_result := pg_catalog.jsonb_build_object(
    'ok',true,
    'duplicate',false,
    'progression_authority','miner-progression-v1',
    'slot_key',v_slot,
    'from_level',v_current_level,
    'to_level',v_next.level,
    'equipment_key',v_next.equipment_key,
    'display_name',v_next.display_name,
    'cost',v_next.upgrade_cost,
    'balance_after',(v_wallet->>'balance_after')::bigint,
    'effective_cycle_ms',private.sd_miner_effective_cycle_ms_v1(v_user),
    'storage_capacity',private.sd_miner_storage_capacity_v1(v_user),
    'access_device_id',v_device_id
  );

  return private.sd_miner_save_action(
    v_user,p_request_id,'v3_equipment_upgrade',v_input,v_result
  );
end;
$$;

revoke execute on function public.sd_miner_v3_upgrade_equipment(text,integer,uuid,text,text)
  from public,anon;
grant execute on function public.sd_miner_v3_upgrade_equipment(text,integer,uuid,text,text)
  to authenticated;

-- Start remains the v3 work-loop API, but cycle and storage checks now come from
-- server-owned equipment instead of a fixed client-visible constant.
create or replace function public.sd_miner_v3_start(
  p_request_id uuid,
  p_device_key text,
  p_device_secret text,
  p_mine_key text default 'surface'
)
returns jsonb
language plpgsql
security definer
set search_path=''
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
  v_cycle_ms integer;
  v_inventory bigint;
  v_capacity bigint;
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

  perform private.ensure_sd_miner_equipment_v1(v_user);
  select * into a
  from public.sd_miner_accounts
  where user_id=v_user
  for update;

  perform 1
  from public.sd_miner_user_equipment u
  where u.user_id=v_user
  for share;

  select j.job_id into v_existing_job
  from public.sd_miner_jobs j
  where j.user_id=v_user and j.status='active'
  for update;

  if v_existing_job is not null then
    raise exception using errcode='P1054',message='MINER_JOB_ALREADY_ACTIVE';
  end if;

  v_inventory := private.sd_miner_current_inventory_quantity_v1(v_user);
  v_capacity := private.sd_miner_storage_capacity_v1(v_user);
  if v_inventory >= v_capacity then
    raise exception using errcode='P1065',message='MINER_STORAGE_FULL';
  end if;

  v_cycle_ms := private.sd_miner_effective_cycle_ms_v1(v_user);
  v_ready_at := v_started_at + (v_cycle_ms * interval '1 millisecond');

  insert into public.sd_miner_jobs(
    user_id,start_request_id,mine_key,status,cycle_ms,started_at,ready_at
  ) values(
    v_user,p_request_id,v_mine_key,'active',v_cycle_ms,v_started_at,v_ready_at
  ) returning job_id into v_job_id;

  v_result := pg_catalog.jsonb_build_object(
    'ok',true,
    'authority','server-v3',
    'progression_authority','miner-progression-v1',
    'job_id',v_job_id,
    'mine_key',v_mine_key,
    'status','active',
    'cycle_ms',v_cycle_ms,
    'started_at',v_started_at,
    'ready_at',v_ready_at,
    'storage_capacity',v_capacity,
    'inventory_quantity',v_inventory,
    'access_device_id',v_device_id
  );

  return private.sd_miner_save_action(v_user,p_request_id,'v3_start',v_input,v_result);
end;
$$;

revoke execute on function public.sd_miner_v3_start(uuid,text,text,text) from public,anon;
grant execute on function public.sd_miner_v3_start(uuid,text,text,text) to authenticated;

-- Claim mutates the shared item before it marks the job claimed. This trigger runs
-- in the same transaction before that status transition; if the new quantity exceeds
-- capacity, the exception rolls the item/account mutation back as well.
create or replace function private.enforce_sd_miner_storage_claim_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_capacity bigint;
  v_inventory bigint;
begin
  if old.status is distinct from 'claimed' and new.status='claimed' then
    perform private.ensure_sd_miner_equipment_v1(new.user_id);
    perform 1
    from public.sd_miner_user_equipment u
    where u.user_id=new.user_id
    for share;

    v_capacity := private.sd_miner_storage_capacity_v1(new.user_id);
    v_inventory := private.sd_miner_current_inventory_quantity_v1(new.user_id);
    if v_inventory > v_capacity then
      raise exception using errcode='P1065',message='MINER_STORAGE_FULL';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_sd_miner_storage_claim_v1()
  from public,anon,authenticated;

drop trigger if exists sd_miner_storage_claim_guard_v1 on public.sd_miner_jobs;
create trigger sd_miner_storage_claim_guard_v1
before update of status on public.sd_miner_jobs
for each row execute function private.enforce_sd_miner_storage_claim_v1();

-- Keep the main miner state internally consistent with the active equipment system.
create or replace function public.sd_miner_v3_get_state(
  p_device_key text,
  p_device_secret text
)
returns jsonb
language plpgsql
security definer
set search_path=''
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
  v_capacity bigint;
  v_cycle_ms integer;
begin
  v_device_id := private.assert_sd_miner_device_v3(v_user,p_device_key,p_device_secret);
  perform private.sd_miner_ensure_account(v_user);
  perform private.ensure_sd_miner_common_balances(v_user);
  perform private.ensure_sd_miner_equipment_v1(v_user);
  select * into a from public.sd_miner_accounts where user_id=v_user;

  v_used := case when a.daily_claim_day=v_day then a.daily_claims else 0 end;
  v_next_reset := ((v_day+1)::timestamp at time zone 'Asia/Seoul');
  v_capacity := private.sd_miner_storage_capacity_v1(v_user);
  v_cycle_ms := private.sd_miner_effective_cycle_ms_v1(v_user);

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
    'progression_authority','miner-progression-v1',
    'access_device_id',v_device_id,
    'total_mined',a.total_mined,
    'total_sales_krw',a.total_sales_krw,
    'legacy_auto_mining_owned',a.auto_mining_unlocked,
    'auto_mining_status','disabled_pending_redesign',
    'highest_tier_found',a.highest_tier_found,
    'max_diamond_streak',a.max_diamond_streak,
    'ore_kinds',v_kinds,
    'current_inventory_quantity',v_current,
    'storage_capacity',v_capacity,
    'storage_remaining',greatest(v_capacity-v_current,0),
    'equipment',pg_catalog.jsonb_build_object(
      'tool',private.sd_miner_equipment_slot_state_v1(v_user,'tool'),
      'storage',private.sd_miner_equipment_slot_state_v1(v_user,'storage')
    ),
    'active_job',v_job,
    'daily_claims_used',v_used,
    'daily_claim_limit',v_limit,
    'daily_claims_remaining',greatest(v_limit-v_used,0),
    'daily_reset_timezone','Asia/Seoul',
    'next_daily_reset_at',v_next_reset,
    'config',pg_catalog.jsonb_build_object(
      'mine_key','surface',
      'cycle_ms',v_cycle_ms,
      'max_parallel_jobs',1,
      'offline_queue_limit',1,
      'daily_claim_limit',v_limit,
      'daily_reset_timezone','Asia/Seoul',
      'economy_stage','pre_ch4_7_guardrail_v1',
      'economy_version','miner-economy-v1',
      'progression_stage','ch4_4_equipment_growth_v1',
      'progression_version','miner-progression-v1',
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

revoke execute on function public.sd_miner_v3_get_state(text,text) from public,anon;
grant execute on function public.sd_miner_v3_get_state(text,text) to authenticated;

commit;
