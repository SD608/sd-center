\set ON_ERROR_STOP on

create or replace function pg_temp.assert_true(p_value boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_value is distinct from true then
    raise exception 'ASSERTION_FAILED: %', p_message;
  end if;
end;
$$;

create temp table sale_numbers(k text primary key, v bigint not null);

set request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","session_id":"aaaaaaaa-0000-4000-8000-000000000001"}';
select public.record_sd_access_heartbeat(
  'miner-device-A','desktop','electron-test','Asia/Seoul','ko-KR','miner');
select public.sd_miner_v3_bind_device(
  'miner-device-A','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

-- Clear any inventory left by prior regressions through the public exact-once path.
do $$
declare
  v_sum bigint;
begin
  select coalesce(sum(b.quantity),0)::bigint into v_sum
  from public.sd_user_item_balances b
  join public.sd_item_catalog c on c.item_key=b.item_key
  where b.user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and c.source_app='sd-miner';
  if v_sum > 0 then
    perform public.sd_miner_v3_sell_all(
      '73000000-0000-4000-8000-000000000001','miner-device-A',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  end if;
end;
$$;

-- Seed exactly one of each miner resource using the private trusted item writer.
select private.apply_sd_item_delta_impl(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','seed:economy:stone','miner.ore.stone',1,
  'ci-fixture','economy_seed','{}'::jsonb);
select private.apply_sd_item_delta_impl(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','seed:economy:copper','miner.ore.copper',1,
  'ci-fixture','economy_seed','{}'::jsonb);
select private.apply_sd_item_delta_impl(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','seed:economy:iron','miner.ore.iron',1,
  'ci-fixture','economy_seed','{}'::jsonb);
select private.apply_sd_item_delta_impl(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','seed:economy:emerald','miner.gem.emerald',1,
  'ci-fixture','economy_seed','{}'::jsonb);
select private.apply_sd_item_delta_impl(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','seed:economy:diamond','miner.gem.diamond',1,
  'ci-fixture','economy_seed','{}'::jsonb);

insert into sale_numbers(k,v)
select 'wallet_before_all',balance
from public.wallets
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

select public.sd_miner_v3_sell_all(
  '74000000-0000-4000-8000-000000000001','miner-device-A',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

select pg_temp.assert_true(
  (select balance from public.wallets
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=
  (select v+6250 from sale_numbers where k='wallet_before_all'),
  'one of every ore must pay exactly 6250');
select pg_temp.assert_true(
  (select coalesce(sum(b.quantity),0)
   from public.sd_user_item_balances b
   join public.sd_item_catalog c on c.item_key=b.item_key
   where b.user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and c.source_app='sd-miner')=0,
  'sell-all must consume every seeded miner item');
select pg_temp.assert_true(
  (select count(*) from public.sd_item_events
   where event_id like '74000000-0000-4000-8000-000000000001:%')=5,
  'sell-all must create one item sub-event for each of five resources');
select pg_temp.assert_true(
  (select count(*) from public.transactions
   where request_id='74000000-0000-4000-8000-000000000001')=1,
  'sell-all must create one Core wallet transaction');
select pg_temp.assert_true(
  (select amount from public.transactions
   where request_id='74000000-0000-4000-8000-000000000001')=6250,
  'Core sell-all transaction must equal final server prices');

-- Lost-response retry must be exact-once for both inventory and wallet.
select public.sd_miner_v3_sell_all(
  '74000000-0000-4000-8000-000000000001','miner-device-A',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
select pg_temp.assert_true(
  (select balance from public.wallets
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=
  (select v+6250 from sale_numbers where k='wallet_before_all'),
  'sell-all replay must not pay twice');
select pg_temp.assert_true(
  (select count(*) from public.transactions
   where request_id='74000000-0000-4000-8000-000000000001')=1,
  'sell-all replay must keep one Core transaction');
select pg_temp.assert_true(
  (select count(*) from public.sd_item_events
   where event_id like '74000000-0000-4000-8000-000000000001:%')=5,
  'sell-all replay must not duplicate item events');

-- Individual sale uses the new 50 SD stone price.
select private.apply_sd_item_delta_impl(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','seed:economy:stone3','miner.ore.stone',3,
  'ci-fixture','economy_seed','{}'::jsonb);
insert into sale_numbers(k,v)
select 'wallet_before_stone',balance
from public.wallets
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

select public.sd_miner_v3_sell(
  'stone',3,'74000000-0000-4000-8000-000000000002','miner-device-A',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
select pg_temp.assert_true(
  (select balance from public.wallets
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=
  (select v+150 from sale_numbers where k='wallet_before_stone'),
  'three stone must pay exactly 150');
select pg_temp.assert_true(
  (select quantity from public.sd_user_item_balances
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and item_key='miner.ore.stone')=0,
  'three stone sale must consume exactly three');
select pg_temp.assert_true(
  (select count(*) from public.sd_item_events
   where event_id='74000000-0000-4000-8000-000000000002'
     and delta=-3)=1,
  'individual sale must create one -3 item event');
select pg_temp.assert_true(
  (select count(*) from public.transactions
   where request_id='74000000-0000-4000-8000-000000000002'
     and amount=150)=1,
  'individual sale must create one Core transaction for 150');

select public.sd_miner_v3_sell(
  'stone',3,'74000000-0000-4000-8000-000000000002','miner-device-A',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
select pg_temp.assert_true(
  (select balance from public.wallets
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=
  (select v+150 from sale_numbers where k='wallet_before_stone'),
  'individual sale replay must not pay twice');
select pg_temp.assert_true(
  (select count(*) from public.transactions
   where request_id='74000000-0000-4000-8000-000000000002')=1,
  'individual sale replay must keep one Core transaction');

-- Oversell must fail before either inventory or wallet changes.
insert into sale_numbers(k,v)
select 'wallet_before_oversell',balance
from public.wallets
where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
begin
  perform public.sd_miner_v3_sell(
    'diamond',1,'74000000-0000-4000-8000-000000000003','miner-device-A',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  raise exception 'expected INSUFFICIENT_ORE';
exception when sqlstate 'P1013' then null;
end;
$$;
select pg_temp.assert_true(
  (select balance from public.wallets
   where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=
  (select v from sale_numbers where k='wallet_before_oversell'),
  'oversell must leave wallet unchanged');
select pg_temp.assert_true(
  (select count(*) from public.sd_item_events
   where event_id='74000000-0000-4000-8000-000000000003')=0,
  'oversell must leave no item event');
select pg_temp.assert_true(
  (select count(*) from public.transactions
   where request_id='74000000-0000-4000-8000-000000000003')=0,
  'oversell must leave no Core transaction');

select pg_temp.assert_true(
  not exists(select 1 from public.sd_user_item_balances where quantity<0),
  'shared inventory must never become negative');

select 'miner-economy sales PASS' as result;
