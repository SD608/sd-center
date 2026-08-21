begin;

create or replace function public.sd_sta_get_state()
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid(); a public.sd_sta_accounts%rowtype; o public.sd_sta_server_operations%rowtype; v_cooldown_ms bigint:=0;
begin
  if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  insert into public.sd_sta_accounts(user_id) values(u) on conflict do nothing;
  select * into a from public.sd_sta_accounts where user_id=u;
  select * into o from public.sd_sta_server_operations where user_id=u and status='active' order by created_at desc limit 1;
  if o.id is null then
    select greatest(0,ceil(extract(epoch from (max(next_operation_unlock_at)-clock_timestamp()))*1000)::bigint)
      into v_cooldown_ms from public.sd_sta_server_operations where user_id=u and status='completed';
  end if;
  return jsonb_build_object(
    'ok',true,
    'stats',jsonb_build_object('completed_operations',a.completed_operations,'zero_hit_completions',a.zero_hit_completions,
      'hacking_rounds_completed',a.hacking_rounds_completed,'max_raw_cash',a.max_raw_cash,'max_payout',a.max_payout),
    'operation',case when o.id is null then null else jsonb_build_object(
      'id',o.id,'status',o.status,'phase',o.phase,'phase_started_at',o.phase_started_at,'hacking_round',o.hacking_round,'hacking_connections',o.hacking_connections,
      'laser_hits',o.laser_hits,'laser_checkpoint',o.laser_checkpoint,'vault_progress',o.vault_progress,'raw_cash',o.raw_cash,
      'loot_started_at',o.loot_started_at,'loot_ends_at',o.loot_ends_at,'loot_clicks',o.loot_clicks,
      'transport_hits',o.transport_hits,'transport_checkpoint',o.transport_checkpoint,'transport_step',o.transport_step,
      'transport_blocked_lane',o.transport_blocked_lane,'next_operation_unlock_at',o.next_operation_unlock_at) end,
    'operation_cooldown_remaining_ms',coalesce(v_cooldown_ms,0),
    'constants',jsonb_build_object('entry_fee',50000,'hacking_rounds',3,'laser_max_hits',5,'vault_required_hits',100,
      'loot_duration_ms',25000,'loot_per_click',10000,'loot_click_min_interval_ms',50,'loot_cap',1000000,
      'operation_cooldown_ms',300000,'transport_loss_per_hit',0.05,'transport_hit_cooldown_ms',1000,
      'transport_steps',20,'transport_step_min_interval_ms',250),
    'authority','server'
  );
end$$;

create or replace function public.sd_sta_loot_click(p_operation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); o public.sd_sta_server_operations%rowtype; v_replay jsonb; v_result jsonb; v_now timestamptz:=clock_timestamp(); v_raw bigint;
begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_sta_replay(u,p_request_id,'loot_click',p_operation_id,'{}'::jsonb); if v_replay is not null then return v_replay; end if;
 select * into o from public.sd_sta_server_operations where id=p_operation_id and user_id=u for update;
 if o.id is null or o.status<>'active' or o.phase<>'raid_loot' then raise exception using errcode='P1031',message='STA_LOOT_NOT_ACTIVE'; end if;
 if o.loot_ends_at is null or v_now>=o.loot_ends_at then
   v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'accepted',false,'expired',true,'raw_cash',o.raw_cash);
   return private.sd_sta_save(u,p_request_id,'loot_click',o.id,'{}'::jsonb,v_result);
 end if;
 if o.raw_cash>=1000000 or o.loot_clicks>=100 then
   v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'accepted',false,'capped',true,'raw_cash',o.raw_cash,'loot_clicks',o.loot_clicks);
   return private.sd_sta_save(u,p_request_id,'loot_click',o.id,'{}'::jsonb,v_result);
 end if;
 if o.last_loot_click_at is not null and v_now<o.last_loot_click_at+interval '50 milliseconds' then
   v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'accepted',false,'rate_limited',true,'raw_cash',o.raw_cash,'loot_clicks',o.loot_clicks);
   return private.sd_sta_save(u,p_request_id,'loot_click',o.id,'{}'::jsonb,v_result);
 end if;
 v_raw:=least(1000000,o.raw_cash+10000);
 update public.sd_sta_server_operations set raw_cash=v_raw,loot_clicks=loot_clicks+1,last_loot_click_at=v_now,updated_at=now() where id=o.id returning * into o;
 v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'accepted',true,'raw_cash',o.raw_cash,'loot_clicks',o.loot_clicks,'loot_ends_at',o.loot_ends_at);
 return private.sd_sta_save(u,p_request_id,'loot_click',o.id,'{}'::jsonb,v_result);
end$$;

revoke execute on function public.sd_sta_get_state() from public,anon;
grant execute on function public.sd_sta_get_state() to authenticated;
revoke execute on function public.sd_sta_loot_click(uuid,uuid) from public,anon;
grant execute on function public.sd_sta_loot_click(uuid,uuid) to authenticated;

comment on function public.sd_sta_loot_click(uuid,uuid) is 'Server-authoritative STA loot click. 25-second window, 50ms server rate limit, 10,000 KRW accepted click, 1,000,000 KRW operation cap; 100 accepted clicks attain the active sta-02 requirement without changing the payout cap.';

commit;