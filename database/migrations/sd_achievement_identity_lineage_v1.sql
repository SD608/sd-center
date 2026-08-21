begin;

-- Chapter 3-1: permanent achievement identity + lineage foundation.
-- Existing sd_achievements.id UUID and code become permanent identities.
-- Presentation fields may change, but published IDs/codes must never be renamed,
-- deleted, or reused. Content/producer moves keep the same identity.

-- Fail closed before adding permanent constraints.
do $$
begin
  if exists (
    select 1
      from public.sd_achievements
     where code is null
        or btrim(code) = ''
        or code !~ '^[a-z0-9][a-z0-9-]{1,79}$'
  ) then
    raise exception 'achievement identity preflight failed: invalid code exists';
  end if;

  if exists (
    select code
      from public.sd_achievements
     group by code
    having count(*) > 1
  ) then
    raise exception 'achievement identity preflight failed: duplicate code exists';
  end if;

  if exists (
    select 1
      from public.sd_achievement_progress p
      left join public.sd_achievements a on a.code = p.achievement_id
     where a.id is null
  ) then
    raise exception 'achievement identity preflight failed: orphan progress code exists';
  end if;
end $$;

alter table public.sd_achievements
  add column lineage_root_id uuid,
  add column supersedes_achievement_id uuid;

update public.sd_achievements
   set lineage_root_id = id
 where lineage_root_id is null;

alter table public.sd_achievements
  alter column lineage_root_id set not null,
  add constraint sd_achievements_code_format_v1
    check (code ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  add constraint sd_achievements_lineage_root_fkey
    foreign key (lineage_root_id)
    references public.sd_achievements(id)
    on update restrict on delete restrict,
  add constraint sd_achievements_supersedes_fkey
    foreign key (supersedes_achievement_id)
    references public.sd_achievements(id)
    on update restrict on delete restrict,
  add constraint sd_achievements_no_self_supersede
    check (supersedes_achievement_id is null or supersedes_achievement_id <> id);

-- Legacy progress rows remain code-based for compatibility, but every code is now
-- required to resolve to the permanent catalog identity.
alter table public.sd_achievement_progress
  add constraint sd_achievement_progress_code_fkey_v1
    foreign key (achievement_id)
    references public.sd_achievements(code)
    on update restrict on delete restrict;

create or replace function private.enforce_sd_achievement_identity_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_root uuid;
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = 'P0001',
      message = 'achievement identity is permanent; deactivate or mark Legacy instead of deleting';
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id then
      raise exception using
        errcode = 'P0001',
        message = 'achievement UUID is permanent and cannot be changed';
    end if;

    if new.code is distinct from old.code then
      raise exception using
        errcode = 'P0001',
        message = 'achievement code is permanent and cannot be renamed or reused';
    end if;
  end if;

  if new.supersedes_achievement_id is null then
    if new.lineage_root_id is null then
      new.lineage_root_id := new.id;
    end if;

    if new.lineage_root_id is distinct from new.id then
      raise exception using
        errcode = 'P0001',
        message = 'root achievement must point lineage_root_id to itself';
    end if;
  else
    if new.supersedes_achievement_id = new.id then
      raise exception using
        errcode = 'P0001',
        message = 'achievement cannot supersede itself';
    end if;

    select a.lineage_root_id
      into v_parent_root
      from public.sd_achievements a
     where a.id = new.supersedes_achievement_id;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'superseded achievement does not exist';
    end if;

    if new.lineage_root_id is null then
      new.lineage_root_id := v_parent_root;
    end if;

    if new.lineage_root_id is distinct from v_parent_root then
      raise exception using
        errcode = 'P0001',
        message = 'achievement lineage_root_id must match the superseded achievement lineage root';
    end if;

    if exists (
      with recursive ancestry as (
        select a.id, a.supersedes_achievement_id
          from public.sd_achievements a
         where a.id = new.supersedes_achievement_id
        union all
        select a.id, a.supersedes_achievement_id
          from public.sd_achievements a
          join ancestry x on a.id = x.supersedes_achievement_id
         where x.supersedes_achievement_id is not null
      )
      select 1 from ancestry where id = new.id
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'achievement lineage cycle is not allowed';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_sd_achievement_identity_v1() from public, anon, authenticated;

create trigger sd_achievement_identity_guard_v1
before insert or update or delete on public.sd_achievements
for each row execute function private.enforce_sd_achievement_identity_v1();

comment on column public.sd_achievements.id is
  'Permanent canonical achievement UUID. Never change or reuse after publication.';
comment on column public.sd_achievements.code is
  'Permanent canonical public achievement code. Never rename or reuse after publication.';
comment on column public.sd_achievements.lineage_root_id is
  'Permanent semantic lineage root. Content/producer moves do not create a new identity.';
comment on column public.sd_achievements.supersedes_achievement_id is
  'Optional previous achievement when a fundamentally different semantic achievement replaces an older Legacy achievement.';

commit;
