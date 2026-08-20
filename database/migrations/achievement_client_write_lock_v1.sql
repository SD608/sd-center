-- Achievement authority hardening v1.
-- Release-gate candidate only: apply to production only after active achievement
-- producer/validator coverage is confirmed.

begin;

alter table public.sd_achievement_progress enable row level security;

revoke insert, update, delete, truncate, references, trigger
  on table public.sd_achievement_progress
  from authenticated, anon;
grant select on table public.sd_achievement_progress to authenticated;

drop policy if exists sd_achievement_progress_insert_own on public.sd_achievement_progress;
drop policy if exists sd_achievement_progress_update_own on public.sd_achievement_progress;
drop policy if exists sd_achievement_progress_delete_own on public.sd_achievement_progress;

revoke execute on function public.sync_sd_achievement_progress(jsonb, text)
  from public, anon, authenticated;

comment on table public.sd_achievement_progress is
  'Server/Core-owned achievement progress. Authenticated clients may read their own rows but cannot mutate final progress/unlock state.';

commit;
