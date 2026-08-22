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

\ir ../../database/migrations/sd_achievement_migration_classification_v1.sql

do $$
declare
  v_failed boolean;
  v_moves text[];
  v_expected_moves text[] := array[
    'flea-01','flea-02','flea-03','flea-04',
    'flea-08','flea-09','flea-10','flea-11',
    'flea-14','flea-15','flea-16','flea-17','flea-18'
  ];
begin
  if (select count(*) from public.sd_achievement_migration_classification)
     <> (select count(*) from public.sd_achievements) then
    raise exception '3-2 regression: classification coverage mismatch';
  end if;

  select array_agg(permanent_code order by permanent_code)
    into v_moves
    from public.sd_achievement_migration_classification
   where disposition='move_producer';

  select array_agg(x order by x) into v_expected_moves
    from unnest(v_expected_moves) x;

  if v_moves is distinct from v_expected_moves then
    raise exception '3-2 regression: exact 13 Flea PC -> STA move set drifted: %', v_moves;
  end if;

  if (select count(*) from public.sd_achievement_migration_classification
       where permanent_code like 'flea-%' and disposition='retain') <> 6 then
    raise exception '3-2 regression: expected 6 Flea Market retain classifications';
  end if;

  if exists (
    select 1 from public.sd_achievement_migration_classification
     where disposition='move_producer'
       and (current_content_key<>'flea_pc' or target_content_key<>'sta')
  ) then
    raise exception '3-2 regression: Flea producer move content keys drifted';
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
    raise exception '3-2 regression: achievement catalog changed';
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
    raise exception '3-2 regression: progress/unlock assets changed';
  end if;

  if exists (
    (select * from before_earned
     except
     select user_id, achievement_id, unlocked_at from public.sd_user_achievements)
    union all
    (select user_id, achievement_id, unlocked_at from public.sd_user_achievements
     except select * from before_earned)
  ) then
    raise exception '3-2 regression: earned/unlocked_at assets changed';
  end if;

  if exists (
    select 1 from public.sd_achievement_migration_classification
     where not preserve_unlock
        or not preserve_unlocked_at
        or not preserve_title_reward
  ) then
    raise exception '3-2 regression: preservation contract disabled';
  end if;

  v_failed := false;
  begin
    update public.sd_achievement_migration_classification
       set permanent_code='flea-05'
     where permanent_code='flea-01';
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception '3-2 regression: mismatched UUID/code pair was accepted';
  end if;

  v_failed := false;
  begin
    update public.sd_achievement_migration_classification
       set target_content_key='sta'
     where permanent_code='flea-05';
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception '3-2 regression: retain with changed target was accepted';
  end if;

  v_failed := false;
  begin
    update public.sd_achievement_migration_classification
       set preserve_unlocked_at=false
     where permanent_code='flea-01';
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception '3-2 regression: preservation flag could be disabled';
  end if;

  if has_table_privilege('anon','public.sd_achievement_migration_classification','SELECT')
     or has_table_privilege('anon','public.sd_achievement_migration_classification','INSERT')
     or has_table_privilege('authenticated','public.sd_achievement_migration_classification','SELECT')
     or has_table_privilege('authenticated','public.sd_achievement_migration_classification','UPDATE') then
    raise exception '3-2 regression: client privilege leaked';
  end if;
end $$;

select 'Chapter 3-2 exact Flea split + asset preservation regression PASS' as result;
