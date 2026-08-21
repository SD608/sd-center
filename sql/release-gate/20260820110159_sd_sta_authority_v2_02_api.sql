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
      'id',o.id,'status',o.status,'phase',o.phase,'hacking_round',o.hacking_round,'hacking_connections',o.hacking_connections,
      'laser_hits',o.laser_hits,'laser_checkpoint',o.laser_checkpoint,'vault_progress',o.vault_progress,'raw_cash',o.raw_cash,
      'loot_started_at',o.loot_started_at,'loot_ends_at',o.loot_ends_at,'loot_clicks',o.loot_clicks,
      'transport_hits',o.transport_hits,'transport_checkpoint',o.transport_checkpoint,'next_operation_unlock_at',o.next_operation_unlock_at) end,
    'operation_cooldown_remaining_ms',coalesce(v_cooldown_ms,0),
    'constants',jsonb_build_object('entry_fee',50000,'hacking_rounds',3,'laser_max_hits',5,'vault_required_hits',100,
      'loot_duration_ms',25000,'loot_per_click',2000,'loot_click_min_interval_ms',50,'loot_cap',1000000,
      'operation_cooldown_ms',300000,'transport_loss_per_hit',0.05,'transport_hit_cooldown_ms',1000),
    'authority','server'
  );
end;$$;

