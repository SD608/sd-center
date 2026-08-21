-- SD Core integration regression for a real Supabase database.
-- Run only on local Supabase or SD-Core-Dev as postgres/service DB owner.
-- The entire test is rolled back; it must never be pointed at production.

begin;

-- Deterministic isolated identities for test setup. Any pre-existing test state is
-- removed inside this transaction and restored by the final ROLLBACK.
delete from public.sd_core_wallet_events
 where user_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')
    or target_user_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
delete from public.transactions where user_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
delete from public.devices where user_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
delete from public.wallets where user_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
delete from public.profiles where id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
delete from auth.users where id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values
  ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'core-a@example.invalid', '', now(), '{}', '{}', now(), now(), '', '', '', ''),
  ('22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'core-b@example.invalid', '', now(), '{}', '{}', now(), now(), '', '', '', '');

insert into public.profiles (id, nickname, role, status) values
  ('11111111-1111-4111-8111-111111111111', 'Core A', 'user', 'active'),
  ('22222222-2222-4222-8222-222222222222', 'Core B', 'user', 'active');

insert into public.wallets (user_id, account_number, balance) values
  ('11111111-1111-4111-8111-111111111111', '608-CORE-0001', 1000000),
  ('22222222-2222-4222-8222-222222222222', '608-CORE-0002', 50000);

-- Simulate the Data API authenticated database role. auth.uid() is driven by
-- request.jwt.claim.sub, exactly as the public Core functions expect.
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
set local role authenticated;

do $$
declare
  v_a uuid := '11111111-1111-4111-8111-111111111111';
  v_b uuid := '22222222-2222-4222-8222-222222222222';
  v_device_a uuid;
  v_device_b uuid;
  v_json jsonb;
  v_balance bigint;
  v_count integer;
begin
  -- Device A and required wallet regression.
  v_json := public.sd_core_register_device(repeat('a', 64), 'Core Dev A', 'windows');
  v_device_a := (v_json ->> 'device_id')::uuid;

  v_json := public.sd_core_apply_wallet_event(
    v_device_a, gen_random_uuid(), 'reward', 100000,
    null, 'sd_core_test', 'reward regression', '{}'::jsonb
  );
  if (v_json ->> 'balance_before')::bigint <> 1000000
     or (v_json ->> 'balance_after')::bigint <> 1100000 then
    raise exception 'reward regression failed: %', v_json;
  end if;

  -- Keep the reward event id for replay/idempotency tests.
  create temporary table if not exists pg_temp.sd_core_ids (name text primary key, id uuid not null) on commit drop;
  insert into pg_temp.sd_core_ids(name, id)
  values ('reward', (v_json ->> 'event_id')::uuid)
  on conflict (name) do update set id = excluded.id;

  v_json := public.sd_core_apply_wallet_event(
    v_device_a, gen_random_uuid(), 'spend', 200000,
    null, 'sd_core_test', 'spend regression', '{}'::jsonb
  );
  if (v_json ->> 'balance_before')::bigint <> 1100000
     or (v_json ->> 'balance_after')::bigint <> 900000 then
    raise exception 'spend regression failed: %', v_json;
  end if;

  v_json := public.sd_core_apply_wallet_event(
    v_device_a, (select id from pg_temp.sd_core_ids where name = 'reward'),
    'reward', 100000, null, 'sd_core_test', 'reward regression', '{}'::jsonb
  );
  if coalesce((v_json ->> 'duplicate')::boolean, false) is not true
     or (v_json ->> 'current_balance')::bigint <> 900000 then
    raise exception 'duplicate replay failed: %', v_json;
  end if;

  begin
    perform public.sd_core_apply_wallet_event(
      v_device_a, (select id from pg_temp.sd_core_ids where name = 'reward'),
      'reward', 100001, null, 'sd_core_test', 'reward regression', '{}'::jsonb
    );
    raise exception 'expected P1015 idempotency conflict';
  exception when sqlstate 'P1015' then
    null;
  end;

  v_json := public.sd_core_get_snapshot(v_device_a);
  if (v_json ->> 'balance')::bigint <> 900000 then
    raise exception 'resync regression failed: %', v_json;
  end if;

  -- Device B and transfer isolation.
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  v_json := public.sd_core_register_device(repeat('b', 64), 'Core Dev B', 'web');
  v_device_b := (v_json ->> 'device_id')::uuid;

  perform set_config('request.jwt.claim.sub', v_a::text, true);
  v_json := public.sd_core_apply_wallet_event(
    v_device_a, gen_random_uuid(), 'transfer', 100000,
    '608-CORE-0002', 'sd_core_test', 'transfer regression', '{}'::jsonb
  );
  if (v_json ->> 'balance_after')::bigint <> 800000 then
    raise exception 'sender transfer balance failed: %', v_json;
  end if;

  select count(*) into v_count from public.sd_core_list_transactions(v_device_a, 0, 100);
  if v_count <> 3 then
    raise exception 'sender ledger expected 3 rows, got %', v_count;
  end if;

  select count(*) into v_count
    from public.sd_core_list_transactions(v_device_a, 0, 100)
   where transaction_type = 'sd_core_transfer_out';
  if v_count <> 1 then
    raise exception 'sender transfer_out expected 1 row, got %', v_count;
  end if;

  perform set_config('request.jwt.claim.sub', v_b::text, true);
  v_json := public.sd_core_get_snapshot(v_device_b);
  if (v_json ->> 'balance')::bigint <> 150000 then
    raise exception 'recipient transfer balance failed: %', v_json;
  end if;

  select count(*) into v_count from public.sd_core_list_transactions(v_device_b, 0, 100);
  if v_count <> 1 then
    raise exception 'recipient ledger expected 1 row, got %', v_count;
  end if;

  select count(*) into v_count
    from public.sd_core_list_transactions(v_device_b, 0, 100)
   where transaction_type = 'sd_core_transfer_in';
  if v_count <> 1 then
    raise exception 'recipient transfer_in expected 1 row, got %', v_count;
  end if;

  begin
    perform public.sd_core_get_snapshot(v_device_a);
    raise exception 'expected P1003 when user B uses user A device';
  exception when sqlstate 'P1003' then
    null;
  end;

  -- Insufficient transfer must roll back completely.
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  begin
    perform public.sd_core_apply_wallet_event(
      v_device_a, gen_random_uuid(), 'transfer', 999999999,
      '608-CORE-0002', 'sd_core_test', 'insufficient transfer', '{}'::jsonb
    );
    raise exception 'expected P1013 insufficient funds';
  exception when sqlstate 'P1013' then
    null;
  end;

  v_json := public.sd_core_get_snapshot(v_device_a);
  if (v_json ->> 'balance')::bigint <> 800000 then
    raise exception 'failed transfer changed sender balance: %', v_json;
  end if;

  perform set_config('request.jwt.claim.sub', v_b::text, true);
  v_json := public.sd_core_get_snapshot(v_device_b);
  if (v_json ->> 'balance')::bigint <> 150000 then
    raise exception 'failed transfer changed recipient balance: %', v_json;
  end if;

  -- Authenticated clients must not directly overwrite the authoritative wallet.
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  begin
    update public.wallets set balance = 123 where user_id = v_a;
    raise exception 'direct wallet update unexpectedly allowed';
  exception when insufficient_privilege then
    null;
  end;

  select (public.sd_core_get_snapshot(v_device_a) ->> 'balance')::bigint into v_balance;
  if v_balance <> 800000 then
    raise exception 'authoritative wallet changed after denied direct update: %', v_balance;
  end if;
end;
$$;

rollback;
