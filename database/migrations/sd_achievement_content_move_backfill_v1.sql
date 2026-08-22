begin;

-- Chapter 3-4: gated Flea PC -> STA producer cutover + legacy backfill.
-- Dependencies: Chapter 3-1 identity, 3-2 classification, 3-3 Core event/stat registry.
-- Production deployment is NOT performed by this migration source commit.
-- The legacy Flea PC server tables remain a compatibility source, but the 13 moved
-- achievement identities are evaluated through official.sta Core stats after cutover.

-- Fail closed if the exact Chapter 3-2 move set or the reviewed legacy collection
-- baseline has drifted before this migration is applied.
do $$
declare
  v_move_codes text[];
  v_collection_target bigint;
begin
  if to_regclass('public.sd_achievement_producer_bindings') is null
     or to_regclass('public.sd_achievement_core_stats') is null
     or to_regclass('public.sd_achievement_event_ledger') is null then
    raise exception 'Chapter 3-4 requires Chapter 3-3 Core achievement registry first';
  end if;

  if to_regclass('public.sd_flea_pc_accounts') is null
     or to_regclass('public.sd_flea_pc_item_catalog') is null
     or to_regclass('public.sd_flea_pc_item_counts') is null then
    raise exception 'Chapter 3-4 requires the server-authoritative Flea PC compatibility source';
  end if;

  select array_agg(c.permanent_code order by c.permanent_code)
    into v_move_codes
    from public.sd_achievement_migration_classification c
   where c.disposition='move_producer';

  if v_move_codes is distinct from array[
    'flea-01','flea-02','flea-03','flea-04','flea-08','flea-09','flea-10',
    'flea-11','flea-14','flea-15','flea-16','flea-17','flea-18'
  ]::text[] then
    raise exception 'Chapter 3-4 move set drifted from the reviewed 13-code Flea PC -> STA classification';
  end if;

  select count(*) into v_collection_target
    from public.sd_flea_pc_item_catalog
   where collection_required;

  if v_collection_target <> 35 then
    raise exception 'Chapter 3-4 reviewed Flea collection baseline drifted: expected 35, got %', v_collection_target;
  end if;
end $$;

-- Freeze the exact legacy collection universe at cutover. Future Flea/STA catalog
-- additions must not silently change the permanent flea-11 meaning or target.
create table public.sd_achievement_sta_flea_legacy_collection_keys (
  catalog_key text primary key,
  migration_version text not null default 'chapter-3-4-v1',
  captured_at timestamptz not null default now()
);

insert into public.sd_achievement_sta_flea_legacy_collection_keys(catalog_key)
select item_key
  from public.sd_flea_pc_item_catalog
 where collection_required
 order by item_key;

alter table public.sd_achievement_sta_flea_legacy_collection_keys enable row level security;
revoke all on table public.sd_achievement_sta_flea_legacy_collection_keys from public, anon, authenticated;
create policy sd_achievement_sta_flea_legacy_collection_keys_client_deny_v1
  on public.sd_achievement_sta_flea_legacy_collection_keys
  for all to anon, authenticated using (false) with check (false);

do $$
begin
  if (select count(*) from public.sd_achievement_sta_flea_legacy_collection_keys) <> 35 then
    raise exception 'Chapter 3-4 frozen Flea collection baseline must contain exactly 35 keys';
  end if;
end $$;

-- Common STA-owned statistics for the moved permanent achievement identities.
insert into public.sd_achievement_stat_registry(
  stat_key,producer_key,aggregation_mode,allow_negative,registry_version,active,description
) values
  ('sta.flea.bank_successes','official.sta','max',false,'chapter-3-4-v1',true,'Legacy-compatible STA bank/raid successes.'),
  ('sta.flea.red_diamond_found','official.sta','flag',false,'chapter-3-4-v1',true,'Legacy-compatible STA rare red-diamond discovery flag.'),
  ('sta.flea.boxes_looted','official.sta','max',false,'chapter-3-4-v1',true,'Legacy-compatible STA loot boxes opened.'),
  ('sta.flea.collection_types','official.sta','max',false,'chapter-3-4-v1',true,'Count of reviewed legacy collection item types ever acquired.'),
  ('sta.flea.bank_failures','official.sta','max',false,'chapter-3-4-v1',true,'Legacy-compatible STA failed bank/raid attempts.'),
  ('sta.flea.highest_tier_found','official.sta','flag',false,'chapter-3-4-v1',true,'Legacy-compatible STA highest-tier loot discovery flag.'),
  ('sta.flea.lowest_only_boxes','official.sta','max',false,'chapter-3-4-v1',true,'Legacy-compatible lowest-tier-only loot box count.'),
  ('sta.flea.max_same_item_acquired','official.sta','max',false,'chapter-3-4-v1',true,'Maximum acquired count of one legacy loot item.'),
  ('sta.flea.max_top_speed_distance_m','official.sta','max',false,'chapter-3-4-v1',true,'Maximum accepted top-speed chase distance in metres.')