create or replace function public.sd_sta_start(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid(); v_replay jsonb; v_wallet jsonb; v_result jsonb; v_unlock timestamptz;
begin
  if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  v_replay:=private.sd_sta_replay(u,p_request_id,'start',p_request_id,'{}'::jsonb); if v_replay is not null then return v_replay; end if;
  if exists(select 1 from public.sd_sta_server_operations where user_id=u and status='active') then raise exception using errcode='P1031',message='STA_OPERATION_ACTIVE'; end if;
  select max(next_operation_unlock_at) into v_unlock from public.sd_sta_server_operations where user_id=u and status='completed';
  if v_unlock is not null and clock_timestamp()<v_unlock then raise exception using errcode='P1052',message='STA_OPERATION_COOLDOWN'; end if;
  v_wallet:=sd_core_private.apply_server_wallet_delta_impl(u,p_request_id,'sta_entry',-50000,'sta','STA 작전 참가비',jsonb_build_object('operation_id',p_request_id));
  insert into public.sd_sta_accounts(user_id) values(u) on conflict do nothing;
  insert into public.sd_sta_server_operations(id,user_id) values(p_request_id,u);
  v_result:=jsonb_build_object('ok',true,'operation_id',p_request_id,'phase','hacking','hacking_round',1,'entry_fee',50000,
    'balance_after',(v_wallet->>'balance_after')::bigint);
  return private.sd_sta_save(u,p_request_id,'start',p_request_id,'{}'::jsonb,v_result);
end;$$;

create or replace function public.sd_sta_hacking_connect(p_operation_id uuid,p_source_color text,p_target_color text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid(); s text:=lower(trim(coalesce(p_source_color,''))); t text:=lower(trim(coalesce(p_target_color,'')));
  o public.sd_sta_server_operations%rowtype; v_replay jsonb; v_connections jsonb; v_round_completed boolean:=false; v_hacking_completed boolean:=false; v_result jsonb;
begin
  if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  if s not in('red','blue','yellow') or t not in('red','blue','yellow') then raise exception using errcode='P1010',message='INVALID_STA_COLOR'; end if;
  v_replay:=private.sd_sta_replay(u,p_request_id,'hacking_connect',p_operation_id,jsonb_build_object('source_color',s,'target_color',t)); if v_replay is not null then return v_replay; end if;
  select * into o from public.sd_sta_server_operations where id=p_operation_id and user_id=u for update;
  if o.id is null or o.status<>'active' or o.phase<>'hacking' then raise exception using errcode='P1031',message='STA_HACKING_NOT_ACTIVE'; end if;
  v_connections:=coalesce(o.hacking_connections,'[]'::jsonb);
  if s<>t then
    v_result:=jsonb_build_object('ok',true,'connected',false,'reason','COLOR_MISMATCH','hacking_round',o.hacking_round,'connections',v_connections);
    return private.sd_sta_save(u,p_request_id,'hacking_connect',p_operation_id,jsonb_build_object('source_color',s,'target_color',t),v_result);
  end if;
  if not (v_connections ? s) then v_connections:=v_connections||jsonb_build_array(s); end if;
  if jsonb_array_length(v_connections)>=3 then
    v_round_completed:=true;
    insert into public.sd_sta_accounts(user_id,hacking_rounds_completed) values(u,1)
      on conflict(user_id) do update set hacking_rounds_completed=public.sd_sta_accounts.hacking_rounds_completed+1,updated_at=now();
    if o.hacking_round>=3 then
      v_hacking_completed:=true;
      update public.sd_sta_server_operations set phase='raid_ready',hacking_connections='[]'::jsonb,updated_at=now() where id=o.id returning * into o;
    else
      update public.sd_sta_server_operations set hacking_round=hacking_round+1,hacking_connections='[]'::jsonb,updated_at=now() where id=o.id returning * into o;
    end if;
    perform private.refresh_sd_sta_achievements(u);
  else
    update public.sd_sta_server_operations set hacking_connections=v_connections,updated_at=now() where id=o.id returning * into o;
  end if;
  v_result:=jsonb_build_object('ok',true,'connected',true,'round_completed',v_round_completed,'hacking_completed',v_hacking_completed,
    'phase',o.phase,'hacking_round',o.hacking_round,'connections',o.hacking_connections);
  return private.sd_sta_save(u,p_request_id,'hacking_connect',p_operation_id,jsonb_build_object('source_color',s,'target_color',t),v_result);
end;$$;

create or replace function public.sd_sta_start_raid(p_operation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); o public.sd_sta_server_operations%rowtype; v_replay jsonb; v_result jsonb;
begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_sta_replay(u,p_request_id,'start_raid',p_operation_id,'{}'::jsonb); if v_replay is not null then return v_replay; end if;
 select * into o from public.sd_sta_server_operations where id=p_operation_id and user_id=u for update;
 if o.id is null or o.status<>'active' or o.phase<>'raid_ready' then raise exception using errcode='P1031',message='STA_RAID_NOT_READY'; end if;
 update public.sd_sta_server_operations set phase='raid_laser',laser_hits=0,laser_checkpoint=0,updated_at=now() where id=o.id;
 v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'phase','raid_laser','laser_hits',0,'laser_checkpoint',0);
 return private.sd_sta_save(u,p_request_id,'start_raid',o.id,'{}'::jsonb,v_result);
end;$$;

create or replace function public.sd_sta_laser_checkpoint(p_operation_id uuid,p_checkpoint integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); o public.sd_sta_server_operations%rowtype; v_cp int:=greatest(0,least(2,coalesce(p_checkpoint,0))); v_replay jsonb; v_result jsonb;
begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_sta_replay(u,p_request_id,'laser_checkpoint',p_operation_id,jsonb_build_object('checkpoint',v_cp)); if v_replay is not null then return v_replay; end if;
 select * into o from public.sd_sta_server_operations where id=p_operation_id and user_id=u for update;
 if o.id is null or o.status<>'active' or o.phase<>'raid_laser' then raise exception using errcode='P1031',message='STA_LASER_NOT_ACTIVE'; end if;
 update public.sd_sta_server_operations set laser_checkpoint=greatest(laser_checkpoint,v_cp),updated_at=now() where id=o.id returning * into o;
 v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'laser_checkpoint',o.laser_checkpoint,'laser_hits',o.laser_hits);
 return private.sd_sta_save(u,p_request_id,'laser_checkpoint',o.id,jsonb_build_object('checkpoint',v_cp),v_result);
end;$$;

create or replace function public.sd_sta_laser_hit(p_operation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); o public.sd_sta_server_operations%rowtype; v_replay jsonb; v_result jsonb; v_hits int;
begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_sta_replay(u,p_request_id,'laser_hit',p_operation_id,'{}'::jsonb); if v_replay is not null then return v_replay; end if;
 select * into o from public.sd_sta_server_operations where id=p_operation_id and user_id=u for update;
 if o.id is null or o.status<>'active' or o.phase<>'raid_laser' then raise exception using errcode='P1031',message='STA_LASER_NOT_ACTIVE'; end if;
 v_hits:=o.laser_hits+1;
 if v_hits>=5 then
   update public.sd_sta_server_operations set laser_hits=v_hits,status='failed',phase='failed',updated_at=now(),ended_at=now() where id=o.id;
   v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'failed',true,'laser_hits',v_hits);
 else
   update public.sd_sta_server_operations set laser_hits=v_hits,updated_at=now() where id=o.id;
   v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'failed',false,'laser_hits',v_hits);
 end if;
 return private.sd_sta_save(u,p_request_id,'laser_hit',o.id,'{}'::jsonb,v_result);
