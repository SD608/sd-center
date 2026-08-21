\set ON_ERROR_STOP on

begin;

do $$
declare
  v_existing uuid := '11111111-1111-4111-8111-111111111111';
  v_root uuid;
  v_child uuid;
  v_failed boolean;
begin
  if (select count(*) from public.sd_achievements) <> 2 then
    raise exception 'existing achievement count changed during migration';
  end if;

  if exists (
    select 1 from public.sd_achievements
    where supersedes_achievement_id is null
      and lineage_root_id is distinct from id
  ) then
    raise exception 'existing roots were not backfilled to their own permanent UUID';
  end if;

  if not exists (
    select 1 from public.sd_achievement_progress
    where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and achievement_id = 'wallet-01'
      and unlocked
  ) then
    raise exception 'existing progress was not preserved';
  end if;

  v_failed := false;
  begin
    update public.sd_achievements set code = 'wallet-01-renamed' where id = v_existing;
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'permanent code rename was not blocked'; end if;

  v_failed := false;
  begin
    update public.sd_achievements set id = gen_random_uuid() where id = v_existing;
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'permanent UUID change was not blocked'; end if;

  v_failed := false;
  begin
    delete from public.sd_achievements where id = v_existing;
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'permanent achievement delete was not blocked'; end if;

  update public.sd_achievements set name = 'Presentation fields remain editable' where id = v_existing;
  if (select name from public.sd_achievements where id = v_existing) <> 'Presentation fields remain editable' then
    raise exception 'presentation-only update was unexpectedly blocked';
  end if;

  insert into public.sd_achievements(code, name, sort_order, active, hidden)
  values ('test-lineage-root', 'Lineage Root', 900, false, true)
  returning id into v_root;

  if (select lineage_root_id from public.sd_achievements where id = v_root) is distinct from v_root then
    raise exception 'new root achievement did not self-root';
  end if;

  insert into public.sd_achievements(code, name, sort_order, active, hidden, supersedes_achievement_id)
  values ('test-lineage-child', 'Lineage Child', 901, false, true, v_root)
  returning id into v_child;

  if (select lineage_root_id from public.sd_achievements where id = v_child) is distinct from v_root then
    raise exception 'successor did not inherit the original lineage root';
  end if;

  v_failed := false;
  begin
    update public.sd_achievements
       set supersedes_achievement_id = v_child,
           lineage_root_id = v_root
     where id = v_root;
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'lineage cycle was not blocked'; end if;

  v_failed := false;
  begin
    insert into public.sd_achievements(
      code, name, sort_order, active, hidden, lineage_root_id, supersedes_achievement_id
    ) values (
      'test-lineage-badroot', 'Bad Root', 902, false, true, v_child, v_root
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'mismatched lineage root was not blocked'; end if;

  insert into public.sd_achievement_progress(user_id, achievement_id, current_value, unlocked)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'miner-01', 1, false);

  v_failed := false;
  begin
    insert into public.sd_achievement_progress(user_id, achievement_id, current_value, unlocked)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'unknown-achievement', 1, false);
  exception when foreign_key_violation then
    v_failed := true;
  end;
  if not v_failed then raise exception 'orphan progress code was not blocked by canonical-code FK'; end if;
end $$;

rollback;
