-- Read-only DEV privilege inventory. DO NOT run in production without review.
-- This report reveals function names / roles, NOT user data or credentials.
-- The SQL intentionally does not modify databases or assume policy adequacy.
\pset pager off
\echo 'SD Core exposed and private RPC authority inventory (informational)'
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as signature,
  p.prosecdef as security_definer,
  pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where (n.nspname='sd_core_private')
   or (n.nspname='public' and (
       p.proname like 'sd_core_%'
       or p.proname like 'admin_%wallet%'
       or p.proname like 'sd_admin_%wallet%'
       or p.proname like '%logistics%wallet%'
       or p.proname='push_sd_link_transaction'
       or p.proname='admin_finalize_sd_season_wallet_ranking'))
order by n.nspname,p.proname,signature;

\echo 'Effective Core wallet and journal table ACL/RLS inventory'
select n.nspname as schema_name,c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  pg_catalog.has_table_privilege('anon',c.oid,'INSERT') as anon_insert,
  pg_catalog.has_table_privilege('anon',c.oid,'UPDATE') as anon_update,
  pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT') as authenticated_insert,
  pg_catalog.has_table_privilege('authenticated',c.oid,'UPDATE') as authenticated_update,
  pg_catalog.has_table_privilege('authenticated',c.oid,'DELETE') as authenticated_delete
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relkind in ('r','p')
  and c.relname in ('wallets','transactions','sd_core_wallet_events','sd_core_server_wallet_events')
order by c.relname;

-- Treat every flagged callable SECURITY DEFINER as a review candidate.
-- Direct function execute is only one layer; account/device checks must be
-- tested in a trusted DEV session with ordinary and revoked users.