end;$$;

create or replace function public.sd_sta_laser_pass(p_operation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); o public.sd_sta_server_operations%rowtype; v_replay jsonb; v_result jsonb;
begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_sta_replay(u,p_request_id,'laser_pass',p_operation_id,'{}'::jsonb); if v_replay is not null then return v_replay; end if;
 select * into o from public.sd_sta_server_operations where id=p_operation_id and user_id=u for update;
 if o.id is null or o.status<>'active' or o.phase<>'raid_laser' then raise exception using errcode='P1031',message='STA_LASER_NOT_ACTIVE'; end if;
 if o.laser_checkpoint<2 then raise exception using errcode='P1052',message='STA_LASER_CHECKPOINT_INCOMPLETE'; end if;
 update public.sd_sta_server_operations set phase='raid_vault',vault_progress=0,last_vault_hit_at=null,updated_at=now() where id=o.id;
 v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'phase','raid_vault','laser_hits',o.laser_hits);
 return private.sd_sta_save(u,p_request_id,'laser_pass',o.id,'{}'::jsonb,v_result);
end;$$;

create or replace function public.sd_sta_vault_hit(p_operation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); o public.sd_sta_server_operations%rowtype; v_replay jsonb; v_result jsonb; v_now timestamptz:=clock_timestamp(); v_elapsed_ms numeric; v_decay int:=0; v_progress int;
begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_sta_replay(u,p_request_id,'vault_hit',p_operation_id,'{}'::jsonb); if v_replay is not null then return v_replay; end if;
 select * into o from public.sd_sta_server_operations where id=p_operation_id and user_id=u for update;
 if o.id is null or o.status<>'active' or o.phase<>'raid_vault' then raise exception using errcode='P1031',message='STA_VAULT_NOT_ACTIVE'; end if;
 if o.last_vault_hit_at is not null then
   v_elapsed_ms:=extract(epoch from (v_now-o.last_vault_hit_at))*1000;
   if v_elapsed_ms>800 then v_decay:=floor((v_elapsed_ms-800)/400)::int+1; end if;
 end if;
 v_progress:=least(100,greatest(0,o.vault_progress-v_decay)+1);
 if v_progress>=100 then
   update public.sd_sta_server_operations set phase='raid_loot',vault_progress=100,last_vault_hit_at=v_now,loot_started_at=v_now,loot_ends_at=v_now+interval '25 seconds',last_loot_click_at=null,loot_clicks=0,raw_cash=0,updated_at=now() where id=o.id returning * into o;
 else
   update public.sd_sta_server_operations set vault_progress=v_progress,last_vault_hit_at=v_now,updated_at=now() where id=o.id returning * into o;
 end if;
 v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'vault_progress',o.vault_progress,'decayed_by',v_decay,'opened',o.phase='raid_loot','phase',o.phase,'loot_ends_at',o.loot_ends_at);
 return private.sd_sta_save(u,p_request_id,'vault_hit',o.id,'{}'::jsonb,v_result);
end;$$;

create or replace function public.sd_sta_vault_decay(p_operation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); o public.sd_sta_server_operations%rowtype; v_replay jsonb; v_result jsonb; v_now timestamptz:=clock_timestamp(); v_elapsed_ms numeric; v_decay int:=0; v_progress int;
begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_sta_replay(u,p_request_id,'vault_decay',p_operation_id,'{}'::jsonb); if v_replay is not null then return v_replay; end if;
 select * into o from public.sd_sta_server_operations where id=p_operation_id and user_id=u for update;
 if o.id is null or o.status<>'active' or o.phase<>'raid_vault' then raise exception using errcode='P1031',message='STA_VAULT_NOT_ACTIVE'; end if;
 if o.last_vault_hit_at is not null then
   v_elapsed_ms:=extract(epoch from (v_now-o.last_vault_hit_at))*1000;
   if v_elapsed_ms>800 then v_decay:=floor((v_elapsed_ms-800)/400)::int+1; end if;
 end if;
 v_progress:=greatest(0,o.vault_progress-v_decay);
 update public.sd_sta_server_operations set vault_progress=v_progress,last_vault_hit_at=case when v_decay>0 then v_now else last_vault_hit_at end,updated_at=now() where id=o.id returning * into o;
 v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'vault_progress',o.vault_progress,'decayed_by',v_decay);
 return private.sd_sta_save(u,p_request_id,'vault_decay',o.id,'{}'::jsonb,v_result);
