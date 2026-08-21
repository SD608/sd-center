alter table public.sd_sta_server_operations add column if not exists phase_started_at timestamptz not null default clock_timestamp();
alter table public.sd_sta_server_operations add column if not exists transport_step integer not null default 0 check (transport_step between 0 and 20);
alter table public.sd_sta_server_operations add column if not exists transport_blocked_lane text check (transport_blocked_lane is null or transport_blocked_lane in ('left','center','right'));
alter table public.sd_sta_server_operations add column if not exists last_transport_step_at timestamptz;

create or replace function private.sd_sta_set_transport_challenge(p_operation uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_lanes text[]:=array['left','center','right']; v_lane text; v_i int;
begin
  v_i := (pg_catalog.get_byte(extensions.gen_random_bytes(1),0) % 3) + 1;
  v_lane := v_lanes[v_i];
  update public.sd_sta_server_operations set transport_blocked_lane=v_lane where id=p_operation;
  return v_lane;
end$$;
revoke all on function private.sd_sta_set_transport_challenge(uuid) from public,anon,authenticated;

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
      'loot_duration_ms',25000,'loot_per_click',2000,'loot_click_min_interval_ms',50,'loot_cap',1000000,
      'operation_cooldown_ms',300000,'transport_loss_per_hit',0.05,'transport_hit_cooldown_ms',1000,
      'transport_steps',20,'transport_step_min_interval_ms',250),
    'authority','server'
  );
end$$;

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
      update public.sd_sta_server_operations set phase='raid_ready',phase_started_at=clock_timestamp(),hacking_connections='[]'::jsonb,updated_at=now() where id=o.id returning * into o;
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
end$$;

create or replace function public.sd_sta_start_raid(p_operation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); o public.sd_sta_server_operations%rowtype; v_replay jsonb; v_result jsonb;
begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_sta_replay(u,p_request_id,'start_raid',p_operation_id,'{}'::jsonb); if v_replay is not null then return v_replay; end if;
 select * into o from public.sd_sta_server_operations where id=p_operation_id and user_id=u for update;
 if o.id is null or o.status<>'active' or o.phase<>'raid_ready' then raise exception using errcode='P1031',message='STA_RAID_NOT_READY'; end if;
 update public.sd_sta_server_operations set phase='raid_laser',phase_started_at=clock_timestamp(),laser_hits=0,laser_checkpoint=0,updated_at=now() where id=o.id;
 v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'phase','raid_laser','laser_hits',0,'laser_checkpoint',0);
 return private.sd_sta_save(u,p_request_id,'start_raid',o.id,'{}'::jsonb,v_result);
end$$;

create or replace function public.sd_sta_laser_checkpoint(p_operation_id uuid,p_checkpoint integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); o public.sd_sta_server_operations%rowtype; v_cp int:=coalesce(p_checkpoint,0); v_replay jsonb; v_result jsonb; v_min interval;
begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 if v_cp not in (1,2) then raise exception using errcode='P1010',message='INVALID_STA_LASER_CHECKPOINT'; end if;
 v_replay:=private.sd_sta_replay(u,p_request_id,'laser_checkpoint',p_operation_id,jsonb_build_object('checkpoint',v_cp)); if v_replay is not null then return v_replay; end if;
 select * into o from public.sd_sta_server_operations where id=p_operation_id and user_id=u for update;
 if o.id is null or o.status<>'active' or o.phase<>'raid_laser' then raise exception using errcode='P1031',message='STA_LASER_NOT_ACTIVE'; end if;
 if v_cp<>o.laser_checkpoint+1 then raise exception using errcode='P1031',message='STA_LASER_CHECKPOINT_ORDER'; end if;
 v_min:=make_interval(secs=>2*v_cp);
 if clock_timestamp()<o.phase_started_at+v_min then raise exception using errcode='P1052',message='STA_LASER_CHECKPOINT_TOO_EARLY'; end if;
 update public.sd_sta_server_operations set laser_checkpoint=v_cp,updated_at=now() where id=o.id returning * into o;
 v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'laser_checkpoint',o.laser_checkpoint,'laser_hits',o.laser_hits);
 return private.sd_sta_save(u,p_request_id,'laser_checkpoint',o.id,jsonb_build_object('checkpoint',v_cp),v_result);
end$$;

