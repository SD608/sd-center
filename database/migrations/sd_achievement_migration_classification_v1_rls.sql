begin;

-- Chapter 3-2 follow-up hardening: make the intentionally private
-- classification table explicit to Supabase RLS tooling as well as grants.
drop policy if exists sd_achievement_migration_no_client_access_v1
  on public.sd_achievement_migration_classification;

create policy sd_achievement_migration_no_client_access_v1
on public.sd_achievement_migration_classification
for all
to anon, authenticated
using (false)
with check (false);

commit;
