\set ON_ERROR_STOP on

create temporary table before_catalog as
select id,code,name,description,icon,title_reward,sort_order,active,created_at,lineage_root_id,supersedes_achievement_id
  from public.sd_achievements;
create temporary table before_progress as select * from public.sd_achievement_progress;
create temporary table before_earned as select * from public.sd_user_achievements;

\ir ../../database/migrations/sd_achievement_hidden_policy_v1.sql

do $$
declare
  v_expected text[]:=array[
    'bitcoin-05','oddeven-07','flea-16','flea-14','miner-07',
    'oddeven-08','oddeven-03','sta-01','flea-18','npcvault-08'
  ];
begin
  if (select count(*) from public.sd_achievements)<>99 then
    raise exception '3-5 regression: catalog count changed';
  end if;
  if (select count(*) from public.sd_achievements where hidden)<>10 then
    raise exception '3-5 regression: expected 10 hidden rows';
  end if;
  if exists(
    select code from public.sd_achievements where hidden
    except select unnest(v_expected)
  ) or exists(
    select unnest(v_expected)
    except select code from public.sd_achievements where hidden
  ) then raise exception '3-5 regression: hidden set mismatch'; end if;

  if exists(
    (select * from before_catalog
     except select id,code,name,description,icon,title_reward,sort_order,active,created_at,lineage_root_id,supersedes_achievement_id from public.sd_achievements)
    union all
    (select id,code,name,description,icon,title_reward,sort_order,active,created_at,lineage_root_id,supersedes_achievement_id from public.sd_achievements
     except select * from before_catalog)
  ) then raise exception '3-5 regression: non-hidden catalog metadata changed'; end if;

  if exists((select * from before_progress except select * from public.sd_achievement_progress)
            union all
            (select * from public.sd_achievement_progress except select * from before_progress)) then
    raise exception '3-5 regression: progress/unlock assets changed';
  end if;
  if exists((select * from before_earned except select * from public.sd_user_achievements)
            union all
            (select * from public.sd_user_achievements except select * from before_earned)) then
    raise exception '3-5 regression: earned/title assets changed';
  end if;

  if not exists(select 1 from public.sd_achievement_progress where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and achievement_id='oddeven-03' and unlocked and unlocked_at='2026-08-18T01:02:03Z') then
    raise exception '3-5 regression: earned hidden oddeven-03 was not preserved';
  end if;
  if not exists(select 1 from public.sd_achievement_progress where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and achievement_id='oddeven-08' and unlocked and unlocked_at='2026-08-18T04:05:06Z') then
    raise exception '3-5 regression: earned hidden oddeven-08 was not preserved';
  end if;

  -- Old PR #55 local >=404 interpretation must not become acquisition authority.
  if not exists(select 1 from public.sd_achievements where code='bitcoin-05' and hidden and active) then
    raise exception '3-5 regression: bitcoin-05 hidden identity missing';
  end if;
end $$;

select 'Chapter 3-5 hidden policy regression PASS' as result;