create or replace function public.sd_sta_laser_pass(p_operation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); o public.sd_sta_server_operations%rowtype; v_replay jsonb; v_result jsonb;
begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_sta_replay(u,p_request_id,'laser_pass',p_operation_id,'{}'::jsonb); if v_replay is not null then return v_replay; end if;
 select * into o from public.sd_sta_server_operations where id=p_operation_id and user_id=u for update;
 if o.id is null or o.status<>'active' or o.phase<>'raid_laser' then raise exception using errcode='P1031',message='STA_LASER_NOT_ACTIVE'; end if;
 if o.laser_checkpoint<2 or clock_timestamp()<o.phase_started_at+interval '4 seconds' then raise exception using errcode='P1052',message='STA_LASER_CHECKPOINT_INCOMPLETE'; end if;
 update public.sd_sta_server_operations set phase='raid_vault',phase_started_at=clock_timestamp(),vault_progress=0,last_vault_hit_at=null,updated_at=now() where id=o.id;
 v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'phase','raid_vault','laser_hits',o.laser_hits);
 return private.sd_sta_save(u,p_request_id,'laser_pass',o.id,'{}'::jsonb,v_result);
end$$;

create or replace function public.sd_sta_vault_hit(p_operation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); o public.sd_sta_server_operations%rowtype; v_replay jsonb; v_result jsonb; v_now timestamptz:=clock_timestamp(); v_elapsed_ms numeric; v_decay int:=0; v_progress int;
begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_sta_replay(u,p_request_id,'vault_hit',p_operation_id,'{}'::jsonb); if v_replay is not null then return v_replay; end if;
 select * into o from public.sd_sta_server_operations where id=p_operation_id and user_id=u for update;
 if o.id is null or o.status<>'active' or o.phase<>'raid_vault' then raise exception using errcode='P1031',message='STA_VAULT_NOT_ACTIVE'; end if;
 if o.last_vault_hit_at is not null and v_now<o.last_vault_hit_at+interval '50 milliseconds' then raise exception using errcode='P1052',message='STA_VAULT_HIT_TOO_FAST'; end if;
 if o.last_vault_hit_at is not null then
   v_elapsed_ms:=extract(epoch from (v_now-o.last_vault_hit_at))*1000;
   if v_elapsed_ms>800 then v_decay:=floor((v_elapsed_ms-800)/400)::int+1; end if;
 end if;
 v_progress:=least(100,greatest(0,o.vault_progress-v_decay)+1);
 if v_progress>=100 then
   update public.sd_sta_server_operations set phase='raid_loot',phase_started_at=v_now,vault_progress=100,last_vault_hit_at=v_now,loot_started_at=v_now,loot_ends_at=v_now+interval '25 seconds',last_loot_click_at=null,loot_clicks=0,raw_cash=0,updated_at=now() where id=o.id returning * into o;
 else
   update public.sd_sta_server_operations set vault_progress=v_progress,last_vault_hit_at=v_now,updated_at=now() where id=o.id returning * into o;
 end if;
 v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'vault_progress',o.vault_progress,'decayed_by',v_decay,'opened',o.phase='raid_loot','phase',o.phase,'loot_ends_at',o.loot_ends_at);
 return private.sd_sta_save(u,p_request_id,'vault_hit',o.id,'{}'::jsonb,v_result);
end$$;

create or replace function public.sd_sta_finalize_loot(p_operation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); o public.sd_sta_server_operations%rowtype; v_replay jsonb; v_result jsonb;
begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_sta_replay(u,p_request_id,'finalize_loot',p_operation_id,'{}'::jsonb); if v_replay is not null then return v_replay; end if;
 select * into o from public.sd_sta_server_operations where id=p_operation_id and user_id=u for update;
 if o.id is null or o.status<>'active' or o.phase<>'raid_loot' then raise exception using errcode='P1031',message='STA_LOOT_NOT_ACTIVE'; end if;
 if o.loot_ends_at is null or clock_timestamp()<o.loot_ends_at then raise exception using errcode='P1052',message='STA_LOOT_TIME_REMAINING'; end if;
 update public.sd_sta_server_operations set phase='transport_ready',phase_started_at=clock_timestamp(),updated_at=now() where id=o.id;
 v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'phase','transport_ready','raw_cash',o.raw_cash);
 return private.sd_sta_save(u,p_request_id,'finalize_loot',o.id,'{}'::jsonb,v_result);
end$$;

create or replace function public.sd_sta_start_transport(p_operation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); o public.sd_sta_server_operations%rowtype; v_replay jsonb; v_result jsonb; v_lane text; v_now timestamptz:=clock_timestamp();
begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_sta_replay(u,p_request_id,'start_transport',p_operation_id,'{}'::jsonb); if v_replay is not null then return v_replay; end if;
 select * into o from public.sd_sta_server_operations where id=p_operation_id and user_id=u for update;
 if o.id is null or o.status<>'active' or o.phase<>'transport_ready' then raise exception using errcode='P1031',message='STA_TRANSPORT_NOT_READY'; end if;
 update public.sd_sta_server_operations set phase='transport',phase_started_at=v_now,transport_hits=0,transport_checkpoint=0,transport_step=0,last_transport_hit_at=null,last_transport_step_at=v_now,updated_at=now() where id=o.id;
 v_lane:=private.sd_sta_set_transport_challenge(o.id);
 v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'phase','transport','transport_hits',0,'transport_checkpoint',0,'transport_step',0,'blocked_lane',v_lane);
 return private.sd_sta_save(u,p_request_id,'start_transport',o.id,'{}'::jsonb,v_result);
