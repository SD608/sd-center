\set ON_ERROR_STOP on

-- The event-trigger function must not be a callable client RPC.
do $$
begin
  if has_function_privilege('anon','public.rls_auto_enable()','EXECUTE') then
    raise exception 'anon still has EXECUTE on rls_auto_enable';
  end if;
  if has_function_privilege('authenticated','public.rls_auto_enable()','EXECUTE') then
    raise exception 'authenticated still has EXECUTE on rls_auto_enable';
  end if;
  if has_function_privilege('public','public.rls_auto_enable()','EXECUTE') then
    raise exception 'PUBLIC still has EXECUTE on rls_auto_enable';
  end if;
end;
$$;

-- Revoking client EXECUTE must not break the database-internal event trigger.
set role app_ddl;
create table public.rls_event_trigger_probe(
  id bigint generated always as identity primary key,
  note text
);
reset role;

do $$
declare
  v_rls boolean;
  v_enabled "char";
begin
  select c.relrowsecurity into v_rls
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='rls_event_trigger_probe';

  if coalesce(v_rls,false) is not true then
    raise exception 'ensure_rls event trigger stopped enabling RLS';
  end if;

  select evtenabled into v_enabled
  from pg_event_trigger
  where evtname='ensure_rls';

  if v_enabled is null or v_enabled='D' then
    raise exception 'ensure_rls event trigger is missing or disabled';
  end if;
end;
$$;

select 'RLS event-trigger execute lock regression PASS' as result;
