create or replace function public.buy_sd_profile_cosmetic(p_cosmetic_id uuid,p_platform text default 'web'::text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_item public.sd_profile_cosmetics%rowtype; v_core jsonb;
begin
 if v_user is null then raise exception '로그인이 필요합니다.'; end if;
 if p_cosmetic_id is null then raise exception '치장품 정보가 없습니다.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text||':cosmetic:'||p_cosmetic_id::text,0));
 select * into v_item from public.sd_profile_cosmetics where id=p_cosmetic_id and active=true;
 if not found then raise exception '판매 중인 치장품이 아닙니다.'; end if;
 if exists(select 1 from public.sd_profile_cosmetic_purchases where user_id=v_user and cosmetic_id=v_item.id) then return pg_catalog.jsonb_build_object('ok',true,'already_owned',true); end if;
 v_core:=sd_core_private.apply_server_wallet_delta_impl(v_user,extensions.gen_random_uuid(),'profile_cosmetic_buy',-v_item.price,'sd_profile','프로필 치장품 구매 · '||v_item.name,pg_catalog.jsonb_build_object('cosmetic_id',v_item.id,'kind',v_item.kind,'origin_platform',case when lower(coalesce(p_platform,'web'))='android' then 'android' else 'web' end));
 insert into public.sd_profile_cosmetic_purchases(user_id,cosmetic_id,purchase_price) values(v_user,v_item.id,v_item.price);
 return pg_catalog.jsonb_build_object('ok',true,'balance_after',(v_core->>'balance_after')::bigint);
end$$;

create or replace function public.buy_sd_vault_gold(p_bars bigint,p_request_id uuid,p_platform text default 'android'::text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_status text; v_locked boolean; v_old bigint; v_cost bigint; v_core jsonb; v_platform text; v_new bigint;
begin
 if v_user is null then raise exception '로그인이 필요합니다.'; end if;
 if p_request_id is null then raise exception '요청 번호가 없습니다.'; end if;
 v_platform:=lower(trim(coalesce(p_platform,'android'))); if v_platform not in ('windows','android','web') then raise exception '허용되지 않은 실행 환경입니다.'; end if;
 if p_bars is null or p_bars<1 or p_bars>10000 then raise exception '금괴는 한 번에 1개 이상 10,000개 이하로 구매하세요.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text||':vault-gold:'||p_request_id::text,0));
 select p.status,v.is_locked,v.gold_bars into v_status,v_locked,v_old from public.profiles p join public.vaults v on v.user_id=p.id where p.id=v_user for update of v;
 if v_status is null then raise exception '가상지갑 또는 금고를 찾지 못했습니다.'; end if;
 if v_status<>'active' then raise exception '현재 이용할 수 없는 계정입니다.'; end if;
 if v_locked then raise exception '먼저 금고 PIN을 입력해 금고를 여세요.'; end if;
 v_cost:=p_bars*826000;
 v_core:=sd_core_private.apply_server_wallet_delta_impl(v_user,p_request_id,'vault_gold_buy',-v_cost,'sd_vault','SD금고 가상 금괴 구매 '||p_bars||'개',pg_catalog.jsonb_build_object('gold_bars',p_bars,'grams',round(p_bars::numeric*3.75,2),'price_per_bar',826000,'origin_platform',v_platform));
 if coalesce((v_core->>'duplicate')::boolean,false) then return public.get_sd_vault_state(); end if;
 v_new:=coalesce(v_old,0)+p_bars;
 update public.vaults set gold_bars=v_new,gold_grams=round(v_new::numeric*3.75,2),updated_at=now() where user_id=v_user;
 return public.get_sd_vault_state();
end$$;

create or replace function public.buy_sd_flea_market_item(p_stock_id uuid,p_request_id uuid,p_platform text default 'android'::text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_existing jsonb; v_stock public.sd_flea_market_stock%rowtype; v_item public.sd_flea_items%rowtype; v_core jsonb; v_result jsonb; v_origin text; v_platform text;
begin
 if v_user is null then raise exception '로그인이 필요합니다.'; end if;
 if p_stock_id is null or p_request_id is null then raise exception '요청 정보가 없습니다.'; end if;
 v_platform:=lower(trim(coalesce(p_platform,'android'))); if v_platform not in ('android','web','windows') then v_platform:='web'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text||':flea-buy:'||p_request_id::text,0));
 select result into v_existing from public.sd_flea_market_actions where request_id=p_request_id and user_id=v_user and action_type='buy'; if found then return v_existing; end if;
 select * into v_stock from public.sd_flea_market_stock where id=p_stock_id for update; if not found then raise exception '이미 판매된 물건이거나 존재하지 않습니다.'; end if;
 select * into v_item from public.sd_flea_items where id=v_stock.item_id for update; if not found or v_item.status<>'system_stock' then raise exception '구매 가능한 물건이 아닙니다.'; end if;
 v_core:=sd_core_private.apply_server_wallet_delta_impl(v_user,p_request_id,'flea_market_buy',-v_stock.list_price,'sd_flea','SD 플리마켓 시스템 구매 · '||v_item.name,pg_catalog.jsonb_build_object('item_id',v_item.id,'stock_id',v_stock.id,'origin_user_id',v_item.origin_user_id,'origin_platform',v_platform));
 update public.sd_flea_items set owner_user_id=v_user,status='owned',acquisition_kind='system_purchase',purchase_price=v_stock.list_price,acquired_at=now(),updated_at=now() where id=v_item.id;
 delete from public.sd_flea_market_stock where id=v_stock.id;
 select nickname into v_origin from public.profiles where id=v_item.origin_user_id;
 v_result:=pg_catalog.jsonb_build_object('ok',true,'item_id',v_item.id,'name',v_item.name,'price',v_stock.list_price,'balance_after',(v_core->>'balance_after')::bigint,'origin_user_id',v_item.origin_user_id,'origin_nickname',coalesce(v_origin,'회원'),'future_resale_price',floor(v_stock.list_price*0.50)::bigint);
 insert into public.sd_flea_market_actions(request_id,user_id,action_type,result) values(p_request_id,v_user,'buy',v_result);
 return v_result;
end$$;

create or replace function public.trade_sdcoin(p_coin_code text,p_side text,p_quantity numeric,p_request_id uuid,p_platform text default 'mobile'::text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_wallet uuid; v_coin public.sd_coins%rowtype; v_old_qty numeric(30,8):=0; v_old_cost bigint:=0; v_new_qty numeric(30,8); v_new_cost bigint; v_gross bigint; v_fee bigint; v_delta bigint; v_reduce bigint:=0; v_trade uuid; v_existing public.sd_coin_trades%rowtype; v_side text:=lower(trim(p_side)); v_platform text:=lower(coalesce(nullif(trim(p_platform),''),'mobile')); v_core jsonb;
begin
 if v_user is null then raise exception '로그인이 필요합니다.'; end if; if p_request_id is null then raise exception '거래 요청 ID가 필요합니다.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text||':sdcoin:'||p_request_id::text,0));
 select * into v_existing from public.sd_coin_trades where request_id=p_request_id and user_id=v_user; if found then return pg_catalog.jsonb_build_object('ok',true,'duplicate',true,'trade_id',v_existing.id,'side',v_existing.side,'quantity',v_existing.quantity,'unit_price',v_existing.unit_price,'gross_amount',v_existing.gross_amount,'fee',v_existing.fee,'wallet_delta',v_existing.wallet_delta,'balance_after',v_existing.balance_after); end if;
 if v_side not in ('buy','sell') then raise exception '거래 종류는 buy 또는 sell이어야 합니다.'; end if; if p_quantity is null or p_quantity<0.05 or mod(p_quantity,0.05::numeric)<>0 or scale(p_quantity)>8 then raise exception '거래 수량이 올바르지 않습니다.'; end if;
 select id into v_wallet from public.wallets where user_id=v_user; if v_wallet is null then raise exception '온라인 가상지갑을 찾지 못했습니다.'; end if;
 select * into v_coin from public.sd_coins where code=upper(trim(p_coin_code)) and is_active for share; if v_coin.id is null then raise exception '거래 가능한 코인을 찾지 못했습니다.'; end if;
 select quantity,cost_basis into v_old_qty,v_old_cost from public.sd_coin_holdings where user_id=v_user and coin_id=v_coin.id for update; v_old_qty:=coalesce(v_old_qty,0); v_old_cost:=coalesce(v_old_cost,0);
 v_gross:=round(v_coin.current_price::numeric*p_quantity)::bigint; v_fee:=ceil(v_gross::numeric*0.05)::bigint;
 if v_side='buy' then v_delta:=-(v_gross+v_fee); v_new_qty:=v_old_qty+p_quantity; v_new_cost:=v_old_cost+v_gross+v_fee;
 else if v_old_qty<p_quantity then raise exception '보유 코인 수량이 부족합니다.'; end if; v_delta:=greatest(v_gross-v_fee,0); v_new_qty:=v_old_qty-p_quantity; if v_new_qty=0 then v_new_cost:=0; else v_reduce:=round(v_old_cost::numeric*(p_quantity/v_old_qty))::bigint; v_new_cost:=greatest(v_old_cost-v_reduce,0); end if; end if;
 v_core:=sd_core_private.apply_server_wallet_delta_impl(v_user,p_request_id,case when v_side='buy' then 'sdcoin_buy' else 'sdcoin_sell' end,v_delta,'sdcoin',case when v_side='buy' then 'SD코인 구매 · '||v_coin.name else 'SD코인 판매 · '||v_coin.name end,pg_catalog.jsonb_build_object('coin_code',v_coin.code,'quantity',p_quantity,'unit_price',v_coin.current_price,'gross_amount',v_gross,'fee',v_fee,'origin_platform',v_platform));
 if v_side='buy' then insert into public.sd_coin_holdings(user_id,coin_id,quantity,cost_basis) values(v_user,v_coin.id,v_new_qty,v_new_cost) on conflict(user_id,coin_id) do update set quantity=excluded.quantity,cost_basis=excluded.cost_basis,updated_at=now(); else if v_new_qty=0 then delete from public.sd_coin_holdings where user_id=v_user and coin_id=v_coin.id; else update public.sd_coin_holdings set quantity=v_new_qty,cost_basis=v_new_cost,updated_at=now() where user_id=v_user and coin_id=v_coin.id; end if; end if;
 insert into public.sd_coin_trades(request_id,user_id,wallet_id,coin_id,side,quantity,unit_price,gross_amount,fee,wallet_delta,balance_before,balance_after,platform) values(p_request_id,v_user,v_wallet,v_coin.id,v_side,p_quantity,v_coin.current_price,v_gross,v_fee,v_delta,(v_core->>'balance_before')::bigint,(v_core->>'balance_after')::bigint,v_platform) returning id into v_trade;
 return pg_catalog.jsonb_build_object('ok',true,'duplicate',false,'trade_id',v_trade,'coin_code',v_coin.code,'coin_name',v_coin.name,'side',v_side,'quantity',p_quantity,'unit_price',v_coin.current_price,'gross_amount',v_gross,'fee',v_fee,'wallet_delta',v_delta,'balance_after',(v_core->>'balance_after')::bigint,'holding_quantity',v_new_qty,'holding_cost_basis',v_new_cost);
end$$;