-- Legacy SD Link reward authority hardening v1
-- Existing committed operations may be replayed exactly once/read back.
-- New client-origin positive deposits are rejected; negative spends remain supported.

begin;

create or replace function public.push_sd_link_transaction(
  p_device_key text,
  p_local_transaction_id text,
  p_transaction_type text,
  p_description text,
  p_amount bigint,
  p_local_created_at timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile_status text;
  v_device_id uuid;
  v_device_fingerprint text;
  v_wallet_id uuid;
  v_balance_before bigint;
  v_balance_after bigint;
  v_migration_status text;
  v_existing_transaction uuid;
  v_existing_seq bigint;
  v_existing_after bigint;
  v_existing_amount bigint;
  v_transaction_id uuid;
  v_sync_seq bigint;
  v_server_type text;
  v_description text;
begin
  if v_user_id is null then
    raise exception using errcode='P1001', message='AUTH_REQUIRED';
  end if;

  p_device_key := lower(trim(coalesce(p_device_key,'')));
  p_local_transaction_id := trim(coalesce(p_local_transaction_id,''));
  p_transaction_type := lower(trim(coalesce(p_transaction_type,'')));
  v_description := left(trim(coalesce(p_description,'PC 로컬 거래')),160);
  p_metadata := coalesce(p_metadata,'{}'::jsonb);

  if p_device_key !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='P1019', message='INVALID_DEVICE_KEY';
  end if;
  if char_length(p_local_transaction_id)<1 or char_length(p_local_transaction_id)>160 then
    raise exception using errcode='P1027', message='INVALID_LOCAL_TRANSACTION_ID';
  end if;
  if p_amount is null or p_amount=0 or abs(p_amount)>1000000000000 then
    raise exception using errcode='P1011', message='INVALID_AMOUNT';
  end if;
  if p_transaction_type not in ('deposit','withdraw') then
    raise exception using errcode='P1010', message='INVALID_EVENT_TYPE';
  end if;
  if (p_transaction_type='deposit' and p_amount<0)
     or (p_transaction_type='withdraw' and p_amount>0) then
    raise exception using errcode='P1010', message='INVALID_EVENT_DIRECTION';
  end if;

  select d.id,d.wallet_fingerprint
    into v_device_id,v_device_fingerprint
  from public.devices d
  where d.user_id=v_user_id
    and d.device_key=p_device_key
    and d.platform='windows'
    and d.link_status='active'
    and d.revoked_at is null;

  if v_device_id is null then
    raise exception using errcode='P1003', message='DEVICE_NOT_FOUND';
  end if;

  -- Replay lookup happens before the new reward ban so an already-committed
  -- legacy positive transaction remains exactly-once compatible.
  select o.server_transaction_id,t.sync_seq,t.balance_after,t.amount
    into v_existing_transaction,v_existing_seq,v_existing_after,v_existing_amount
  from public.sd_link_local_operations o
  join public.transactions t on t.id=o.server_transaction_id
  where o.device_id=v_device_id
    and o.local_transaction_id=p_local_transaction_id;

  if v_existing_transaction is not null then
    if v_existing_amount is distinct from p_amount then
      raise exception using errcode='P1015', message='IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object(
      'ok',true,
      'duplicate',true,
      'transaction_id',v_existing_transaction,
      'sync_seq',v_existing_seq,
      'balance_after',v_existing_after,
      'message','이미 반영된 로컬 거래입니다.'
    );
  end if;

  -- A registered client/device proves identity, not authority to mint money.
  if p_amount>0 then
    raise exception using errcode='P1030', message='REWARD_CAPABILITY_REQUIRED';
  end if;

  select p.status,w.id,w.balance,m.status
    into v_profile_status,v_wallet_id,v_balance_before,v_migration_status
  from public.profiles p
  join public.wallets w on w.user_id=p.id
  left join public.wallet_migrations m on m.user_id=p.id
  where p.id=v_user_id
  for update of w;

  if v_wallet_id is null then
    raise exception using errcode='P1016', message='WALLET_NOT_FOUND';
  end if;
  if v_profile_status<>'active' then
    raise exception using errcode='P1002', message='ACCOUNT_INACTIVE';
  end if;
  if v_migration_status is distinct from 'completed' then
    raise exception '기존 PC 잔액 이전 승인 후 동기화할 수 있습니다.';
  end if;

  v_balance_after := v_balance_before+p_amount;
  if v_balance_after<0 then
    raise exception using errcode='P1013', message='INSUFFICIENT_FUNDS';
  end if;

  v_server_type := 'sd_link_local_withdraw';

  insert into public.transactions(
    wallet_id,user_id,transaction_type,description,amount,
    balance_before,balance_after,request_id,platform,metadata
  ) values(
    v_wallet_id,
    v_user_id,
    v_server_type,
    coalesce(nullif(v_description,''),'PC 로컬 거래'),
    p_amount,
    v_balance_before,
    v_balance_after,
    gen_random_uuid(),
    'windows',
    p_metadata || jsonb_build_object(
      'sd_link_device_key',p_device_key,
      'sd_link_local_transaction_id',p_local_transaction_id,
      'local_transaction_type',p_transaction_type,
      'local_created_at',coalesce(p_local_created_at,now()),
      'wallet_fingerprint',v_device_fingerprint,
      'notice','실제 현금이 아닌 SD 게임용 가상화폐 동기화입니다.'
    )
  ) returning id,sync_seq into v_transaction_id,v_sync_seq;

  update public.wallets set balance=v_balance_after where id=v_wallet_id;

  insert into public.sd_link_local_operations(
    user_id,wallet_id,device_id,local_transaction_id,server_transaction_id
  ) values(
    v_user_id,v_wallet_id,v_device_id,p_local_transaction_id,v_transaction_id
  );

  update public.devices
     set last_seen_at=now(),last_sync_at=now(),updated_at=now()
   where id=v_device_id;

  return jsonb_build_object(
    'ok',true,
    'duplicate',false,
    'transaction_id',v_transaction_id,
    'sync_seq',v_sync_seq,
    'balance_before',v_balance_before,
    'balance_after',v_balance_after,
    'message','PC 로컬 거래를 온라인 장부에 반영했습니다.'
  );
exception
  when unique_violation then
    select o.server_transaction_id,t.sync_seq,t.balance_after,t.amount
      into v_existing_transaction,v_existing_seq,v_existing_after,v_existing_amount
    from public.sd_link_local_operations o
    join public.transactions t on t.id=o.server_transaction_id
    where o.device_id=v_device_id
      and o.local_transaction_id=p_local_transaction_id;

    if v_existing_transaction is not null then
      if v_existing_amount is distinct from p_amount then
        raise exception using errcode='P1015', message='IDEMPOTENCY_CONFLICT';
      end if;
      return jsonb_build_object(
        'ok',true,
        'duplicate',true,
        'transaction_id',v_existing_transaction,
        'sync_seq',v_existing_seq,
        'balance_after',v_existing_after,
        'message','재시도된 거래는 중복 반영하지 않았습니다.'
      );
    end if;
    raise;
end;
$$;

revoke execute on function public.push_sd_link_transaction(text,text,text,text,bigint,timestamptz,jsonb)
  from public,anon;
grant execute on function public.push_sd_link_transaction(text,text,text,text,bigint,timestamptz,jsonb)
  to authenticated;

comment on function public.push_sd_link_transaction(text,text,text,text,bigint,timestamptz,jsonb) is
  'Legacy compatibility API. Existing committed operations replay exactly once; new positive client rewards require server/Core capability.';

commit;
