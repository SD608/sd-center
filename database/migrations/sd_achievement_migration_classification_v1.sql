begin;

-- Chapter 3-2: classify the reviewed achievement catalog for content movement
-- without changing any player-owned achievement asset.
-- Dependency: Chapter 3-1 permanent identity/lineage migration.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='sd_achievements' and column_name='lineage_root_id'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='sd_achievements' and column_name='supersedes_achievement_id'
  ) then
    raise exception 'Chapter 3-2 requires Chapter 3-1 permanent identity/lineage migration first';
  end if;
end $$;

create table if not exists public.sd_achievement_migration_classification (
  achievement_id uuid primary key
    references public.sd_achievements(id) on update restrict on delete restrict,
  permanent_code text not null unique,
  classification_version text not null default 'chapter-3-2-v1',
  current_content_key text not null,
  target_content_key text not null,
  disposition text not null,
  preserve_unlock boolean not null default true,
  preserve_unlocked_at boolean not null default true,
  preserve_title_reward boolean not null default true,
  notes text not null,
  classified_at timestamptz not null default now(),
  constraint sd_achievement_migration_disposition_v1
    check (disposition in ('retain','move_producer','legacy','successor')),
  constraint sd_achievement_migration_preservation_v1
    check (preserve_unlock and preserve_unlocked_at and preserve_title_reward)
);

alter table public.sd_achievement_migration_classification enable row level security;
revoke all on table public.sd_achievement_migration_classification from public, anon, authenticated;

create or replace function private.enforce_sd_achievement_migration_classification_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_code text;
begin
  select a.code into v_code
    from public.sd_achievements a
   where a.id = new.achievement_id;

  if not found then
    raise exception using errcode='P0001',
      message='achievement migration classification references an unknown permanent UUID';
  end if;

  if new.permanent_code is distinct from v_code then
    raise exception using errcode='P0001',
      message='achievement migration classification UUID/code pair does not match canonical identity';
  end if;

  if new.disposition='move_producer' and new.current_content_key=new.target_content_key then
    raise exception using errcode='P0001',
      message='move_producer classification requires a different target content';
  end if;

  if new.disposition='retain' and new.current_content_key<>new.target_content_key then
    raise exception using errcode='P0001',
      message='retain classification must keep the same content key';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_sd_achievement_migration_classification_v1()
  from public, anon, authenticated;

drop trigger if exists sd_achievement_migration_classification_guard_v1
  on public.sd_achievement_migration_classification;

create trigger sd_achievement_migration_classification_guard_v1
before insert or update on public.sd_achievement_migration_classification
for each row execute function private.enforce_sd_achievement_migration_classification_v1();

create temporary table sd_chapter_3_2_manifest (
  code text primary key,
  current_content_key text not null,
  target_content_key text not null,
  disposition text not null,
  notes text not null
) on commit drop;

-- Retained groups: no semantic replacement in Chapter 3-2.
insert into sd_chapter_3_2_manifest
select format('logistics-%s', lpad(i::text,2,'0')), 'logistics','logistics','retain',
       'No semantic replacement in Chapter 3-2; preserve permanent identity and earned assets.'
  from generate_series(1,16) i
union all
select format('miner-%s', lpad(i::text,2,'0')), 'miner','miner','retain',
       'No semantic replacement in Chapter 3-2; preserve permanent identity and earned assets.'
  from generate_series(1,9) i
union all
select format('mukjjippa-%s', lpad(i::text,2,'0')), 'mukjjippa','mukjjippa','retain',
       'No semantic replacement in Chapter 3-2; preserve permanent identity and earned assets.'
  from generate_series(1,2) i
union all
select format('slot-%s', lpad(i::text,2,'0')), 'slot','slot','retain',
       'No semantic replacement in Chapter 3-2; preserve permanent identity and earned assets.'
  from generate_series(1,7) i
union all
select format('oddeven-%s', lpad(i::text,2,'0')), 'oddeven','oddeven','retain',
       'No semantic replacement in Chapter 3-2; preserve permanent identity and earned assets.'
  from generate_series(1,10) i
union all
select format('bitcoin-%s', lpad(i::text,2,'0')), 'bitcoin','bitcoin','retain',
       'No semantic replacement in Chapter 3-2; preserve permanent identity and earned assets.'
  from generate_series(1,5) i
union all
select format('sta-%s', lpad(i::text,2,'0')), 'sta','sta','retain',
       'No semantic replacement in Chapter 3-2; preserve permanent identity and earned assets.'
  from generate_series(1,3) i
union all
select format('gold-%s', lpad(i::text,2,'0')), 'core_gold','core_gold','retain',
       'Core-owned gold holding achievement; preserve permanent identity and earned assets.'
  from generate_series(1,3) i
union all
select format('npcvault-%s', lpad(i::text,2,'0')), 'npc_vault','npc_vault','retain',
       'No semantic replacement in Chapter 3-2; preserve permanent identity and earned assets.'
  from generate_series(1,8) i
