create or replace function public.finalize_sd_email_signup()
returns jsonb language plpgsql security definer set search_path='public','auth','pg_temp' as $$
declare v_user uuid:=auth.uid();v_pending public.signup_pending%rowtype;v_email text;v_confirmed timestamptz;v_session_iat bigint;v_required_iat bigint;v_wallet uuid;v_account text;v_balance bigint:=250000;v_core jsonb;
begin
 if v_user is null then raise exception '1회용 가입 코드를 먼저 인증하세요.';end if;perform pg_advisory_xact_lock(6082026);
 select * into v_pending from public.signup_pending where user_id=v_user for update;if not found then raise exception '진행 중인 회원가입 정보를 찾지 못했습니다.';end if;
 if v_pending.finalized_at is not null then select w.account_number,w.balance into v_account,v_balance from public.wallets w where w.user_id=v_user;return jsonb_build_object('ok',true,'already_finalized',true,'nickname',v_pending.desired_nickname,'account_number',v_account,'balance',v_balance);end if;
 select lower(u.email),u.email_confirmed_at into v_email,v_confirmed from auth.users u where u.id=v_user;if v_confirmed is null then raise exception '이메일 인증이 완료되지 않았습니다.';end if;if lower(v_pending.email)<>v_email then raise exception '회원가입 이메일 정보가 일치하지 않습니다.';end if;if v_pending.second_code_sent_at is null then raise exception '1회용 가입 코드를 먼저 발급받으세요.';end if;
 v_session_iat:=coalesce((auth.jwt()->>'iat')::bigint,0);v_required_iat:=floor(extract(epoch from v_pending.second_code_sent_at))::bigint;if v_session_iat<=v_required_iat then raise exception '방금 이메일로 받은 1회용 가입 코드를 인증하세요.';end if;
 if exists(select 1 from public.profiles p where p.id=v_user) then raise exception '이미 SD 회원가입이 완료된 계정입니다.';end if;if (select count(*) from public.profiles)>=15 then raise exception 'SD608 Online 회원 정원 15명이 모두 찼습니다.';end if;if exists(select 1 from public.profiles p where lower(p.nickname)=lower(v_pending.desired_nickname)) then raise exception '가입 진행 중 닉네임이 다른 회원에게 사용되었습니다. 관리자에게 문의하세요.';end if;
 v_account:='608-'||to_char(now() at time zone 'Asia/Seoul','YYYY')||'-'||lpad(nextval('public.sd_account_seq')::text,4,'0');
 insert into public.profiles(id,nickname) values(v_user,v_pending.desired_nickname);insert into public.wallets(user_id,account_number,balance) values(v_user,v_account,0) returning id into v_wallet;
 v_core:=sd_core_private.apply_server_wallet_delta_impl(v_user,extensions.gen_random_uuid(),'signup_bonus',250000,'sd_signup','신규 가입 가상 지원금',jsonb_build_object('signup_flow','email_double_otp_v1','notice','실제 현금이나 정부 지원금이 아닌 SD 게임용 가상화폐입니다.'));v_balance:=(v_core->>'balance_after')::bigint;
 insert into public.vaults(user_id) values(v_user);update public.signup_pending set finalized_at=now(),updated_at=now() where user_id=v_user;
 return jsonb_build_object('ok',true,'nickname',v_pending.desired_nickname,'account_number',v_account,'balance',v_balance);
end$$;

create or replace function public.handle_new_sd_user()
returns trigger language plpgsql security definer set search_path='public','auth','pg_temp' as $$
declare v_invite_code text;v_nickname text;v_invite uuid;v_wallet uuid;v_account text;v_flow text;v_core jsonb;
begin
 perform pg_advisory_xact_lock(6082026);v_flow:=trim(coalesce(new.raw_user_meta_data->>'signup_flow',''));v_nickname:=trim(coalesce(new.raw_user_meta_data->>'nickname',''));if char_length(v_nickname)<2 or char_length(v_nickname)>20 then raise exception '닉네임은 2자 이상 20자 이하로 입력하세요.';end if;
 if v_flow='email_double_otp_v1' then if (select count(*) from public.profiles)>=15 then raise exception 'SD608 Online 회원 정원 15명이 모두 찼습니다.';end if;if exists(select 1 from public.profiles p where lower(p.nickname)=lower(v_nickname)) then raise exception '이미 사용 중인 닉네임입니다.';end if;insert into public.signup_pending(user_id,email,desired_nickname,flow,updated_at) values(new.id,lower(new.email),v_nickname,v_flow,now()) on conflict(user_id) do update set email=excluded.email,desired_nickname=excluded.desired_nickname,flow=excluded.flow,updated_at=now();return new;end if;
 v_invite_code:=upper(trim(coalesce(new.raw_user_meta_data->>'invite_code','')));if (select count(*) from public.profiles)>=15 then raise exception 'SD608 Online 회원 정원 15명이 모두 찼습니다.';end if;select id into v_invite from public.invite_codes where code=v_invite_code and used_by is null and revoked_at is null and (expires_at is null or expires_at>now()) for update;if v_invite is null then raise exception '유효하지 않거나 이미 사용된 초대 코드입니다.';end if;
 v_account:='608-'||to_char(now() at time zone 'Asia/Seoul','YYYY')||'-'||lpad(nextval('public.sd_account_seq')::text,4,'0');insert into public.profiles(id,nickname) values(new.id,v_nickname);insert into public.wallets(user_id,account_number,balance) values(new.id,v_account,0) returning id into v_wallet;
 v_core:=sd_core_private.apply_server_wallet_delta_impl(new.id,extensions.gen_random_uuid(),'signup_bonus',250000,'sd_signup','신규 가입 가상 지원금',jsonb_build_object('signup_flow','legacy_invite','notice','실제 현금이나 정부 지원금이 아닌 SD 게임용 가상화폐입니다.'));
 insert into public.vaults(user_id) values(new.id);update public.invite_codes set used_by=new.id,used_at=now() where id=v_invite;return new;
end$$;