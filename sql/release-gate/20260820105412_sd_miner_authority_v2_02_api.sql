begin;

create or replace function public.sd_miner_get_state()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); a public.sd_miner_accounts%rowtype; v_inv jsonb; v_current bigint; v_kinds bigint;
begin
 if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 perform private.sd_miner_ensure_account(v_user); select * into a from public.sd_miner_accounts where user_id=v_user;
 select coalesce(jsonb_object_agg(ore_key,jsonb_build_object('quantity',quantity,'acquired_count',acquired_count)),'{}'::jsonb),coalesce(sum(quantity),0),count(*) filter(where acquired_count>0)
 into v_inv,v_current,v_kinds from public.sd_miner_inventory where user_id=v_user;
 return jsonb_build_object('ok',true,'total_mined',a.total_mined,'total_sales_krw',a.total_sales_krw,'auto_mining_unlocked',a.auto_mining_unlocked,
  'highest_tier_found',a.highest_tier_found,'max_diamond_streak',a.max_diamond_streak,'ore_kinds',v_kinds,'current_inventory_quantity',v_current,
  'inventory',v_inv,'config',jsonb_build_object('cooldown_ms',300,'auto_mining_upgrade_price',500000,'ores',jsonb_build_array(
    jsonb_build_object('key','stone','name','돌','probability',47.6,'price',100),jsonb_build_object('key','copper','name','구리','probability',23.8,'price',500),
    jsonb_build_object('key','iron','name','철','probability',14.3,'price',1200),jsonb_build_object('key','emerald','name','에메랄드','probability',9.5,'price',3000),
    jsonb_build_object('key','diamond','name','다이아몬드','probability',4.8,'price',8000))),'authority','server');
end;$$;

create or replace function public.sd_miner_mine(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); a public.sd_miner_accounts%rowtype; v_replay jsonb; v_ore text; v_price bigint; v_result jsonb; v_now timestamptz:=clock_timestamp(); v_q bigint; v_total bigint;
begin
 if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_miner_action_replay(v_user,p_request_id,'mine','{}'::jsonb); if v_replay is not null then return v_replay; end if;
 perform private.sd_miner_ensure_account(v_user); select * into a from public.sd_miner_accounts where user_id=v_user for update;
 if a.last_mine_at is not null and v_now<a.last_mine_at+interval '300 milliseconds' then raise exception using errcode='P1052',message='MINER_COOLDOWN'; end if;
 v_ore:=private.sd_miner_roll_ore(); v_price:=private.sd_miner_ore_price(v_ore);
 update public.sd_miner_inventory set quantity=quantity+1,acquired_count=acquired_count+1,updated_at=now() where user_id=v_user and ore_key=v_ore returning quantity into v_q;
 update public.sd_miner_accounts set total_mined=total_mined+1,last_mine_at=v_now,
   highest_tier_found=highest_tier_found or v_ore='diamond',
   current_diamond_streak=case when v_ore='diamond' then current_diamond_streak+1 else 0 end,
   max_diamond_streak=greatest(max_diamond_streak,case when v_ore='diamond' then current_diamond_streak+1 else 0 end),updated_at=now()
 where user_id=v_user returning * into a;
 perform private.refresh_sd_miner_achievements(v_user);
 v_result:=jsonb_build_object('ok',true,'ore_key',v_ore,'ore_name',case v_ore when 'stone' then '돌' when 'copper' then '구리' when 'iron' then '철' when 'emerald' then '에메랄드' else '다이아몬드' end,
   'price',v_price,'probability',case v_ore when 'stone' then 47.6 when 'copper' then 23.8 when 'iron' then 14.3 when 'emerald' then 9.5 else 4.8 end,
   'quantity',v_q,'total_mined',a.total_mined,'max_diamond_streak',a.max_diamond_streak,'mined_at',v_now);
 return private.sd_miner_save_action(v_user,p_request_id,'mine','{}'::jsonb,v_result);
end;$$;

create or replace function public.sd_miner_buy_auto_mining(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); a public.sd_miner_accounts%rowtype; v_replay jsonb; v_wallet jsonb; v_result jsonb;
begin
 if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_miner_action_replay(v_user,p_request_id,'buy_auto_mining','{}'::jsonb); if v_replay is not null then return v_replay; end if;
 perform private.sd_miner_ensure_account(v_user); select * into a from public.sd_miner_accounts where user_id=v_user for update;
 if a.auto_mining_unlocked then raise exception using errcode='P1031',message='MINER_AUTO_ALREADY_OWNED'; end if;
 v_wallet:=sd_core_private.apply_server_wallet_delta_impl(v_user,p_request_id,'miner_auto_upgrade',-500000,'sd_miner','SD광산 · 자동 채굴 업그레이드','{}'::jsonb);
 update public.sd_miner_accounts set auto_mining_unlocked=true,updated_at=now() where user_id=v_user;
 v_result:=jsonb_build_object('ok',true,'auto_mining_unlocked',true,'price',500000,'balance_after',(v_wallet->>'balance_after')::bigint);
 return private.sd_miner_save_action(v_user,p_request_id,'buy_auto_mining','{}'::jsonb,v_result);
