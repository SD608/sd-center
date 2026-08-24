\set ON_ERROR_STOP on

insert into auth.users(id) values
 ('71111111-1111-4111-8111-111111111111'),
 ('72222222-2222-4222-8222-222222222222'),
 ('73333333-3333-4333-8333-333333333333'),
 ('74444444-4444-4444-8444-444444444444'),
 ('75555555-5555-4555-8555-555555555555'),
 ('76666666-6666-4666-8666-666666666666'),
 ('77777777-7777-4777-8777-777777777777'),
 ('78888888-8888-4888-8888-888888888888');

insert into auth.sessions(id,user_id,not_after) values
 ('a1111111-1111-4111-8111-111111111111','71111111-1111-4111-8111-111111111111',now()+interval '1 day'),
 ('a1111111-1111-4111-8111-111111111112','71111111-1111-4111-8111-111111111111',now()-interval '1 minute'),
 ('a2222222-2222-4222-8222-222222222222','72222222-2222-4222-8222-222222222222',now()+interval '1 day');

insert into public.profiles(id,nickname,role,status,created_at) values
 ('71111111-1111-4111-8111-111111111111','admin','admin','active',now()-interval '10 day'),
 ('72222222-2222-4222-8222-222222222222','a','user','active',now()-interval '10 day'),
 ('73333333-3333-4333-8333-333333333333','b','user','active',now()-interval '10 day'),
 ('74444444-4444-4444-8444-444444444444','c','user','active',now()-interval '10 day'),
 ('75555555-5555-4555-8555-555555555555','inactive','user','suspended',now()-interval '10 day'),
 ('76666666-6666-4666-8666-666666666666','e','user','active',now()-interval '10 day'),
 ('77777777-7777-4777-8777-777777777777','f-started-final','user','active',now()-interval '10 day'),
 ('78888888-8888-4888-8888-888888888888','g-reached-later','user','active',now()-interval '10 day');

insert into public.wallets(id,user_id,account_number,balance,created_at) values
 ('81111111-1111-4111-8111-111111111111','71111111-1111-4111-8111-111111111111','RANK-ADMIN',0,now()-interval '10 day'),
 ('82222222-2222-4222-8222-222222222222','72222222-2222-4222-8222-222222222222','RANK-A',1000,now()-interval '10 day'),
 ('83333333-3333-4333-8333-333333333333','73333333-3333-4333-8333-333333333333','RANK-B',1000,now()-interval '10 day'),
 ('84444444-4444-4444-8444-444444444444','74444444-4444-4444-8444-444444444444','RANK-C',1000,now()-interval '10 day'),
 ('85555555-5555-4555-8555-555555555555','75555555-5555-4555-8555-555555555555','RANK-INACTIVE',999999999,now()-interval '10 day'),
 ('86666666-6666-4666-8666-666666666666','76666666-6666-4666-8666-666666666666','RANK-E',800,now()-interval '10 day'),
 ('87777777-7777-4777-8777-777777777777','77777777-7777-4777-8777-777777777777','RANK-F',900,now()-interval '10 day'),
 ('88888888-8888-4888-8888-888888888888','78888888-8888-4888-8888-888888888888','RANK-G',900,now()-interval '10 day');

insert into public.devices(id,user_id,device_key,device_name,platform,link_status,revoked_at) values
 ('91111111-1111-4111-8111-111111111111','71111111-1111-4111-8111-111111111111','admin-active','Admin Active','windows','active',null),
 ('91111111-1111-4111-8111-111111111112','71111111-1111-4111-8111-111111111111','admin-revoked','Admin Revoked','windows','active',now()-interval '1 minute'),
 ('91111111-1111-4111-8111-111111111113','71111111-1111-4111-8111-111111111111','admin-paused','Admin Paused','windows','paused',null),
 ('92222222-2222-4222-8222-222222222222','72222222-2222-4222-8222-222222222222','user-a-active','User A Active','windows','active',null);

update public.sd_seasons
set started_at=now()-interval '1 hour',updated_at=now()
where code='season-0' and status='open';

