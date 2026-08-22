\set ON_ERROR_STOP on

insert into auth.users(id) values
 ('71111111-1111-4111-8111-111111111111'),
 ('72222222-2222-4222-8222-222222222222'),
 ('73333333-3333-4333-8333-333333333333'),
 ('74444444-4444-4444-8444-444444444444'),
 ('75555555-5555-4555-8555-555555555555'),
 ('76666666-6666-4666-8666-666666666666');

insert into public.profiles(id,nickname,role,status,created_at) values
 ('71111111-1111-4111-8111-111111111111','admin','admin','active',now()-interval '10 day'),
 ('72222222-2222-4222-8222-222222222222','a','user','active',now()-interval '10 day'),
 ('73333333-3333-4333-8333-333333333333','b','user','active',now()-interval '10 day'),
 ('74444444-4444-4444-8444-444444444444','c','user','active',now()-interval '10 day'),
 ('75555555-5555-4555-8555-555555555555','inactive','user','disabled',now()-interval '10 day'),
 ('76666666-6666-4666-8666-666666666666','e','user','active',now()-interval '10 day');

insert into public.wallets(id,user_id,account_number,balance,created_at) values
 ('81111111-1111-4111-8111-111111111111','71111111-1111-4111-8111-111111111111','RANK-ADMIN',0,now()-interval '10 day'),
 ('82222222-2222-4222-8222-222222222222','72222222-2222-4222-8222-222222222222','RANK-A',1000,now()-interval '10 day'),
 ('83333333-3333-4333-8333-333333333333','73333333-3333-4333-8333-333333333333','RANK-B',1000,now()-interval '10 day'),
 ('84444444-4444-4444-8444-444444444444','74444444-4444-4444-8444-444444444444','RANK-C',1000,now()-interval '10 day'),
 ('85555555-5555-4555-8555-555555555555','75555555-5555-4555-8555-555555555555','RANK-INACTIVE',999999999,now()-interval '10 day'),
 ('86666666-6666-4666-8666-666666666666','76666666-6666-4666-8666-666666666666','RANK-E',800,now()-interval '10 day');

-- v1 creates Season 0 before these fixture profiles exist. Pin the reviewed test interval explicitly.
update public.sd_seasons
set started_at=now()-interval '1 hour',updated_at=now()
where code='season-0' and status='open';

-- A has enormous pre-season income. v2 must ignore it. B/C tie on in-season income;
-- B reached the final 1000 balance earlier, so B must win. Inactive user must be excluded.
insert into public.transactions(wallet_id,user_id,transaction_type,description,amount,balance_before,balance_after,request_id,platform,created_at) values
 ('82222222-2222-4222-8222-222222222222','72222222-2222-4222-8222-222222222222','income','a-pre-season',999999,0,1000,'a0000000-0000-4000-8000-000000000001','server',now()-interval '2 hour'),
 ('82222222-2222-4222-8222-222222222222','72222222-2222-4222-8222-222222222222','income','a-season',100,900,1000,'a0000000-0000-4000-8000-000000000002','server',now()-interval '10 minute'),
 ('83333333-3333-4333-8333-333333333333','73333333-3333-4333-8333-333333333333','income','b-season',200,800,1000,'b0000000-0000-4000-8000-000000000001','server',now()-interval '20 minute'),
 ('84444444-4444-4444-8444-444444444444','74444444-4444-4444-8444-444444444444','income','c-season',200,800,1000,'c0000000-0000-4000-8000-000000000001','server',now()-interval '5 minute'),
 ('85555555-5555-4555-8555-555555555555','75555555-5555-4555-8555-555555555555','income','inactive-season',999999999,0,999999999,'d0000000-0000-4000-8000-000000000001','server',now()-interval '2 minute');

