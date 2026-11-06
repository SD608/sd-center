-- DRAFT/REVIEW ONLY. No production deployment.
-- Exact production getter definitions with account lazy-initialization disabled.
-- Existing-user return values preserved; unknown accounts fail closed without writes.

CREATE OR REPLACE FUNCTION public.get_sd_bitcoin_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid:=auth.uid();
  a public.sd_bitcoin_accounts%rowtype;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  select * into a from public.sd_bitcoin_accounts where user_id=v_user;
  if not found then raise exception using errcode='P1032',message='BITCOIN_RETIRED_NO_ACCOUNT'; end if;
  return jsonb_build_object(
    'available',true,'btc_quantity',a.btc_balance,'synced_at',a.updated_at,
    'local_updated_at',null,'source_hint','SD Core Bitcoin Authority',
    'notice','BTC 잔액은 SD Core 서버 상태를 기준으로 합니다.','authority','server'
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sd_bitcoin_get_state()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid:=auth.uid();
  a public.sd_bitcoin_accounts%rowtype;
  v_rooms jsonb;
  v_active int;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  select * into a from public.sd_bitcoin_accounts where user_id=v_user;
  if not found then raise exception using errcode='P1032',message='BITCOIN_RETIRED_NO_ACCOUNT'; end if;
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
$function$
;