end;$$;

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
 if o.raw_cash>=1000000 or o.loot_clicks>=500 then
   v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'accepted',false,'capped',true,'raw_cash',o.raw_cash,'loot_clicks',o.loot_clicks);
   return private.sd_sta_save(u,p_request_id,'loot_click',o.id,'{}'::jsonb,v_result);
 end if;
 if o.last_loot_click_at is not null and v_now<o.last_loot_click_at+interval '50 milliseconds' then
   v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'accepted',false,'rate_limited',true,'raw_cash',o.raw_cash,'loot_clicks',o.loot_clicks);
   return private.sd_sta_save(u,p_request_id,'loot_click',o.id,'{}'::jsonb,v_result);
 end if;
 v_raw:=least(1000000,o.raw_cash+2000);
 update public.sd_sta_server_operations set raw_cash=v_raw,loot_clicks=loot_clicks+1,last_loot_click_at=v_now,updated_at=now() where id=o.id returning * into o;
 v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'accepted',true,'raw_cash',o.raw_cash,'loot_clicks',o.loot_clicks,'loot_ends_at',o.loot_ends_at);
 return private.sd_sta_save(u,p_request_id,'loot_click',o.id,'{}'::jsonb,v_result);
end;$$;

create or replace function public.sd_sta_finalize_loot(p_operation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); o public.sd_sta_server_operations%rowtype; v_replay jsonb; v_result jsonb;
begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_sta_replay(u,p_request_id,'finalize_loot',p_operation_id,'{}'::jsonb); if v_replay is not null then return v_replay; end if;
 select * into o from public.sd_sta_server_operations where id=p_operation_id and user_id=u for update;
 if o.id is null or o.status<>'active' or o.phase<>'raid_loot' then raise exception using errcode='P1031',message='STA_LOOT_NOT_ACTIVE'; end if;
 if o.loot_ends_at is null or clock_timestamp()<o.loot_ends_at then raise exception using errcode='P1052',message='STA_LOOT_TIME_REMAINING'; end if;
 update public.sd_sta_server_operations set phase='transport_ready',updated_at=now() where id=o.id;
 v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'phase','transport_ready','raw_cash',o.raw_cash);
 return private.sd_sta_save(u,p_request_id,'finalize_loot',o.id,'{}'::jsonb,v_result);
end;$$;

create or replace function public.sd_sta_start_transport(p_operation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); o public.sd_sta_server_operations%rowtype; v_replay jsonb; v_result jsonb;
begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_sta_replay(u,p_request_id,'start_transport',p_operation_id,'{}'::jsonb); if v_replay is not null then return v_replay; end if;
 select * into o from public.sd_sta_server_operations where id=p_operation_id and user_id=u for update;
 if o.id is null or o.status<>'active' or o.phase<>'transport_ready' then raise exception using errcode='P1031',message='STA_TRANSPORT_NOT_READY'; end if;
 update public.sd_sta_server_operations set phase='transport',transport_hits=0,transport_checkpoint=0,last_transport_hit_at=null,updated_at=now() where id=o.id;
 v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'phase','transport','transport_hits',0,'transport_checkpoint',0);
 return private.sd_sta_save(u,p_request_id,'start_transport',o.id,'{}'::jsonb,v_result);
end;$$;

