begin;

create table if not exists public.sd_mukjjippa_accounts(
  user_id uuid primary key references auth.users(id) on delete cascade,
  best_streak integer not null default 0 check(best_streak between 0 and 8),
  best_all_in_streak integer not null default 0 check(best_all_in_streak between 0 and 8),
  games bigint not null default 0 check(games>=0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.sd_mukjjippa_server_sessions(
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  stake bigint not null check(stake between 100 and 1000000000),
  streak integer not null default 0 check(streak between 0 and 8),
  potential_payout bigint not null default 0 check(potential_payout>=0),
  status text not null default 'active' check(status in('active','cashed_out','lost')),
  phase text not null default 'rps' check(phase in('rps','mjp','decision','complete')),
  attacker text check(attacker is null or attacker in('player','computer')),
  hand_number integer not null default 1 check(hand_number>=1),
  computer_move text check(computer_move in('rock','scissors','paper')),
  computer_nonce text,
  computer_commitment text,
  all_in boolean not null default false,
  result text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index if not exists sd_mukjjippa_one_active on public.sd_mukjjippa_server_sessions(user_id) where status='active';
create table if not exists public.sd_mukjjippa_actions(
  request_id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,action_type text not null,
  session_id uuid,input jsonb not null default '{}'::jsonb check(jsonb_typeof(input)='object'),result jsonb not null default '{}'::jsonb check(jsonb_typeof(result)='object'),created_at timestamptz not null default now()
);

alter table public.sd_mukjjippa_accounts enable row level security;
alter table public.sd_mukjjippa_server_sessions enable row level security;
alter table public.sd_mukjjippa_actions enable row level security;
revoke all on public.sd_mukjjippa_accounts,public.sd_mukjjippa_server_sessions,public.sd_mukjjippa_actions from public,anon,authenticated;

create or replace function private.sd_mukjjippa_replay(p_user uuid,p_req uuid,p_action text,p_session uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$declare v public.sd_mukjjippa_actions%rowtype; begin
 if p_req is null then raise exception using errcode='P1007',message='REQUEST_ID_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_req::text,0)); select * into v from public.sd_mukjjippa_actions where request_id=p_req;
 if v.request_id is null then return null; end if;
 if v.user_id is distinct from p_user or v.action_type is distinct from p_action or v.session_id is distinct from p_session or v.input is distinct from coalesce(p_input,'{}'::jsonb) then raise exception using errcode='P1015',message='MUKJJIPPA_REQUEST_IDEMPOTENCY_CONFLICT'; end if;
 return v.result; end$$;
create or replace function private.sd_mukjjippa_save(p_user uuid,p_req uuid,p_action text,p_session uuid,p_input jsonb,p_result jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$begin insert into public.sd_mukjjippa_actions values(p_req,p_user,p_action,p_session,coalesce(p_input,'{}'::jsonb),coalesce(p_result,'{}'::jsonb),now()); return p_result; end$$;
create or replace function private.sd_mukjjippa_move() returns text language plpgsql volatile security definer set search_path='' as $$declare r int:=floor(random()*3)::int; begin return case r when 0 then 'rock' when 1 then 'scissors' else 'paper' end; end$$;
create or replace function private.sd_mukjjippa_compare(p_player text,p_cpu text) returns text language plpgsql immutable security definer set search_path='' as $$begin
 if p_player=p_cpu then return 'tie'; end if;
 if (p_player='rock' and p_cpu='scissors') or (p_player='scissors' and p_cpu='paper') or (p_player='paper' and p_cpu='rock') then return 'player'; end if; return 'computer'; end$$;
create or replace function private.sd_mukjjippa_payout(p_stake bigint,p_streak int) returns bigint language sql immutable security definer set search_path='' as $$select floor(p_stake*1.9*power(1.5,p_streak-1))::bigint$$;
create or replace function private.sd_mukjjippa_set_hand(p_session uuid,p_hand int) returns void language plpgsql volatile security definer set search_path='' as $$declare m text:=private.sd_mukjjippa_move(); n text:=replace(gen_random_uuid()::text,'-',''); c text; begin c:=encode(digest(p_session::text||':'||p_hand::text||':'||m||':'||n,'sha256'),'hex'); update public.sd_mukjjippa_server_sessions set computer_move=m,computer_nonce=n,computer_commitment=c where id=p_session; end$$;
create or replace function private.refresh_sd_mukjjippa_achievements(p_user uuid) returns void language plpgsql security definer set search_path='' as $$declare a public.sd_mukjjippa_accounts%rowtype; begin
 insert into public.sd_mukjjippa_accounts(user_id) values(p_user) on conflict do nothing; select * into a from public.sd_mukjjippa_accounts where user_id=p_user;
 perform private.upsert_sd_authoritative_achievement(p_user,'mukjjippa-01',a.best_streak,8,jsonb_build_object('authority','mukjjippa-server','metric','best_streak'));
 perform private.upsert_sd_authoritative_achievement(p_user,'mukjjippa-02',a.best_all_in_streak,8,jsonb_build_object('authority','mukjjippa-server','metric','best_all_in_streak'));
 end$$;
revoke all on function private.sd_mukjjippa_replay(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
revoke all on function private.sd_mukjjippa_save(uuid,uuid,text,uuid,jsonb,jsonb) from public,anon,authenticated;
revoke all on function private.sd_mukjjippa_move() from public,anon,authenticated;
revoke all on function private.sd_mukjjippa_compare(text,text) from public,anon,authenticated;
revoke all on function private.sd_mukjjippa_payout(bigint,int) from public,anon,authenticated;
revoke all on function private.sd_mukjjippa_set_hand(uuid,int) from public,anon,authenticated;
revoke all on function private.refresh_sd_mukjjippa_achievements(uuid) from public,anon,authenticated;

create or replace function public.sd_mukjjippa_get_state() returns jsonb language plpgsql security definer set search_path='' as $$declare u uuid:=auth.uid(); s public.sd_mukjjippa_server_sessions%rowtype; a public.sd_mukjjippa_accounts%rowtype; begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if; insert into public.sd_mukjjippa_accounts(user_id) values(u) on conflict do nothing; select * into a from public.sd_mukjjippa_accounts where user_id=u; select * into s from public.sd_mukjjippa_server_sessions where user_id=u and status='active' order by created_at desc limit 1;
 return jsonb_build_object('ok',true,'stats',jsonb_build_object('best_streak',a.best_streak,'best_all_in_streak',a.best_all_in_streak,'games',a.games),'session',case when s.id is null then null else jsonb_build_object('id',s.id,'stake',s.stake,'streak',s.streak,'potential_payout',s.potential_payout,'phase',s.phase,'attacker',s.attacker,'hand_number',s.hand_number,'commitment',s.computer_commitment,'all_in',s.all_in) end,'max_streak',8,'min_bet',100,'max_bet',1000000000); end$$;

create or replace function public.sd_mukjjippa_start(p_bet_amount bigint,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare u uuid:=auth.uid(); v_bet bigint:=coalesce(p_bet_amount,0); v_replay jsonb; v_balance bigint; v_wallet jsonb; v_result jsonb; begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if; if v_bet<100 or v_bet>1000000000 then raise exception using errcode='P1011',message='INVALID_MUKJJIPPA_BET'; end if;
 v_replay:=private.sd_mukjjippa_replay(u,p_request_id,'start',p_request_id,jsonb_build_object('bet',v_bet)); if v_replay is not null then return v_replay; end if;
 if exists(select 1 from public.sd_mukjjippa_server_sessions where user_id=u and status='active') then raise exception using errcode='P1031',message='MUKJJIPPA_SESSION_ACTIVE'; end if;
 select balance into v_balance from public.wallets where user_id=u for update; if v_balance is null then raise exception using errcode='P1016',message='WALLET_NOT_FOUND'; end if;
 v_wallet:=sd_core_private.apply_server_wallet_delta_impl(u,p_request_id,'mukjjippa_stake',-v_bet,'sd_mukjjippa','SD묵찌빠 도전금',jsonb_build_object('session_id',p_request_id));
 insert into public.sd_mukjjippa_accounts(user_id) values(u) on conflict do nothing;
 insert into public.sd_mukjjippa_server_sessions(id,user_id,stake,all_in) values(p_request_id,u,v_bet,v_bet=v_balance); perform private.sd_mukjjippa_set_hand(p_request_id,1);
 v_result:=jsonb_build_object('ok',true,'session_id',p_request_id,'stake',v_bet,'all_in',v_bet=v_balance,'balance_after',(v_wallet->>'balance_after')::bigint,(select 'commitment'),'');
 select v_result||jsonb_build_object('commitment',computer_commitment,'hand_number',1,'phase','rps') into v_result from public.sd_mukjjippa_server_sessions where id=p_request_id;
 return private.sd_mukjjippa_save(u,p_request_id,'start',p_request_id,jsonb_build_object('bet',v_bet),v_result); end$$;

create or replace function public.sd_mukjjippa_play(p_session_id uuid,p_player_move text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare
 u uuid:=auth.uid(); p text:=lower(trim(coalesce(p_player_move,''))); s public.sd_mukjjippa_server_sessions%rowtype; v_replay jsonb; cmp text; next_phase text; next_attacker text; v_streak int; v_payout bigint; v_result jsonb; v_wallet jsonb; v_match text; v_reveal jsonb; v_next_hand int;
begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if; if p not in('rock','scissors','paper') then raise exception using errcode='P1010',message='INVALID_MUKJJIPPA_MOVE'; end if;
 v_replay:=private.sd_mukjjippa_replay(u,p_request_id,'play',p_session_id,jsonb_build_object('move',p)); if v_replay is not null then return v_replay; end if;
 select * into s from public.sd_mukjjippa_server_sessions where id=p_session_id and user_id=u for update; if s.id is null or s.status<>'active' or s.phase not in('rps','mjp') then raise exception using errcode='P1031',message='MUKJJIPPA_PLAY_NOT_ALLOWED'; end if;
 cmp:=private.sd_mukjjippa_compare(p,s.computer_move); v_reveal:=jsonb_build_object('hand_number',s.hand_number,'player_move',p,'computer_move',s.computer_move,'nonce',s.computer_nonce,'commitment',s.computer_commitment,'comparison',cmp);
 next_phase:=s.phase; next_attacker:=s.attacker; v_streak:=s.streak; v_payout:=s.potential_payout; v_match:=null;
 if s.phase='rps' then if cmp='tie' then next_phase:='rps'; next_attacker:=null; else next_phase:='mjp'; next_attacker:=cmp; end if;
 elsif p=s.computer_move then
   v_match:=case when s.attacker='player' then 'player_win' else 'computer_win' end;
   if v_match='player_win' then v_streak:=s.streak+1; v_payout:=private.sd_mukjjippa_payout(s.stake,v_streak);
     update public.sd_mukjjippa_accounts set best_streak=greatest(best_streak,v_streak),best_all_in_streak=greatest(best_all_in_streak,case when s.all_in then v_streak else 0 end),updated_at=now() where user_id=u;
     if v_streak>=8 then
       v_wallet:=sd_core_private.apply_server_wallet_delta_impl(u,p_request_id,'mukjjippa_payout',v_payout,'sd_mukjjippa','SD묵찌빠 8연승 자동 정산',jsonb_build_object('session_id',s.id,'streak',v_streak,'all_in',s.all_in));
       update public.sd_mukjjippa_server_sessions set streak=v_streak,potential_payout=v_payout,status='cashed_out',phase='complete',result='max_streak',updated_at=now(),ended_at=now() where id=s.id;
       update public.sd_mukjjippa_accounts set games=games+1 where user_id=u; perform private.refresh_sd_mukjjippa_achievements(u);
       v_result:=jsonb_build_object('ok',true,'session_id',s.id,'session_complete',true,'streak',v_streak,'payout',v_payout,'balance_after',(v_wallet->>'balance_after')::bigint,'auto_cashed_out',true,'reveal',v_reveal); return private.sd_mukjjippa_save(u,p_request_id,'play',s.id,jsonb_build_object('move',p),v_result);
     else next_phase:='decision'; end if;
   else update public.sd_mukjjippa_server_sessions set status='lost',phase='complete',potential_payout=0,result='streak_lost',updated_at=now(),ended_at=now() where id=s.id; update public.sd_mukjjippa_accounts set games=games+1 where user_id=u; perform private.refresh_sd_mukjjippa_achievements(u); v_result:=jsonb_build_object('ok',true,'session_id',s.id,'session_complete',true,'lost',true,'streak',s.streak,'reveal',v_reveal); return private.sd_mukjjippa_save(u,p_request_id,'play',s.id,jsonb_build_object('move',p),v_result); end if;
 else next_attacker:=cmp; next_phase:='mjp'; end if;
 v_next_hand:=s.hand_number+1; update public.sd_mukjjippa_server_sessions set streak=v_streak,potential_payout=v_payout,phase=next_phase,attacker=next_attacker,hand_number=v_next_hand,result=case when v_match='player_win' then 'player_win' else null end,updated_at=now() where id=s.id;
 if next_phase in('rps','mjp') then perform private.sd_mukjjippa_set_hand(s.id,v_next_hand); else update public.sd_mukjjippa_server_sessions set computer_move=null,computer_nonce=null,computer_commitment=null where id=s.id; end if;
 select jsonb_build_object('ok',true,'session_id',id,'session_complete',false,'phase',phase,'attacker',attacker,'streak',streak,'potential_payout',potential_payout,'hand_number',hand_number,'commitment',computer_commitment,'reveal',v_reveal) into v_result from public.sd_mukjjippa_server_sessions where id=s.id;
 return private.sd_mukjjippa_save(u,p_request_id,'play',s.id,jsonb_build_object('move',p),v_result); end$$;

create or replace function public.sd_mukjjippa_continue(p_session_id uuid,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare u uuid:=auth.uid(); s public.sd_mukjjippa_server_sessions%rowtype; v_replay jsonb; v_result jsonb; begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if; v_replay:=private.sd_mukjjippa_replay(u,p_request_id,'continue',p_session_id,'{}'::jsonb); if v_replay is not null then return v_replay; end if;
 select * into s from public.sd_mukjjippa_server_sessions where id=p_session_id and user_id=u for update; if s.id is null or s.status<>'active' or s.phase<>'decision' then raise exception using errcode='P1031',message='MUKJJIPPA_CONTINUE_NOT_ALLOWED'; end if;
 update public.sd_mukjjippa_server_sessions set phase='rps',attacker=null,result=null,updated_at=now() where id=s.id; perform private.sd_mukjjippa_set_hand(s.id,s.hand_number);
 select jsonb_build_object('ok',true,'session_id',id,'phase',phase,'hand_number',hand_number,'commitment',computer_commitment,'streak',streak,'potential_payout',potential_payout) into v_result from public.sd_mukjjippa_server_sessions where id=s.id;
 return private.sd_mukjjippa_save(u,p_request_id,'continue',s.id,'{}'::jsonb,v_result); end$$;

create or replace function public.sd_mukjjippa_cashout(p_session_id uuid,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare u uuid:=auth.uid(); s public.sd_mukjjippa_server_sessions%rowtype; v_replay jsonb; v_wallet jsonb; v_result jsonb; begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if; v_replay:=private.sd_mukjjippa_replay(u,p_request_id,'cashout',p_session_id,'{}'::jsonb); if v_replay is not null then return v_replay; end if;
 select * into s from public.sd_mukjjippa_server_sessions where id=p_session_id and user_id=u for update; if s.id is null or s.status<>'active' or s.phase<>'decision' or s.streak<1 then raise exception using errcode='P1031',message='MUKJJIPPA_CASHOUT_NOT_ALLOWED'; end if;
 v_wallet:=sd_core_private.apply_server_wallet_delta_impl(u,p_request_id,'mukjjippa_payout',s.potential_payout,'sd_mukjjippa','SD묵찌빠 연승 정산',jsonb_build_object('session_id',s.id,'streak',s.streak,'all_in',s.all_in));
 update public.sd_mukjjippa_server_sessions set status='cashed_out',phase='complete',result='cashout',updated_at=now(),ended_at=now() where id=s.id; update public.sd_mukjjippa_accounts set games=games+1,best_streak=greatest(best_streak,s.streak),best_all_in_streak=greatest(best_all_in_streak,case when s.all_in then s.streak else 0 end),updated_at=now() where user_id=u; perform private.refresh_sd_mukjjippa_achievements(u);
 v_result:=jsonb_build_object('ok',true,'session_id',s.id,'payout',s.potential_payout,'streak',s.streak,'balance_after',(v_wallet->>'balance_after')::bigint);
 return private.sd_mukjjippa_save(u,p_request_id,'cashout',s.id,'{}'::jsonb,v_result); end$$;

revoke execute on function public.sd_mukjjippa_get_state() from public,anon;
revoke execute on function public.sd_mukjjippa_start(bigint,uuid) from public,anon;
revoke execute on function public.sd_mukjjippa_play(uuid,text,uuid) from public,anon;
revoke execute on function public.sd_mukjjippa_continue(uuid,uuid) from public,anon;
revoke execute on function public.sd_mukjjippa_cashout(uuid,uuid) from public,anon;
grant execute on function public.sd_mukjjippa_get_state() to authenticated;
grant execute on function public.sd_mukjjippa_start(bigint,uuid) to authenticated;
grant execute on function public.sd_mukjjippa_play(uuid,text,uuid) to authenticated;
grant execute on function public.sd_mukjjippa_continue(uuid,uuid) to authenticated;
grant execute on function public.sd_mukjjippa_cashout(uuid,uuid) to authenticated;

commit;