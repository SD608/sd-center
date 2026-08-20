\set ON_ERROR_STOP on

-- Baseline import must preserve existing logistics progress without trusting it for future writes.
do $$
declare v public.sd_logistics_accounts%rowtype; v_count int;
begin
  select * into v from public.sd_logistics_accounts where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if v.user_id is null or v.logistics_rep<>8517 or v.completed_contracts<>168 or v.headquarters_level<>2 or v.logistics_revenue<>6151550 then
    raise exception 'legacy logistics baseline mismatch';
  end if;
  select count(*) into v_count from public.sd_logistics_vehicles where user_id=v.user_id and sold_at is null;
  if v_count<>1 then raise exception 'legacy fleet baseline mismatch'; end if;
  if has_table_privilege('authenticated','public.sd_logistics_progress','INSERT') or has_table_privilege('authenticated','public.sd_logistics_progress','UPDATE') or has_table_privilege('authenticated','public.sd_logistics_progress','DELETE') then
    raise exception 'legacy logistics snapshot remains client-writable';
  end if;
end $$;

-- All 16 logistics achievements are active and server-produced.
do $$
declare v_count int; v_progress int;
begin
  select count(*) into v_count from public.sd_achievements where code like 'logistics-%' and active;
  if v_count<>16 then raise exception 'expected 16 active logistics achievements, got %',v_count; end if;
  select count(*) into v_progress from public.sd_achievement_progress where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id like 'logistics-%';
  if v_progress<>16 then raise exception 'expected 16 authoritative logistics progress rows, got %',v_progress; end if;
  if not exists(select 1 from public.sd_achievement_progress where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='logistics-02' and unlocked and current_value>=7000) then
    raise exception 'legacy S-rank achievement was not preserved/recomputed';
  end if;
  if not exists(select 1 from public.sd_achievement_progress where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='logistics-12' and unlocked and current_value>=168) then
    raise exception 'legacy contract-count achievement was not preserved/recomputed';
  end if;
end $$;

-- Private reward/achievement helpers must not be directly callable by clients.
do $$
begin
  if has_function_privilege('authenticated','sd_core_private.apply_server_wallet_delta_impl(uuid,uuid,text,bigint,text,text,jsonb)','EXECUTE') then raise exception 'authenticated can execute server wallet helper'; end if;
  if has_function_privilege('anon','sd_core_private.apply_server_wallet_delta_impl(uuid,uuid,text,bigint,text,text,jsonb)','EXECUTE') then raise exception 'anon can execute server wallet helper'; end if;
  if has_function_privilege('authenticated','private.refresh_sd_logistics_achievements(uuid)','EXECUTE') then raise exception 'authenticated can execute achievement refresh'; end if;
  if has_function_privilege('anon','private.refresh_sd_logistics_achievements(uuid)','EXECUTE') then raise exception 'anon can execute achievement refresh'; end if;
  if has_function_privilege('anon','public.sd_logistics_purchase_vehicle(text,uuid)','EXECUTE') then raise exception 'anon can execute logistics economy api'; end if;
end $$;

select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);

-- Server-issued contract list.
select public.sd_logistics_refresh_contracts();
do $$
declare v_count int;
begin
  select count(*) into v_count from public.sd_logistics_contract_offers where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and claimed_at is null;
  if v_count<>6 then raise exception 'fresh F-rank contract count mismatch: %',v_count; end if;
end $$;

-- Fixed server price + idempotent vehicle purchase.
select public.sd_logistics_purchase_vehicle('small','33333333-3333-4333-8333-333333333333');
select public.sd_logistics_purchase_vehicle('small','33333333-3333-4333-8333-333333333333');
do $$
declare v_balance bigint; v_count int;
begin
  select balance into v_balance from public.wallets where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if v_balance<>9750000 then raise exception 'vehicle purchase price/idempotency mismatch: %',v_balance; end if;
  select count(*) into v_count from public.sd_logistics_vehicles where id='33333333-3333-4333-8333-333333333333' and user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and sold_at is null;
  if v_count<>1 then raise exception 'vehicle duplicate row detected'; end if;
  if not exists(select 1 from public.sd_achievement_progress where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and achievement_id='logistics-09' and unlocked) then
    raise exception 'vehicle purchase achievement was not server-produced';
  end if;
end $$;

-- Add a deterministic server-owned offer for timing/reward regression.
insert into public.sd_logistics_contract_offers(id,user_id,route_key,from_name,to_name,cargo,base_reward,rep_reward,min_rank,risk,required_stack,category,expires_at)
values('44444444-4444-4444-8444-444444444444','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','test','A','B','test cargo',100000,25,'F','일반',1,'일반',now()+interval '30 minutes');

select public.sd_logistics_start_contract(
 '44444444-4444-4444-8444-444444444444',
 array[(select id from public.sd_logistics_vehicles where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and starter and sold_at is null limit 1)]::uuid[]
);

do $$
declare v_delivery uuid;
begin
  select id into v_delivery from public.sd_logistics_deliveries where contract_id='44444444-4444-4444-8444-444444444444';
  begin
    perform public.sd_logistics_finish_contract(v_delivery);
    raise exception 'early delivery settlement unexpectedly succeeded';
  exception when sqlstate 'P1039' then null; end;
end $$;

update public.sd_logistics_deliveries set end_at=now()-interval '1 second' where contract_id='44444444-4444-4444-8444-444444444444';

do $$
declare v_delivery uuid; v_before bigint; v_after bigint; v_after_retry bigint; v_tx_count int;
begin
  select id into v_delivery from public.sd_logistics_deliveries where contract_id='44444444-4444-4444-8444-444444444444';
  select balance into v_before from public.wallets where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  perform public.sd_logistics_finish_contract(v_delivery);
  select balance into v_after from public.wallets where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if v_after<=v_before then raise exception 'completed delivery did not credit server reward'; end if;
  perform public.sd_logistics_finish_contract(v_delivery);
  select balance into v_after_retry from public.wallets where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if v_after_retry<>v_after then raise exception 'delivery retry double credited'; end if;
  select count(*) into v_tx_count from public.transactions where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and transaction_type='sd_server_logistics_direct_contract_reward';
  if v_tx_count<>1 then raise exception 'delivery reward transaction count mismatch: %',v_tx_count; end if;
end $$;

-- Driver payout is server-timed and server-priced.
update public.sd_logistics_accounts set headquarters_level=2 where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select public.sd_logistics_hire_driver('CI 기사','55555555-5555-4555-8555-555555555555');
select public.sd_logistics_hire_driver('CI 기사','55555555-5555-4555-8555-555555555555');
select public.sd_logistics_start_driver('55555555-5555-4555-8555-555555555555','local');

do $$
begin
  begin
    perform public.sd_logistics_settle_driver('55555555-5555-4555-8555-555555555555');
    raise exception 'early driver settlement unexpectedly succeeded';
  exception when sqlstate 'P1052' then null; end;
end $$;

update public.sd_logistics_drivers set next_payout_at=now()-interval '1 second' where id='55555555-5555-4555-8555-555555555555';
select public.sd_logistics_settle_driver('55555555-5555-4555-8555-555555555555');

do $$
declare v_count int; v_total bigint;
begin
  select count(*),coalesce(max(total_earned),0) into v_count,v_total from public.sd_logistics_drivers where id='55555555-5555-4555-8555-555555555555';
  if v_count<>1 or v_total<=0 then raise exception 'driver server settlement failed'; end if;
end $$;

select 'logistics server authority v2 regression PASS' as result;
