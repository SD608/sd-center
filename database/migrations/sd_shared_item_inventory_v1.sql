-- Chapter 4-3: SD shared stackable item authority v1
--
-- Goals:
-- - create one server-authoritative catalog/balance/event model for stackable SD items
-- - migrate the current miner ore balances without changing legitimate user assets
-- - make miner v3 claim/sell use the shared balance as the current quantity authority
-- - keep item mutations private to trusted server RPCs; authenticated clients are read-only
-- - preserve miner achievements and legacy acquisition history monotonically

begin;

create table if not exists public.sd_item_catalog (
  item_key text primary key
    check (char_length(item_key) between 3 and 120 and item_key ~ '^[a-z0-9._:-]+$'),
  display_name text not null check (char_length(display_name) between 1 and 120),
  item_kind text not null check (item_kind in ('resource','equipment','consumable','collectible')),
  category text not null check (char_length(category) between 1 and 80),
  stackable boolean not null default true,
  transferable boolean not null default false,
  source_app text not null check (char_length(source_app) between 1 and 80),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sd_item_catalog enable row level security;
revoke all on public.sd_item_catalog from public, anon, authenticated;
grant select on public.sd_item_catalog to authenticated;
drop policy if exists sd_item_catalog_select_authenticated on public.sd_item_catalog;
create policy sd_item_catalog_select_authenticated
  on public.sd_item_catalog for select to authenticated
  using (true);

create table if not exists public.sd_user_item_balances (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_key text not null references public.sd_item_catalog(item_key) on update cascade on delete restrict,
  quantity bigint not null default 0 check (quantity >= 0),
  lifetime_acquired bigint not null default 0 check (lifetime_acquired >= 0),
  lifetime_spent bigint not null default 0 check (lifetime_spent >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, item_key)
);

create index if not exists sd_user_item_balances_item_idx
  on public.sd_user_item_balances(item_key, user_id);

alter table public.sd_user_item_balances enable row level security;
revoke all on public.sd_user_item_balances from public, anon, authenticated;
grant select on public.sd_user_item_balances to authenticated;
drop policy if exists sd_user_item_balances_select_own on public.sd_user_item_balances;
create policy sd_user_item_balances_select_own
  on public.sd_user_item_balances for select to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.sd_item_events (
  event_id text primary key
    check (char_length(event_id) between 1 and 180 and event_id ~ '^[A-Za-z0-9._:-]+$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_key text not null references public.sd_item_catalog(item_key) on update cascade on delete restrict,
  delta bigint not null check (delta <> 0 and abs(delta) <= 1000000000),
  quantity_before bigint not null check (quantity_before >= 0),
  quantity_after bigint not null check (quantity_after >= 0),
  source_app text not null check (char_length(source_app) between 1 and 80),
  event_type text not null check (char_length(event_type) between 1 and 80),
  metadata jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(metadata)='object'),
  result jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(result)='object'),
  created_at timestamptz not null default now()
);

create index if not exists sd_item_events_user_created_idx
  on public.sd_item_events(user_id, created_at desc);
create index if not exists sd_item_events_user_item_idx
  on public.sd_item_events(user_id, item_key, created_at desc);

alter table public.sd_item_events enable row level security;
revoke all on public.sd_item_events from public, anon, authenticated;
grant select on public.sd_item_events to authenticated;
drop policy if exists sd_item_events_select_own on public.sd_item_events;
create policy sd_item_events_select_own
  on public.sd_item_events for select to authenticated
  using ((select auth.uid()) = user_id);