-- Pre-season ledger. A has large positive income before the season but starts Season 0 at 900.
-- F starts Season 0 already holding the same 900 balance it will finish with.
insert into public.transactions(wallet_id,user_id,transaction_type,description,amount,balance_before,balance_after,request_id,platform,created_at) values
 ('82222222-2222-4222-8222-222222222222','72222222-2222-4222-8222-222222222222','income','a-pre-season-income',999999,0,999999,'a0000000-0000-4000-8000-000000000001','server',now()-interval '2 hour'),
 ('82222222-2222-4222-8222-222222222222','72222222-2222-4222-8222-222222222222','spend','a-pre-season-spend',-999099,999999,900,'a0000000-0000-4000-8000-000000000002','server',now()-interval '119 minute'),
 ('87777777-7777-4777-8777-777777777777','77777777-7777-4777-8777-777777777777','income','f-pre-season',900,0,900,'f0000000-0000-4000-8000-000000000001','server',now()-interval '118 minute');

-- In-season ledger. B and C tie on final balance/gross income; B reaches the balance first by sync_seq.
-- F and G tie on final balance/gross income, but F already held the final balance at season start.
insert into public.transactions(wallet_id,user_id,transaction_type,description,amount,balance_before,balance_after,request_id,platform,created_at) values
 ('82222222-2222-4222-8222-222222222222','72222222-2222-4222-8222-222222222222','income','a-season',100,900,1000,'a0000000-0000-4000-8000-000000000003','server',now()-interval '30 minute'),
 ('83333333-3333-4333-8333-333333333333','73333333-3333-4333-8333-333333333333','income','b-season',200,800,1000,'b0000000-0000-4000-8000-000000000001','server',now()-interval '25 minute'),
 ('84444444-4444-4444-8444-444444444444','74444444-4444-4444-8444-444444444444','income','c-season',200,800,1000,'c0000000-0000-4000-8000-000000000001','server',now()-interval '20 minute'),
 ('85555555-5555-4555-8555-555555555555','75555555-5555-4555-8555-555555555555','income','inactive-season',999999999,0,999999999,'d0000000-0000-4000-8000-000000000001','server',now()-interval '15 minute'),
 ('87777777-7777-4777-8777-777777777777','77777777-7777-4777-8777-777777777777','spend','f-dip',-10,900,890,'f0000000-0000-4000-8000-000000000002','server',now()-interval '12 minute'),
 ('87777777-7777-4777-8777-777777777777','77777777-7777-4777-8777-777777777777','income','f-return',10,890,900,'f0000000-0000-4000-8000-000000000003','server',now()-interval '8 minute'),
 ('88888888-8888-4888-8888-888888888888','78888888-8888-4888-8888-888888888888','income','g-reach',10,890,900,'70000000-0000-4000-8000-000000000001','server',now()-interval '9 minute');

-- Existing legitimate achievement/title assets must survive finalization.
insert into public.sd_achievement_progress(user_id,achievement_id,current_value,unlocked,unlocked_at,source_app,metadata,updated_at)
values('73333333-3333-4333-8333-333333333333','ranking-01',1,true,'2026-08-01 00:00:00+00','server-authority','{"preexisting":true}'::jsonb,'2026-08-01 00:00:00+00');
insert into public.sd_achievements(code,name,title_reward,active) values('other-01','Preserved','보존',true);
insert into public.sd_achievement_progress(user_id,achievement_id,current_value,unlocked,unlocked_at,source_app,metadata,updated_at)
values('74444444-4444-4444-8444-444444444444','other-01',7,true,'2026-08-02 00:00:00+00','server-authority','{"keep":true}'::jsonb,'2026-08-02 00:00:00+00');

-- Simulate legacy privilege residue that v3 must explicitly remove.
grant trigger,references on table public.sd_seasons to authenticated;
grant trigger,references on table public.sd_season_wallet_rankings to authenticated;

select 'pre-v3 production-like state seeded' as result;