-- A pre-owned ranking-01 record is legitimate historical state and must never be revoked/retimestamped.
insert into public.sd_achievement_progress(user_id,achievement_id,current_value,unlocked,unlocked_at,source_app,metadata,updated_at)
values('72222222-2222-4222-8222-222222222222','ranking-01',1,true,now()-interval '5 day','server-authority','{"legacy":true}'::jsonb,now()-interval '5 day');
insert into public.sd_achievements(code,name,title_reward,active) values('other-01','Preserved','보존','true');
insert into public.sd_achievement_progress(user_id,achievement_id,current_value,unlocked,unlocked_at,source_app,metadata,updated_at)
values('74444444-4444-4444-8444-444444444444','other-01',7,true,now()-interval '4 day','server-authority','{"keep":true}'::jsonb,now()-interval '4 day');

create temporary table season_v2_baseline as
select
  (select count(*) from public.transactions) as tx_count,
  (select coalesce(sum(amount),0) from public.transactions) as tx_amount_sum,
  (select md5(string_agg(user_id::text||':'||balance::text,'|' order by user_id)) from public.wallets) as wallet_digest,
  (select unlocked_at from public.sd_achievement_progress where user_id='72222222-2222-4222-8222-222222222222' and achievement_id='ranking-01') as a_rank_unlocked_at,
  (select current_value from public.sd_achievement_progress where user_id='74444444-4444-4444-8444-444444444444' and achievement_id='other-01') as c_other_value,
  (select unlocked_at from public.sd_achievement_progress where user_id='74444444-4444-4444-8444-444444444444' and achievement_id='other-01') as c_other_unlocked_at;

select set_config('request.jwt.claim.sub','72222222-2222-4222-8222-222222222222',false);
do $$ begin
 begin
  perform public.admin_finalize_sd_season_wallet_ranking('season-0');
  raise exception 'non-admin finalize unexpectedly succeeded';
 exception when sqlstate 'P1005' then null; end;
end $$;

select set_config('request.jwt.claim.sub','71111111-1111-4111-8111-111111111111',false);
create temporary table season_v2_result as
select public.admin_finalize_sd_season_wallet_ranking('season-0') as payload;

do $$
declare
  w uuid;
  c int;
  r record;
  started timestamptz;
  finalized timestamptz;
  season1_started timestamptz;
  reward_id uuid;
  payload jsonb;