insert into public.sd_item_catalog(
  item_key, display_name, item_kind, category, stackable, transferable, source_app, active, metadata
) values
  ('miner.ore.stone','돌','resource','ore',true,false,'sd-miner',true,
    pg_catalog.jsonb_build_object('origin_extension','sd-miner','legacy_ore_key','stone','common_scope','sd-core')),
  ('miner.ore.copper','구리','resource','ore',true,false,'sd-miner',true,
    pg_catalog.jsonb_build_object('origin_extension','sd-miner','legacy_ore_key','copper','common_scope','sd-core')),
  ('miner.ore.iron','철','resource','ore',true,false,'sd-miner',true,
    pg_catalog.jsonb_build_object('origin_extension','sd-miner','legacy_ore_key','iron','common_scope','sd-core')),
  ('miner.gem.emerald','에메랄드','resource','gem',true,false,'sd-miner',true,
    pg_catalog.jsonb_build_object('origin_extension','sd-miner','legacy_ore_key','emerald','common_scope','sd-core')),
  ('miner.gem.diamond','다이아몬드','resource','gem',true,false,'sd-miner',true,
    pg_catalog.jsonb_build_object('origin_extension','sd-miner','legacy_ore_key','diamond','common_scope','sd-core'))
on conflict (item_key) do update set
  display_name = excluded.display_name,
  item_kind = excluded.item_kind,
  category = excluded.category,
  stackable = excluded.stackable,
  transferable = excluded.transferable,
  source_app = excluded.source_app,
  active = excluded.active,
  metadata = coalesce(public.sd_item_catalog.metadata,'{}'::jsonb) || excluded.metadata,
  updated_at = now();

create or replace function private.apply_sd_item_delta_impl(
  p_user_id uuid,
  p_event_id text,
  p_item_key text,
  p_delta bigint,
  p_source_app text,
  p_event_type text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.sd_item_events%rowtype;
  v_item_key text := lower(trim(coalesce(p_item_key,'')));
  v_event_id text := trim(coalesce(p_event_id,''));
  v_source_app text := lower(trim(coalesce(p_source_app,'')));
  v_event_type text := lower(trim(coalesce(p_event_type,'')));
  v_stackable boolean;
  v_active boolean;
  v_before bigint;
  v_after bigint;
  v_acquired bigint;
  v_spent bigint;
  v_result jsonb;
begin
  if p_user_id is null then
    raise exception using errcode='P1001', message='AUTH_REQUIRED';
  end if;
  if char_length(v_event_id) < 1 or char_length(v_event_id) > 180
     or v_event_id !~ '^[A-Za-z0-9._:-]+$' then
    raise exception using errcode='P1007', message='INVALID_ITEM_EVENT_ID';
  end if;
  if char_length(v_item_key) < 3 or char_length(v_item_key) > 120
     or v_item_key !~ '^[a-z0-9._:-]+$' then
    raise exception using errcode='P1010', message='INVALID_ITEM_KEY';
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 1000000000 then
    raise exception using errcode='P1011', message='INVALID_ITEM_DELTA';
  end if;
  if char_length(v_source_app) < 1 or char_length(v_source_app) > 80
     or char_length(v_event_type) < 1 or char_length(v_event_type) > 80 then
    raise exception using errcode='P1023', message='INVALID_ITEM_EVENT_SOURCE';
  end if;
  p_metadata := coalesce(p_metadata,'{}'::jsonb);
  if pg_catalog.jsonb_typeof(p_metadata) <> 'object' then
    raise exception using errcode='P1026', message='INVALID_METADATA';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_event_id, 0));

  select * into v_event
  from public.sd_item_events e
  where e.event_id = v_event_id;

  if v_event.event_id is not null then
    if v_event.user_id is distinct from p_user_id
       or v_event.item_key is distinct from v_item_key
       or v_event.delta is distinct from p_delta
       or v_event.source_app is distinct from v_source_app
       or v_event.event_type is distinct from v_event_type then
      raise exception using errcode='P1015', message='ITEM_EVENT_IDEMPOTENCY_CONFLICT';
    end if;
    return v_event.result || pg_catalog.jsonb_build_object('duplicate',true);
  end if;

  select c.stackable, c.active
    into v_stackable, v_active
  from public.sd_item_catalog c
  where c.item_key = v_item_key;

  if not found or v_active is distinct from true then
    raise exception using errcode='P1016', message='ITEM_NOT_FOUND';
  end if;
  if v_stackable is distinct from true then
    raise exception using errcode='P1027', message='ITEM_NOT_STACKABLE';
  end if;

  insert into public.sd_user_item_balances(user_id,item_key)
  values(p_user_id,v_item_key)
  on conflict(user_id,item_key) do nothing;

  select b.quantity, b.lifetime_acquired, b.lifetime_spent
    into v_before, v_acquired, v_spent
  from public.sd_user_item_balances b
  where b.user_id = p_user_id
    and b.item_key = v_item_key
  for update;

  v_after := v_before + p_delta;
  if v_after < 0 then
    raise exception using errcode='P1063', message='INSUFFICIENT_ITEM';
  end if;

  update public.sd_user_item_balances
  set quantity = v_after,
      lifetime_acquired = v_acquired + case when p_delta > 0 then p_delta else 0 end,
      lifetime_spent = v_spent + case when p_delta < 0 then -p_delta else 0 end,
      updated_at = now()
  where user_id = p_user_id
    and item_key = v_item_key;

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'event_id', v_event_id,
    'item_key', v_item_key,
    'delta', p_delta,
    'quantity_before', v_before,
    'quantity_after', v_after,
    'lifetime_acquired', v_acquired + case when p_delta > 0 then p_delta else 0 end,
    'lifetime_spent', v_spent + case when p_delta < 0 then -p_delta else 0 end
  );

  insert into public.sd_item_events(
    event_id,user_id,item_key,delta,quantity_before,quantity_after,
    source_app,event_type,metadata,result
  ) values(
    v_event_id,p_user_id,v_item_key,p_delta,v_before,v_after,
    v_source_app,v_event_type,p_metadata,v_result
  );

  return v_result;
