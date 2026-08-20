\set ON_ERROR_STOP on

-- Fault-injection regression. Runs only against disposable CI/dev fixtures.
-- It deliberately forces validation errors and a transaction-ledger failure to prove rollback.

create or replace function public.sd_core_ci_fail_transaction_insert()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.metadata ->> 'fault_inject', '') = 'tx_insert_fail' then
    raise exception 'FAULT_INJECT_TX_INSERT';
  end if;
  return new;
end;
$$;

create trigger sd_core_ci_fail_transaction_insert
before insert on public.transactions
for each row execute function public.sd_core_ci_fail_transaction_insert();

set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);

do $$
declare
  v_device jsonb;
  v_device_id uuid;
  v_balance bigint;
  v_event_count bigint;
  v_tx_count bigint;
  v_big_metadata jsonb;
begin
  -- Registration validation.
  begin
    perform public.sd_core_register_device('short', 'Bad Key', 'windows');
    raise exception 'expected INVALID_DEVICE_KEY';
  exception when sqlstate 'P1019' then null; end;

  begin
    perform public.sd_core_register_device(repeat('a',64), 'x', 'windows');
    raise exception 'expected INVALID_DEVICE_NAME';
  exception when sqlstate 'P1020' then null; end;

  begin
    perform public.sd_core_register_device(repeat('a',64), 'Fault Device', 'ios');
    raise exception 'expected INVALID_PLATFORM';
  exception when sqlstate 'P1021' then null; end;

  v_device := public.sd_core_register_device(repeat('a',64), 'Fault Device', 'windows');
  v_device_id := (v_device ->> 'device_id')::uuid;

  -- Event validation.
  begin
    perform public.sd_core_apply_wallet_event(v_device_id, gen_random_uuid(), 'deposit', 1, null, 'fault', '', '{}'::jsonb);
    raise exception 'expected INVALID_EVENT_TYPE';
  exception when sqlstate 'P1010' then null; end;

  begin
    perform public.sd_core_apply_wallet_event(v_device_id, gen_random_uuid(), 'reward', 0, null, 'fault', '', '{}'::jsonb);
    raise exception 'expected INVALID_AMOUNT';
  exception when sqlstate 'P1011' then null; end;

  begin
    perform public.sd_core_apply_wallet_event(v_device_id, gen_random_uuid(), 'spend', -1, null, 'fault', '', '{}'::jsonb);
    raise exception 'expected INVALID_AMOUNT negative';
  exception when sqlstate 'P1011' then null; end;

  begin
    perform public.sd_core_apply_wallet_event(v_device_id, gen_random_uuid(), 'reward', 1000000000001, null, 'fault', '', '{}'::jsonb);
    raise exception 'expected INVALID_AMOUNT cap';
  exception when sqlstate 'P1011' then null; end;

  begin
    perform public.sd_core_apply_wallet_event(v_device_id, gen_random_uuid(), 'reward', 1, null, 'fault', '', '[]'::jsonb);
    raise exception 'expected INVALID_METADATA';
  exception when sqlstate 'P1026' then null; end;

  select jsonb_build_object('blob', string_agg(md5(g::text), ''))
    into v_big_metadata
  from generate_series(1, 800) g;
  begin
    perform public.sd_core_apply_wallet_event(v_device_id, gen_random_uuid(), 'reward', 1, null, 'fault', '', v_big_metadata);
    raise exception 'expected METADATA_TOO_LARGE';
  exception when sqlstate 'P1023' then null; end;

  begin
    perform public.sd_core_apply_wallet_event(v_device_id, gen_random_uuid(), 'reward', 1, '608-CORE-0002', 'fault', '', '{}'::jsonb);
    raise exception 'expected TARGET_NOT_ALLOWED';
  exception when sqlstate 'P1012' then null; end;

  begin
    perform public.sd_core_apply_wallet_event(v_device_id, gen_random_uuid(), 'transfer', 1, '608-CORE-0001', 'fault', '', '{}'::jsonb);
    raise exception 'expected SELF_TRANSFER_NOT_ALLOWED';
  exception when sqlstate 'P1018' then null; end;

  begin
    perform public.sd_core_apply_wallet_event(v_device_id, gen_random_uuid(), 'transfer', 1, '608-CORE-NOPE', 'fault', '', '{}'::jsonb);
    raise exception 'expected TARGET_NOT_FOUND';
  exception when sqlstate 'P1017' then null; end;

  begin
    perform public.sd_core_apply_wallet_event(v_device_id, gen_random_uuid(), 'spend', 1000001, null, 'fault', '', '{}'::jsonb);
    raise exception 'expected INSUFFICIENT_FUNDS';
  exception when sqlstate 'P1013' then null; end;

  -- Force failure after wallet calculation/update, at transaction INSERT.
  -- The whole RPC must roll back wallet + event journal atomically.
  select balance into v_balance from public.wallets where user_id = auth.uid();
  if v_balance <> 1000000 then raise exception 'unexpected pre-fault balance %', v_balance; end if;

  begin
    perform public.sd_core_apply_wallet_event(
      v_device_id,
      '99999999-9999-4999-8999-999999999991',
      'reward',
      12345,
      null,
      'fault',
      'forced ledger failure',
      '{"fault_inject":"tx_insert_fail"}'::jsonb
    );
    raise exception 'expected forced transaction INSERT failure';
  exception
    when raise_exception then
      if sqlerrm <> 'FAULT_INJECT_TX_INSERT' then raise; end if;
  end;

  select balance into v_balance from public.wallets where user_id = auth.uid();
  select count(*) into v_event_count from public.sd_core_wallet_events where event_id='99999999-9999-4999-8999-999999999991';
  select count(*) into v_tx_count from public.transactions where metadata ->> 'sd_core_event_id'='99999999-9999-4999-8999-999999999991';
  if v_balance <> 1000000 or v_event_count <> 0 or v_tx_count <> 0 then
    raise exception 'reward rollback failure balance=% event=% tx=%', v_balance, v_event_count, v_tx_count;
  end if;

  -- Same forced failure during transfer must roll back BOTH wallets and both ledgers.
  begin
    perform public.sd_core_apply_wallet_event(
      v_device_id,
      '99999999-9999-4999-8999-999999999992',
      'transfer',
      10000,
      '608-CORE-0002',
      'fault',
      'forced transfer ledger failure',
      '{"fault_inject":"tx_insert_fail"}'::jsonb
    );
    raise exception 'expected forced transfer INSERT failure';
  exception
    when raise_exception then
      if sqlerrm <> 'FAULT_INJECT_TX_INSERT' then raise; end if;
  end;

  select balance into v_balance from public.wallets where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if v_balance <> 1000000 then raise exception 'sender changed after forced transfer failure %', v_balance; end if;
  select balance into v_balance from public.wallets where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if v_balance <> 50000 then raise exception 'receiver changed after forced transfer failure %', v_balance; end if;
  if exists (select 1 from public.sd_core_wallet_events where event_id='99999999-9999-4999-8999-999999999992') then
    raise exception 'forced transfer failure left event row';
  end if;
