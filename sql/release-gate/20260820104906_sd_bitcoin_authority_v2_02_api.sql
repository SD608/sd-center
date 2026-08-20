begin;

update public.sd_bitcoin_accounts set hit_exact_404=true where btc_balance=404.00000000;

create or replace function public.sd_bitcoin_get_state()
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid();
  a public.sd_bitcoin_accounts%rowtype;
  v_rooms jsonb;
  v_active int;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  perform private.sd_bitcoin_ensure_account(v_user);
  select * into a from public.sd_bitcoin_accounts where user_id=v_user;
  select count(*) into v_active from public.sd_bitcoin_gpu_units where user_id=v_user and durability>0;
  select coalesce(jsonb_agg(jsonb_build_object(
    'room_key',r.room_key,'owned',r.owned,'frames',r.frames,'gpus',coalesce(g.c,0),
    'mined_btc',r.mined_btc,'gpu_units',coalesce(g.units,'[]'::jsonb)
  ) order by r.room_key),'[]'::jsonb)
  into v_rooms
  from public.sd_bitcoin_rooms r
  left join lateral (
    select count(*) filter(where u.durability>0) c,
           jsonb_agg(jsonb_build_object('slot_index',u.slot_index,'durability',u.durability,'broken',u.durability<=0) order by u.slot_index) units
    from public.sd_bitcoin_gpu_units u where u.user_id=r.user_id and u.room_key=r.room_key
  ) g on true
  where r.user_id=v_user;
  return jsonb_build_object('ok',true,
    'btc_balance',a.btc_balance,'max_btc_balance',a.max_btc_balance,'total_mined_btc',a.total_mined_btc,
    'total_sold_btc',a.total_sold_btc,'total_sales_krw',a.total_sales_krw,
    'electricity',jsonb_build_object('status',a.electricity_status,'debt_krw',a.electricity_debt_krw,
      'last_billed_utc_date',a.last_billed_utc_date,'unpaid_utc_date',a.unpaid_utc_date,'fee_per_gpu_krw',100000,'active_gpu_count',v_active),
    'config',jsonb_build_object('btc_price_krw',4500000,'room_prices',jsonb_build_object('A',500000,'B',1000000,'C',1500000,'D',2000000,'E',2500000),
      'frame_price',1000000,'gpu_price',1550000,'gpus_per_frame',5,'max_frames_per_room',3,'mining_interval_seconds',10,'btc_reward',0.05,'success_probability',0.0002),
    'rooms',v_rooms,'authority','server');
end;
$$;

