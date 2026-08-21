\set ON_ERROR_STOP on

insert into auth.users(id) values
 ('71111111-1111-4111-8111-111111111111'),('72222222-2222-4222-8222-222222222222'),('73333333-3333-4333-8333-333333333333'),('74444444-4444-4444-8444-444444444444');
insert into public.profiles(id,nickname,role,status) values
 ('71111111-1111-4111-8111-111111111111','admin','admin','active'),
 ('72222222-2222-4222-8222-222222222222','a','user','active'),
 ('73333333-3333-4333-8333-333333333333','b','user','active'),
 ('74444444-4444-4444-8444-444444444444','c','user','active');
insert into public.wallets(id,user_id,account_number,balance) values
 ('81111111-1111-4111-8111-111111111111','71111111-1111-4111-8111-111111111111','RANK-ADMIN',0),
 ('82222222-2222-4222-8222-222222222222','72222222-2222-4222-8222-222222222222','RANK-A',1000),
 ('83333333-3333-4333-8333-333333333333','73333333-3333-4333-8333-333333333333','RANK-B',1000),
 ('84444444-4444-4444-8444-444444444444','74444444-4444-4444-8444-444444444444','RANK-C',900);
insert into public.transactions(wallet_id,user_id,transaction_type,description,amount,balance_before,balance_after,request_id,platform,created_at) values
 ('82222222-2222-4222-8222-222222222222','72222222-2222-4222-8222-222222222222','income','a',2000,0,1000,'a1111111-1111-4111-8111-111111111111','server',now()-interval '2 hour'),
 ('83333333-3333-4333-8333-333333333333','73333333-3333-4333-8333-333333333333','income','b',3000,0,1000,'b2222222-2222-4222-8222-222222222222','server',now()-interval '1 hour'),
 ('84444444-4444-4444-8444-444444444444','74444444-4444-4444-8444-444444444444','income','c',5000,0,900,'c3333333-3333-4333-8333-333333333333','server',now()-interval '30 minute');

select set_config('request.jwt.claim.sub','72222222-2222-4222-8222-222222222222',false);
do $$ begin
 begin
  perform public.admin_finalize_sd_season_wallet_ranking('season-0');
  raise exception 'non-admin finalize unexpectedly succeeded';
 exception when sqlstate 'P1005' then null; end;
end $$;

select set_config('request.jwt.claim.sub','71111111-1111-4111-8111-111111111111',false);
select public.admin_finalize_sd_season_wallet_ranking('season-0');

do $$ declare w uuid; c int; begin
 select user_id into w from public.sd_season_wallet_rankings where season_code='season-0' and rank_no=1;
 if w<>'73333333-3333-4333-8333-333333333333' then raise exception 'wrong Season 0 winner: %',w; end if;
 if not exists(select 1 from public.sd_achievement_progress where user_id=w and achievement_id='ranking-01' and unlocked and current_value>=1) then raise exception 'ranking-01 was not awarded to winner'; end if;
 if exists(select 1 from public.sd_achievement_progress where user_id<>'73333333-3333-4333-8333-333333333333' and achievement_id='ranking-01' and unlocked) then raise exception 'ranking-01 awarded to non-winner'; end if;
 select count(*) into c from public.sd_season_wallet_rankings where season_code='season-0';
 if c<>4 then raise exception 'ranking snapshot count mismatch: %',c; end if;
 if has_table_privilege('authenticated','public.sd_season_wallet_rankings','INSERT') or has_table_privilege('authenticated','public.sd_season_wallet_rankings','UPDATE') or has_table_privilege('authenticated','public.sd_season_wallet_rankings','DELETE') then raise exception 'client can mutate final ranking'; end if;
end $$;

do $$ declare r jsonb; begin
 r:=public.admin_finalize_sd_season_wallet_ranking('season-0');
 if coalesce((r->>'duplicate')::boolean,false) is not true then raise exception 'season finalize retry was not idempotent'; end if;
end $$;

select 'season ranking authority regression PASS' as result;
