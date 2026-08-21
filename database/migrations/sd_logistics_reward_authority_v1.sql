-- Logistics wallet authority hardening v1.
-- Identity + a client-controlled reference id is not authority to mint currency.
-- Existing committed positive events remain replayable as duplicate-only.
-- Fresh client-positive events are blocked until a server validator/capability exists.

begin;

create or replace function public.apply_sd_logistics_wallet_event(
  p_event_key text,
  p_reference_id text,
  p_amount bigint,
  p_request_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_status text;
  v_wallet_id uuid;
  v_balance_before bigint;
  v_balance_after bigint;
  v_existing_tx uuid;
  v_existing_after bigint;
  v_existing_amount bigint;
  v_tx_id uuid;
  v_description text;
begin
  if v_user_id is null then
    raise exception using errcode='P1001', message='로그인이 필요합니다.';
  end if;

  p_event_key := lower(trim(coalesce(p_event_key,'')));
  p_reference_id := trim(coalesce(p_reference_id,''));
  p_metadata := coalesce(p_metadata,'{}'::jsonb);

  if p_request_id is null then
    raise exception using errcode='P1007', message='요청 번호가 없습니다.';
  end if;
  if char_length(p_reference_id)<3 or char_length(p_reference_id)>160 then
    raise exception using errcode='P1027', message='물류 거래 식별값이 올바르지 않습니다.';
  end if;
  if p_amount is null or p_amount=0 or abs(p_amount)>1000000000000 then
    raise exception using errcode='P1011', message='거래 금액이 올바르지 않습니다.';
  end if;
  if pg_catalog.jsonb_typeof(p_metadata)<>'object' then
    raise exception using errcode='P1026', message='거래 부가 정보가 올바르지 않습니다.';
  end if;

  -- Replay lookup MUST precede the positive-event ban. An event already committed
  -- before hardening can be read back after a lost response without a second mint.
  select e.transaction_id,t.balance_after,e.amount
    into v_existing_tx,v_existing_after,v_existing_amount
  from public.sd_logistics_wallet_events e
  join public.transactions t on t.id=e.transaction_id
  where e.user_id=v_user_id
    and e.event_key=p_event_key
    and e.reference_id=p_reference_id;

  if v_existing_tx is not null then
    if v_existing_amount is distinct from p_amount then
      raise exception using errcode='P1015', message='같은 물류 거래 식별값의 금액이 이전 요청과 다릅니다.';
    end if;
    return pg_catalog.jsonb_build_object(
      'ok',true,
      'duplicate',true,
      'transaction_id',v_existing_tx,
      'balance_after',v_existing_after
    );
  end if;

  -- Fresh positive client events have no server-side proof today. Do not mint.
  if p_amount>0 then
    raise exception using
      errcode='P1030',
      message='이 물류 보상은 서버 검증이 필요합니다. 검증 경로가 준비되기 전에는 온라인 잔액에 반영되지 않습니다.';
  end if;

  -- Client-origin spends are safe to retain because they can only decrease the
  -- caller's own balance. Exact prices are still enforced server-side.
  case p_event_key
    when 'vehicle_buy_small' then
      if p_amount<>-250000 then raise exception using errcode='P1011', message='소형 차량 구매 금액이 올바르지 않습니다.'; end if;
      v_description:='SD 물류회사 · 소형 차량 구매';
    when 'vehicle_buy_medium' then
      if p_amount<>-700000 then raise exception using errcode='P1011', message='중형 차량 구매 금액이 올바르지 않습니다.'; end if;
      v_description:='SD 물류회사 · 중형 차량 구매';
    when 'vehicle_buy_large' then
      if p_amount<>-1500000 then raise exception using errcode='P1011', message='대형 차량 구매 금액이 올바르지 않습니다.'; end if;
      v_description:='SD 물류회사 · 대형 차량 구매';
    when 'vehicle_buy_xlarge' then
      if p_amount<>-3000000 then raise exception using errcode='P1011', message='초대형 차량 구매 금액이 올바르지 않습니다.'; end if;
      v_description:='SD 물류회사 · 초대형 차량 구매';
    when 'starter_upgrade_small_medium' then
      if p_amount<>-450000 then raise exception using errcode='P1011', message='스타터 중형 업그레이드 금액이 올바르지 않습니다.'; end if;
      v_description:='SD 물류회사 · 스타터 차량 소형→중형';
    when 'starter_upgrade_medium_large' then
      if p_amount<>-800000 then raise exception using errcode='P1011', message='스타터 대형 업그레이드 금액이 올바르지 않습니다.'; end if;
      v_description:='SD 물류회사 · 스타터 차량 중형→대형';
    when 'starter_upgrade_large_xlarge' then
      if p_amount<>-1500000 then raise exception using errcode='P1011', message='스타터 초대형 업그레이드 금액이 올바르지 않습니다.'; end if;
      v_description:='SD 물류회사 · 스타터 차량 대형→초대형';
    when 'driver_hire' then
      if p_amount<>-300000 then raise exception using errcode='P1011', message='기사 채용 금액이 올바르지 않습니다.'; end if;
      v_description:='SD 물류 본부 · 기사 채용';
    when 'warehouse_buy' then
      if p_amount<>-3000000 then raise exception using errcode='P1011', message='물류창고 구매 금액이 올바르지 않습니다.'; end if;
      v_description:='SD 물류 본부 · 물류창고 구매';
    when 'hq_upgrade_2' then if p_amount<>-500000 then raise exception using errcode='P1011', message='본부 승급 금액 오류'; end if; v_description:='SD 물류 본부 Lv.2 승급';
    when 'hq_upgrade_3' then if p_amount<>-750000 then raise exception using errcode='P1011', message='본부 승급 금액 오류'; end if; v_description:='SD 물류 본부 Lv.3 승급';
    when 'hq_upgrade_4' then if p_amount<>-1000000 then raise exception using errcode='P1011', message='본부 승급 금액 오류'; end if; v_description:='SD 물류 본부 Lv.4 승급';
    when 'hq_upgrade_5' then if p_amount<>-1500000 then raise exception using errcode='P1011', message='본부 승급 금액 오류'; end if; v_description:='SD 물류 본부 Lv.5 승급';
    when 'hq_upgrade_6' then if p_amount<>-2000000 then raise exception using errcode='P1011', message='본부 승급 금액 오류'; end if; v_description:='SD 물류 본부 Lv.6 승급';
    when 'hq_upgrade_7' then if p_amount<>-3000000 then raise exception using errcode='P1011', message='본부 승급 금액 오류'; end if; v_description:='SD 물류 본부 Lv.7 승급';
    when 'hq_upgrade_8' then if p_amount<>-4000000 then raise exception using errcode='P1011', message='본부 승급 금액 오류'; end if; v_description:='SD 물류 본부 Lv.8 승급';
    when 'hq_upgrade_9' then if p_amount<>-5500000 then raise exception using errcode='P1011', message='본부 승급 금액 오류'; end if; v_description:='SD 물류 본부 Lv.9 승급';
    when 'hq_upgrade_10' then if p_amount<>-8000000 then raise exception using errcode='P1011', message='본부 승급 금액 오류'; end if; v_description:='SD 물류 본부 Lv.10 승급';
    else
      raise exception using errcode='P1010', message='허용되지 않은 물류 거래입니다.';
  end case;

  select p.status,w.id,w.balance
    into v_status,v_wallet_id,v_balance_before
  from public.profiles p
  join public.wallets w on w.user_id=p.id
  where p.id=v_user_id
  for update of w;

  if v_wallet_id is null then
    raise exception using errcode='P1016', message='가상지갑을 찾지 못했습니다.';
  end if;
  if v_status<>'active' then
    raise exception using errcode='P1002', message='현재 이용할 수 없는 계정입니다.';
  end if;

  v_balance_after:=v_balance_before+p_amount;
  if v_balance_after<0 then
    raise exception using errcode='P1013', message='가상잔액이 부족합니다.';
  end if;

  insert into public.transactions(
    wallet_id,user_id,transaction_type,description,amount,
    balance_before,balance_after,request_id,platform,metadata
  ) values(
    v_wallet_id,
    v_user_id,
    'sd_logistics_'||p_event_key,
    v_description,
    p_amount,
    v_balance_before,
    v_balance_after,
    p_request_id,
    'web',
    p_metadata||pg_catalog.jsonb_build_object(
      'source','sd_logistics_center_web',
      'event_key',p_event_key,
      'reference_id',p_reference_id,
      'notice','실제 현금이 아닌 SD 게임 시뮬레이션용 가상 거래입니다.'
    )
  ) returning id into v_tx_id;

  update public.wallets
     set balance=v_balance_after,
         updated_at=now()
   where id=v_wallet_id;

  insert into public.sd_logistics_wallet_events(
    user_id,wallet_id,event_key,reference_id,amount,request_id,transaction_id
  ) values(
    v_user_id,v_wallet_id,p_event_key,p_reference_id,p_amount,p_request_id,v_tx_id
  );

  return pg_catalog.jsonb_build_object(
    'ok',true,
    'duplicate',false,
    'transaction_id',v_tx_id,
    'balance_before',v_balance_before,
    'balance_after',v_balance_after,
    'amount',p_amount
  );
exception
  when unique_violation then
    select e.transaction_id,t.balance_after,e.amount
      into v_existing_tx,v_existing_after,v_existing_amount
    from public.sd_logistics_wallet_events e
    join public.transactions t on t.id=e.transaction_id
    where e.user_id=v_user_id
      and e.event_key=p_event_key
      and e.reference_id=p_reference_id;

    if v_existing_tx is not null then
      if v_existing_amount is distinct from p_amount then
        raise exception using errcode='P1015', message='같은 물류 거래 식별값의 금액이 이전 요청과 다릅니다.';
      end if;
      return pg_catalog.jsonb_build_object(
        'ok',true,
        'duplicate',true,
        'transaction_id',v_existing_tx,
        'balance_after',v_existing_after
      );
    end if;
    raise;
end;
$$;

revoke execute on function public.apply_sd_logistics_wallet_event(text,text,bigint,uuid,jsonb)
  from public,anon;
grant execute on function public.apply_sd_logistics_wallet_event(text,text,bigint,uuid,jsonb)
  to authenticated;

comment on function public.apply_sd_logistics_wallet_event(text,text,bigint,uuid,jsonb) is
  'Client logistics compatibility API. Fresh positive rewards require future server validation; existing committed rewards replay duplicate-only; validated prices for spends remain.';

commit;