on conflict (stat_key) do nothing;

do $$
declare v_bad bigint;
begin
  select count(*) into v_bad
    from public.sd_achievement_stat_registry s
   where s.stat_key in (
     'sta.flea.bank_successes','sta.flea.red_diamond_found','sta.flea.boxes_looted',
     'sta.flea.collection_types','sta.flea.bank_failures','sta.flea.highest_tier_found',
     'sta.flea.lowest_only_boxes','sta.flea.max_same_item_acquired','sta.flea.max_top_speed_distance_m'
   )
     and (
       s.producer_key <> 'official.sta'
       or s.allow_negative
       or not s.active
       or s.aggregation_mode is distinct from case s.stat_key
          when 'sta.flea.red_diamond_found' then 'flag'
          when 'sta.flea.highest_tier_found' then 'flag'
          else 'max'
        end
     );
  if v_bad <> 0 then
    raise exception 'Chapter 3-4 STA Flea stat registry conflicts with an existing definition';
  end if;
end $$;

-- Strengthen the 3-3 binding guard: a stat-threshold binding may only consume a
-- stat owned by the same producer. This prevents future server-side registry drift.
create or replace function private.enforce_sd_achievement_producer_binding_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_code text;
  v_class public.sd_achievement_migration_classification%rowtype;
  v_producer_content text;
  v_stat_producer text;
begin
  if tg_op='DELETE' then
    raise exception using errcode='P3320', message='ACHIEVEMENT_PRODUCER_BINDING_DELETE_FORBIDDEN';
  end if;

  if tg_op='UPDATE' then
    if new.achievement_id is distinct from old.achievement_id
       or new.permanent_code is distinct from old.permanent_code then
      raise exception using errcode='P3321', message='ACHIEVEMENT_PRODUCER_BINDING_IDENTITY_IMMUTABLE';
    end if;
  end if;

  select a.code into v_code
    from public.sd_achievements a
   where a.id=new.achievement_id;
  if not found or new.permanent_code is distinct from v_code then
    raise exception using errcode='P3322', message='ACHIEVEMENT_PRODUCER_BINDING_IDENTITY_MISMATCH';
  end if;

  select * into v_class
    from public.sd_achievement_migration_classification c
   where c.achievement_id=new.achievement_id;
  if not found then
    raise exception using errcode='P3323', message='ACHIEVEMENT_PRODUCER_BINDING_CLASSIFICATION_MISSING';
  end if;

  if new.source_content_key is distinct from v_class.current_content_key
     or new.target_content_key is distinct from v_class.target_content_key then
    raise exception using errcode='P3324', message='ACHIEVEMENT_PRODUCER_BINDING_CLASSIFICATION_MISMATCH';
  end if;

  select p.content_key into v_producer_content
    from public.sd_achievement_producer_registry p
   where p.producer_key=new.producer_key;
  if not found or v_producer_content is distinct from new.target_content_key then
    raise exception using errcode='P3325', message='ACHIEVEMENT_PRODUCER_BINDING_TARGET_MISMATCH';
  end if;

  if v_class.disposition='move_producer' and new.binding_state not in ('planned_move','active') then
    raise exception using errcode='P3326', message='ACHIEVEMENT_PRODUCER_MOVE_STATE_INVALID';
  elsif v_class.disposition='retain' and new.binding_state not in ('shadow','active') then
    raise exception using errcode='P3327', message='ACHIEVEMENT_PRODUCER_RETAIN_STATE_INVALID';
  elsif v_class.disposition='legacy' and new.binding_state<>'legacy' then
    raise exception using errcode='P3328', message='ACHIEVEMENT_PRODUCER_LEGACY_STATE_INVALID';
  elsif v_class.disposition='successor' and new.binding_state not in ('shadow','active') then
    raise exception using errcode='P3329', message='ACHIEVEMENT_PRODUCER_SUCCESSOR_STATE_INVALID';
  end if;

  if new.evaluation_mode='stat_threshold' then
    select s.producer_key into v_stat_producer
      from public.sd_achievement_stat_registry s
     where s.stat_key=new.stat_key and s.active;
    if not found or v_stat_producer is distinct from new.producer_key then
      raise exception using errcode='P3330', message='ACHIEVEMENT_PRODUCER_BINDING_STAT_OWNER_MISMATCH';
    end if;
  elsif new.stat_key is not null or new.target_value is not null then
    raise exception using errcode='P3331', message='ACHIEVEMENT_PRODUCER_BINDING_NONSTAT_SHAPE_INVALID';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_sd_achievement_producer_binding_v1() from public, anon, authenticated;

