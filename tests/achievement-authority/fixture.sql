\set ON_ERROR_STOP on

create schema auth;
create role anon nologin;
create role authenticated nologin;

grant usage on schema public to anon, authenticated;
grant usage on schema auth to authenticated;

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to authenticated;

create table auth.users (id uuid primary key);
insert into auth.users(id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

create table public.sd_achievements (
  id uuid primary key,
  code text not null unique,
  active boolean not null default true,
  title_reward text
);
insert into public.sd_achievements(id, code, active, title_reward) values
  ('11111111-1111-4111-8111-111111111111', 'wallet-02', true, '첫 단추');

create table public.sd_achievement_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null,
  current_value numeric not null default 0,
  unlocked boolean not null default false,
  unlocked_at timestamptz,
  source_app text not null default 'unknown',
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

create table public.sd_user_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_id uuid not null references public.sd_achievements(id) on delete cascade,
  unlocked_at timestamptz not null,
  primary key (user_id, achievement_id)
);

alter table public.sd_achievement_progress enable row level security;

grant select, insert, update, delete on public.sd_achievement_progress to authenticated;

create policy sd_achievement_progress_select_own
  on public.sd_achievement_progress for select to authenticated
  using (user_id = auth.uid());
create policy sd_achievement_progress_insert_own
  on public.sd_achievement_progress for insert to authenticated
  with check (user_id = auth.uid());
create policy sd_achievement_progress_update_own
  on public.sd_achievement_progress for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy sd_achievement_progress_delete_own
  on public.sd_achievement_progress for delete to authenticated
  using (user_id = auth.uid());

create function public.sync_sd_achievement_progress(p_items jsonb, p_source_app text default 'unknown')
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_item jsonb;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    insert into public.sd_achievement_progress(user_id, achievement_id, current_value, unlocked, unlocked_at, source_app)
    values (
      v_user_id,
      lower(trim(v_item->>'achievement_id')),
      greatest(0, coalesce((v_item->>'current_value')::numeric, 0)),
      coalesce((v_item->>'unlocked')::boolean, false),
      case when coalesce((v_item->>'unlocked')::boolean, false) then now() end,
      p_source_app
    )
    on conflict (user_id, achievement_id) do update set
      current_value = greatest(sd_achievement_progress.current_value, excluded.current_value),
      unlocked = sd_achievement_progress.unlocked or excluded.unlocked,
      unlocked_at = coalesce(sd_achievement_progress.unlocked_at, excluded.unlocked_at),
      source_app = excluded.source_app,
      updated_at = now();
  end loop;
end;
$$;
grant execute on function public.sync_sd_achievement_progress(jsonb,text) to authenticated;

create function public.bridge_sd_achievement_title()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.unlocked then
    insert into public.sd_user_achievements(user_id, achievement_id, unlocked_at)
    select new.user_id, a.id, coalesce(new.unlocked_at, now())
    from public.sd_achievements a
    where a.code = new.achievement_id and a.active
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger trg_sd_achievement_title_bridge
after insert or update of unlocked, unlocked_at on public.sd_achievement_progress
for each row execute function public.bridge_sd_achievement_title();

-- Trusted producer used only to prove the write lock still permits server-owned updates.
create schema achievement_test_private;
revoke all on schema achievement_test_private from public, anon, authenticated;
create function achievement_test_private.server_unlock(p_user_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.sd_achievement_progress(user_id, achievement_id, current_value, unlocked, unlocked_at, source_app)
  values (p_user_id, p_code, 1, true, now(), 'server-test')
  on conflict (user_id, achievement_id) do update set
    current_value = greatest(public.sd_achievement_progress.current_value, 1),
    unlocked = true,
    unlocked_at = coalesce(public.sd_achievement_progress.unlocked_at, now()),
    source_app = 'server-test',
    updated_at = now();
end;
$$;
revoke all on function achievement_test_private.server_unlock(uuid,text) from public, anon, authenticated;
