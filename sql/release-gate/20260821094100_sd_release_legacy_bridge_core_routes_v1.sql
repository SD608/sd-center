create or replace function public.apply_sd_logistics_wallet_event(p_event_key text,p_reference_id text,p_amount bigint,p_request_id uuid,p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_user uuid:=auth.uid(); v_wallet uuid; v_tx uuid; v_after bigint; v_prev_amount bigint; v_expected bigint; v_desc text; v_core jsonb;
begin
 if v_user is null then raise exception using errcode='P1001',message='로그인이 필요합니다.'; end if;
 p_event_key:=lower(trim(coalesce(p_event_key,''))); p_reference_id:=trim(coalesce(p_reference_id,'')); p_metadata:=coalesce(p_metadata,'{}'::jsonb);
 if p_request_id is null then raise exception using errcode='P1007',message='요청 번호가 없습니다.'; end if;
 if char_length(p_reference_id)<3 or char_length(p_reference_id)>160 then raise exception using errcode='P1027',message='물류 거래 식별값이 올바르지 않습니다.'; end if;
 if p_amount is null or p_amount=0 then raise exception using errcode='P1011',message='거래 금액이 올바르지 않습니다.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text||':logistics:'||p_event_key||':'||p_reference_id,0));
 select e.transaction_id,t.balance_after,e.amount into v_tx,v_after,v_prev_amount from public.sd_logistics_wallet_events e join public.transactions t on t.id=e.transaction_id where e.user_id=v_user and e.event_key=p_event_key and e.reference_id=p_reference_id;
 if v_tx is not null then if v_prev_amount is distinct from p_amount then raise exception using errcode='P1015',message='같은 물류 거래 식별값의 금액이 이전 요청과 다릅니다.'; end if; return pg_catalog.jsonb_build_object('ok',true,'duplicate',true,'transaction_id',v_tx,'balance_after',v_after); end if;
 if p_amount>0 then raise exception using errcode='P1030',message='이 물류 보상은 서버 검증이 필요합니다.'; end if;
 select x.amount,x.description into v_expected,v_desc from (values
 ('vehicle_buy_small',-250000::bigint,'SD 물류회사 · 소형 차량 구매'),('vehicle_buy_medium',-700000,'SD 물류회사 · 중형 차량 구매'),('vehicle_buy_large',-1500000,'SD 물류회사 · 대형 차량 구매'),('vehicle_buy_xlarge',-3000000,'SD 물류회사 · 초대형 차량 구매'),('starter_upgrade_small_medium',-450000,'SD 물류회사 · 스타터 차량 소형→중형'),('starter_upgrade_medium_large',-800000,'SD 물류회사 · 스타터 차량 중형→대형'),('starter_upgrade_large_xlarge',-1500000,'SD 물류회사 · 스타터 차량 대형→초대형'),('driver_hire',-300000,'SD 물류 본부 · 기사 채용'),('warehouse_buy',-3000000,'SD 물류 본부 · 물류창고 구매'),('hq_upgrade_2',-500000,'SD 물류 본부 Lv.2 승급'),('hq_upgrade_3',-750000,'SD 물류 본부 Lv.3 승급'),('hq_upgrade_4',-1000000,'SD 물류 본부 Lv.4 승급'),('hq_upgrade_5',-1500000,'SD 물류 본부 Lv.5 승급'),('hq_upgrade_6',-2000000,'SD 물류 본부 Lv.6 승급'),('hq_upgrade_7',-3000000,'SD 물류 본부 Lv.7 승급'),('hq_upgrade_8',-4000000,'SD 물류 본부 Lv.8 승급'),('hq_upgrade_9',-5500000,'SD 물류 본부 Lv.9 승급'),('hq_upgrade_10',-8000000,'SD 물류 본부 Lv.10 승급')) as x(key,amount,description) where x.key=p_event_key;
 if v_expected is null then raise exception using errcode='P1010',message='허용되지 않은 물류 거래입니다.'; end if;
 if p_amount<>v_expected then raise exception using errcode='P1011',message='물류 거래 금액이 올바르지 않습니다.'; end if;
 select id into v_wallet from public.wallets where user_id=v_user;
 v_core:=sd_core_private.apply_server_wallet_delta_impl(v_user,p_request_id,'logistics_'||p_event_key,p_amount,'sd_logistics',v_desc,p_metadata||pg_catalog.jsonb_build_object('reference_id',p_reference_id,'origin_platform','web'));
 v_tx:=(v_core->>'transaction_id')::uuid; v_after:=(v_core->>'balance_after')::bigint;
 insert into public.sd_logistics_wallet_events(user_id,wallet_id,event_key,reference_id,amount,request_id,transaction_id) values(v_user,v_wallet,p_event_key,p_reference_id,p_amount,p_request_id,v_tx);
 return pg_catalog.jsonb_build_object('ok',true,'duplicate',coalesce((v_core->>'duplicate')::boolean,false),'transaction_id',v_tx,'balance_before',nullif(v_core->>'balance_before','')::bigint,'balance_after',v_after,'amount',p_amount);
end$$;

create or replace function public.push_sd_link_transaction(p_device_key text,p_local_transaction_id text,p_transaction_type text,p_description text,p_amount bigint,p_local_created_at timestamptz default now(),p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_user uuid:=auth.uid(); v_profile_status text; v_device uuid; v_fingerprint text; v_wallet uuid; v_migration text; v_old_tx uuid; v_old_seq bigint; v_old_after bigint; v_old_amount bigint; v_core jsonb; v_event uuid:=extensions.gen_random_uuid(); v_desc text;
begin
 if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 p_device_key:=lower(trim(coalesce(p_device_key,''))); p_local_transaction_id:=trim(coalesce(p_local_transaction_id,'')); p_transaction_type:=lower(trim(coalesce(p_transaction_type,''))); v_desc:=left(trim(coalesce(p_description,'PC 로컬 거래')),160); p_metadata:=coalesce(p_metadata,'{}'::jsonb);
 if p_device_key !~ '^[0-9a-f]{64}$' then raise exception using errcode='P1019',message='INVALID_DEVICE_KEY'; end if;
 if char_length(p_local_transaction_id)<1 or char_length(p_local_transaction_id)>160 then raise exception using errcode='P1027',message='INVALID_LOCAL_TRANSACTION_ID'; end if;
 if p_amount is null or p_amount=0 or abs(p_amount)>1000000000000 then raise exception using errcode='P1011',message='INVALID_AMOUNT'; end if;
 if p_transaction_type not in ('deposit','withdraw') then raise exception using errcode='P1010',message='INVALID_EVENT_TYPE'; end if;
 if (p_transaction_type='deposit' and p_amount<0) or (p_transaction_type='withdraw' and p_amount>0) then raise exception using errcode='P1010',message='INVALID_EVENT_DIRECTION'; end if;
 select d.id,d.wallet_fingerprint into v_device,v_fingerprint from public.devices d where d.user_id=v_user and d.device_key=p_device_key and d.platform='windows' and d.link_status='active' and d.revoked_at is null;
 if v_device is null then raise exception using errcode='P1003',message='DEVICE_NOT_FOUND'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_device::text||':legacy-sdlink:'||p_local_transaction_id,0));
 select o.server_transaction_id,t.sync_seq,t.balance_after,t.amount into v_old_tx,v_old_seq,v_old_after,v_old_amount from public.sd_link_local_operations o join public.transactions t on t.id=o.server_transaction_id where o.device_id=v_device and o.local_transaction_id=p_local_transaction_id;
 if v_old_tx is not null then if v_old_amount is distinct from p_amount then raise exception using errcode='P1015',message='IDEMPOTENCY_CONFLICT'; end if; return pg_catalog.jsonb_build_object('ok',true,'duplicate',true,'transaction_id',v_old_tx,'sync_seq',v_old_seq,'balance_after',v_old_after,'message','이미 반영된 로컬 거래입니다.'); end if;
 if p_amount>0 then raise exception using errcode='P1030',message='REWARD_CAPABILITY_REQUIRED'; end if;
 select p.status,w.id,m.status into v_profile_status,v_wallet,v_migration from public.profiles p join public.wallets w on w.user_id=p.id left join public.wallet_migrations m on m.user_id=p.id where p.id=v_user;
 if v_wallet is null then raise exception using errcode='P1016',message='WALLET_NOT_FOUND'; end if;
 if v_profile_status<>'active' then raise exception using errcode='P1002',message='ACCOUNT_INACTIVE'; end if;
 if v_migration is distinct from 'completed' then raise exception '기존 PC 잔액 이전 승인 후 동기화할 수 있습니다.'; end if;
 v_core:=public.sd_core_apply_sd_link_event(v_device,v_event,p_local_transaction_id,'spend',abs(p_amount),'sd_link',v_desc,p_metadata||pg_catalog.jsonb_build_object('local_transaction_type',p_transaction_type,'local_created_at',coalesce(p_local_created_at,now()),'wallet_fingerprint',v_fingerprint,'legacy_bridge',true));
 insert into public.sd_link_local_operations(user_id,wallet_id,device_id,local_transaction_id,server_transaction_id) values(v_user,v_wallet,v_device,p_local_transaction_id,(v_core->>'transaction_id')::uuid) on conflict do nothing;
 update public.devices set last_seen_at=now(),last_sync_at=now(),updated_at=now() where id=v_device;
 return pg_catalog.jsonb_build_object('ok',true,'duplicate',coalesce((v_core->>'duplicate')::boolean,false),'transaction_id',(v_core->>'transaction_id')::uuid,'sync_seq',(v_core->>'sync_seq')::bigint,'balance_before',nullif(v_core->>'balance_before','')::bigint,'balance_after',(v_core->>'balance_after')::bigint,'message',case when coalesce((v_core->>'duplicate')::boolean,false) then '재시도된 거래는 중복 반영하지 않았습니다.' else 'PC 로컬 거래를 온라인 장부에 반영했습니다.' end);
end$$;