\set ON_ERROR_STOP on

create temporary table before_achievements as
select id, code, name, description, title_reward, sort_order, active, hidden,
       lineage_root_id, supersedes_achievement_id
  from public.sd_achievements;

create temporary table before_progress as
select user_id, achievement_id, current_value, unlocked, unlocked_at, source_app
  from public.sd_achievement_progress;

create temporary table before_earned as
select user_id, achievement_id, unlocked_at
  from public.sd_user_achievements;

\ir ../../database/migrations/sd_achievement_core_event_registry_v1.sql

do $$
declare
  v_expected_tables text[] := array[
    'sd_achievement_producer_registry',
    'sd_achievement_event_type_registry',
    'sd_achievement_stat_registry',
    'sd_achievement_producer_bindings',
    'sd_achievement_event_ledger',
    'sd_achievement_core_stats',
    'sd_achievement_stat_event_applications'
  ];
  v_table text;
begin
  if (select count(*) from public.sd_achievement_producer_registry) <> 13 then
    raise exception '3-3 regression: producer registry expected 13 rows';
  end if;

  if (select count(*) from public.sd_achievement_event_type_registry) <> 13 then
    raise exception '3-3 regression: event type registry expected 13 rows';
  end if;

  if (select count(*) from public.sd_achievement_producer_bindings)
     <> (select count(*) from public.sd_achievements) then
    raise exception '3-3 regression: binding coverage mismatch';
  end if;

  if (select count(*) from public.sd_achievement_producer_bindings where binding_state='planned_move') <> 13 then
    raise exception '3-3 regression: exact Flea planned-move count drifted';
  end if;

  if exists (select 1 from public.sd_achievement_producer_bindings where binding_state='active') then
    raise exception '3-3 regression: producer cutover happened in Chapter 3-3';
  end if;

  if exists (select 1 from public.sd_achievement_producer_registry where ingress_mode<>'internal_only')
     or exists (select 1 from public.sd_achievement_event_type_registry where client_submission_allowed) then
    raise exception '3-3 regression: client achievement event ingress opened early';
  end if;

  if not exists (
    select 1 from public.sd_achievement_producer_bindings
     where permanent_code='flea-01'
       and producer_key='official.sta'
       and source_content_key='flea_pc'
       and target_content_key='sta'
       and binding_state='planned_move'
  ) then
    raise exception '3-3 regression: flea-01 planned STA binding missing';
  end if;

  if not exists (
    select 1 from public.sd_achievement_producer_bindings
     where permanent_code='flea-05'
       and producer_key='official.flea-market'
       and source_content_key='flea_market'
       and target_content_key='flea_market'
       and binding_state='shadow'
  ) then
    raise exception '3-3 regression: flea-05 retained Flea binding missing';
  end if;

  if exists (
    (select * from before_achievements
     except
     select id, code, name, description, title_reward, sort_order, active, hidden,
            lineage_root_id, supersedes_achievement_id
       from public.sd_achievements)
    union all
    (select id, code, name, description, title_reward, sort_order, active, hidden,
            lineage_root_id, supersedes_achievement_id
       from public.sd_achievements
     except select * from before_achievements)
  ) then
    raise exception '3-3 regression: achievement catalog/player identity changed';
  end if;

  if exists (
    (select * from before_progress
     except
     select user_id, achievement_id, current_value, unlocked, unlocked_at, source_app
       from public.sd_achievement_progress)
    union all
    (select user_id, achievement_id, current_value, unlocked, unlocked_at, source_app
       from public.sd_achievement_progress
     except select * from before_progress)
  ) then
    raise exception '3-3 regression: progress/unlock assets changed';
  end if;

  if exists (
    (select * from before_earned
     except select user_id, achievement_id, unlocked_at from public.sd_user_achievements)
    union all
    (select user_id, achievement_id, unlocked_at from public.sd_user_achievements
     except select * from before_earned)
  ) then
    raise exception '3-3 regression: earned/unlocked_at assets changed';
  end if;

  foreach v_table in array v_expected_tables loop
    if not exists (
      select 1 from pg_policies
       where schemaname='public' and tablename=v_table
    ) then
      raise exception '3-3 regression: explicit RLS policy missing on %', v_table;
    end if;

    if has_table_privilege('anon',format('public.%I',v_table),'SELECT')
       or has_table_privilege('anon',format('public.%I',v_table),'INSERT')
       or has_table_privilege('authenticated',format('public.%I',v_table),'SELECT')
       or has_table_privilege('authenticated',format('public.%I',v_table),'INSERT')
       or has_table_privilege('authenticated',format('public.%I',v_table),'UPDATE')
       or has_table_privilege('authenticated',format('public.%I',v_table),'DELETE') then
      raise exception '3-3 regression: direct client table privilege leaked on %', v_table;
    end if;
  end loop;