end;
$$;

create or replace function private.ensure_sd_miner_common_balances(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then return; end if;
  insert into public.sd_user_item_balances(user_id,item_key)
  select p_user_id, c.item_key
  from public.sd_item_catalog c
  where c.source_app='sd-miner'
    and c.active
  on conflict(user_id,item_key) do nothing;
end;
$$;

revoke all on function private.apply_sd_item_delta_impl(uuid,text,text,bigint,text,text,jsonb)
  from public, anon, authenticated;
revoke all on function private.ensure_sd_miner_common_balances(uuid)
  from public, anon, authenticated;

-- One-time cutover. Existing miner current quantity and lifetime acquired values are
-- copied exactly once. ON CONFLICT DO NOTHING prevents a later re-run from restoring
-- items that were legitimately spent after the cutover.
insert into public.sd_user_item_balances(
  user_id,item_key,quantity,lifetime_acquired,lifetime_spent
)
select
  i.user_id,
  private.sd_miner_v3_resource_key(i.ore_key),
  i.quantity,
  greatest(i.acquired_count,i.quantity),
  greatest(i.acquired_count-i.quantity,0)
from public.sd_miner_inventory i
where private.sd_miner_v3_resource_key(i.ore_key) is not null
on conflict(user_id,item_key) do nothing;

insert into public.sd_item_events(
  event_id,user_id,item_key,delta,quantity_before,quantity_after,
  source_app,event_type,metadata,result
)
select
  'migration:miner-v2:' || i.user_id::text || ':' || i.ore_key,
  i.user_id,
  private.sd_miner_v3_resource_key(i.ore_key),
  i.quantity,
  0,
  i.quantity,
  'sd-migration',
  'miner_inventory_cutover',
  pg_catalog.jsonb_build_object('legacy_ore_key',i.ore_key,'legacy_acquired_count',i.acquired_count),
  pg_catalog.jsonb_build_object(
    'ok',true,'duplicate',false,
    'event_id','migration:miner-v2:' || i.user_id::text || ':' || i.ore_key,
    'item_key',private.sd_miner_v3_resource_key(i.ore_key),
    'delta',i.quantity,'quantity_before',0,'quantity_after',i.quantity,
    'migration',true
  )
from public.sd_miner_inventory i
where i.quantity > 0
  and private.sd_miner_v3_resource_key(i.ore_key) is not null
on conflict(event_id) do nothing;

comment on table public.sd_miner_inventory is
  'Legacy miner compatibility/history snapshot. Current stackable quantity authority moved to sd_user_item_balances in Chapter 4-3.';
comment on table public.sd_item_catalog is
  'Shared SD item identity catalog. Client roles are read-only; prices/economy rules remain in the authoritative source system.';
comment on table public.sd_user_item_balances is
  'Server-authoritative stackable item balances and lifetime counters. Direct client DML is denied.';
comment on table public.sd_item_events is
  'Exact-once shared item mutation journal. Every trusted gameplay quantity delta must use a unique event_id.';

create or replace function public.get_my_sd_item_inventory()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_items jsonb;
begin
  if v_user is null then
    raise exception using errcode='P1001', message='AUTH_REQUIRED';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'item_key',c.item_key,
        'display_name',c.display_name,
        'item_kind',c.item_kind,
        'category',c.category,
        'quantity',coalesce(b.quantity,0),
        'lifetime_acquired',coalesce(b.lifetime_acquired,0),
        'lifetime_spent',coalesce(b.lifetime_spent,0),
        'transferable',c.transferable,
        'source_app',c.source_app,
        'active',c.active
      ) order by c.item_key
    ),
    '[]'::jsonb
  ) into v_items
  from public.sd_item_catalog c
  left join public.sd_user_item_balances b
    on b.user_id=v_user and b.item_key=c.item_key;

  return pg_catalog.jsonb_build_object(
    'ok',true,
    'authority','sd-item-v1',
    'user_id',v_user,
    'items',v_items
  );
