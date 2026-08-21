begin;

alter table public.sd_flea_pc_missions
  add column if not exists escape_distance_m numeric not null default 0,
  add column if not exists escape_target_distance_m numeric not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname='sd_flea_pc_missions_escape_distance_m_check'
  ) then
    alter table public.sd_flea_pc_missions
      add constraint sd_flea_pc_missions_escape_distance_m_check check (escape_distance_m >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname='sd_flea_pc_missions_escape_target_distance_m_check'
  ) then
    alter table public.sd_flea_pc_missions
      add constraint sd_flea_pc_missions_escape_target_distance_m_check check (escape_target_distance_m >= 0 and escape_target_distance_m <= 5000);
  end if;
end $$;

create or replace function public.sd_flea_pc_bank_begin_escape(p_mission_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid();
  v_m public.sd_flea_pc_missions%rowtype;
  v_replay jsonb;
  v_result jsonb;
  v_target numeric;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  v_replay:=private.sd_flea_pc_action_replay(v_user,p_request_id,'bank_begin_escape',p_mission_id,'{}'::jsonb);
  if v_replay is not null then return v_replay; end if;
  select * into v_m from public.sd_flea_pc_missions where id=p_mission_id and user_id=v_user for update;
  if v_m.id is null or v_m.mission_type<>'bank' or v_m.status<>'active' or v_m.carried_safes<1 then
    raise exception using errcode='P1031',message='BANK_ESCAPE_NOT_READY';
  end if;
  v_target:=850 + greatest(0,least(5,v_m.carried_safes-1))*150;
  update public.sd_flea_pc_missions
     set status='escaping',escape_started_at=now(),last_checkpoint_at=now(),escape_checkpoint_count=0,
         top_speed_distance_m=0,escape_distance_m=0,escape_target_distance_m=v_target
   where id=v_m.id;
  v_result:=jsonb_build_object('ok',true,'mission_id',v_m.id,'status','escaping','carried_safes',v_m.carried_safes,
    'escape_distance_m',0,'escape_target_distance_m',v_target);
  return private.sd_flea_pc_save_action(v_user,p_request_id,'bank_begin_escape',p_mission_id,'{}'::jsonb,v_result);
end;
$$;
revoke execute on function public.sd_flea_pc_bank_begin_escape(uuid,uuid) from public,anon;
grant execute on function public.sd_flea_pc_bank_begin_escape(uuid,uuid) to authenticated;

create or replace function public.sd_flea_pc_bank_checkpoint(p_mission_id uuid,p_at_max_speed boolean,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid();
  v_m public.sd_flea_pc_missions%rowtype;
  v_replay jsonb;
  v_result jsonb;
  v_elapsed numeric;
  v_speed_kmh numeric;
  v_add_distance numeric:=0;
  v_add_top numeric:=0;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  v_replay:=private.sd_flea_pc_action_replay(v_user,p_request_id,'bank_checkpoint',p_mission_id,jsonb_build_object('at_max_speed',coalesce(p_at_max_speed,false)));
  if v_replay is not null then return v_replay; end if;
  select * into v_m from public.sd_flea_pc_missions where id=p_mission_id and user_id=v_user for update;
  if v_m.id is null or v_m.status<>'escaping' then raise exception using errcode='P1031',message='BANK_ESCAPE_NOT_ACTIVE'; end if;
  if coalesce(v_m.escape_target_distance_m,0)<=0 then raise exception using errcode='P1031',message='BANK_ESCAPE_TARGET_MISSING'; end if;
  v_elapsed:=greatest(0,least(5,extract(epoch from (now()-coalesce(v_m.last_checkpoint_at,now())))));
  v_speed_kmh:=case when coalesce(p_at_max_speed,false) then 150 else 100 end;
  v_add_distance:=v_elapsed*(v_speed_kmh/3.6);
  if coalesce(p_at_max_speed,false) and now()>=coalesce(v_m.escape_started_at,now())+interval '3 seconds' then
    v_add_top:=v_elapsed*(150.0/3.6);
  end if;
  update public.sd_flea_pc_missions set
    escape_distance_m=least(escape_target_distance_m,escape_distance_m+v_add_distance),
    top_speed_distance_m=top_speed_distance_m+v_add_top,
    last_checkpoint_at=now(),
    escape_checkpoint_count=escape_checkpoint_count+1
  where id=v_m.id returning * into v_m;
  v_result:=jsonb_build_object('ok',true,'mission_id',v_m.id,'accepted_seconds',v_elapsed,'accepted_speed_kmh',v_speed_kmh,
    'checkpoint_count',v_m.escape_checkpoint_count,'escape_distance_m',v_m.escape_distance_m,
    'escape_target_distance_m',v_m.escape_target_distance_m,'top_speed_distance_m',v_m.top_speed_distance_m,
    'escape_complete',v_m.escape_distance_m>=v_m.escape_target_distance_m);
  return private.sd_flea_pc_save_action(v_user,p_request_id,'bank_checkpoint',p_mission_id,jsonb_build_object('at_max_speed',coalesce(p_at_max_speed,false)),v_result);
end;
$$;
revoke execute on function public.sd_flea_pc_bank_checkpoint(uuid,boolean,uuid) from public,anon;
grant execute on function public.sd_flea_pc_bank_checkpoint(uuid,boolean,uuid) to authenticated;

create or replace function public.sd_flea_pc_bank_finish(p_mission_id uuid,p_success boolean,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid();
  v_m public.sd_flea_pc_missions%rowtype;
  v_replay jsonb;
  v_result jsonb;
  v_box record;
  v_loot jsonb:='[]'::jsonb;
  v_one jsonb;
  v_min_seconds numeric;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  v_replay:=private.sd_flea_pc_action_replay(v_user,p_request_id,'bank_finish',p_mission_id,jsonb_build_object('success',coalesce(p_success,false)));
  if v_replay is not null then return v_replay; end if;
  select * into v_m from public.sd_flea_pc_missions where id=p_mission_id and user_id=v_user for update;
  if v_m.id is null or v_m.mission_type<>'bank' or v_m.status<>'escaping' then raise exception using errcode='P1031',message='BANK_ESCAPE_NOT_ACTIVE'; end if;

  if coalesce(p_success,false) then
    if coalesce(v_m.escape_target_distance_m,0)<=0 then raise exception using errcode='P1031',message='BANK_ESCAPE_TARGET_MISSING'; end if;
    v_min_seconds:=ceil(v_m.escape_target_distance_m*3.6/150.0);
    if now()<coalesce(v_m.escape_started_at,now())+make_interval(secs=>v_min_seconds::int) then
      raise exception using errcode='P1052',message='BANK_ESCAPE_TOO_EARLY';
    end if;
    if v_m.escape_checkpoint_count<2 then raise exception using errcode='P1052',message='BANK_ESCAPE_CHECKPOINTS_INCOMPLETE'; end if;
    if v_m.escape_distance_m<v_m.escape_target_distance_m then
      raise exception using errcode='P1052',message='BANK_ESCAPE_DISTANCE_INCOMPLETE';
    end if;

    update public.sd_flea_pc_missions set status='completed',completed_at=now() where id=v_m.id;
    insert into public.sd_flea_pc_accounts(user_id,bank_successes,max_top_speed_distance_m)
    values(v_user,1,v_m.top_speed_distance_m)
    on conflict(user_id) do update set bank_successes=public.sd_flea_pc_accounts.bank_successes+1,
      max_top_speed_distance_m=greatest(public.sd_flea_pc_accounts.max_top_speed_distance_m,excluded.max_top_speed_distance_m),updated_at=now();
    for v_box in select id from public.sd_flea_pc_boxes where mission_id=v_m.id and carried order by created_at,id loop
      v_one:=private.sd_flea_pc_grant_box_item(v_box.id);
      v_loot:=v_loot||jsonb_build_array(v_one);
    end loop;
  else
    update public.sd_flea_pc_missions set status='failed',completed_at=now() where id=v_m.id;
    insert into public.sd_flea_pc_accounts(user_id,bank_failures,max_top_speed_distance_m)
    values(v_user,1,v_m.top_speed_distance_m)
    on conflict(user_id) do update set bank_failures=public.sd_flea_pc_accounts.bank_failures+1,
      max_top_speed_distance_m=greatest(public.sd_flea_pc_accounts.max_top_speed_distance_m,excluded.max_top_speed_distance_m),updated_at=now();
  end if;
  perform private.refresh_sd_flea_pc_achievements(v_user);
  v_result:=jsonb_build_object('ok',true,'mission_id',v_m.id,'success',coalesce(p_success,false),
    'escape_distance_m',v_m.escape_distance_m,'escape_target_distance_m',v_m.escape_target_distance_m,
    'top_speed_distance_m',v_m.top_speed_distance_m,'loot',case when p_success then v_loot else '[]'::jsonb end);
  return private.sd_flea_pc_save_action(v_user,p_request_id,'bank_finish',p_mission_id,jsonb_build_object('success',coalesce(p_success,false)),v_result);
end;
$$;
revoke execute on function public.sd_flea_pc_bank_finish(uuid,boolean,uuid) from public,anon;
grant execute on function public.sd_flea_pc_bank_finish(uuid,boolean,uuid) to authenticated;

create or replace function public.sd_flea_pc_get_state()
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid();
  v_a public.sd_flea_pc_accounts%rowtype;
  v_m public.sd_flea_pc_missions%rowtype;
  v_mission jsonb:=null;
  v_nodes jsonb:='[]'::jsonb;
  v_boxes jsonb:='[]'::jsonb;
  v_guards jsonb:='[]'::jsonb;
  v_items jsonb:='[]'::jsonb;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  insert into public.sd_flea_pc_accounts(user_id) values(v_user) on conflict(user_id) do nothing;
  select * into v_a from public.sd_flea_pc_accounts where user_id=v_user;
  select * into v_m from public.sd_flea_pc_missions where user_id=v_user and status in('active','escaping') order by created_at desc limit 1;
  if v_m.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('node_index',n.node_index,'searched',n.searched_at is not null,'box_id',n.box_id) order by n.node_index),'[]'::jsonb)
      into v_nodes from public.sd_flea_pc_nodes n where n.mission_id=v_m.id;
    select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'tier',b.tier,'source_kind',b.source_kind,'carried',b.carried,'opened',b.opened_at is not null) order by b.created_at,b.id),'[]'::jsonb)
      into v_boxes from public.sd_flea_pc_boxes b where b.mission_id=v_m.id;
    select coalesce(jsonb_agg(jsonb_build_object('guard_no',g.guard_no,'hp',g.hp,'max_hp',g.max_hp,'neutralized',g.hp<=0) order by g.guard_no),'[]'::jsonb)
      into v_guards from public.sd_flea_pc_bank_guards g where g.mission_id=v_m.id;
    v_mission:=jsonb_build_object('id',v_m.id,'mission_type',v_m.mission_type,'location_id',v_m.location_id,'status',v_m.status,
      'node_count',v_m.node_count,'search_count',v_m.search_count,'found_boxes',v_m.found_boxes,'max_boxes',v_m.max_boxes,
      'prep_type',v_m.prep_type,'prep_targets_found',v_m.prep_targets_found,'prep_target_count',v_m.prep_target_count,
      'carried_safes',v_m.carried_safes,'bank_door_unlocked',v_m.bank_door_unlocked,'bank_code_revealed',v_m.bank_code_revealed,
      'bank_guards_neutralized',v_m.bank_guards_neutralized,'bank_guard_weakening',v_m.bank_guard_weakening,
      'escape_checkpoint_count',v_m.escape_checkpoint_count,'escape_distance_m',v_m.escape_distance_m,
      'escape_target_distance_m',v_m.escape_target_distance_m,'top_speed_distance_m',v_m.top_speed_distance_m,
      'created_at',v_m.created_at,'expires_at',v_m.expires_at,'nodes',v_nodes,'boxes',v_boxes,'guards',v_guards);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'local_item_id',i.local_item_key,'name',i.name,'tier',i.tier,
    'original_value',i.original_value,'current_value',i.current_value,'box_id',i.box_id,'acquired_at',i.acquired_at,
    'sellable',coalesce(r.sellable,true),'catalog_key',r.catalog_key) order by i.acquired_at desc),'[]'::jsonb)
    into v_items from public.sd_flea_items i left join public.sd_flea_pc_loot_receipts r on r.flea_item_id=i.id
    where i.owner_user_id=v_user and i.status='owned' and i.acquisition_kind='server_loot';
  return jsonb_build_object('ok',true,'account',jsonb_build_object('bank_successes',v_a.bank_successes,'bank_failures',v_a.bank_failures,
    'boxes_looted',v_a.boxes_looted,'bank_equipment_ready',v_a.bank_equipment_ready,'bank_guard_weakening_ready',v_a.bank_guard_weakening_ready),
    'active_mission',v_mission,'server_loot_items',v_items);
end;
$$;
revoke execute on function public.sd_flea_pc_get_state() from public,anon;
grant execute on function public.sd_flea_pc_get_state() to authenticated;

comment on function public.sd_flea_pc_bank_finish(uuid,boolean,uuid) is 'Bank escape settlement. Client success=true is accepted only after server-timed checkpoint distance reaches the server-owned escape target.';

commit;