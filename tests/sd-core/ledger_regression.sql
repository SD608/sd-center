\set ON_ERROR_STOP on

set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);

do $$
declare
  v_device_id uuid;
  v_receiver_device jsonb;
  v_receiver_device_id uuid;
  v_count bigint;
  v_after_count bigint;
  v_first_seq bigint;
begin
  select id into v_device_id
  from public.devices
  where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and device_key = repeat('a', 64);

  if v_device_id is null then
    raise exception 'sender regression device not found';
  end if;

  select count(*), min(sync_seq)
    into v_count, v_first_seq
  from public.sd_core_list_transactions(v_device_id, 0, 200);

  if v_count <> 3 then
    raise exception 'sender Core ledger count mismatch: %', v_count;
  end if;

  select count(*) into v_after_count
  from public.sd_core_list_transactions(v_device_id, v_first_seq, 200);

  if v_after_count <> 2 then
    raise exception 'sender Core ledger after_seq mismatch: %', v_after_count;
  end if;

  if pg_catalog.has_function_privilege(
    'anon',
    'public.sd_core_list_transactions(uuid,bigint,integer)',
    'EXECUTE'
  ) then
    raise exception 'anon unexpectedly has Core ledger EXECUTE';
  end if;

  -- Switch to receiver account. Receiver has one transfer-in ledger row.
  perform set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', false);

  v_receiver_device := public.sd_core_register_device(
    repeat('b', 64),
    'SD Core Receiver Device',
    'web'
  );
  v_receiver_device_id := (v_receiver_device ->> 'device_id')::uuid;

  select count(*) into v_count
  from public.sd_core_list_transactions(v_receiver_device_id, 0, 200);

  if v_count <> 1 then
    raise exception 'receiver Core ledger count mismatch: %', v_count;
  end if;

  -- Cross-account device_id must be rejected even though both users are authenticated.
  begin
    perform * from public.sd_core_list_transactions(v_device_id, 0, 100);
    raise exception 'expected DEVICE_NOT_FOUND for cross-account device';
  exception
    when sqlstate 'P1003' then
      null;
  end;
end;
$$;

reset role;

select 'SD Core ledger regression PASS' as result;