begin
  select user_id into w from public.sd_season_wallet_rankings where season_code='season-0' and rank_no=1;
  if w<>'73333333-3333-4333-8333-333333333333' then raise exception 'wrong Season 0 winner: %',w; end if;

  select * into r from public.sd_season_wallet_rankings where season_code='season-0' and user_id='72222222-2222-4222-8222-222222222222';
  if r.gross_income<>100 then raise exception 'pre-season income leaked into A gross income: %',r.gross_income; end if;
  select * into r from public.sd_season_wallet_rankings where season_code='season-0' and user_id='73333333-3333-4333-8333-333333333333';
  if r.gross_income<>200 then raise exception 'B in-season gross income mismatch: %',r.gross_income; end if;
  select * into r from public.sd_season_wallet_rankings where season_code='season-0' and user_id='74444444-4444-4444-8444-444444444444';
  if r.gross_income<>200 then raise exception 'C in-season gross income mismatch: %',r.gross_income; end if;
  if r.rank_no<>2 then raise exception 'reached-balance tie-break failed for C: rank %',r.rank_no; end if;

  select started_at,finalized_at into started,finalized from public.sd_seasons where code='season-0';
  select reached_balance_at into r from public.sd_season_wallet_rankings where season_code='season-0' and user_id='76666666-6666-4666-8666-666666666666';
  if r.reached_balance_at<>started then raise exception 'pre-existing final balance must fall back to season start'; end if;

  if exists(select 1 from public.sd_season_wallet_rankings where season_code='season-0' and user_id='75555555-5555-4555-8555-555555555555') then raise exception 'inactive profile entered ranking'; end if;
  select count(*) into c from public.sd_season_wallet_rankings where season_code='season-0';
  if c<>5 then raise exception 'ranking snapshot count mismatch: %',c; end if;

  if not exists(select 1 from public.sd_achievement_progress where user_id=w and achievement_id='ranking-01' and unlocked and current_value>=1) then raise exception 'ranking-01 was not awarded to winner'; end if;
  select id into reward_id from public.sd_achievements where code='ranking-01';
  if not exists(select 1 from public.sd_user_achievements where user_id=w and achievement_id=reward_id) then raise exception 'ranking-01 title ownership bridge missing for winner'; end if;

  if (select unlocked_at from public.sd_achievement_progress where user_id='72222222-2222-4222-8222-222222222222' and achievement_id='ranking-01') <>
     (select a_rank_unlocked_at from season_v2_baseline) then raise exception 'existing ranking achievement unlocked_at changed'; end if;
  if (select current_value from public.sd_achievement_progress where user_id='74444444-4444-4444-8444-444444444444' and achievement_id='other-01') <>
     (select c_other_value from season_v2_baseline) then raise exception 'unrelated achievement progress changed'; end if;
  if (select unlocked_at from public.sd_achievement_progress where user_id='74444444-4444-4444-8444-444444444444' and achievement_id='other-01') <>
     (select c_other_unlocked_at from season_v2_baseline) then raise exception 'unrelated achievement timestamp changed'; end if;

  if (select status from public.sd_seasons where code='season-0')<>'closed' then raise exception 'Season 0 not closed'; end if;
  if (select status from public.sd_seasons where code='season-1')<>'open' then raise exception 'Season 1 not opened'; end if;
  select started_at into season1_started from public.sd_seasons where code='season-1';
  if season1_started<>finalized then raise exception 'Season 1 boundary does not equal Season 0 finalization'; end if;
  if (select count(*) from public.sd_seasons where status='open')<>1 then raise exception 'open season invariant broken'; end if;

  if (select count(*) from public.transactions)<>(select tx_count from season_v2_baseline) then raise exception 'season finalization wrote a monetary transaction'; end if;
  if (select coalesce(sum(amount),0) from public.transactions)<>(select tx_amount_sum from season_v2_baseline) then raise exception 'season finalization changed transaction economics'; end if;
  if (select md5(string_agg(user_id::text||':'||balance::text,'|' order by user_id)) from public.wallets)<>(select wallet_digest from season_v2_baseline) then raise exception 'season finalization changed wallet balances'; end if;

  select payload into payload from season_v2_result;
  if payload->>'reward_achievement_code'<>'ranking-01' then raise exception 'wrong reward contract'; end if;
  if coalesce((payload->>'money_reward')::boolean,true) is not false then raise exception 'undefined money reward was emitted'; end if;

  if has_table_privilege('authenticated','public.sd_season_wallet_rankings','INSERT') or has_table_privilege('authenticated','public.sd_season_wallet_rankings','UPDATE') or has_table_privilege('authenticated','public.sd_season_wallet_rankings','DELETE') then raise exception 'client can mutate final ranking'; end if;
  if has_table_privilege('authenticated','public.sd_seasons','INSERT') or has_table_privilege('authenticated','public.sd_seasons','UPDATE') or has_table_privilege('authenticated','public.sd_seasons','DELETE') then raise exception 'client can mutate season lifecycle'; end if;
end $$;

-- A second open season must fail at the database invariant, not become ambiguous current state.
do $$ begin
 begin
   insert into public.sd_seasons(code,name,status,started_at) values('season-2','Season 2','open',now());
   raise exception 'second open season unexpectedly succeeded';
 exception when unique_violation then null; end;
end $$;

-- Retry must be a read-only duplicate result: no duplicate ranking/reward/money/season rows.
do $$ declare r jsonb; before_earned int; before_tx int; begin
 select count(*) into before_earned from public.sd_user_achievements;
 select count(*) into before_tx from public.transactions;
 r:=public.admin_finalize_sd_season_wallet_ranking('season-0');
 if coalesce((r->>'duplicate')::boolean,false) is not true then raise exception 'season finalize retry was not idempotent'; end if;
 if (select count(*) from public.sd_user_achievements)<>before_earned then raise exception 'retry duplicated achievement/title ownership'; end if;
 if (select count(*) from public.transactions)<>before_tx then raise exception 'retry wrote money transaction'; end if;
 if (select count(*) from public.sd_seasons where code='season-1')<>1 then raise exception 'retry duplicated Season 1'; end if;
end $$;

select 'season transition authority v2 regression PASS' as result;
