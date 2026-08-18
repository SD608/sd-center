-- SD608 업적 카테고리 순서 사용자 설정
-- 로그인 사용자는 업적 카테고리 드래그 순서를 계정에 저장합니다.

create table if not exists public.sd_user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  achievement_category_order text[] not null default '{}'::text[],
  updated_at timestamptz not null default now(),
  constraint sd_user_preferences_achievement_order_limit check (cardinality(achievement_category_order) <= 32)
);

alter table public.sd_user_preferences enable row level security;

revoke all on table public.sd_user_preferences from public, anon;
grant select, insert, update on table public.sd_user_preferences to authenticated;

drop policy if exists "sd_user_preferences_select_own" on public.sd_user_preferences;
create policy "sd_user_preferences_select_own"
on public.sd_user_preferences
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "sd_user_preferences_insert_own" on public.sd_user_preferences;
create policy "sd_user_preferences_insert_own"
on public.sd_user_preferences
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "sd_user_preferences_update_own" on public.sd_user_preferences;
create policy "sd_user_preferences_update_own"
on public.sd_user_preferences
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