create or replace function public.sd_sta_transport_checkpoint(p_operation_id uuid,p_checkpoint integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); o public.sd_sta_server_operations%rowtype; v_cp int:=greatest(0,least(2,coalesce(p_checkpoint,0))); v_replay jsonb; v_result jsonb;
begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_sta_replay(u,p_request_id,'transport_checkpoint',p_operation_id,jsonb_build_object('checkpoint',v_cp)); if v_replay is not null then return v_replay; end if;
 select * into o from public.sd_sta_server_operations where id=p_operation_id and user_id=u for update;
 if o.id is null or o.status<>'active' or o.phase<>'transport' then raise exception using errcode='P1031',message='STA_TRANSPORT_NOT_ACTIVE'; end if;
 update public.sd_sta_server_operations set transport_checkpoint=greatest(transport_checkpoint,v_cp),updated_at=now() where id=o.id returning * into o;
 v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'transport_checkpoint',o.transport_checkpoint,'transport_hits',o.transport_hits);
 return private.sd_sta_save(u,p_request_id,'transport_checkpoint',o.id,jsonb_build_object('checkpoint',v_cp),v_result);
end;$$;

create or replace function public.sd_sta_transport_hit(p_operation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); o public.sd_sta_server_operations%rowtype; v_replay jsonb; v_result jsonb; v_now timestamptz:=clock_timestamp();
begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_sta_replay(u,p_request_id,'transport_hit',p_operation_id,'{}'::jsonb); if v_replay is not null then return v_replay; end if;
 select * into o from public.sd_sta_server_operations where id=p_operation_id and user_id=u for update;
 if o.id is null or o.status<>'active' or o.phase<>'transport' then raise exception using errcode='P1031',message='STA_TRANSPORT_NOT_ACTIVE'; end if;
 if o.last_transport_hit_at is not null and v_now<o.last_transport_hit_at+interval '1 second' then
   v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'accepted',false,'rate_limited',true,'transport_hits',o.transport_hits);
   return private.sd_sta_save(u,p_request_id,'transport_hit',o.id,'{}'::jsonb,v_result);
 end if;
 update public.sd_sta_server_operations set transport_hits=transport_hits+1,last_transport_hit_at=v_now,updated_at=now() where id=o.id returning * into o;
 v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'accepted',true,'transport_hits',o.transport_hits);
 return private.sd_sta_save(u,p_request_id,'transport_hit',o.id,'{}'::jsonb,v_result);
end;$$;

create or replace function public.sd_sta_transport_arrive(p_operation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); o public.sd_sta_server_operations%rowtype; v_replay jsonb; v_result jsonb; v_unlock timestamptz:=clock_timestamp()+interval '5 minutes';
begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_sta_replay(u,p_request_id,'transport_arrive',p_operation_id,'{}'::jsonb); if v_replay is not null then return v_replay; end if;
 select * into o from public.sd_sta_server_operations where id=p_operation_id and user_id=u for update;
 if o.id is null or o.status<>'active' or o.phase<>'transport' then raise exception using errcode='P1031',message='STA_TRANSPORT_NOT_ACTIVE'; end if;
 if o.transport_checkpoint<2 then raise exception using errcode='P1052',message='STA_TRANSPORT_CHECKPOINT_INCOMPLETE'; end if;
 update public.sd_sta_server_operations set phase='payout',next_operation_unlock_at=v_unlock,updated_at=now() where id=o.id;
 v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'phase','payout','transport_hits',o.transport_hits,'next_operation_unlock_at',v_unlock);
 return private.sd_sta_save(u,p_request_id,'transport_arrive',o.id,'{}'::jsonb,v_result);
end;$$;