end;
$$;

revoke execute on function public.get_my_sd_item_inventory() from public, anon;
grant execute on function public.get_my_sd_item_inventory() to authenticated;

create or replace function private.refresh_sd_miner_achievements(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.sd_miner_accounts%rowtype;
  v_kinds bigint := 0;
begin
  if p_user_id is null then return; end if;
  perform private.sd_miner_ensure_account(p_user_id);
  perform private.ensure_sd_miner_common_balances(p_user_id);
  select * into a from public.sd_miner_accounts where user_id=p_user_id;

  select count(*) into v_kinds
  from public.sd_user_item_balances b
  join public.sd_item_catalog c on c.item_key=b.item_key
  where b.user_id=p_user_id
    and c.source_app='sd-miner'
    and coalesce(c.metadata->>'legacy_ore_key','') in ('stone','copper','iron','emerald','diamond')
    and b.lifetime_acquired>0;

  perform private.upsert_sd_authoritative_achievement(p_user_id,'miner-01',a.total_mined,1000,pg_catalog.jsonb_build_object('authority','miner-server','metric','total_mined'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'miner-02',a.total_sales_krw,1000000,pg_catalog.jsonb_build_object('authority','miner-server','metric','sales_krw'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'miner-03',a.total_sales_krw,5000000,pg_catalog.jsonb_build_object('authority','miner-server','metric','sales_krw'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'miner-04',a.total_sales_krw,10000000,pg_catalog.jsonb_build_object('authority','miner-server','metric','sales_krw'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'miner-05',a.total_mined,10000,pg_catalog.jsonb_build_object('authority','miner-server','metric','total_mined'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'miner-06',case when a.highest_tier_found then 1 else 0 end,1,pg_catalog.jsonb_build_object('authority','miner-server','metric','diamond_found'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'miner-07',a.max_diamond_streak,2,pg_catalog.jsonb_build_object('authority','miner-server','metric','consecutive_diamond','target',2));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'miner-08',v_kinds,5,pg_catalog.jsonb_build_object('authority','miner-server','metric','ore_kinds','target',5,'inventory_authority','sd-item-v1'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'miner-09',a.total_sales_krw,100000000,pg_catalog.jsonb_build_object('authority','miner-server','metric','sales_krw'));
end;
$$;
revoke all on function private.refresh_sd_miner_achievements(uuid) from public, anon, authenticated;

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
  perform private.ensure_sd_miner_common_balances(v_user);
  select * into a from public.sd_miner_accounts where user_id=v_user;

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
    'config',pg_catalog.jsonb_build_object(
      'mine_key','surface',
      'cycle_ms',5000,
      'max_parallel_jobs',1,
      'offline_queue_limit',1,
      'economy_stage','provisional_ch4_2_pending_ch4_4',
      'item_authority','sd-item-v1',
      'ores',pg_catalog.jsonb_build_array(
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
  v_item_key text;
  v_price bigint;
  v_item jsonb;
  v_q bigint;
  v_result jsonb;
begin
  v_device_id := private.assert_sd_miner_device_v3(v_user,p_device_key,p_device_secret);
  if p_request_id is null or p_job_id is null then
    raise exception using errcode='P1007', message='REQUEST_ID_REQUIRED';
  end if;

  v_input := pg_catalog.jsonb_build_object('job_id',p_job_id);
  v_replay := private.sd_miner_action_replay(v_user,p_request_id,'v3_claim',v_input);
  if v_replay is not null then return v_replay; end if;

  perform private.sd_miner_ensure_account(v_user);
  perform private.ensure_sd_miner_common_balances(v_user);
  select * into a from public.sd_miner_accounts where user_id=v_user for update;
  select * into j from public.sd_miner_jobs
    where job_id=p_job_id and user_id=v_user for update;

  if j.job_id is null then raise exception using errcode='P1016',message='MINER_JOB_NOT_FOUND'; end if;
  if j.status='claimed' then raise exception using errcode='P1055',message='MINER_JOB_ALREADY_CLAIMED'; end if;
  if j.status<>'active' then raise exception using errcode='P1056',message='MINER_JOB_NOT_ACTIVE'; end if;
  if v_now<j.ready_at then raise exception using errcode='P1053',message='MINER_JOB_NOT_READY'; end if;

  v_ore := private.sd_miner_roll_ore();
  v_item_key := private.sd_miner_v3_resource_key(v_ore);
  v_price := private.sd_miner_ore_price(v_ore);
  v_item := private.apply_sd_item_delta_impl(
    v_user,p_request_id::text,v_item_key,1,'sd_miner_v3','mine_claim',
    pg_catalog.jsonb_build_object('job_id',p_job_id,'ore_key',v_ore,'miner_access_device_id',v_device_id,'miner_api_version','v3')
  );
  v_q := (v_item->>'quantity_after')::bigint;

  update public.sd_miner_accounts
  set total_mined=total_mined+1,
      last_mine_at=v_now,
      highest_tier_found=highest_tier_found or v_ore='diamond',
      current_diamond_streak=case when v_ore='diamond' then current_diamond_streak+1 else 0 end,
      max_diamond_streak=greatest(max_diamond_streak,case when v_ore='diamond' then current_diamond_streak+1 else 0 end),
      updated_at=now()
  where user_id=v_user returning * into a;

  update public.sd_miner_jobs
  set status='claimed',claimed_at=v_now,claim_request_id=p_request_id,
      result_ore_key=v_ore,result_quantity=1,updated_at=now()
  where job_id=p_job_id;

  perform private.refresh_sd_miner_achievements(v_user);

  v_result := pg_catalog.jsonb_build_object(
    'ok',true,'authority','server-v3','inventory_authority','sd-item-v1',
    'job_id',p_job_id,'status','claimed','ore_key',v_ore,'resource_key',v_item_key,
    'ore_name',case v_ore when 'stone' then '돌' when 'copper' then '구리' when 'iron' then '철' when 'emerald' then '에메랄드' else '다이아몬드' end,
    'quantity_gained',1,'inventory_quantity',v_q,'current_sale_price',v_price,
    'total_mined',a.total_mined,'max_diamond_streak',a.max_diamond_streak,
    'claimed_at',v_now,'access_device_id',v_device_id,'item_event_id',p_request_id::text
  );
  return private.sd_miner_save_action(v_user,p_request_id,'v3_claim',v_input,v_result);
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
  v_ore text := lower(trim(coalesce(p_ore_key,'')));
  v_item_key text;
  v_qty bigint := coalesce(p_quantity,0);
  v_owned bigint;
  v_price bigint;
  v_amount bigint;
  v_input jsonb;
  v_replay jsonb;
  v_item jsonb;
  v_wallet jsonb;
  v_result jsonb;
  a public.sd_miner_accounts%rowtype;
begin
  v_device_id := private.assert_sd_miner_device_v3(v_user,p_device_key,p_device_secret);
  if p_request_id is null then raise exception using errcode='P1007',message='REQUEST_ID_REQUIRED'; end if;
  if v_ore not in ('stone','copper','iron','emerald','diamond') or v_qty<=0 or v_qty>1000000000 then
    raise exception using errcode='P1010',message='INVALID_MINER_SALE';
  end if;

  v_input := pg_catalog.jsonb_build_object('ore_key',v_ore,'quantity',v_qty);
  v_replay := private.sd_miner_action_replay(v_user,p_request_id,'v3_sell',v_input);
  if v_replay is not null then return v_replay; end if;

  perform private.sd_miner_ensure_account(v_user);
  perform private.ensure_sd_miner_common_balances(v_user);
  select * into a from public.sd_miner_accounts where user_id=v_user for update;
  v_item_key := private.sd_miner_v3_resource_key(v_ore);

  select b.quantity into v_owned
  from public.sd_user_item_balances b
  where b.user_id=v_user and b.item_key=v_item_key
  for update;
  if coalesce(v_owned,0)<v_qty then
    raise exception using errcode='P1013',message='INSUFFICIENT_ORE';
  end if;

  v_price := private.sd_miner_ore_price(v_ore);
  v_amount := v_price*v_qty;
  if v_amount<=0 or v_amount>1000000000000 then
    raise exception using errcode='P1011',message='MINER_SALE_TOO_LARGE';
  end if;

  v_item := private.apply_sd_item_delta_impl(
    v_user,p_request_id::text,v_item_key,-v_qty,'sd_miner_v3','sell',
    pg_catalog.jsonb_build_object('ore_key',v_ore,'quantity',v_qty,'unit_price',v_price,'miner_access_device_id',v_device_id,'miner_api_version','v3')
  );

  v_wallet := sd_core_private.apply_server_wallet_delta_impl(
    v_user,p_request_id,'miner_sell_v3',v_amount,'sd_miner_v3',
    'SD광산 · ' || case v_ore when 'stone' then '돌' when 'copper' then '구리' when 'iron' then '철' when 'emerald' then '에메랄드' else '다이아몬드' end || ' 판매',
    pg_catalog.jsonb_build_object('ore_key',v_ore,'resource_key',v_item_key,'quantity',v_qty,'unit_price',v_price,'miner_access_device_id',v_device_id,'miner_api_version','v3','item_event_id',p_request_id::text)
  );

  update public.sd_miner_accounts
  set total_sales_krw=total_sales_krw+v_amount,updated_at=now()
  where user_id=v_user returning * into a;
  perform private.refresh_sd_miner_achievements(v_user);

  v_result := pg_catalog.jsonb_build_object(
    'ok',true,'authority','server-v3','inventory_authority','sd-item-v1',
    'ore_key',v_ore,'resource_key',v_item_key,'quantity',v_qty,
    'unit_price',v_price,'amount',v_amount,
    'remaining',(v_item->>'quantity_after')::bigint,
    'total_sales_krw',a.total_sales_krw,
    'balance_after',(v_wallet->>'balance_after')::bigint,
    'duplicate',false,'item_event_id',p_request_id::text
  );
  return private.sd_miner_save_action(v_user,p_request_id,'v3_sell',v_input,v_result);
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
  v_items jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_item_result jsonb;
  v_wallet jsonb;
  v_result jsonb;
  a public.sd_miner_accounts%rowtype;
  r record;
begin
  v_device_id := private.assert_sd_miner_device_v3(v_user,p_device_key,p_device_secret);
  if p_request_id is null then raise exception using errcode='P1007',message='REQUEST_ID_REQUIRED'; end if;
  v_replay := private.sd_miner_action_replay(v_user,p_request_id,'v3_sell_all','{}'::jsonb);
  if v_replay is not null then return v_replay; end if;

  perform private.sd_miner_ensure_account(v_user);
  perform private.ensure_sd_miner_common_balances(v_user);
  select * into a from public.sd_miner_accounts where user_id=v_user for update;

  for r in
    select b.item_key,b.quantity,c.metadata->>'legacy_ore_key' as ore_key
    from public.sd_user_item_balances b
    join public.sd_item_catalog c on c.item_key=b.item_key
    where b.user_id=v_user
      and c.source_app='sd-miner'
      and coalesce(c.metadata->>'legacy_ore_key','') in ('stone','copper','iron','emerald','diamond')
    order by b.item_key
    for update of b
  loop
    if r.quantity>0 then
      v_amount := v_amount + r.quantity*private.sd_miner_ore_price(r.ore_key);
      v_items := v_items || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'item_key',r.item_key,'ore_key',r.ore_key,'quantity',r.quantity,
        'unit_price',private.sd_miner_ore_price(r.ore_key)
      ));
    end if;
  end loop;

  if v_amount<=0 then raise exception using errcode='P1031',message='MINER_NOTHING_TO_SELL'; end if;
  if v_amount>1000000000000 then raise exception using errcode='P1011',message='MINER_SALE_TOO_LARGE'; end if;

  for v_entry in select value from pg_catalog.jsonb_array_elements(v_items)
  loop
    v_item_result := private.apply_sd_item_delta_impl(
      v_user,
      p_request_id::text || ':' || (v_entry->>'item_key'),
      v_entry->>'item_key',
      -(v_entry->>'quantity')::bigint,
      'sd_miner_v3','sell_all',
      pg_catalog.jsonb_build_object(
        'ore_key',v_entry->>'ore_key','quantity',(v_entry->>'quantity')::bigint,
        'unit_price',(v_entry->>'unit_price')::bigint,'miner_access_device_id',v_device_id,
        'miner_api_version','v3','request_id',p_request_id
      )
    );
  end loop;

  v_wallet := sd_core_private.apply_server_wallet_delta_impl(
    v_user,p_request_id,'miner_sell_all_v3',v_amount,'sd_miner_v3','SD광산 · 광석 전체 판매',
    pg_catalog.jsonb_build_object('miner_access_device_id',v_device_id,'miner_api_version','v3','inventory_authority','sd-item-v1','sold_items',v_items)
  );

  update public.sd_miner_accounts
  set total_sales_krw=total_sales_krw+v_amount,updated_at=now()
  where user_id=v_user returning * into a;
  perform private.refresh_sd_miner_achievements(v_user);

  v_result := pg_catalog.jsonb_build_object(
    'ok',true,'authority','server-v3','inventory_authority','sd-item-v1',
    'amount',v_amount,'sold_items',v_items,'total_sales_krw',a.total_sales_krw,
    'balance_after',(v_wallet->>'balance_after')::bigint,'duplicate',false
  );
  return private.sd_miner_save_action(v_user,p_request_id,'v3_sell_all','{}'::jsonb,v_result);
end;
$$;

revoke execute on function public.sd_miner_v3_get_state(text,text) from public, anon;
revoke execute on function public.sd_miner_v3_claim(uuid,uuid,text,text) from public, anon;
revoke execute on function public.sd_miner_v3_sell(text,bigint,uuid,text,text) from public, anon;
revoke execute on function public.sd_miner_v3_sell_all(uuid,text,text) from public, anon;
grant execute on function public.sd_miner_v3_get_state(text,text) to authenticated;
grant execute on function public.sd_miner_v3_claim(uuid,uuid,text,text) to authenticated;
grant execute on function public.sd_miner_v3_sell(text,bigint,uuid,text,text) to authenticated;
grant execute on function public.sd_miner_v3_sell_all(uuid,text,text) to authenticated;

commit;