create or replace function public.sd_bitcoin_buy_room(p_room_key text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid(); v_key text:=upper(trim(coalesce(p_room_key,''))); v_price bigint; v_replay jsonb; v_wallet jsonb; v_result jsonb; v_owned boolean;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  if v_key not in('A','B','C','D','E') then raise exception using errcode='P1010',message='INVALID_BITCOIN_ROOM'; end if;
  v_replay:=private.sd_bitcoin_action_replay(v_user,p_request_id,'buy_room',jsonb_build_object('room_key',v_key)); if v_replay is not null then return v_replay; end if;
  perform private.sd_bitcoin_ensure_account(v_user);
  select owned into v_owned from public.sd_bitcoin_rooms where user_id=v_user and room_key=v_key for update;
  if v_owned then raise exception using errcode='P1031',message='BITCOIN_ROOM_ALREADY_OWNED'; end if;
  v_price:=case v_key when 'A' then 500000 when 'B' then 1000000 when 'C' then 1500000 when 'D' then 2000000 else 2500000 end;
  v_wallet:=sd_core_private.apply_server_wallet_delta_impl(v_user,p_request_id,'bitcoin_buy_room',-v_price,'sd_bitcoin','SD비트코인 · '||v_key||' 원룸 구매',jsonb_build_object('room_key',v_key));
  update public.sd_bitcoin_rooms set owned=true,updated_at=now() where user_id=v_user and room_key=v_key;
  v_result:=jsonb_build_object('ok',true,'room_key',v_key,'price',v_price,'balance_after',(v_wallet->>'balance_after')::bigint);
  return private.sd_bitcoin_save_action(v_user,p_request_id,'buy_room',jsonb_build_object('room_key',v_key),v_result);
end;
$$;

create or replace function public.sd_bitcoin_buy_frame(p_room_key text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid(); v_key text:=upper(trim(coalesce(p_room_key,''))); v_replay jsonb; v_wallet jsonb; v_result jsonb; v_room public.sd_bitcoin_rooms%rowtype;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  if v_key not in('A','B','C','D','E') then raise exception using errcode='P1010',message='INVALID_BITCOIN_ROOM'; end if;
  v_replay:=private.sd_bitcoin_action_replay(v_user,p_request_id,'buy_frame',jsonb_build_object('room_key',v_key)); if v_replay is not null then return v_replay; end if;
  perform private.sd_bitcoin_ensure_account(v_user);
  select * into v_room from public.sd_bitcoin_rooms where user_id=v_user and room_key=v_key for update;
  if not v_room.owned then raise exception using errcode='P1031',message='BITCOIN_ROOM_NOT_OWNED'; end if;
  if v_room.frames>=3 then raise exception using errcode='P1031',message='BITCOIN_FRAME_CAP_REACHED'; end if;
  v_wallet:=sd_core_private.apply_server_wallet_delta_impl(v_user,p_request_id,'bitcoin_buy_frame',-1000000,'sd_bitcoin','SD비트코인 · '||v_key||' 원룸 채굴 틀 구매',jsonb_build_object('room_key',v_key));
  update public.sd_bitcoin_rooms set frames=frames+1,updated_at=now() where user_id=v_user and room_key=v_key returning * into v_room;
  v_result:=jsonb_build_object('ok',true,'room_key',v_key,'frames',v_room.frames,'price',1000000,'balance_after',(v_wallet->>'balance_after')::bigint);
  return private.sd_bitcoin_save_action(v_user,p_request_id,'buy_frame',jsonb_build_object('room_key',v_key),v_result);
end;
$$;

create or replace function public.sd_bitcoin_buy_gpu(p_room_key text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid(); v_key text:=upper(trim(coalesce(p_room_key,''))); v_replay jsonb; v_wallet jsonb; v_result jsonb; v_room public.sd_bitcoin_rooms%rowtype; v_slot int:=-1; i int; v_active int;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  if v_key not in('A','B','C','D','E') then raise exception using errcode='P1010',message='INVALID_BITCOIN_ROOM'; end if;
  v_replay:=private.sd_bitcoin_action_replay(v_user,p_request_id,'buy_gpu',jsonb_build_object('room_key',v_key)); if v_replay is not null then return v_replay; end if;
  perform private.sd_bitcoin_ensure_account(v_user);
  select * into v_room from public.sd_bitcoin_rooms where user_id=v_user and room_key=v_key for update;
  if not v_room.owned then raise exception using errcode='P1031',message='BITCOIN_ROOM_NOT_OWNED'; end if;
  if v_room.frames<=0 then raise exception using errcode='P1031',message='BITCOIN_FRAME_REQUIRED'; end if;
  select count(*) into v_active from public.sd_bitcoin_gpu_units where user_id=v_user and room_key=v_key and durability>0;
  if v_active>=v_room.frames*5 then raise exception using errcode='P1031',message='BITCOIN_GPU_CAP_REACHED'; end if;
  for i in 0..(v_room.frames*5-1) loop
    if not exists(select 1 from public.sd_bitcoin_gpu_units where user_id=v_user and room_key=v_key and slot_index=i and durability>0) then v_slot:=i; exit; end if;
  end loop;
  if v_slot<0 then raise exception using errcode='P1031',message='BITCOIN_GPU_SLOT_NOT_FOUND'; end if;
  v_wallet:=sd_core_private.apply_server_wallet_delta_impl(v_user,p_request_id,'bitcoin_buy_gpu',-1550000,'sd_bitcoin','SD비트코인 · '||v_key||' 원룸 그래픽카드 구매',jsonb_build_object('room_key',v_key,'slot_index',v_slot));
  insert into public.sd_bitcoin_gpu_units(user_id,room_key,slot_index,durability,installed_at,updated_at)
  values(v_user,v_key,v_slot,100,now(),now()) on conflict(user_id,room_key,slot_index) do update set durability=100,installed_at=now(),updated_at=now();
  v_result:=jsonb_build_object('ok',true,'room_key',v_key,'slot_index',v_slot,'durability',100,'price',1550000,'balance_after',(v_wallet->>'balance_after')::bigint);
  return private.sd_bitcoin_save_action(v_user,p_request_id,'buy_gpu',jsonb_build_object('room_key',v_key),v_result);
end;
$$;

create or replace function public.sd_bitcoin_tick(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid(); a public.sd_bitcoin_accounts%rowtype; v_replay jsonb; v_result jsonb; v_now timestamptz:=clock_timestamp(); v_today date:=(clock_timestamp() at time zone 'UTC')::date;
  v_due date; v_fee bigint; v_active int; v_billed bigint:=0; v_billing_count int:=0; v_boundary timestamptz; v_elapsed numeric; v_intervals bigint:=0; v_success int; v_total_success int:=0; v_reward numeric(30,8):=0; g record; v_wallet jsonb;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  v_replay:=private.sd_bitcoin_action_replay(v_user,p_request_id,'tick','{}'::jsonb); if v_replay is not null then return v_replay; end if;
  perform private.sd_bitcoin_ensure_account(v_user);
  select * into a from public.sd_bitcoin_accounts where user_id=v_user for update;
  select count(*) into v_active from public.sd_bitcoin_gpu_units u join public.sd_bitcoin_rooms r using(user_id,room_key) where u.user_id=v_user and r.owned and u.durability>0;

  if v_active>0 and a.electricity_status='active' then
    v_due:=coalesce(a.last_billed_utc_date+1,v_today);
    while v_due<=v_today loop
      v_fee:=v_active*100000;
      begin
        v_wallet:=sd_core_private.apply_server_wallet_delta_impl(v_user,gen_random_uuid(),'bitcoin_electricity',-v_fee,'sd_bitcoin','SD비트코인 · UTC '||v_due::text||' 일일 전기세',jsonb_build_object('utc_date',v_due,'active_gpu_count',v_active,'tick_request_id',p_request_id));
        update public.sd_bitcoin_accounts set last_billed_utc_date=v_due,electricity_debt_krw=0,unpaid_utc_date=null,updated_at=now() where user_id=v_user;
        v_billed:=v_billed+v_fee; v_billing_count:=v_billing_count+1;
      exception when sqlstate 'P1013' then
        update public.sd_bitcoin_accounts set electricity_status='suspended',electricity_debt_krw=v_fee,unpaid_utc_date=v_due,updated_at=now() where user_id=v_user;
        exit;
      end;
      v_due:=v_due+1;
    end loop;
  end if;

  select * into a from public.sd_bitcoin_accounts where user_id=v_user for update;
  if a.last_tick_at is null then
    update public.sd_bitcoin_accounts set last_tick_at=v_now,updated_at=now() where user_id=v_user;
    v_result:=jsonb_build_object('ok',true,'initialized',true,'elapsed_intervals',0,'btc_reward',0,'btc_balance',a.btc_balance,'active_gpu_count',v_active,'electricity_status',a.electricity_status,'billed_krw',v_billed);
    return private.sd_bitcoin_save_action(v_user,p_request_id,'tick','{}'::jsonb,v_result);
  end if;

  v_boundary:=v_now;
  if a.electricity_status='suspended' and a.unpaid_utc_date is not null then
    v_boundary:=least(v_now,(a.unpaid_utc_date::timestamp at time zone 'UTC'));
  end if;
  v_elapsed:=greatest(0,extract(epoch from (v_boundary-a.last_tick_at)));
  v_intervals:=floor(v_elapsed/10.0)::bigint;

  if v_intervals>0 and v_active>0 then
    for g in select u.user_id,u.room_key,u.slot_index,u.durability from public.sd_bitcoin_gpu_units u join public.sd_bitcoin_rooms r using(user_id,room_key) where u.user_id=v_user and r.owned and u.durability>0 order by u.room_key,u.slot_index for update of u loop
      v_success:=private.sd_bitcoin_sample_successes(v_intervals,g.durability);
      if v_success>0 then
        update public.sd_bitcoin_gpu_units set durability=greatest(0,durability-v_success),updated_at=now() where user_id=v_user and room_key=g.room_key and slot_index=g.slot_index;
        update public.sd_bitcoin_rooms set mined_btc=mined_btc+(v_success*0.05),updated_at=now() where user_id=v_user and room_key=g.room_key;
        v_total_success:=v_total_success+v_success;
      end if;
    end loop;
    v_reward:=round(v_total_success*0.05,8);
  end if;

  update public.sd_bitcoin_accounts set
    btc_balance=round(btc_balance+v_reward,8),
    max_btc_balance=greatest(max_btc_balance,round(btc_balance+v_reward,8)),
    total_mined_btc=round(total_mined_btc+v_reward,8),
    ever_acquired=ever_acquired or v_reward>0,
    hit_exact_404=hit_exact_404 or round(btc_balance+v_reward,8)=404.00000000,
    last_tick_at=v_now,updated_at=now()
  where user_id=v_user returning * into a;
  perform private.refresh_sd_bitcoin_achievements(v_user);
  v_result:=jsonb_build_object('ok',true,'initialized',false,'elapsed_intervals',v_intervals,'elapsed_seconds',v_intervals*10,
    'successes',v_total_success,'btc_reward',v_reward,'btc_balance',a.btc_balance,'active_gpu_count',v_active,
    'electricity_status',a.electricity_status,'debt_krw',a.electricity_debt_krw,'billed_krw',v_billed,'billing_count',v_billing_count);
  return private.sd_bitcoin_save_action(v_user,p_request_id,'tick','{}'::jsonb,v_result);
end;
$$;

create or replace function public.sd_bitcoin_sell(p_btc_amount numeric,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid(); a public.sd_bitcoin_accounts%rowtype; v_amount numeric(30,8):=round(coalesce(p_btc_amount,0),8); v_krw bigint; v_replay jsonb; v_wallet jsonb; v_result jsonb;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  if v_amount<=0 or v_amount>1000000000 then raise exception using errcode='P1011',message='INVALID_BITCOIN_AMOUNT'; end if;
  v_replay:=private.sd_bitcoin_action_replay(v_user,p_request_id,'sell',jsonb_build_object('btc_amount',v_amount)); if v_replay is not null then return v_replay; end if;
  perform private.sd_bitcoin_ensure_account(v_user);
  select * into a from public.sd_bitcoin_accounts where user_id=v_user for update;
  if a.btc_balance<v_amount then raise exception using errcode='P1013',message='INSUFFICIENT_BITCOIN'; end if;
  v_krw:=round(v_amount*4500000)::bigint;
  v_wallet:=sd_core_private.apply_server_wallet_delta_impl(v_user,p_request_id,'bitcoin_sell',v_krw,'sd_bitcoin','SD비트코인 · '||v_amount::text||' BTC 판매',jsonb_build_object('btc_amount',v_amount,'btc_price_krw',4500000));
  update public.sd_bitcoin_accounts set btc_balance=round(btc_balance-v_amount,8),total_sold_btc=round(total_sold_btc+v_amount,8),total_sales_krw=total_sales_krw+v_krw,
    hit_exact_404=hit_exact_404 or round(btc_balance-v_amount,8)=404.00000000,updated_at=now() where user_id=v_user returning * into a;
  perform private.refresh_sd_bitcoin_achievements(v_user);
  v_result:=jsonb_build_object('ok',true,'sold_btc',v_amount,'sale_krw',v_krw,'btc_balance',a.btc_balance,'balance_after',(v_wallet->>'balance_after')::bigint);
  return private.sd_bitcoin_save_action(v_user,p_request_id,'sell',jsonb_build_object('btc_amount',v_amount),v_result);
end;
$$;

create or replace function public.sd_bitcoin_reactivate_electricity(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid(); a public.sd_bitcoin_accounts%rowtype; v_replay jsonb; v_wallet jsonb; v_result jsonb; v_today date:=(clock_timestamp() at time zone 'UTC')::date;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  v_replay:=private.sd_bitcoin_action_replay(v_user,p_request_id,'reactivate_electricity','{}'::jsonb); if v_replay is not null then return v_replay; end if;
  perform private.sd_bitcoin_ensure_account(v_user);
  select * into a from public.sd_bitcoin_accounts where user_id=v_user for update;
  if a.electricity_status<>'suspended' then raise exception using errcode='P1031',message='BITCOIN_ELECTRICITY_NOT_SUSPENDED'; end if;
  if a.electricity_debt_krw<=0 then raise exception using errcode='P1031',message='BITCOIN_ELECTRICITY_DEBT_MISSING'; end if;
  v_wallet:=sd_core_private.apply_server_wallet_delta_impl(v_user,p_request_id,'bitcoin_electricity_reactivate',-a.electricity_debt_krw,'sd_bitcoin','SD비트코인 · 밀린 전기세 납부 및 채굴 재가동',jsonb_build_object('debt_krw',a.electricity_debt_krw));
  update public.sd_bitcoin_accounts set electricity_status='active',electricity_debt_krw=0,unpaid_utc_date=null,last_billed_utc_date=v_today,last_tick_at=clock_timestamp(),updated_at=now() where user_id=v_user returning * into a;
  v_result:=jsonb_build_object('ok',true,'paid_krw',(v_wallet->>'amount')::bigint*-1,'balance_after',(v_wallet->>'balance_after')::bigint,'electricity_status','active');
  return private.sd_bitcoin_save_action(v_user,p_request_id,'reactivate_electricity','{}'::jsonb,v_result);
end;
$$;

revoke execute on function public.sd_bitcoin_get_state() from public,anon;
revoke execute on function public.sd_bitcoin_buy_room(text,uuid) from public,anon;
revoke execute on function public.sd_bitcoin_buy_frame(text,uuid) from public,anon;
revoke execute on function public.sd_bitcoin_buy_gpu(text,uuid) from public,anon;
revoke execute on function public.sd_bitcoin_tick(uuid) from public,anon;
revoke execute on function public.sd_bitcoin_sell(numeric,uuid) from public,anon;
revoke execute on function public.sd_bitcoin_reactivate_electricity(uuid) from public,anon;
grant execute on function public.sd_bitcoin_get_state() to authenticated;
grant execute on function public.sd_bitcoin_buy_room(text,uuid) to authenticated;
grant execute on function public.sd_bitcoin_buy_frame(text,uuid) to authenticated;
grant execute on function public.sd_bitcoin_buy_gpu(text,uuid) to authenticated;
grant execute on function public.sd_bitcoin_tick(uuid) to authenticated;
grant execute on function public.sd_bitcoin_sell(numeric,uuid) to authenticated;
grant execute on function public.sd_bitcoin_reactivate_electricity(uuid) to authenticated;

commit;