-- Activate exactly the 13 reviewed move bindings. UUID/code and the 3-2
-- classification are not rewritten.
update public.sd_achievement_producer_bindings
   set binding_state='active',
       evaluation_mode='stat_threshold',
       stat_key=case permanent_code
         when 'flea-01' then 'sta.flea.bank_successes'
         when 'flea-02' then 'sta.flea.bank_successes'
         when 'flea-03' then 'sta.flea.bank_successes'
         when 'flea-04' then 'sta.flea.red_diamond_found'
         when 'flea-08' then 'sta.flea.boxes_looted'
         when 'flea-09' then 'sta.flea.boxes_looted'
         when 'flea-10' then 'sta.flea.boxes_looted'
         when 'flea-11' then 'sta.flea.collection_types'
         when 'flea-14' then 'sta.flea.bank_failures'
         when 'flea-15' then 'sta.flea.highest_tier_found'
         when 'flea-16' then 'sta.flea.lowest_only_boxes'
         when 'flea-17' then 'sta.flea.max_same_item_acquired'
         when 'flea-18' then 'sta.flea.max_top_speed_distance_m'
       end,
       target_value=case permanent_code
         when 'flea-01' then 1
         when 'flea-02' then 10
         when 'flea-03' then 100
         when 'flea-04' then 1
         when 'flea-08' then 100
         when 'flea-09' then 500
         when 'flea-10' then 1000
         when 'flea-11' then 35
         when 'flea-14' then 10
         when 'flea-15' then 1
         when 'flea-16' then 1
         when 'flea-17' then 100
         when 'flea-18' then 500
       end,
       registry_version='chapter-3-4-v1',
       notes='Chapter 3-4 active producer cutover. Permanent Flea achievement identity preserved; official.sta owns evaluation with server-authoritative legacy backfill.',
       updated_at=now()
 where permanent_code in (
   'flea-01','flea-02','flea-03','flea-04','flea-08','flea-09','flea-10',
   'flea-11','flea-14','flea-15','flea-16','flea-17','flea-18'
 );

do $$
begin
  if (select count(*) from public.sd_achievement_producer_bindings
       where binding_state='active' and producer_key='official.sta'
         and permanent_code in (
           'flea-01','flea-02','flea-03','flea-04','flea-08','flea-09','flea-10',
           'flea-11','flea-14','flea-15','flea-16','flea-17','flea-18'
         )) <> 13 then
    raise exception 'Chapter 3-4 failed to activate all 13 reviewed Flea PC -> STA bindings';
  end if;
end $$;

-- No authenticated achievement event ingress is opened by the content move.
-- Unreviewed ZIPs and clients therefore still cannot mint official achievement stats.
update public.sd_achievement_producer_registry
   set ingress_mode='internal_only',
       validator_key=null,
       registry_version='chapter-3-4-v1',
       notes='Official STA server authority. Chapter 3-4 also owns the reviewed Flea PC legacy compatibility adapter; client event submission remains disabled.',
       updated_at=now()
 where producer_key='official.sta';

update public.sd_achievement_event_type_registry
   set client_submission_allowed=false,
       validator_key=null,
       updated_at=now()
 where event_type='sta.operation.accepted' and producer_key='official.sta';

