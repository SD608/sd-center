\set ON_ERROR_STOP on

create or replace function pg_temp.assert_true(p_value boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if p_value is distinct from true then
    raise exception 'ASSERTION_FAILED: %', p_message;
  end if;
end;
$$;

create temp table shared_item_numbers(k text primary key, v bigint not null);
create temp table shared_item_ids(k text primary key, v uuid not null);

-- Schema/privilege contract: catalog and own balances/events are readable,
-- but no authenticated client can mutate shared assets or call the private writer.
select pg_temp.assert_true(
  (select count(*) from public.sd_item_catalog where source_app='sd-miner')=5,
  'five miner resources must exist in shared catalog');
select pg_temp.assert_true(
  not has_table_privilege('authenticated','public.sd_user_item_balances','INSERT')
  and not has_table_privilege('authenticated','public.sd_user_item_balances','UPDATE')
  and not has_table_privilege('authenticated','public.sd_user_item_balances','DELETE'),
  'authenticated client must not mutate shared balances');
select pg_temp.assert_true(
  not has_table_privilege('authenticated','public.sd_item_events','INSERT')
  and not has_table_privilege('authenticated','public.sd_item_events','UPDATE')
  and not has_table_privilege('authenticated','public.sd_item_events','DELETE'),
  'authenticated client must not mutate item journal');
select pg_temp.assert_true(
  not has_function_privilege(
    'authenticated',
    'private.apply_sd_item_delta_impl(uuid,text,text,bigint,text,text,jsonb)',
    'EXECUTE'
  ),
  'authenticated client must not call private item delta helper');
select pg_temp.assert_true(
  has_function_privilege('authenticated','public.get_my_sd_item_inventory()','EXECUTE'),
  'authenticated client must have read inventory API');

-- The one-time cutover must equal the exact current miner snapshot. It must not
-- mint a second copy or erase lifetime acquisition history.
select pg_temp.assert_true(
  not exists (
    select 1
    from public.sd_miner_inventory i
    join public.sd_user_item_balances b
      on b.user_id=i.user_id
     and b.item_key=private.sd_miner_v3_resource_key(i.ore_key)
    where b.quantity<>i.quantity
       or b.lifetime_acquired<>greatest(i.acquired_count,i.quantity)
       or b.lifetime_spent<>greatest(i.acquired_count-i.quantity,0)
  ),
  'shared cutover must exactly preserve current quantity and lifetime counters');
select pg_temp.assert_true(
  (select count(*) from public.sd_user_item_balances)=
  (select count(*) from public.sd_miner_inventory),
  'cutover must create exactly one shared balance per legacy miner balance');
select pg_temp.assert_true(
  (select count(*) from public.sd_item_events where event_type='miner_inventory_cutover')=
  (select count(*) from public.sd_miner_inventory where quantity>0),
  'positive migrated balances must have one migration journal event');

-- RLS: user A cannot read user B balances while acting as authenticated.
set request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","session_id":"aaaaaaaa-0000-4000-8000-000000000001"}';
set role authenticated;
select pg_temp.assert_true(
  (select count(*) from public.sd_user_item_balances
   where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=0,
  'RLS must hide another user shared balances');
select pg_temp.assert_true(
  (select count(*) from public.sd_item_events
   where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')=0,
  'RLS must hide another user item events');
select pg_temp.assert_true(
  (public.get_my_sd_item_inventory()->>'authority')='sd-item-v1',
  'shared inventory read API must report sd-item-v1 authority');
reset role;

-- Restore the active miner session/device used by Chapter 4-2.
set request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","session_id":"aaaaaaaa-0000-4000-8000-000000000001"}';
select public.record_sd_access_heartbeat(
  'miner-device-A','desktop','electron-test','Asia/Seoul','ko-KR','miner');
select public.sd_miner_v3_bind_device(
  'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )->>'inventory_authority')='sd-item-v1',
  'miner state must read current quantity from shared inventory');
select pg_temp.assert_true(
  (public.sd_miner_v3_get_state(
    'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )->'config'->>'item_authority')='sd-item-v1',
  'miner config must advertise shared item authority');

insert into shared_item_numbers(k,v)
select 'legacy_sum',coalesce(sum(quantity),0)
from public.sd_miner_inventory
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into shared_item_numbers(k,v)
select 'common_sum_before_claim',coalesce(sum(quantity),0)
from public.sd_user_item_balances
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into shared_item_ids(k,v)
select 'pending_job',job_id
from public.sd_miner_jobs
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and status='active';
select pg_temp.assert_true(
  (select count(*) from shared_item_ids where k='pending_job')=1,
  'Chapter 4-2 must leave one ready job for cutover continuity test');

-- Claim the job that was started before the shared-inventory migration. The claim
-- must land exactly once in the common balance, not in the legacy quantity table.
update public.sd_miner_jobs
set started_at=clock_timestamp()-interval '2 seconds',
    ready_at=clock_timestamp()-interval '1 second'
where job_id=(select v from shared_item_ids where k='pending_job');

select public.sd_miner_v3_claim(
  '60000000-0000-4000-8000-000000000001',
  (select v from shared_item_ids where k='pending_job'),
  'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

select pg_temp.assert_true(
  (select coalesce(sum(quantity),0) from public.sd_user_item_balances
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=
  (select v+1 from shared_item_numbers where k='common_sum_before_claim'),
  'post-cutover claim must add exactly one common item');
select pg_temp.assert_true(
  (select coalesce(sum(quantity),0) from public.sd_miner_inventory
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=
  (select v from shared_item_numbers where k='legacy_sum'),
  'legacy miner quantity snapshot must stop changing after cutover');
select pg_temp.assert_true(
  (select count(*) from public.sd_item_events
   where event_id='60000000-0000-4000-8000-000000000001'
     and user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and delta=1)=1,
  'accepted claim must create exactly one shared item event');
select pg_temp.assert_true(
  exists(
    select 1
    from public.sd_item_events e
    join public.sd_user_item_balances b
      on b.user_id=e.user_id and b.item_key=e.item_key
    where e.event_id='60000000-0000-4000-8000-000000000001'
      and e.quantity_after=b.quantity
  ),
  'claim item event result must match canonical balance');

select public.sd_miner_v3_claim(
  '60000000-0000-4000-8000-000000000001',
  (select v from shared_item_ids where k='pending_job'),
  'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
select pg_temp.assert_true(
  (select count(*) from public.sd_item_events
   where event_id='60000000-0000-4000-8000-000000000001')=1,
  'claim retry must not duplicate shared item event');

-- Single-resource sale must atomically reduce shared quantity and credit Core once.
insert into shared_item_numbers(k,v)
select 'stone_before_sale',quantity
from public.sd_user_item_balances
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and item_key='miner.ore.stone';
insert into shared_item_numbers(k,v)
select 'wallet_before_sale',balance
from public.wallets where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select pg_temp.assert_true(
  (select v from shared_item_numbers where k='stone_before_sale')>=3,
  'fixture must retain at least three stone for common sale test');

select public.sd_miner_v3_sell(
  'stone',3,'60000000-0000-4000-8000-000000000002','miner-device-A',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
select pg_temp.assert_true(
  (select quantity from public.sd_user_item_balances
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and item_key='miner.ore.stone')=
  (select v-3 from shared_item_numbers where k='stone_before_sale'),
  'sale must reduce common stone exactly once');
select pg_temp.assert_true(
  (select balance from public.wallets where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=
  (select v+300 from shared_item_numbers where k='wallet_before_sale'),
  'sale must credit Core exactly 300');
select pg_temp.assert_true(
  (select count(*) from public.sd_item_events
   where event_id='60000000-0000-4000-8000-000000000002'
     and item_key='miner.ore.stone' and delta=-3)=1,
  'sale must journal one -3 item event');
select pg_temp.assert_true(
  (select count(*) from public.transactions
   where request_id='60000000-0000-4000-8000-000000000002')=1,
  'sale must create one Core transaction');

select public.sd_miner_v3_sell(
  'stone',3,'60000000-0000-4000-8000-000000000002','miner-device-A',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
select pg_temp.assert_true(
  (select count(*) from public.sd_item_events
   where event_id='60000000-0000-4000-8000-000000000002')=1,
  'sale retry must not duplicate item journal');
select pg_temp.assert_true(
  (select count(*) from public.transactions
   where request_id='60000000-0000-4000-8000-000000000002')=1,
  'sale retry must not duplicate Core transaction');

do $$
begin
  perform public.sd_miner_v3_sell(
    'stone',4,'60000000-0000-4000-8000-000000000002','miner-device-A',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  raise exception 'expected MINER_REQUEST_IDEMPOTENCY_CONFLICT';
exception when sqlstate 'P1015' then null;
end;
$$;

-- Insufficient inventory must fail before any wallet mutation or item journal entry.
insert into shared_item_numbers(k,v)
select 'wallet_before_oversell',balance
from public.wallets where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
begin
  perform public.sd_miner_v3_sell(
    'diamond',1000000,'60000000-0000-4000-8000-000000000003','miner-device-A',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  raise exception 'expected INSUFFICIENT_ORE';
exception when sqlstate 'P1013' then null;
end;
$$;
select pg_temp.assert_true(
  (select balance from public.wallets where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=
  (select v from shared_item_numbers where k='wallet_before_oversell'),
  'oversell must not change wallet');
select pg_temp.assert_true(
  (select count(*) from public.sd_item_events
   where event_id='60000000-0000-4000-8000-000000000003')=0,
  'oversell must not create item event');

-- Sell-all uses one Core event and deterministic per-item sub-events. Every current
-- shared miner item must reach zero atomically; a retry must replay without change.
insert into shared_item_numbers(k,v)
select 'sell_all_amount',coalesce(sum(
  b.quantity*private.sd_miner_ore_price(c.metadata->>'legacy_ore_key')
),0)::bigint
from public.sd_user_item_balances b
join public.sd_item_catalog c on c.item_key=b.item_key
where b.user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and c.source_app='sd-miner';
insert into shared_item_numbers(k,v)
select 'sell_all_nonzero_items',count(*)
from public.sd_user_item_balances b
join public.sd_item_catalog c on c.item_key=b.item_key
where b.user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and c.source_app='sd-miner' and b.quantity>0;
insert into shared_item_numbers(k,v)
select 'wallet_before_sell_all',balance
from public.wallets where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select pg_temp.assert_true(
  (select v from shared_item_numbers where k='sell_all_amount')>0,
  'sell-all fixture must contain common miner items');

select public.sd_miner_v3_sell_all(
  '60000000-0000-4000-8000-000000000004','miner-device-A',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
select pg_temp.assert_true(
  (select coalesce(sum(b.quantity),0)
   from public.sd_user_item_balances b
   join public.sd_item_catalog c on c.item_key=b.item_key
   where b.user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and c.source_app='sd-miner')=0,
  'sell-all must atomically clear all common miner balances');
select pg_temp.assert_true(
  (select balance from public.wallets where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=
  (select (select v from shared_item_numbers where k='wallet_before_sell_all')+
          (select v from shared_item_numbers where k='sell_all_amount')),
  'sell-all Core credit must equal server-computed common inventory value');
select pg_temp.assert_true(
  (select count(*) from public.sd_item_events
   where event_id like '60000000-0000-4000-8000-000000000004:%')=
  (select v from shared_item_numbers where k='sell_all_nonzero_items'),
  'sell-all must create exactly one sub-event per nonzero item');
select pg_temp.assert_true(
  (select count(*) from public.transactions
   where request_id='60000000-0000-4000-8000-000000000004')=1,
  'sell-all must create exactly one Core transaction');

select public.sd_miner_v3_sell_all(
  '60000000-0000-4000-8000-000000000004','miner-device-A',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
select pg_temp.assert_true(
  (select count(*) from public.sd_item_events
   where event_id like '60000000-0000-4000-8000-000000000004:%')=
  (select v from shared_item_numbers where k='sell_all_nonzero_items'),
  'sell-all retry must not duplicate sub-events');
select pg_temp.assert_true(
  (select count(*) from public.transactions
   where request_id='60000000-0000-4000-8000-000000000004')=1,
  'sell-all retry must not duplicate Core transaction');

do $$
begin
  perform public.sd_miner_v3_sell_all(
    '60000000-0000-4000-8000-000000000005','miner-device-A',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  raise exception 'expected MINER_NOTHING_TO_SELL';
exception when sqlstate 'P1031' then null;
end;
$$;

-- The legacy snapshot and legal achievement assets must remain unchanged/monotonic.
select pg_temp.assert_true(
  (select coalesce(sum(quantity),0) from public.sd_miner_inventory
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=
  (select v from shared_item_numbers where k='legacy_sum'),
  'common claim/sell must not rewrite legacy miner snapshot');
select pg_temp.assert_true(
  (select current_value from public.sd_achievement_progress
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='miner-01')>=86,
  'miner-01 legal progress must never decrease');
select pg_temp.assert_true(
  (select unlocked from public.sd_achievement_progress
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='miner-06'),
  'miner-06 legal unlock must remain');
select pg_temp.assert_true(
  (select current_value from public.sd_achievement_progress
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='miner-08')>=5,
  'miner-08 legal progress must never decrease');

-- Shared exact-once helper regression (trusted/server context only): same event replays,
-- conflicting reuse is rejected, and only one quantity change is committed.
select private.apply_sd_item_delta_impl(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'test:shared:item:exact-once:1','miner.ore.iron',2,
  'ci-test','grant','{}'::jsonb);
select pg_temp.assert_true(
  (private.apply_sd_item_delta_impl(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'test:shared:item:exact-once:1','miner.ore.iron',2,
    'ci-test','grant','{}'::jsonb)->>'duplicate')::boolean,
  'same shared item event must replay as duplicate');
select pg_temp.assert_true(
  (select quantity from public.sd_user_item_balances
   where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and item_key='miner.ore.iron')=2,
  'same shared item event must apply quantity exactly once');
do $$
begin
  perform private.apply_sd_item_delta_impl(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'test:shared:item:exact-once:1','miner.ore.iron',3,
    'ci-test','grant','{}'::jsonb);
  raise exception 'expected ITEM_EVENT_IDEMPOTENCY_CONFLICT';
exception when sqlstate 'P1015' then null;
end;
$$;

select 'shared-item-inventory-v1 regression PASS' as result;