end $$;

begin;
insert into public.profiles(id,nickname)
values('33333333-3333-4333-8333-333333333333','chapter33-fixture');

insert into public.sd_achievement_stat_registry(stat_key,producer_key,aggregation_mode,allow_negative,description)
values
 ('sta.test.sum','official.sta','sum',false,'fixture sum'),
 ('sta.test.max','official.sta','max',false,'fixture max'),
 ('sta.test.latest','official.sta','latest',false,'fixture latest'),
 ('sta.test.flag','official.sta','flag',false,'fixture flag');

do $$
declare
  r jsonb;
  v numeric;
  failed boolean;
begin
  r:=private.accept_sd_achievement_event_v1(
    '33333333-3333-4333-8333-333333333333','official.sta','sta.operation.accepted',
    'chapter33:event:0001','sta-expansion',
    '{"proof":"a"}'::jsonb,'{"proof":"a","validated":true}'::jsonb,
    '[{"stat_key":"sta.test.sum","value":5},{"stat_key":"sta.test.max","value":7},{"stat_key":"sta.test.latest","value":100},{"stat_key":"sta.test.flag","value":1}]'::jsonb,
    'fixture-server','2026-08-22T05:00:00Z'
  );
  if coalesce((r->>'duplicate')::boolean,true) then
    raise exception '3-3 E2E: first event unexpectedly duplicate';
  end if;

  r:=private.accept_sd_achievement_event_v1(
    '33333333-3333-4333-8333-333333333333','official.sta','sta.operation.accepted',
    'chapter33:event:0001','sta-expansion',
    '{"proof":"a"}'::jsonb,'{"ignored_on_replay":true}'::jsonb,'[]'::jsonb,
    'changed-validator','2026-08-22T06:00:00Z'
  );
  if not coalesce((r->>'duplicate')::boolean,false) then
    raise exception '3-3 E2E: exact retry was not duplicate-only';
  end if;

  select value into v from public.sd_achievement_core_stats
   where user_id='33333333-3333-4333-8333-333333333333' and stat_key='sta.test.sum';
  if v<>5 then raise exception '3-3 E2E: retry changed SUM'; end if;

  failed:=false;
  begin
    perform private.accept_sd_achievement_event_v1(
      '33333333-3333-4333-8333-333333333333','official.sta','sta.operation.accepted',
      'chapter33:event:0001','sta-expansion',
      '{"proof":"DIFFERENT"}'::jsonb,'{}'::jsonb,'[]'::jsonb,'fixture-server',now()
    );
  exception when sqlstate 'P3301' then failed:=true; end;
  if not failed then raise exception '3-3 E2E: event_id conflicting replay accepted'; end if;

  perform private.accept_sd_achievement_event_v1(
    '33333333-3333-4333-8333-333333333333','official.sta','sta.operation.accepted',
    'chapter33:event:0002','sta-expansion',
    '{"proof":"b"}'::jsonb,'{"proof":"b"}'::jsonb,
    '[{"stat_key":"sta.test.sum","value":7},{"stat_key":"sta.test.max","value":3},{"stat_key":"sta.test.latest","value":50},{"stat_key":"sta.test.flag","value":0}]'::jsonb,
    'fixture-server','2026-08-22T04:00:00Z'
  );

  select value into v from public.sd_achievement_core_stats where user_id='33333333-3333-4333-8333-333333333333' and stat_key='sta.test.sum';
  if v<>12 then raise exception '3-3 E2E: SUM expected 12 got %',v; end if;
  select value into v from public.sd_achievement_core_stats where user_id='33333333-3333-4333-8333-333333333333' and stat_key='sta.test.max';
  if v<>7 then raise exception '3-3 E2E: MAX regressed to %',v; end if;
  select value into v from public.sd_achievement_core_stats where user_id='33333333-3333-4333-8333-333333333333' and stat_key='sta.test.latest';
  if v<>100 then raise exception '3-3 E2E: older LATEST overwrote newer value: %',v; end if;
  select value into v from public.sd_achievement_core_stats where user_id='33333333-3333-4333-8333-333333333333' and stat_key='sta.test.flag';
  if v<>1 then raise exception '3-3 E2E: FLAG regressed: %',v; end if;

  failed:=false;
  begin
    perform private.accept_sd_achievement_event_v1(
      '33333333-3333-4333-8333-333333333333','official.sta','sta.operation.accepted',
      'chapter33:event:0003','sd-flea-market','{}'::jsonb,'{}'::jsonb,'[]'::jsonb,
      'fixture-server',now()
    );
  exception when sqlstate 'P3305' then failed:=true; end;
  if not failed then raise exception '3-3 E2E: spoofed extension_id accepted'; end if;
  if exists(select 1 from public.sd_achievement_event_ledger where event_id='chapter33:event:0003') then
    raise exception '3-3 E2E: rejected source event persisted';
  end if;

  failed:=false;
  begin
    perform private.accept_sd_achievement_event_v1(
      '33333333-3333-4333-8333-333333333333','official.sta','sta.operation.accepted',
      'chapter33:event:0004','sta-expansion','{}'::jsonb,'{}'::jsonb,
      '[{"stat_key":"sta.test.sum","value":-1}]'::jsonb,'fixture-server',now()
    );
  exception when sqlstate 'P3310' then failed:=true; end;
  if not failed then raise exception '3-3 E2E: forbidden negative stat accepted'; end if;
  if exists(select 1 from public.sd_achievement_event_ledger where event_id='chapter33:event:0004') then
    raise exception '3-3 E2E: stat failure left a partial accepted event';
  end if;

  failed:=false;
  begin
    update public.sd_achievement_event_ledger
       set normalized_evidence='{}'::jsonb
     where event_id='chapter33:event:0001';
  exception when sqlstate 'P3330' then failed:=true; end;
  if not failed then raise exception '3-3 E2E: event ledger update was allowed'; end if;

  failed:=false;
  begin
    delete from public.sd_achievement_stat_event_applications
     where event_id='chapter33:event:0001';
  exception when sqlstate 'P3330' then failed:=true; end;
  if not failed then raise exception '3-3 E2E: stat application delete was allowed'; end if;

  failed:=false;
  begin
    update public.sd_achievement_producer_bindings
       set producer_key='official.flea-market'
     where permanent_code='flea-01';
  exception when sqlstate 'P3325' then failed:=true; end;
  if not failed then raise exception '3-3 E2E: planned Flea->STA binding was redirected'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
do $$
declare failed boolean:=false;
begin
  begin
    perform public.submit_sd_achievement_event_v1(
      'sta-expansion','sta.operation.accepted','chapter33:client:0001','{"claim":"unlock"}'::jsonb
    );
  exception when sqlstate 'P3307' then failed:=true; end;
  if not failed then raise exception '3-3 E2E: authenticated client event submission was not fail-closed'; end if;
end $$;
reset role;
rollback;

do $$
begin
  if exists(select 1 from public.profiles where id='33333333-3333-4333-8333-333333333333')
     or exists(select 1 from public.sd_achievement_event_ledger where event_id like 'chapter33:%')
     or exists(select 1 from public.sd_achievement_core_stats where stat_key like 'sta.test.%')
     or exists(select 1 from public.sd_achievement_stat_registry where stat_key like 'sta.test.%') then
    raise exception '3-3 regression: rollback fixture residue remains';
  end if;
end $$;

select 'Chapter 3-3 producer registry + exactly-once event/stat regression PASS' as result;