-- Evaluate active stat-threshold bindings without rewriting an existing player row
-- unless the Core stat actually advances it or newly proves its unlock.
create or replace function private.evaluate_sd_achievement_stat_bindings_v1(
  p_user_id uuid,
  p_stat_key text
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_stat public.sd_achievement_core_stats%rowtype;
  v_binding record;
  v_progress public.sd_achievement_progress%rowtype;
  v_changed integer:=0;
begin
  if p_user_id is null or p_stat_key is null then
    return 0;
  end if;

  select * into v_stat
    from public.sd_achievement_core_stats s
   where s.user_id=p_user_id and s.stat_key=p_stat_key;
  if not found then
    return 0;
  end if;

  for v_binding in
    select b.permanent_code,b.producer_key,b.target_value,b.registry_version
      from public.sd_achievement_producer_bindings b
     where b.binding_state='active'
       and b.evaluation_mode='stat_threshold'
       and b.stat_key=p_stat_key
     order by b.permanent_code
  loop
    select * into v_progress
      from public.sd_achievement_progress p
     where p.user_id=p_user_id and p.achievement_id=v_binding.permanent_code;

    if not found then
      if v_stat.value <= 0 and v_stat.value < v_binding.target_value then
        continue;
      end if;
    else
      if v_stat.value <= v_progress.current_value
         and (v_progress.unlocked or v_stat.value < v_binding.target_value) then
        continue;
      end if;
    end if;

    perform private.upsert_sd_authoritative_achievement(
      p_user_id,
      v_binding.permanent_code,
      v_stat.value,
      v_binding.target_value,
      jsonb_build_object(
        'authority','achievement-core-stat',
        'producer_key',v_binding.producer_key,
        'stat_key',p_stat_key,
        'registry_version',v_binding.registry_version,
        'source_event_id',v_stat.source_event_id
      )
    );
    v_changed:=v_changed+1;
  end loop;

  return v_changed;
end;
$$;

revoke all on function private.evaluate_sd_achievement_stat_bindings_v1(uuid,text) from public, anon, authenticated;

-- Every newly applied event/stat pair evaluates its active bindings in the same
-- transaction. Any evaluator failure therefore rolls back the event/stat write too.
create or replace function private.evaluate_sd_achievement_stat_application_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  perform private.evaluate_sd_achievement_stat_bindings_v1(new.user_id,new.stat_key);
  return new;
end;
$$;

revoke all on function private.evaluate_sd_achievement_stat_application_trigger_v1() from public, anon, authenticated;

drop trigger if exists trg_sd_achievement_stat_application_evaluate_v1
  on public.sd_achievement_stat_event_applications;
create trigger trg_sd_achievement_stat_application_evaluate_v1
  after insert on public.sd_achievement_stat_event_applications
  for each row execute function private.evaluate_sd_achievement_stat_application_trigger_v1();

-- Server-owned compatibility adapter. It does not trust client progress/unlocked,
-- client metrics, local SQLite, or extension-supplied reward data. The source
-- evidence is reconstructed from the authoritative Flea PC server tables.
create or replace function private.sync_sd_sta_flea_legacy_v1(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_a public.sd_flea_pc_accounts%rowtype;
  v_collection bigint:=0;
  v_max_same bigint:=0;
  v_normalized jsonb;
  v_submitted jsonb;
  v_stats jsonb;
  v_event_id text;
begin
  if p_user_id is null then
    raise exception using errcode='P1001', message='AUTH_REQUIRED';
  end if;

  select * into v_a
    from public.sd_flea_pc_accounts a
   where a.user_id=p_user_id;
  if not found then
    return jsonb_build_object('accepted',false,'duplicate',false,'reason','NO_LEGACY_FLEA_SERVER_STATE');
  end if;

  select count(*) into v_collection
    from public.sd_flea_pc_item_counts c
    join public.sd_achievement_sta_flea_legacy_collection_keys k
      on k.catalog_key=c.catalog_key
   where c.user_id=p_user_id and c.acquired_count>0;

  select coalesce(max(c.acquired_count),0) into v_max_same
    from public.sd_flea_pc_item_counts c
   where c.user_id=p_user_id;

  v_normalized:=jsonb_build_object(
    'migration','flea-pc-to-sta-v1',
    'legacy_source','server-flea-pc-authority',
    'bank_successes',greatest(0,coalesce(v_a.bank_successes,0)),
    'red_diamond_found',coalesce(v_a.red_diamond_found,false),
    'boxes_looted',greatest(0,coalesce(v_a.boxes_looted,0)),
    'collection_types',greatest(0,v_collection),
    'collection_baseline_types',35,
    'bank_failures',greatest(0,coalesce(v_a.bank_failures,0)),
    'highest_tier_found',coalesce(v_a.highest_tier_found,false),
    'lowest_only_boxes',greatest(0,coalesce(v_a.lowest_only_boxes,0)),
    'max_same_item_acquired',greatest(0,v_max_same),
    'max_top_speed_distance_m',greatest(0,coalesce(v_a.max_top_speed_distance_m,0))
  );

  v_event_id:='sta:flea:legacy:'||replace(p_user_id::text,'-','')||':'||md5(v_normalized::text);
  v_submitted:=jsonb_build_object(
    'migration','flea-pc-to-sta-v1',
    'server_snapshot',v_normalized
  );

  v_stats:=jsonb_build_array(
    jsonb_build_object('stat_key','sta.flea.bank_successes','value',v_normalized->>'bank_successes','metadata',jsonb_build_object('legacy_source','server-flea-pc-authority')),
    jsonb_build_object('stat_key','sta.flea.red_diamond_found','value',case when (v_normalized->>'red_diamond_found')::boolean then 1 else 0 end,'metadata',jsonb_build_object('legacy_source','server-flea-pc-authority')),
    jsonb_build_object('stat_key','sta.flea.boxes_looted','value',v_normalized->>'boxes_looted','metadata',jsonb_build_object('legacy_source','server-flea-pc-authority')),
    jsonb_build_object('stat_key','sta.flea.collection_types','value',v_normalized->>'collection_types','metadata',jsonb_build_object('legacy_source','server-flea-pc-authority','baseline_types',35)),
    jsonb_build_object('stat_key','sta.flea.bank_failures','value',v_normalized->>'bank_failures','metadata',jsonb_build_object('legacy_source','server-flea-pc-authority')),
    jsonb_build_object('stat_key','sta.flea.highest_tier_found','value',case when (v_normalized->>'highest_tier_found')::boolean then 1 else 0 end,'metadata',jsonb_build_object('legacy_source','server-flea-pc-authority')),
    jsonb_build_object('stat_key','sta.flea.lowest_only_boxes','value',v_normalized->>'lowest_only_boxes','metadata',jsonb_build_object('legacy_source','server-flea-pc-authority')),
    jsonb_build_object('stat_key','sta.flea.max_same_item_acquired','value',v_normalized->>'max_same_item_acquired','metadata',jsonb_build_object('legacy_source','server-flea-pc-authority')),
    jsonb_build_object('stat_key','sta.flea.max_top_speed_distance_m','value',v_normalized->>'max_top_speed_distance_m','metadata',jsonb_build_object('legacy_source','server-flea-pc-authority'))
  );

  return private.accept_sd_achievement_event_v1(
    p_user_id,
    'official.sta',
    'sta.operation.accepted',
    v_event_id,
    'sta-expansion',
    v_submitted,
    v_normalized,
    v_stats,
    'sta-flea-legacy-server-state-v1',
    coalesce(v_a.updated_at,now())
  );
end;
$$;

revoke all on function private.sync_sd_sta_flea_legacy_v1(uuid) from public, anon, authenticated;

-- Compatibility call sites keep working, but they no longer directly unlock the
-- moved Flea identities. They feed the common official.sta Core stats instead.
create or replace function private.refresh_sd_flea_pc_achievements(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_user_id is null then return; end if;
  perform private.sync_sd_sta_flea_legacy_v1(p_user_id);
end;
$$;

revoke all on function private.refresh_sd_flea_pc_achievements(uuid) from public, anon, authenticated;

create or replace function private.refresh_sd_flea_game_achievements(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_user_id is null then return; end if;
  perform private.sync_sd_sta_flea_legacy_v1(p_user_id);
end;
$$;

revoke all on function private.refresh_sd_flea_game_achievements(uuid) from public, anon, authenticated;

-- One-time backfill from existing server-authoritative legacy rows. The event id is
-- a deterministic snapshot fingerprint, so retrying the migration-side sync is
-- duplicate-only. Existing higher progress/unlock/unlocked_at is never lowered.
do $$
declare r record;
begin
  for r in select a.user_id from public.sd_flea_pc_accounts a order by a.user_id loop
    perform private.sync_sd_sta_flea_legacy_v1(r.user_id);
  end loop;
end $$;

-- Final cutover invariants.
do $$
declare
  v_direct_writers bigint;
begin
  if exists (
    select 1 from public.sd_achievement_producer_registry p
     where p.producer_key='official.sta'
       and (p.ingress_mode<>'internal_only' or p.validator_key is not null)
  ) then
    raise exception 'Chapter 3-4 must not open authenticated STA achievement ingress';
  end if;

  if exists (
    select 1 from public.sd_achievement_event_type_registry e
     where e.event_type='sta.operation.accepted'
       and (e.client_submission_allowed or e.validator_key is not null)
  ) then
    raise exception 'Chapter 3-4 STA event type must remain client fail-closed';
  end if;

  select count(*) into v_direct_writers
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='private'
     and p.proname in ('refresh_sd_flea_pc_achievements','refresh_sd_flea_game_achievements')
     and pg_get_functiondef(p.oid) ~ 'flea-(01|02|03|04|08|09|10|11|14|15|16|17|18)';
  if v_direct_writers <> 0 then
    raise exception 'Chapter 3-4 legacy refresh functions still contain direct moved-achievement writers';
  end if;
end $$;

commit;
