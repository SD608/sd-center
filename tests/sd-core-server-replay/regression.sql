\set ON_ERROR_STOP on

do $$
declare
  uid uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  other_uid uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  old_event uuid := 'e1111111-1111-4111-8111-111111111111';
  new_event uuid := 'e2222222-2222-4222-8222-222222222222';
  bad_event uuid := 'e3333333-3333-4333-8333-333333333333';
  v_result jsonb;
  v_balance bigint;
  v_n int;
begin
  -- Verify existing private boundary, not just function text.
  if pg_catalog.has_function_privilege('anon','sd_core_private.apply_server_wallet_delta_impl(uuid,uuid,text,bigint,text,text,jsonb)','EXECUTE') then
    raise exception 'ANON_SERVER_HELPER_EXECUTE';
  end if;
  if pg_catalog.has_function_privilege('authenticated','sd_core_private.apply_server_wallet_delta_impl(uuid,uuid,text,bigint,text,text,jsonb)','EXECUTE') then
    raise exception 'AUTHENTICATED_SERVER_HELPER_EXECUTE';
  end if;
  if (select request_context is not null from public.sd_core_server_wallet_events where event_id=old_event) then
    raise exception 'HISTORICAL_EVENT_CONTEXT_UNEXPECTED';
  end if;

  -- Old, already-settled event remains a duplicate even if an old caller's
  -- description/metadata changed. Its balance must NEVER be credited twice.
  v_result := sd_core_private.apply_server_wallet_delta_impl(
    uid,old_event,'legacy_test',1000,'sd_test','different legacy description','{"case":"legacy-replay"}'::jsonb
  );
  if coalesce((v_result->>'duplicate')::boolean,false) is not true then
    raise exception 'LEGACY_REPLAY_BROKEN';
  end if;
  select balance into v_balance from public.wallets where user_id=uid;
  if v_balance<>10001000 then raise exception 'LEGACY_DOUBLE_SETTLEMENT: %',v_balance; end if;

  v_result := sd_core_private.apply_server_wallet_delta_impl(
    uid,new_event,'new_test',5000,'sd_test','new-description','{"proof":{"a":1,"b":2}}'::jsonb
  );
  if coalesce((v_result->>'duplicate')::boolean,false) then raise exception 'NEW_EVENT_NOT_INSERTED'; end if;
  if (select request_context is null from public.sd_core_server_wallet_events where event_id=new_event) then
    raise exception 'NEW_EVENT_CONTEXT_MISSING';
  end if;

  -- JSONB canonicalizes object key order, ensuring safe exact retries.
  v_result := sd_core_private.apply_server_wallet_delta_impl(
    uid,new_event,'new_test',5000,'sd_test','new-description','{"proof":{"b":2,"a":1}}'::jsonb
  );
  if coalesce((v_result->>'duplicate')::boolean,false) is not true then
    raise exception 'EXACT_RETRY_FAILED';
  end if;

  begin
    perform sd_core_private.apply_server_wallet_delta_impl(
      uid,new_event,'new_test',5000,'sd_test','changed-description','{"proof":{"a":1,"b":2}}'::jsonb
    );
    raise exception 'DESCRIPTION_CHANGE_NOT_REJECTED';
  exception when sqlstate 'P1015' then null;
  end;
  begin
    perform sd_core_private.apply_server_wallet_delta_impl(
      uid,new_event,'new_test',5000,'sd_test','new-description','{"proof":{"a":9,"b":2}}'::jsonb
    );
    raise exception 'METADATA_CHANGE_NOT_REJECTED';
  exception when sqlstate 'P1015' then null;
  end;
  begin
    perform sd_core_private.apply_server_wallet_delta_impl(
      uid,new_event,'new_test',5001,'sd_test','new-description','{"proof":{"a":1,"b":2}}'::jsonb
    );
    raise exception 'AMOUNT_CHANGE_NOT_REJECTED';
  exception when sqlstate 'P1015' then null;
  end;
  begin
    perform sd_core_private.apply_server_wallet_delta_impl(
      other_uid,new_event,'new_test',5000,'sd_test','new-description','{"proof":{"a":1,"b":2}}'::jsonb
    );
    raise exception 'USER_CHANGE_NOT_REJECTED';
  exception when sqlstate 'P1015' then null;
  end;
  -- Failed spend must roll back the event journal, wallet and ledger.
  begin
    perform sd_core_private.apply_server_wallet_delta_impl(
      uid,bad_event,'overspend',-1000000000,'sd_test','must rollback','{}'::jsonb
    );
    raise exception 'OVERSPEND_NOT_REJECTED';
  exception when sqlstate 'P1013' then null;
  end;
  select balance into v_balance from public.wallets where user_id=uid;
  if v_balance<>10006000 then raise exception 'BALANCE_INTEGRITY_FAILED: %',v_balance; end if;
  select count(*) into v_n from public.sd_core_server_wallet_events
  where event_id in (old_event,new_event,bad_event);
  if v_n<>2 then raise exception 'EVENT_JOURNAL_INTEGRITY_FAILED: %',v_n; end if;
  select count(*) into v_n from public.transactions
  where request_id in (old_event,new_event,bad_event);
  if v_n<>2 then raise exception 'LEDGER_INTEGRITY_FAILED: %',v_n; end if;

  -- Re-applying same DDL must not silently rewrite historical events.
  raise notice 'SERVER_REPLAY_CONTEXT_ISOLATED_QA_PASS';
end
$$;
