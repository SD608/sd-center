begin;

alter table if exists public.sd_flea_company_snapshots enable row level security;
alter table if exists public.sd_flea_profile_showcases enable row level security;
alter table if exists public.sd_flea_slot_stats enable row level security;

revoke all on table public.sd_flea_company_snapshots from anon,authenticated;
revoke all on table public.sd_flea_profile_showcases from anon,authenticated;
revoke all on table public.sd_flea_slot_stats from anon,authenticated;

comment on table public.sd_flea_company_snapshots is 'Server-owned Flea snapshot state. Direct anon/authenticated access is blocked; server RPC paths are authoritative.';
comment on table public.sd_flea_profile_showcases is 'Server-owned Flea profile showcase state. Direct anon/authenticated access is blocked.';
comment on table public.sd_flea_slot_stats is 'Server-owned Flea slot statistics. Direct anon/authenticated access is blocked.';

commit;