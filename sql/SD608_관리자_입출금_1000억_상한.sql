begin;

create or replace function public.sd_admin_v1_adjust_wallet(
  p_target_user_id uuid,
  p_direction text,
  p_amount bigint,
  p_note text default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_direction text := lower(trim(coalesce(p_direction,'')));
  v_note text := nullif(trim(coalesce(p_note,'')), '');
  v_signed_amount bigint;
  v_event_key text;
  v_nickname text;
  v_account_number text;
  v_result jsonb;
begin
  if v_admin is null or not exists (
    select 1 from public.profiles p where p.id=v_admin and p.role='admin' and p.status='active'
  ) then
    raise exception using errcode='P1005', message='ADMIN_REQUIRED';
  end if;
  if p_target_user_id is null or p_target_user_id=v_admin then
    raise exception using errcode='P1027', message='INVALID_ADMIN_WALLET_TARGET';
  end if;
  if p_request_id is null then
    raise exception using errcode='P1027', message='REQUEST_ID_REQUIRED';
  end if;
  if v_direction not in ('credit','debit') then
    raise exception using errcode='P1027', message='INVALID_DIRECTION';
  end if;
  if p_amount is null or p_amount<1 or p_amount>100000000000 then
    raise exception using errcode='P1011', message='INVALID_AMOUNT';
  end if;
  if v_note is not null and char_length(v_note)>80 then
    raise exception using errcode='P1027', message='NOTE_TOO_LONG';
  end if;

  select p.nickname,w.account_number
    into v_nickname,v_account_number
  from public.profiles p
  join public.wallets w on w.user_id=p.id
  where p.id=p_target_user_id and p.status='active' and p.role<>'admin';
  if v_nickname is null then
    raise exception using errcode='P1016', message='WALLET_TARGET_NOT_FOUND';
  end if;

  v_signed_amount := case when v_direction='credit' then p_amount else -p_amount end;
  v_event_key := case when v_direction='credit' then 'admin_credit' else 'admin_debit' end;

  v_result := sd_core_private.apply_server_wallet_delta_impl(
    p_target_user_id,
    p_request_id,
    v_event_key,
    v_signed_amount,
    'sd_admin_monitor',
    case
      when v_note is null and v_direction='credit' then '관리자 가상잔액 지급'
      when v_note is null then '관리자 가상잔액 차감'
      when v_direction='credit' then '관리자 지급 · '||v_note
      else '관리자 가상잔액 차감 · '||v_note
    end,
    jsonb_build_object('admin_user_id',v_admin,'note',v_note,'admin_api_version','v1')
  );

  return v_result || jsonb_build_object(
    'nickname',v_nickname,
    'account_number',v_account_number,
    'direction',v_direction,
    'requested_amount',p_amount
  );
end;
$$;

revoke all on function public.sd_admin_v1_adjust_wallet(uuid,text,bigint,text,uuid) from public, anon, authenticated;
grant execute on function public.sd_admin_v1_adjust_wallet(uuid,text,bigint,text,uuid) to authenticated;

commit;
