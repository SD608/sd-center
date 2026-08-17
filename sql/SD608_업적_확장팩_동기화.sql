-- SD608 업적 / 확장팩 공통 동기화 저장소
-- 적용 대상: Supabase SQL Editor
-- 목적: PC SD Link, 홈페이지, 모바일이 같은 계정의 업적 진행도를 공유

begin;

create table if not exists public.sd_achievement_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null,
  current_value numeric not null default 0,
  unlocked boolean not null default false,
  unlocked_at timestamptz,
  source_app text not null default 'unknown',
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, achievement_id),
  constraint sd_achievement_progress_id_check
    check (achievement_id ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  constraint sd_achievement_progress_source_check
    check (length(source_app) between 1 and 80)
);

create index if not exists sd_achievement_progress_user_updated_idx
  on public.sd_achievement_progress(user_id, updated_at desc);
create index if not exists sd_achievement_progress_source_idx
  on public.sd_achievement_progress(user_id, source_app);

alter table public.sd_achievement_progress enable row level security;

revoke all on table public.sd_achievement_progress from anon;
grant select, insert, update, delete on table public.sd_achievement_progress to authenticated;

DO $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='sd_achievement_progress'
      and policyname='sd_achievement_progress_select_own'
  ) then
    create policy sd_achievement_progress_select_own
      on public.sd_achievement_progress for select
      to authenticated
      using (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='sd_achievement_progress'
      and policyname='sd_achievement_progress_insert_own'
  ) then
    create policy sd_achievement_progress_insert_own
      on public.sd_achievement_progress for insert
      to authenticated
      with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='sd_achievement_progress'
      and policyname='sd_achievement_progress_update_own'
  ) then
    create policy sd_achievement_progress_update_own
      on public.sd_achievement_progress for update
      to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='sd_achievement_progress'
      and policyname='sd_achievement_progress_delete_own'
  ) then
    create policy sd_achievement_progress_delete_own
      on public.sd_achievement_progress for delete
      to authenticated
      using (user_id = auth.uid());
  end if;
end $$;

create or replace function public.sync_sd_achievement_progress(
  p_items jsonb,
  p_source_app text default 'unknown'
)
returns table (
  achievement_id text,
  current_value numeric,
  unlocked boolean,
  unlocked_at timestamptz,
  source_app text,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_item jsonb;
  v_id text;
  v_value numeric;
  v_unlocked boolean;
  v_source text := coalesce(nullif(trim(p_source_app), ''), 'unknown');
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode='28000';
  end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'ITEMS_MUST_BE_ARRAY';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_id := lower(trim(coalesce(v_item->>'achievement_id', v_item->>'id', '')));
    if v_id = '' or v_id !~ '^[a-z0-9][a-z0-9-]{1,79}$' then
      continue;
    end if;

    begin
      v_value := greatest(
        0,
        coalesce(
          nullif(v_item->>'current_value', '')::numeric,
          nullif(v_item->>'value', '')::numeric,
          0
        )
      );
    exception when others then
      v_value := 0;
    end;

    begin
      v_unlocked := coalesce(nullif(v_item->>'unlocked', '')::boolean, false);
    exception when others then
      v_unlocked := false;
    end;

    insert into public.sd_achievement_progress as p
      (user_id, achievement_id, current_value, unlocked, unlocked_at, source_app, metadata, updated_at)
    values
      (
        v_user_id,
        v_id,
        v_value,
        v_unlocked,
        case when v_unlocked then now() else null end,
        left(v_source, 80),
        coalesce(v_item->'metadata', '{}'::jsonb),
        now()
      )
    on conflict on constraint sd_achievement_progress_pkey do update
      set current_value = greatest(p.current_value, excluded.current_value),
          unlocked = p.unlocked or excluded.unlocked,
          unlocked_at = case
            when p.unlocked_at is not null then p.unlocked_at
            when p.unlocked or excluded.unlocked then now()
            else null
          end,
          source_app = excluded.source_app,
          metadata = p.metadata || excluded.metadata,
          updated_at = now();
  end loop;

  return query
    select p.achievement_id, p.current_value, p.unlocked, p.unlocked_at, p.source_app, p.updated_at
    from public.sd_achievement_progress p
    where p.user_id = v_user_id
    order by p.achievement_id;
end;
$$;

grant execute on function public.sync_sd_achievement_progress(jsonb, text) to authenticated;

create or replace function public.get_sd_achievement_progress()
returns table (
  achievement_id text,
  current_value numeric,
  unlocked boolean,
  unlocked_at timestamptz,
  source_app text,
  updated_at timestamptz
)
language sql
security invoker
set search_path = public
as $$
  select p.achievement_id, p.current_value, p.unlocked, p.unlocked_at, p.source_app, p.updated_at
  from public.sd_achievement_progress p
  where p.user_id = auth.uid()
  order by p.achievement_id;
$$;

grant execute on function public.get_sd_achievement_progress() to authenticated;

commit;