end$$;

create or replace function public.sd_sta_transport_step(p_operation_id uuid,p_lane text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); o public.sd_sta_server_operations%rowtype; v_lane text:=lower(trim(coalesce(p_lane,''))); v_replay jsonb; v_result jsonb; v_now timestamptz:=clock_timestamp(); v_hit int:=0; v_step int; v_cp int; v_next text:=null;
begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 if v_lane not in ('left','center','right') then raise exception using errcode='P1010',message='INVALID_STA_TRANSPORT_LANE'; end if;
 v_replay:=private.sd_sta_replay(u,p_request_id,'transport_step',p_operation_id,jsonb_build_object('lane',v_lane)); if v_replay is not null then return v_replay; end if;
 select * into o from public.sd_sta_server_operations where id=p_operation_id and user_id=u for update;
 if o.id is null or o.status<>'active' or o.phase<>'transport' then raise exception using errcode='P1031',message='STA_TRANSPORT_NOT_ACTIVE'; end if;
 if o.transport_step>=20 then raise exception using errcode='P1031',message='STA_TRANSPORT_COMPLETE'; end if;
 if o.last_transport_step_at is not null and v_now<o.last_transport_step_at+interval '250 milliseconds' then raise exception using errcode='P1052',message='STA_TRANSPORT_STEP_TOO_FAST'; end if;
 if o.transport_blocked_lane is null then raise exception using errcode='P1099',message='STA_TRANSPORT_CHALLENGE_MISSING'; end if;
 v_hit:=case when v_lane=o.transport_blocked_lane then 1 else 0 end;
 v_step:=o.transport_step+1;
 v_cp:=case when v_step>=20 then 2 when v_step>=10 then 1 else 0 end;
 update public.sd_sta_server_operations set transport_step=v_step,transport_checkpoint=v_cp,transport_hits=transport_hits+v_hit,last_transport_step_at=v_now,updated_at=now(),transport_blocked_lane=null where id=o.id returning * into o;
 if v_step<20 then v_next:=private.sd_sta_set_transport_challenge(o.id); end if;
 select * into o from public.sd_sta_server_operations where id=o.id;
 v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'step',o.transport_step,'checkpoint',o.transport_checkpoint,'hit',v_hit=1,'transport_hits',o.transport_hits,'next_blocked_lane',v_next);
 return private.sd_sta_save(u,p_request_id,'transport_step',o.id,jsonb_build_object('lane',v_lane),v_result);
end$$;

create or replace function public.sd_sta_transport_checkpoint(p_operation_id uuid,p_checkpoint integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 raise exception using errcode='P1031',message='STA_TRANSPORT_USE_SERVER_STEPS';
end$$;
create or replace function public.sd_sta_transport_hit(p_operation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 raise exception using errcode='P1031',message='STA_TRANSPORT_USE_SERVER_STEPS';
end$$;

create or replace function public.sd_sta_transport_arrive(p_operation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); o public.sd_sta_server_operations%rowtype; v_replay jsonb; v_result jsonb; v_unlock timestamptz:=clock_timestamp()+interval '5 minutes';
begin
 if u is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_sta_replay(u,p_request_id,'transport_arrive',p_operation_id,'{}'::jsonb); if v_replay is not null then return v_replay; end if;
 select * into o from public.sd_sta_server_operations where id=p_operation_id and user_id=u for update;
 if o.id is null or o.status<>'active' or o.phase<>'transport' then raise exception using errcode='P1031',message='STA_TRANSPORT_NOT_ACTIVE'; end if;
 if o.transport_step<20 or o.transport_checkpoint<2 or clock_timestamp()<o.phase_started_at+interval '5 seconds' then raise exception using errcode='P1052',message='STA_TRANSPORT_INCOMPLETE'; end if;
 update public.sd_sta_server_operations set phase='payout',phase_started_at=clock_timestamp(),next_operation_unlock_at=v_unlock,updated_at=now() where id=o.id;
 v_result:=jsonb_build_object('ok',true,'operation_id',o.id,'phase','payout','transport_hits',o.transport_hits,'next_operation_unlock_at',v_unlock);
 return private.sd_sta_save(u,p_request_id,'transport_arrive',o.id,'{}'::jsonb,v_result);
end$$;

grant execute on function public.sd_sta_transport_step(uuid,text,uuid) to authenticated;
revoke execute on function public.sd_sta_transport_step(uuid,text,uuid) from public,anon;