union all
select format('sdcoin-coin-%s', lpad(i::text,2,'0')), 'sdcoin','sdcoin','retain',
       'No semantic replacement in Chapter 3-2; preserve permanent identity and earned assets.'
  from generate_series(1,6) i
union all
select format('sdcoin-%s', lpad(i::text,2,'0')), 'sdcoin','sdcoin','retain',
       'No semantic replacement in Chapter 3-2; preserve permanent identity and earned assets.'
  from generate_series(1,3) i
union all
select format('wallet-%s', lpad(i::text,2,'0')), 'core_wallet','core_wallet','retain',
       'Core-owned wallet-state achievement; preserve permanent identity and earned assets.'
  from generate_series(1,7) i
union all
select 'ranking-01', 'season','season','retain',
       'Season ranking achievement; preserve permanent identity and earned assets.';

-- Flea split is intentional and reviewed:
-- six marketplace achievements stay in Flea Market;
-- 13 Flea PC robbery/loot/chase achievements keep their IDs and move producer to STA.
insert into sd_chapter_3_2_manifest
select format('flea-%s', lpad(i::text,2,'0')),
       case when i = any(array[1,2,3,4,8,9,10,11,14,15,16,17,18]) then 'flea_pc' else 'flea_market' end,
       case when i = any(array[1,2,3,4,8,9,10,11,14,15,16,17,18]) then 'sta' else 'flea_market' end,
       case when i = any(array[1,2,3,4,8,9,10,11,14,15,16,17,18]) then 'move_producer' else 'retain' end,
       case when i = any(array[1,2,3,4,8,9,10,11,14,15,16,17,18])
            then 'Same accomplishment; planned Flea PC -> STA move. Preserve UUID/code/unlock/time/title.'
            else 'Marketplace achievement remains in Flea Market. Preserve UUID/code/unlock/time/title.'
       end
  from generate_series(1,19) i;

do $$
declare
  v_catalog_count integer;
begin
  if (select count(*) from sd_chapter_3_2_manifest) <> 99 then
    raise exception 'Chapter 3-2 manifest bug: expected exactly 99 reviewed codes';
  end if;

  if (select count(*) from sd_chapter_3_2_manifest where disposition='move_producer') <> 13 then
    raise exception 'Chapter 3-2 manifest bug: expected exactly 13 producer moves';
  end if;

  if (select count(*) from sd_chapter_3_2_manifest where disposition='retain') <> 86 then
    raise exception 'Chapter 3-2 manifest bug: expected exactly 86 retained identities';
  end if;

  select count(*) into v_catalog_count from public.sd_achievements;

  if exists (
    select 1
      from public.sd_achievements a
      left join sd_chapter_3_2_manifest m on m.code=a.code
     where m.code is null
  ) then
    raise exception 'Chapter 3-2 classification failed: current catalog contains an unclassified code';
  end if;

  -- Production is the reviewed 99-entry catalog. Smaller DEV subsets are allowed.
  if v_catalog_count=99 and exists (
    select 1
      from sd_chapter_3_2_manifest m
      left join public.sd_achievements a on a.code=m.code
     where a.id is null
  ) then
    raise exception 'Chapter 3-2 classification failed: reviewed 99-code manifest does not exactly match catalog';
  end if;
end $$;

insert into public.sd_achievement_migration_classification (
  achievement_id, permanent_code, classification_version,
  current_content_key, target_content_key, disposition,
  preserve_unlock, preserve_unlocked_at, preserve_title_reward, notes
)
select a.id, a.code, 'chapter-3-2-v1',
       m.current_content_key, m.target_content_key, m.disposition,
       true, true, true, m.notes
  from public.sd_achievements a
  join sd_chapter_3_2_manifest m on m.code=a.code
on conflict (achievement_id) do update
set permanent_code=excluded.permanent_code,
    classification_version=excluded.classification_version,
    current_content_key=excluded.current_content_key,
    target_content_key=excluded.target_content_key,
    disposition=excluded.disposition,
    preserve_unlock=true,
    preserve_unlocked_at=true,
    preserve_title_reward=true,
    notes=excluded.notes;

do $$
begin
  if (select count(*) from public.sd_achievement_migration_classification)
     <> (select count(*) from public.sd_achievements) then
    raise exception 'Chapter 3-2 classification failed: current catalog coverage is not complete';
  end if;

  if exists (
    select 1
      from public.sd_achievement_migration_classification c
      join public.sd_achievements a on a.id=c.achievement_id
     where c.permanent_code is distinct from a.code
  ) then
    raise exception 'Chapter 3-2 classification failed: canonical UUID/code mismatch';
  end if;
end $$;

comment on table public.sd_achievement_migration_classification is
  'Chapter 3-2 reviewed content-migration classification. Unlock/title/timestamp assets are preservation-only.';

commit;
