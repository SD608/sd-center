\set ON_ERROR_STOP on

-- The migration performs the initial server-state backfill during apply.
do $$
declare
  v_bad bigint;
begin
  if (select count(*) from public.sd_achievement_sta_flea_legacy_collection_keys)<>35 then
    raise exception '3-4 regression: frozen legacy collection keys expected 35';
  end if;

  if (select count(*) from public.sd_achievement_stat_registry
       where producer_key='official.sta' and stat_key like 'sta.flea.%')<>9 then
    raise exception '3-4 regression: expected 9 STA Flea stats';
  end if;

  if (select count(*) from public.sd_achievement_producer_bindings
       where binding_state='active' and producer_key='official.sta'
         and permanent_code in (
           'flea-01','flea-02','flea-03','flea-04','flea-08','flea-09','flea-10',
           'flea-11','flea-14','flea-15','flea-16','flea-17','flea-18'
         ))<>13 then
    raise exception '3-4 regression: exact 13 move bindings are not active';
  end if;

  if exists(select 1 from public.sd_achievement_producer_bindings where binding_state='planned_move') then
    raise exception '3-4 regression: planned_move remained after cutover';
  end if;

  if (select count(*) from public.sd_achievement_producer_bindings where binding_state='active')<>13 then
    raise exception '3-4 regression: unexpected extra binding activated';
  end if;

  if not exists(
    select 1 from public.sd_achievement_producer_bindings
     where permanent_code='flea-11'
       and producer_key='official.sta'
       and source_content_key='flea_pc'
       and target_content_key='sta'
       and evaluation_mode='stat_threshold'
       and stat_key='sta.flea.collection_types'
       and target_value=35
  ) then
    raise exception '3-4 regression: flea-11 permanent identity/target binding drifted';
  end if;

  if exists(
    select 1 from public.sd_achievement_producer_registry
     where producer_key='official.sta'
       and (ingress_mode<>'internal_only' or validator_key is not null)
  ) or exists(
    select 1 from public.sd_achievement_event_type_registry
     where event_type='sta.operation.accepted'
       and (client_submission_allowed or validator_key is not null)
  ) then
    raise exception '3-4 regression: authenticated STA event ingress opened';
  end if;

  if (select count(*) from public.sd_achievement_event_ledger
       where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')<>1 then
    raise exception '3-4 regression: initial backfill expected exactly one event';
  end if;

  if (select count(*) from public.sd_achievement_stat_event_applications
       where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')<>9 then
    raise exception '3-4 regression: initial backfill expected 9 stat applications';
  end if;

  if (select count(*) from public.sd_achievement_core_stats
       where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and stat_key like 'sta.flea.%')<>9 then
    raise exception '3-4 regression: initial backfill expected 9 Core stats';
  end if;

  select count(*) into v_bad from (values
    ('flea-01',12::numeric,true,'2026-08-20T01:02:03Z'::timestamptz),
    ('flea-02',12::numeric,true,null::timestamptz),
    ('flea-03',150::numeric,true,'2026-08-19T09:08:07Z'::timestamptz),
    ('flea-04',1::numeric,true,null::timestamptz),
    ('flea-08',600::numeric,true,null::timestamptz),
    ('flea-09',600::numeric,true,null::timestamptz),
    ('flea-10',600::numeric,false,null::timestamptz),
    ('flea-11',35::numeric,true,null::timestamptz),
    ('flea-14',9::numeric,false,null::timestamptz),
    ('flea-15',1::numeric,true,null::timestamptz),
    ('flea-16',1::numeric,true,null::timestamptz),
    ('flea-17',100::numeric,true,null::timestamptz),
    ('flea-18',550::numeric,true,null::timestamptz)
  ) e(code,val,unl,old_time)
  left join public.sd_achievement_progress p
    on p.user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
   and p.achievement_id=e.code
  where p.achievement_id is null
     or p.current_value<>e.val
     or p.unlocked<>e.unl
     or (e.old_time is not null and p.unlocked_at is distinct from e.old_time);
  if v_bad<>0 then
    raise exception '3-4 regression: initial monotonic progress/unlock preservation mismatch rows=%',v_bad;
  end if;

  if exists(
    (select * from public.chapter34_before_catalog
     except
     select id,code,name,description,title_reward,sort_order,active,hidden,
            lineage_root_id,supersedes_achievement_id
       from public.sd_achievements)
    union all
    (select id,code,name,description,title_reward,sort_order,active,hidden,
            lineage_root_id,supersedes_achievement_id
       from public.sd_achievements
     except select * from public.chapter34_before_catalog)
  ) then
    raise exception '3-4 regression: permanent catalog identity/title changed';
  end if;

  if exists(
    (select * from public.chapter34_before_earned
     except select user_id,achievement_id,unlocked_at from public.sd_user_achievements)
    union all
    (select user_id,achievement_id,unlocked_at from public.sd_user_achievements
     except select * from public.chapter34_before_earned)
  ) then
    raise exception '3-4 regression: existing earned row/unlocked_at changed';
  end if;
end $$;

-- Same server snapshot must be duplicate-only.
do $$
declare r jsonb;
begin
  r:=private.sync_sd_sta_flea_legacy_v1('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  if not coalesce((r->>'duplicate')::boolean,false) then
    raise exception '3-4 regression: exact legacy snapshot retry was not duplicate-only: %',r;
  end if;
  if (select count(*) from public.sd_achievement_event_ledger
       where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')<>1 then
    raise exception '3-4 regression: duplicate snapshot created another event';
  end if;
end $$;

-- Future catalog additions cannot silently raise the permanent flea-11 target or
-- collection count because Chapter 3-4 froze the reviewed 35-key legacy universe.
insert into public.sd_flea_pc_item_catalog(item_key,collection_required)
values('future-item-36',true);
insert into public.sd_flea_pc_item_counts(user_id,catalog_key,acquired_count)
values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','future-item-36',1);

do $$
declare r jsonb;
begin
  r:=private.sync_sd_sta_flea_legacy_v1('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  if not coalesce((r->>'duplicate')::boolean,false) then
    raise exception '3-4 regression: future unrelated catalog item changed frozen legacy evidence';
  end if;
  if (select value from public.sd_achievement_core_stats
       where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
         and stat_key='sta.flea.collection_types')<>35 then
    raise exception '3-4 regression: frozen flea-11 collection stat drifted';
  end if;
end $$;

-- Advance the authoritative server state. The old compatibility refresh entry
-- point must now feed the common STA event/stat path rather than directly writing
-- moved achievements.
update public.sd_flea_pc_accounts
   set bank_successes=100,
       bank_failures=10,
       boxes_looted=1000,
       updated_at=now()
 where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select private.refresh_sd_flea_pc_achievements('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

do $$
begin
  if (select count(*) from public.sd_achievement_event_ledger
       where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')<>2 then
    raise exception '3-4 regression: changed server state did not create exactly one new event';
  end if;
  if (select count(*) from public.sd_achievement_stat_event_applications
       where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')<>18 then
    raise exception '3-4 regression: changed state expected 18 total stat applications';
  end if;
  if (select value from public.sd_achievement_core_stats
       where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
         and stat_key='sta.flea.bank_successes')<>100 then
    raise exception '3-4 regression: bank_successes Core stat mismatch';
  end if;
  if (select value from public.sd_achievement_core_stats
       where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
         and stat_key='sta.flea.bank_failures')<>10 then
    raise exception '3-4 regression: bank_failures Core stat mismatch';
  end if;
  if (select value from public.sd_achievement_core_stats
       where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
         and stat_key='sta.flea.boxes_looted')<>1000 then
    raise exception '3-4 regression: boxes_looted Core stat mismatch';
  end if;
  if not exists(
    select 1 from public.sd_achievement_progress
     where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
       and achievement_id='flea-10' and current_value=1000 and unlocked
  ) then
    raise exception '3-4 regression: flea-10 did not unlock at 1000 boxes';
  end if;
  if not exists(
    select 1 from public.sd_achievement_progress
     where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
       and achievement_id='flea-14' and current_value=10 and unlocked
  ) then
    raise exception '3-4 regression: flea-14 did not unlock at 10 failures';
  end if;
  if not exists(
    select 1 from public.sd_achievement_progress
     where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
       and achievement_id='flea-03' and current_value=150 and unlocked
       and unlocked_at='2026-08-19T09:08:07Z'
  ) then
    raise exception '3-4 regression: higher legacy flea-03 progress/unlocked_at was lowered';
  end if;
end $$;

-- The dormant compatibility name is also routed through exactly the same Core
-- adapter. With unchanged server state it must be duplicate-only.
select private.refresh_sd_flea_game_achievements('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
do $$
begin
  if (select count(*) from public.sd_achievement_event_ledger
       where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')<>2 then
    raise exception '3-4 regression: compatibility refresh created duplicate state event';
  end if;
end $$;

-- Signed-in clients and ZIP extensions still cannot mint the STA event directly.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
do $$
declare failed boolean:=false;
begin
  begin
    perform public.submit_sd_achievement_event_v1(
      'sta-expansion','sta.operation.accepted','chapter34:client:forge:0001','{"claim":"unlock"}'::jsonb
    );
  exception when sqlstate 'P3307' then failed:=true; end;
  if not failed then
    raise exception '3-4 regression: authenticated client forged an STA achievement event';
  end if;
end $$;
reset role;
rollback;

-- A moved binding cannot consume a stat owned by a different producer.
insert into public.sd_achievement_stat_registry(
  stat_key,producer_key,aggregation_mode,allow_negative,registry_version,active,description
) values(
  'logistics.fixture.cross','official.logistics','max',false,'fixture',true,'fixture cross-producer stat'
);
do $$
declare failed boolean:=false;
begin
  begin
    update public.sd_achievement_producer_bindings
       set stat_key='logistics.fixture.cross'
     where permanent_code='flea-01';
  exception when sqlstate 'P3330' then failed:=true; end;
  if not failed then
    raise exception '3-4 regression: cross-producer stat binding was accepted';
  end if;
end $$;
delete from public.sd_achievement_stat_registry where stat_key='logistics.fixture.cross';

-- New Chapter 3-4 state and private adapters are inaccessible to clients.
do $$
declare
  v_direct bigint;
begin
  if has_table_privilege('anon','public.sd_achievement_sta_flea_legacy_collection_keys','SELECT')
     or has_table_privilege('authenticated','public.sd_achievement_sta_flea_legacy_collection_keys','SELECT')
     or has_table_privilege('authenticated','public.sd_achievement_sta_flea_legacy_collection_keys','INSERT')
     or has_table_privilege('authenticated','public.sd_achievement_sta_flea_legacy_collection_keys','UPDATE')
     or has_table_privilege('authenticated','public.sd_achievement_sta_flea_legacy_collection_keys','DELETE') then
    raise exception '3-4 regression: client privilege leaked on frozen legacy collection keys';
  end if;

  if has_function_privilege('anon','private.sync_sd_sta_flea_legacy_v1(uuid)','EXECUTE')
     or has_function_privilege('authenticated','private.sync_sd_sta_flea_legacy_v1(uuid)','EXECUTE')
     or has_function_privilege('authenticated','private.evaluate_sd_achievement_stat_bindings_v1(uuid,text)','EXECUTE') then
    raise exception '3-4 regression: private content-move function execute privilege leaked';
  end if;

  select count(*) into v_direct
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='private'
     and p.proname in ('refresh_sd_flea_pc_achievements','refresh_sd_flea_game_achievements')
     and pg_get_functiondef(p.oid) ~ 'flea-(01|02|03|04|08|09|10|11|14|15|16|17|18)';
  if v_direct<>0 then
    raise exception '3-4 regression: direct moved-achievement compatibility writer remains';
  end if;

  if not exists(
    select 1 from pg_policies
     where schemaname='public'
       and tablename='sd_achievement_sta_flea_legacy_collection_keys'
  ) then
    raise exception '3-4 regression: explicit RLS deny policy missing';
  end if;
end $$;

-- Earned rows/timestamps remain byte-for-byte equivalent to the pre-migration
-- fixture snapshot even after both backfill events.
do $$
begin
  if exists(
    (select * from public.chapter34_before_earned
     except select user_id,achievement_id,unlocked_at from public.sd_user_achievements)
    union all
    (select user_id,achievement_id,unlocked_at from public.sd_user_achievements
     except select * from public.chapter34_before_earned)
  ) then
    raise exception '3-4 regression: earned assets changed after later refresh';
  end if;
end $$;

drop table public.chapter34_before_catalog;
drop table public.chapter34_before_earned;

select 'Chapter 3-4 content move + Legacy/backfill regression PASS' as result;
