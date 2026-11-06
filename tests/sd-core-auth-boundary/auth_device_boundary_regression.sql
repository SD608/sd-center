\set ON_ERROR_STOP on
-- ISOLATED postgres:17 fixture only. Simulates request.jwt.claim.sub, NOT a signed JWT.
-- Never apply this to SD-Core-Dev or production.
begin;
set role authenticated;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  begin
    perform public.sd_core_register_device(repeat('e',64),'QA Device','windows');
    raise exception 'missing auth.uid registered a device';
  exception when sqlstate 'P1001' then null; end;
end $$;

select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
select public.sd_core_register_device(repeat('e',64),'QA Device','windows');
do $$
declare did uuid; snap jsonb; result jsonb;
begin
  select id into did from public.devices where user_id=auth.uid() and device_key=repeat('e',64);
  if did is null then raise exception 'device not registered'; end if;
  snap:=public.sd_core_get_snapshot(did);
  if (snap->>'balance')::bigint<>1000000 then raise exception 'wrong initial balance %',snap; end if;
  result:=public.sd_core_apply_wallet_event(did,'a1111111-1111-4111-8111-111111111111','spend',1000,null,'sd_core_qa','legitimate spend','{}'::jsonb);
  if (result->>'balance_after')::bigint<>999000 then raise exception 'legitimate spend failed %',result; end if;
  begin
    perform public.sd_core_apply_wallet_event(did,'a2222222-2222-4222-8222-222222222222','reward',5000,null,'sd_core_qa','forged mint','{}'::jsonb);
    raise exception 'client-side reward minted';
  exception when sqlstate 'P1030' then null; end;
end $$;

-- Under authenticated role, RLS must hide the other user's device.
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
do $$ begin
  if exists(select 1 from public.devices where device_key=repeat('e',64)) then
    raise exception 'cross-account device visible through RLS';
  end if;
end $$;

-- Fixture owner captures generated device identifier; no real account involved.
reset role;
select set_config('sd.qa_device_id',(select id::text from public.devices where device_key=repeat('e',64)),true);
set role authenticated;
do $$ begin
  begin
    perform public.sd_core_get_snapshot(current_setting('sd.qa_device_id')::uuid);
    raise exception 'foreign snapshot succeeded';
  exception when sqlstate 'P1003' then null; end;
  begin
    perform public.sd_core_apply_wallet_event(current_setting('sd.qa_device_id')::uuid,'a3333333-3333-4333-8333-333333333333','spend',500,null,'sd_core_qa','forged spend','{}'::jsonb);
    raise exception 'foreign spend succeeded';
  exception when sqlstate 'P1003' then null; end;
end $$;

-- Revoked device must be rejected by same owner, including re-registration.
reset role;
update public.devices set revoked_at=now() where id=current_setting('sd.qa_device_id')::uuid;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
set role authenticated;
do $$ begin
  begin
    perform public.sd_core_get_snapshot(current_setting('sd.qa_device_id')::uuid);
    raise exception 'revoked snapshot succeeded';
  exception when sqlstate 'P1006' then null; end;
  begin
    perform public.sd_core_apply_wallet_event(current_setting('sd.qa_device_id')::uuid,'a4444444-4444-4444-8444-444444444444','spend',500,null,'sd_core_qa','revoked spend','{}'::jsonb);
    raise exception 'revoked spend succeeded';
  exception when sqlstate 'P1006' then null; end;
  begin
    perform public.sd_core_register_device(repeat('e',64),'QA Device','windows');
    raise exception 'revoked key re-registered';
  exception when sqlstate 'P1006' then null; end;
end $$;

-- Paused device cannot debit.
reset role;
update public.devices set revoked_at=null,link_status='paused' where id=current_setting('sd.qa_device_id')::uuid;
set role authenticated;
do $$ begin
  begin
    perform public.sd_core_apply_wallet_event(current_setting('sd.qa_device_id')::uuid,'a5555555-5555-4555-8555-555555555555','spend',500,null,'sd_core_qa','paused spend','{}'::jsonb);
    raise exception 'paused device spend succeeded';
  exception when sqlstate 'P1004' then null; end;
end $$;

-- Active device still cannot access a suspended account.
reset role;
update public.devices set link_status='active' where id=current_setting('sd.qa_device_id')::uuid;
update public.profiles set status='suspended' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set role authenticated;
do $$ begin
  begin
    perform public.sd_core_get_snapshot(current_setting('sd.qa_device_id')::uuid);
    raise exception 'suspended account snapshot succeeded';
  exception when sqlstate 'P1002' then null; end;
  begin
    perform public.sd_core_apply_wallet_event(current_setting('sd.qa_device_id')::uuid,'a6666666-6666-4666-8666-666666666666','spend',500,null,'sd_core_qa','suspended spend','{}'::jsonb);
    raise exception 'suspended account spend succeeded';
  exception when sqlstate 'P1002' then null; end;
end $$;

reset role;
do $$
declare balance_a bigint; events_a int; transactions_a int;
begin
  select balance into balance_a from public.wallets where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  select count(*) into events_a from public.sd_core_wallet_events where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  select count(*) into transactions_a from public.transactions where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if balance_a<>999000 or events_a<>1 or transactions_a<>1 then
    raise exception 'rejected requests changed economic state: %, %, %',balance_a,events_a,transactions_a;
  end if;
end $$;
rollback;
select 'ISOLATED_CORE_DEVICE_PRINCIPAL_QA_PASS' as result;
