-- Keep the ensure_rls event trigger active while removing its function from the Data API surface.
-- Event trigger execution is database-internal; ordinary API roles do not need EXECUTE.

begin;

revoke execute on function public.rls_auto_enable()
  from public, anon, authenticated;

comment on function public.rls_auto_enable() is
  'Internal ddl_command_end event-trigger function. Not a client RPC; EXECUTE revoked from PUBLIC/anon/authenticated.';

commit;