create or replace function public.sd_sta_payout(p_operation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); o public.sd_sta_server_operations%rowtype; v_replay jsonb; v_result jsonb; v_amount bigint; v_wallet jsonb; v_balance bigint;
begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_sta_replay(u,p_request_id,'payout',p_operation_id,'{}'::jsonb); if v_replay is not null then return v_replay; end if;
 select * into o from public.sd_sta_server_operations where id=p_operation_id and user_id=u for update;
 if o.id is null or o.status<>'active' or o.phase<>'payout' or o.transport_checkpoint<2 then raise exception using errcode='P1031',message='STA_PAYOUT_NOT_READY'; end if;
 v_amount:=floor(o.raw_cash*greatest(0,1-o.transport_hits*0.05))::bigint;
 if v_amount>0 then
   v_wallet:=sd_core_private.apply_server_wallet_delta_impl(u,p_request_id,'sta_payout',v_amount,'sta','STA 작전 최종 보수',jsonb_build_object('operation_id',o.id,'raw_cash',o.raw_cash,'transport_hits',o.transport_hits));
   v_balance:=(v_wallet->>'balance_after')::bigint;
 else select balance into v_balance from public.wallets where user_id=u; end if;
 update public.sd_sta_server_operations set status='completed',phase='completed',updated_at=now(),ended_at=now() where id=o.id;
 insert into public.sd_sta_accounts(user_id,completed_operations,zero_hit_completions,max_raw_cash,max_payout)
 values(u,1,case when o.transport_hits=0 then 1 else 0 end,o.raw_cash,v_amount)
 on conflict(user_id) do update set completed_operations=public.sd_sta_accounts.completed_operations+1,
   zero_hit_completions=public.sd_sta_accounts.zero_hit_completions+case when o.transport_hits=0 then 1 else 0 end,
   max_raw_cash=greatest(public.sd_sta_accounts.max_raw_cash,excluded.max_raw_cash),max_payout=greatest(public.sd_sta_accounts.max_payout,excluded.max_payout),updated_at=now();
 perform private.refresh_sd_sta_achievements(u);
 v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'raw_cash',o.raw_cash,'transport_hits',o.transport_hits,'payout',v_amount,'balance_after',v_balance,'completed',true);
 return private.sd_sta_save(u,p_request_id,'payout',o.id,'{}'::jsonb,v_result);
end;$$;

revoke execute on function public.sd_sta_get_state() from public,anon;
revoke execute on function public.sd_sta_start(uuid) from public,anon;
revoke execute on function public.sd_sta_hacking_connect(uuid,text,text,uuid) from public,anon;
revoke execute on function public.sd_sta_start_raid(uuid,uuid) from public,anon;
revoke execute on function public.sd_sta_laser_checkpoint(uuid,integer,uuid) from public,anon;
revoke execute on function public.sd_sta_laser_hit(uuid,uuid) from public,anon;
revoke execute on function public.sd_sta_laser_pass(uuid,uuid) from public,anon;
revoke execute on function public.sd_sta_vault_hit(uuid,uuid) from public,anon;
revoke execute on function public.sd_sta_vault_decay(uuid,uuid) from public,anon;
revoke execute on function public.sd_sta_loot_click(uuid,uuid) from public,anon;
revoke execute on function public.sd_sta_finalize_loot(uuid,uuid) from public,anon;
revoke execute on function public.sd_sta_start_transport(uuid,uuid) from public,anon;
revoke execute on function public.sd_sta_transport_checkpoint(uuid,integer,uuid) from public,anon;
revoke execute on function public.sd_sta_transport_hit(uuid,uuid) from public,anon;
revoke execute on function public.sd_sta_transport_arrive(uuid,uuid) from public,anon;
revoke execute on function public.sd_sta_payout(uuid,uuid) from public,anon;
grant execute on function public.sd_sta_get_state() to authenticated;
grant execute on function public.sd_sta_start(uuid) to authenticated;
grant execute on function public.sd_sta_hacking_connect(uuid,text,text,uuid) to authenticated;
grant execute on function public.sd_sta_start_raid(uuid,uuid) to authenticated;
grant execute on function public.sd_sta_laser_checkpoint(uuid,integer,uuid) to authenticated;
grant execute on function public.sd_sta_laser_hit(uuid,uuid) to authenticated;
grant execute on function public.sd_sta_laser_pass(uuid,uuid) to authenticated;
grant execute on function public.sd_sta_vault_hit(uuid,uuid) to authenticated;
grant execute on function public.sd_sta_vault_decay(uuid,uuid) to authenticated;
grant execute on function public.sd_sta_loot_click(uuid,uuid) to authenticated;
grant execute on function public.sd_sta_finalize_loot(uuid,uuid) to authenticated;
grant execute on function public.sd_sta_start_transport(uuid,uuid) to authenticated;
grant execute on function public.sd_sta_transport_checkpoint(uuid,integer,uuid) to authenticated;
grant execute on function public.sd_sta_transport_hit(uuid,uuid) to authenticated;
grant execute on function public.sd_sta_transport_arrive(uuid,uuid) to authenticated;
grant execute on function public.sd_sta_payout(uuid,uuid) to authenticated;

commit;