end;$$;

create or replace function public.sd_miner_sell(p_ore_key text,p_quantity bigint,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_ore text:=lower(trim(coalesce(p_ore_key,''))); v_qty bigint:=coalesce(p_quantity,0); v_owned bigint; v_price bigint; v_amount bigint; v_replay jsonb; v_wallet jsonb; v_result jsonb; a public.sd_miner_accounts%rowtype;
begin
 if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 if v_ore not in('stone','copper','iron','emerald','diamond') or v_qty<=0 or v_qty>1000000000 then raise exception using errcode='P1010',message='INVALID_MINER_SALE'; end if;
 v_replay:=private.sd_miner_action_replay(v_user,p_request_id,'sell',jsonb_build_object('ore_key',v_ore,'quantity',v_qty)); if v_replay is not null then return v_replay; end if;
 perform private.sd_miner_ensure_account(v_user);
 select quantity into v_owned from public.sd_miner_inventory where user_id=v_user and ore_key=v_ore for update;
 if coalesce(v_owned,0)<v_qty then raise exception using errcode='P1013',message='INSUFFICIENT_ORE'; end if;
 v_price:=private.sd_miner_ore_price(v_ore); v_amount:=v_price*v_qty;
 v_wallet:=sd_core_private.apply_server_wallet_delta_impl(v_user,p_request_id,'miner_sell',v_amount,'sd_miner','SD광산 · '||case v_ore when 'stone' then '돌' when 'copper' then '구리' when 'iron' then '철' when 'emerald' then '에메랄드' else '다이아몬드' end||' 판매',jsonb_build_object('ore_key',v_ore,'quantity',v_qty,'unit_price',v_price));
 update public.sd_miner_inventory set quantity=quantity-v_qty,updated_at=now() where user_id=v_user and ore_key=v_ore;
 update public.sd_miner_accounts set total_sales_krw=total_sales_krw+v_amount,updated_at=now() where user_id=v_user returning * into a;
 perform private.refresh_sd_miner_achievements(v_user);
 v_result:=jsonb_build_object('ok',true,'ore_key',v_ore,'quantity',v_qty,'unit_price',v_price,'amount',v_amount,'remaining',v_owned-v_qty,'total_sales_krw',a.total_sales_krw,'balance_after',(v_wallet->>'balance_after')::bigint);
 return private.sd_miner_save_action(v_user,p_request_id,'sell',jsonb_build_object('ore_key',v_ore,'quantity',v_qty),v_result);
end;$$;

create or replace function public.sd_miner_sell_all(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_replay jsonb; v_amount bigint:=0; r record; v_wallet jsonb; v_result jsonb; a public.sd_miner_accounts%rowtype;
begin
 if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_miner_action_replay(v_user,p_request_id,'sell_all','{}'::jsonb); if v_replay is not null then return v_replay; end if;
 perform private.sd_miner_ensure_account(v_user);
 for r in select ore_key,quantity from public.sd_miner_inventory where user_id=v_user order by ore_key for update loop v_amount:=v_amount+r.quantity*private.sd_miner_ore_price(r.ore_key); end loop;
 if v_amount<=0 then raise exception using errcode='P1031',message='MINER_NOTHING_TO_SELL'; end if;
 v_wallet:=sd_core_private.apply_server_wallet_delta_impl(v_user,p_request_id,'miner_sell_all',v_amount,'sd_miner','SD광산 · 광석 전체 판매','{}'::jsonb);
 update public.sd_miner_inventory set quantity=0,updated_at=now() where user_id=v_user;
 update public.sd_miner_accounts set total_sales_krw=total_sales_krw+v_amount,updated_at=now() where user_id=v_user returning * into a;
 perform private.refresh_sd_miner_achievements(v_user);
 v_result:=jsonb_build_object('ok',true,'amount',v_amount,'total_sales_krw',a.total_sales_krw,'balance_after',(v_wallet->>'balance_after')::bigint);
 return private.sd_miner_save_action(v_user,p_request_id,'sell_all','{}'::jsonb,v_result);
end;$$;

revoke execute on function public.sd_miner_get_state() from public,anon;
revoke execute on function public.sd_miner_mine(uuid) from public,anon;
revoke execute on function public.sd_miner_buy_auto_mining(uuid) from public,anon;
revoke execute on function public.sd_miner_sell(text,bigint,uuid) from public,anon;
revoke execute on function public.sd_miner_sell_all(uuid) from public,anon;
grant execute on function public.sd_miner_get_state() to authenticated;
grant execute on function public.sd_miner_mine(uuid) to authenticated;
grant execute on function public.sd_miner_buy_auto_mining(uuid) to authenticated;
grant execute on function public.sd_miner_sell(text,bigint,uuid) to authenticated;
grant execute on function public.sd_miner_sell_all(uuid) to authenticated;

commit;