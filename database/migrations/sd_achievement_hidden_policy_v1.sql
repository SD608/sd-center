-- Chapter 3-5: canonical hidden-achievement presentation policy.
-- Acquisition authority remains server/Core-owned; this migration changes only hidden presentation metadata.

create temporary table sd_chapter_3_5_hidden_codes(code text primary key) on commit drop;
insert into sd_chapter_3_5_hidden_codes(code) values
  ('bitcoin-05'),
  ('oddeven-07'),
  ('flea-16'),
  ('flea-14'),
  ('miner-07'),
  ('oddeven-08'),
  ('oddeven-03'),
  ('sta-01'),
  ('flea-18'),
  ('npcvault-08');

do $$
begin
  if (select count(*) from public.sd_achievements) <> 99 then
    raise exception 'Chapter 3-5 requires the exact reviewed 99-achievement catalog';
  end if;

  if (select count(*) from sd_chapter_3_5_hidden_codes) <> 10 then
    raise exception 'Chapter 3-5 hidden manifest bug: expected exactly 10 codes';
  end if;

  if exists (
    select 1
      from sd_chapter_3_5_hidden_codes h
      left join public.sd_achievements a on a.code=h.code
     where a.id is null
  ) then
    raise exception 'Chapter 3-5 hidden manifest does not match the canonical catalog';
  end if;

  if exists (
    select 1
      from sd_chapter_3_5_hidden_codes h
      join public.sd_achievements a on a.code=h.code
     where not a.active
  ) then
    raise exception 'Chapter 3-5 hidden achievement is not active';
  end if;

  if exists (
    select 1
      from public.sd_achievement_migration_classification c
     where not c.preserve_unlock
        or not c.preserve_unlocked_at
        or not c.preserve_title_reward
  ) then
    raise exception 'Chapter 3-5 preservation contract is not satisfied';
  end if;
end $$;

-- Snapshot-worthy player assets are intentionally not touched. Only hidden changes.
update public.sd_achievements a
   set hidden = exists(select 1 from sd_chapter_3_5_hidden_codes h where h.code=a.code)
 where a.hidden is distinct from exists(select 1 from sd_chapter_3_5_hidden_codes h where h.code=a.code);

do $$
begin
  if (select count(*) from public.sd_achievements where hidden) <> 10 then
    raise exception 'Chapter 3-5 hidden policy expected exactly 10 hidden achievements';
  end if;

  if exists (
    (select code from public.sd_achievements where hidden
     except select code from sd_chapter_3_5_hidden_codes)
    union all
    (select code from sd_chapter_3_5_hidden_codes
     except select code from public.sd_achievements where hidden)
  ) then
    raise exception 'Chapter 3-5 hidden set drifted from reviewed policy';
  end if;
end $$;

comment on column public.sd_achievements.hidden is
  'Presentation-only hidden flag. Locked hidden achievements mask name/condition in user UI; server/Core acquisition authority is unchanged.';