end;
$$;

reset role;

-- Device state faults.
update public.devices set link_status='paused' where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and device_key=repeat('a',64);
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);
do $$
declare v_device_id uuid; begin
  select id into v_device_id from public.devices where user_id=auth.uid() and device_key=repeat('a',64);
  begin perform public.sd_core_get_snapshot(v_device_id); raise exception 'expected DEVICE_INACTIVE';
  exception when sqlstate 'P1004' then null; end;
end $$;
reset role;

update public.devices set link_status='active', revoked_at=now() where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and device_key=repeat('a',64);
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);
do $$
declare v_device_id uuid; begin
  select id into v_device_id from public.devices where user_id=auth.uid() and device_key=repeat('a',64);
  begin perform public.sd_core_get_snapshot(v_device_id); raise exception 'expected DEVICE_REVOKED';
  exception when sqlstate 'P1006' then null; end;
end $$;
reset role;

update public.devices set revoked_at=null where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and device_key=repeat('a',64);
update public.profiles set status='suspended' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);
do $$
declare v_device_id uuid; begin
  select id into v_device_id from public.devices where user_id=auth.uid() and device_key=repeat('a',64);
  begin perform public.sd_core_get_snapshot(v_device_id); raise exception 'expected ACCOUNT_INACTIVE';
  exception when sqlstate 'P1002' then null; end;
end $$;
reset role;
update public.profiles set status='active' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

drop trigger sd_core_ci_fail_transaction_insert on public.transactions;
drop function public.sd_core_ci_fail_transaction_insert();

select 'SD Core fault injection PASS' as result;
