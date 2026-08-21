begin;

create or replace function public.admin_credit_sd_wallet(p_target_user_id uuid,p_amount bigint,p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_admin uuid:=auth.uid();
  v_target_nickname text;
  v_account_number text;
  v_note text:=nullif(trim(coalesce(p_note,'')),'');
  v_event uuid:=gen_random_uuid();
  v_wallet jsonb;
begin
  if v_admin is null or not exists(
    select 1 from public.profiles p where p.id=v_admin and p.role='admin' and p.status='active'
  ) then raise exception using errcode='P1005',message='ADMIN_REQUIRED'; end if;
  if p_target_user_id is null or p_target_user_id=v_admin then raise exception using errcode='P1027',message='INVALID_ADMIN_WALLET_TARGET'; end if;
  if p_amount is null or p_amount<1 or p_amount>1000000000 then raise exception using errcode='P1011',message='INVALID_AMOUNT'; end if;
  if v_note is not null and char_length(v_note)>80 then raise exception using errcode='P1027',message='NOTE_TOO_LONG'; end if;
  select p.nickname,w.account_number into v_target_nickname,v_account_number
    from public.profiles p join public.wallets w on w.user_id=p.id
   where p.id=p_target_user_id and p.status='active' and p.role<>'admin';
  if v_target_nickname is null then raise exception using errcode='P1016',message='WALLET_TARGET_NOT_FOUND'; end if;
  v_wallet:=sd_core_private.apply_server_wallet_delta_impl(
    p_target_user_id,v_event,'admin_credit',p_amount,'sd_admin',
    case when v_note is null then '관리자 가상잔액 지급' else '관리자 지급 · '||v_note end,
    pg_catalog.jsonb_build_object('admin_user_id',v_admin,'note',v_note)
  );
  return pg_catalog.jsonb_build_object(
    'ok',true,'user_id',p_target_user_id,'nickname',v_target_nickname,'account_number',v_account_number,
    'amount',p_amount,'balance_before',(v_wallet->>'balance_before')::bigint,'balance_after',(v_wallet->>'balance_after')::bigint,
    'event_id',v_event
  );
end;
$$;
revoke execute on function public.admin_credit_sd_wallet(uuid,bigint,text) from public,anon;
grant execute on function public.admin_credit_sd_wallet(uuid,bigint,text) to authenticated;

create or replace function public.admin_debit_sd_wallet(p_target_user_id uuid,p_amount bigint,p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_admin uuid:=auth.uid();
  v_target_nickname text;
  v_note text:=nullif(trim(coalesce(p_note,'')),'');
  v_event uuid:=gen_random_uuid();
  v_wallet jsonb;
begin
  if v_admin is null or not exists(
    select 1 from public.profiles p where p.id=v_admin and p.role='admin' and p.status='active'
  ) then raise exception using errcode='P1005',message='ADMIN_REQUIRED'; end if;
  if p_target_user_id is null or p_target_user_id=v_admin then raise exception using errcode='P1027',message='INVALID_ADMIN_WALLET_TARGET'; end if;
  if p_amount is null or p_amount<1 or p_amount>1000000000 then raise exception using errcode='P1011',message='INVALID_AMOUNT'; end if;
  if v_note is not null and char_length(v_note)>80 then raise exception using errcode='P1027',message='NOTE_TOO_LONG'; end if;
  select p.nickname into v_target_nickname from public.profiles p
   where p.id=p_target_user_id and p.status='active' and p.role<>'admin';
  if v_target_nickname is null then raise exception using errcode='P1016',message='WALLET_TARGET_NOT_FOUND'; end if;
  v_wallet:=sd_core_private.apply_server_wallet_delta_impl(
    p_target_user_id,v_event,'admin_debit',-p_amount,'sd_admin',
    case when v_note is null then '관리자 가상잔액 차감' else '관리자 가상잔액 차감 · '||v_note end,
    pg_catalog.jsonb_build_object('admin_user_id',v_admin,'reason',coalesce(v_note,'관리자 조정'))
  );
  return pg_catalog.jsonb_build_object(
    'ok',true,'user_id',p_target_user_id,'nickname',v_target_nickname,'amount',p_amount,
    'balance_before',(v_wallet->>'balance_before')::bigint,'balance_after',(v_wallet->>'balance_after')::bigint,'event_id',v_event
  );
end;
$$;
revoke execute on function public.admin_debit_sd_wallet(uuid,bigint,text) from public,anon;
grant execute on function public.admin_debit_sd_wallet(uuid,bigint,text) to authenticated;

comment on function public.admin_credit_sd_wallet(uuid,bigint,text) is 'Active-admin adjustment routed through SD Core trusted server wallet delta.';
comment on function public.admin_debit_sd_wallet(uuid,bigint,text) is 'Active-admin adjustment routed through SD Core trusted server wallet delta.';

commit;
