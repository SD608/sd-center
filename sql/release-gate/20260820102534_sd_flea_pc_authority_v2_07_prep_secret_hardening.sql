-- SD Flea PC authority v2 segment 7/7
-- Bank preparation authority + secret-state lock-down.
begin;

alter table public.sd_flea_pc_accounts
  add column if not exists bank_equipment_ready boolean not null default false,
  add column if not exists bank_guard_weakening_ready boolean not null default false;

alter table public.sd_flea_pc_missions
  drop constraint if exists sd_flea_pc_missions_mission_type_check,
  drop constraint if exists sd_flea_pc_missions_location_id_check;
alter table public.sd_flea_pc_missions
  add constraint sd_flea_pc_missions_mission_type_check
    check (mission_type in ('regular','bank_prep','bank')),
  add constraint sd_flea_pc_missions_location_id_check
    check (location_id in ('alley','abandoned_store','logistics','bank_prep','bank'));
alter table public.sd_flea_pc_missions
  add column if not exists prep_type text null,
  add column if not exists prep_targets_found integer not null default 0,
  add column if not exists prep_target_count integer not null default 0,
  add column if not exists bank_code_revealed boolean not null default false,
  add column if not exists bank_guard_weakening boolean not null default false;
alter table public.sd_flea_pc_missions
  drop constraint if exists sd_flea_pc_missions_prep_type_check,
  drop constraint if exists sd_flea_pc_missions_prep_targets_found_check,
  drop constraint if exists sd_flea_pc_missions_prep_target_count_check;
alter table public.sd_flea_pc_missions
  add constraint sd_flea_pc_missions_prep_type_check
    check (prep_type is null or prep_type in ('equipment','guardWeakening')),
  add constraint sd_flea_pc_missions_prep_targets_found_check
    check (prep_targets_found >= 0 and prep_targets_found <= 3),
  add constraint sd_flea_pc_missions_prep_target_count_check
    check (prep_target_count >= 0 and prep_target_count <= 3);

create table if not exists public.sd_flea_pc_prep_targets (
  mission_id uuid not null references public.sd_flea_pc_missions(id) on delete cascade,
  node_index integer not null check (node_index between 1 and 32),
  target_key text not null check (target_key in ('stethoscope','uvLight','gun','guardWeakening')),
  found_at timestamptz null,
  primary key(mission_id,node_index),
  unique(mission_id,target_key)
);
alter table public.sd_flea_pc_prep_targets enable row level security;
revoke all on public.sd_flea_pc_prep_targets from public,anon,authenticated;

-- Internal mission tables contain server RNG/secret state (bank code, empty safes, target map).
-- Clients use the sanitized state RPC instead of direct SELECT.
revoke select on public.sd_flea_pc_accounts,public.sd_flea_pc_missions,public.sd_flea_pc_nodes,
  public.sd_flea_pc_boxes,public.sd_flea_pc_bank_guards,public.sd_flea_pc_loot_receipts,
  public.sd_flea_pc_item_counts,public.sd_flea_pc_actions from authenticated;

create or replace function public.sd_flea_pc_get_state()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
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
  select * into v_m from public.sd_flea_pc_missions
   where user_id=v_user and status in('active','escaping') order by created_at desc limit 1;

  if v_m.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'node_index',n.node_index,
      'searched',n.searched_at is not null,
      'box_id',n.box_id
    ) order by n.node_index),'[]'::jsonb) into v_nodes
    from public.sd_flea_pc_nodes n where n.mission_id=v_m.id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'id',b.id,
      'tier',b.tier,
      'source_kind',b.source_kind,
      'carried',b.carried,
      'opened',b.opened_at is not null
    ) order by b.created_at,b.id),'[]'::jsonb) into v_boxes
    from public.sd_flea_pc_boxes b where b.mission_id=v_m.id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'guard_no',g.guard_no,
      'hp',g.hp,
      'max_hp',g.max_hp,
      'neutralized',g.hp<=0
    ) order by g.guard_no),'[]'::jsonb) into v_guards
    from public.sd_flea_pc_bank_guards g where g.mission_id=v_m.id;

    v_mission:=jsonb_build_object(
      'id',v_m.id,
      'mission_type',v_m.mission_type,
      'location_id',v_m.location_id,
      'status',v_m.status,
      'node_count',v_m.node_count,
      'search_count',v_m.search_count,
      'found_boxes',v_m.found_boxes,
      'max_boxes',v_m.max_boxes,
      'prep_type',v_m.prep_type,
      'prep_targets_found',v_m.prep_targets_found,
      'prep_target_count',v_m.prep_target_count,
      'carried_safes',v_m.carried_safes,
      'bank_door_unlocked',v_m.bank_door_unlocked,
      'bank_code_revealed',v_m.bank_code_revealed,
      'bank_guards_neutralized',v_m.bank_guards_neutralized,
      'bank_guard_weakening',v_m.bank_guard_weakening,
      'escape_checkpoint_count',v_m.escape_checkpoint_count,
      'top_speed_distance_m',v_m.top_speed_distance_m,
      'created_at',v_m.created_at,
      'expires_at',v_m.expires_at,
      'nodes',v_nodes,
      'boxes',v_boxes,
      'guards',v_guards
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'local_item_id',i.local_item_key,'name',i.name,'tier',i.tier,
    'original_value',i.original_value,'current_value',i.current_value,'box_id',i.box_id,
    'acquired_at',i.acquired_at,'sellable',coalesce(r.sellable,true),'catalog_key',r.catalog_key
  ) order by i.acquired_at desc),'[]'::jsonb) into v_items
  from public.sd_flea_items i
  left join public.sd_flea_pc_loot_receipts r on r.flea_item_id=i.id
  where i.owner_user_id=v_user and i.status='owned' and i.acquisition_kind='server_loot';

  return jsonb_build_object(
    'ok',true,
    'account',jsonb_build_object(
      'bank_successes',v_a.bank_successes,
      'bank_failures',v_a.bank_failures,
      'boxes_looted',v_a.boxes_looted,
      'bank_equipment_ready',v_a.bank_equipment_ready,
      'bank_guard_weakening_ready',v_a.bank_guard_weakening_ready
    ),
    'active_mission',v_mission,
    'server_loot_items',v_items
  );
end;
$$;
revoke execute on function public.sd_flea_pc_get_state() from public,anon;
grant execute on function public.sd_flea_pc_get_state() to authenticated;

create or replace function public.sd_flea_pc_bank_start_prep(p_prep_type text,p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_replay jsonb;
  v_result jsonb;
  v_status text;
  v_a public.sd_flea_pc_accounts%rowtype;
  v_target_count integer;
  v_indexes integer[];
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  p_prep_type:=trim(coalesce(p_prep_type,''));
  if p_prep_type not in('equipment','guardWeakening') then raise exception using errcode='P1010',message='INVALID_BANK_PREP_TYPE'; end if;
  v_replay:=private.sd_flea_pc_action_replay(v_user,p_request_id,'bank_start_prep',p_request_id,jsonb_build_object('prep_type',p_prep_type));
  if v_replay is not null then return v_replay; end if;

  select status into v_status from public.profiles where id=v_user;
  if coalesce(v_status,'')<>'active' then raise exception using errcode='P1002',message='ACCOUNT_INACTIVE'; end if;
  insert into public.sd_flea_pc_accounts(user_id) values(v_user) on conflict(user_id) do nothing;
  select * into v_a from public.sd_flea_pc_accounts where user_id=v_user for update;

  update public.sd_flea_pc_missions set status='expired',completed_at=now()
   where user_id=v_user and status='active' and expires_at<=now();
  if exists(select 1 from public.sd_flea_pc_missions where user_id=v_user and status in('active','escaping')) then
    raise exception using errcode='P1031',message='FLEA_MISSION_ALREADY_ACTIVE';
  end if;

  if p_prep_type='equipment' and v_a.bank_equipment_ready then
    raise exception using errcode='P1031',message='BANK_EQUIPMENT_ALREADY_READY';
  end if;
  if p_prep_type='guardWeakening' then
    if not v_a.bank_equipment_ready then raise exception using errcode='P1031',message='BANK_EQUIPMENT_PREP_REQUIRED'; end if;
    if v_a.bank_guard_weakening_ready then raise exception using errcode='P1031',message='BANK_GUARD_WEAKENING_ALREADY_READY'; end if;
  end if;

  v_target_count:=case when p_prep_type='equipment' then 3 else 1 end;
  insert into public.sd_flea_pc_missions(
    id,user_id,mission_type,location_id,node_count,max_boxes,prep_type,prep_target_count
  ) values(p_request_id,v_user,'bank_prep','bank_prep',6,0,p_prep_type,v_target_count);
  insert into public.sd_flea_pc_nodes(mission_id,node_index)
    select p_request_id,g from generate_series(1,6) g;

  select array_agg(node_index order by random()) into v_indexes
    from public.sd_flea_pc_nodes where mission_id=p_request_id;
  if p_prep_type='equipment' then
    insert into public.sd_flea_pc_prep_targets(mission_id,node_index,target_key) values
      (p_request_id,v_indexes[1],'stethoscope'),
      (p_request_id,v_indexes[2],'uvLight'),
      (p_request_id,v_indexes[3],'gun');
  else
    insert into public.sd_flea_pc_prep_targets(mission_id,node_index,target_key)
      values(p_request_id,v_indexes[1],'guardWeakening');
  end if;

  v_result:=jsonb_build_object('ok',true,'mission_id',p_request_id,'mission_type','bank_prep','prep_type',p_prep_type,'node_count',6,'target_count',v_target_count);
  return private.sd_flea_pc_save_action(v_user,p_request_id,'bank_start_prep',p_request_id,jsonb_build_object('prep_type',p_prep_type),v_result);
end;
$$;
revoke execute on function public.sd_flea_pc_bank_start_prep(text,uuid) from public,anon;
grant execute on function public.sd_flea_pc_bank_start_prep(text,uuid) to authenticated;

create or replace function public.sd_flea_pc_bank_search_prep_node(p_mission_id uuid,p_node_index integer,p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_m public.sd_flea_pc_missions%rowtype;
  v_replay jsonb;
  v_result jsonb;
  v_target text;
  v_found integer;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  v_replay:=private.sd_flea_pc_action_replay(v_user,p_request_id,'bank_search_prep',p_mission_id,jsonb_build_object('node_index',p_node_index));
  if v_replay is not null then return v_replay; end if;
  select * into v_m from public.sd_flea_pc_missions where id=p_mission_id and user_id=v_user for update;
  if v_m.id is null or v_m.mission_type<>'bank_prep' or v_m.status<>'active' or v_m.expires_at<=now() then
    raise exception using errcode='P1031',message='BANK_PREP_NOT_ACTIVE';
  end if;
  if p_node_index is null or p_node_index<1 or p_node_index>v_m.node_count then raise exception using errcode='P1010',message='INVALID_FLEA_NODE'; end if;
  if exists(select 1 from public.sd_flea_pc_nodes where mission_id=v_m.id and node_index=p_node_index and searched_at is not null) then
    raise exception using errcode='P1031',message='FLEA_NODE_ALREADY_SEARCHED';
  end if;

  update public.sd_flea_pc_nodes set searched_at=now() where mission_id=v_m.id and node_index=p_node_index;
  select target_key into v_target from public.sd_flea_pc_prep_targets where mission_id=v_m.id and node_index=p_node_index and found_at is null for update;
  if v_target is not null then
    update public.sd_flea_pc_prep_targets set found_at=now() where mission_id=v_m.id and node_index=p_node_index;
  end if;
  select count(*) into v_found from public.sd_flea_pc_prep_targets where mission_id=v_m.id and found_at is not null;
  update public.sd_flea_pc_missions set search_count=search_count+1,prep_targets_found=v_found where id=v_m.id returning * into v_m;

  if v_found>=v_m.prep_target_count then
    update public.sd_flea_pc_missions set status='completed',completed_at=now() where id=v_m.id;
    if v_m.prep_type='equipment' then
      update public.sd_flea_pc_accounts set bank_equipment_ready=true,updated_at=now() where user_id=v_user;
    else
      update public.sd_flea_pc_accounts set bank_guard_weakening_ready=true,updated_at=now() where user_id=v_user;
    end if;
  end if;

  v_result:=jsonb_build_object(
    'ok',true,'mission_id',v_m.id,'node_index',p_node_index,'found',v_target is not null,
    'target_key',v_target,'targets_found',v_found,'target_count',v_m.prep_target_count,
    'completed',v_found>=v_m.prep_target_count
  );
  return private.sd_flea_pc_save_action(v_user,p_request_id,'bank_search_prep',p_mission_id,jsonb_build_object('node_index',p_node_index),v_result);
end;
$$;
revoke execute on function public.sd_flea_pc_bank_search_prep_node(uuid,integer,uuid) from public,anon;
grant execute on function public.sd_flea_pc_bank_search_prep_node(uuid,integer,uuid) to authenticated;

-- Override mission start so the bank finale can only be issued after server-owned required prep.
create or replace function public.sd_flea_pc_start_mission(p_location_id text,p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
 v_user uuid:=auth.uid(); v_replay jsonb; v_result jsonb; v_nodes int; v_max int; v_special int; v_rep bigint:=0; v_hq int:=0; v_status text;
 v_cost jsonb; v_bank_code text; v_a public.sd_flea_pc_accounts%rowtype; v_weak boolean:=false; v_guard_hp integer:=50;
begin
 if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 p_location_id:=lower(trim(coalesce(p_location_id,'')));
 if p_location_id not in('alley','abandoned_store','logistics','bank') then raise exception using errcode='P1010',message='INVALID_FLEA_LOCATION'; end if;
 v_replay:=private.sd_flea_pc_action_replay(v_user,p_request_id,'start_mission',p_request_id,jsonb_build_object('location_id',p_location_id));
 if v_replay is not null then return v_replay; end if;
 select status into v_status from public.profiles where id=v_user;
 if coalesce(v_status,'')<>'active' then raise exception using errcode='P1002',message='ACCOUNT_INACTIVE'; end if;
 update public.sd_flea_pc_missions set status='expired',completed_at=now() where user_id=v_user and status='active' and expires_at<=now();
 if exists(select 1 from public.sd_flea_pc_missions where user_id=v_user and status in('active','escaping')) then raise exception using errcode='P1031',message='FLEA_MISSION_ALREADY_ACTIVE'; end if;
 if p_location_id='logistics' then
   select coalesce(logistics_rep,0),coalesce(headquarters_level,0) into v_rep,v_hq from public.sd_logistics_accounts where user_id=v_user;
   if coalesce(v_rep,0)<7000 and coalesce(v_hq,0)<1 then raise exception using errcode='P1049',message='FLEA_LOGISTICS_AREA_LOCKED'; end if;
 end if;
 insert into public.sd_flea_pc_accounts(user_id) values(v_user) on conflict(user_id) do nothing;
 select * into v_a from public.sd_flea_pc_accounts where user_id=v_user for update;
 if p_location_id='bank' then
   if not v_a.bank_equipment_ready then raise exception using errcode='P1031',message='BANK_EQUIPMENT_PREP_REQUIRED'; end if;
   v_weak:=v_a.bank_guard_weakening_ready;
   v_guard_hp:=case when v_weak then 25 else 50 end;
   v_nodes:=6; v_max:=6; v_special:=null; v_bank_code:=lpad(floor(random()*10000)::int::text,4,'0');
   v_cost:=sd_core_private.apply_server_wallet_delta_impl(v_user,p_request_id,'flea_bank_entry',-500000,'sd_flea','SD 플리마켓 · 은행 피날레 진입',jsonb_build_object('mission_id',p_request_id));
 else
   select node_count,max_boxes into v_nodes,v_max from (values ('alley',6,4),('abandoned_store',8,3),('logistics',8,2)) q(location_id,node_count,max_boxes) where location_id=p_location_id;
   v_special:=case when random()<0.20 then 1+floor(random()*v_nodes)::int else null end;
 end if;

 insert into public.sd_flea_pc_missions(id,user_id,mission_type,location_id,node_count,special_node,max_boxes,bank_door_code,bank_guard_weakening)
 values(p_request_id,v_user,case when p_location_id='bank' then 'bank' else 'regular' end,p_location_id,v_nodes,v_special,v_max,v_bank_code,v_weak);
 insert into public.sd_flea_pc_nodes(mission_id,node_index) select p_request_id,g from generate_series(1,v_nodes) g;
 if p_location_id='bank' then
   insert into public.sd_flea_pc_boxes(mission_id,user_id,tier,source_kind,empty)
     select p_request_id,v_user,'safe','bank_safe',false from generate_series(1,4);
   insert into public.sd_flea_pc_boxes(mission_id,user_id,tier,source_kind,empty)
     select p_request_id,v_user,'safe','bank_safe',true from generate_series(1,2);
   insert into public.sd_flea_pc_bank_guards(mission_id,guard_no,hp,max_hp)
     select p_request_id,g,v_guard_hp,v_guard_hp from generate_series(1,3) g;
   update public.sd_flea_pc_accounts set bank_equipment_ready=false,bank_guard_weakening_ready=false,updated_at=now() where user_id=v_user;
 end if;
 v_result:=jsonb_build_object(
   'ok',true,'mission_id',p_request_id,'mission_type',case when p_location_id='bank' then 'bank' else 'regular' end,
   'location_id',p_location_id,'node_count',v_nodes,'max_boxes',v_max,
   'bank_entry_cost',case when p_location_id='bank' then 500000 else 0 end,
   'guard_weakening_applied',case when p_location_id='bank' then v_weak else false end
 );
 return private.sd_flea_pc_save_action(v_user,p_request_id,'start_mission',p_request_id,jsonb_build_object('location_id',p_location_id),v_result);
end;
$$;
revoke execute on function public.sd_flea_pc_start_mission(text,uuid) from public,anon;
grant execute on function public.sd_flea_pc_start_mission(text,uuid) to authenticated;

create or replace function public.sd_flea_pc_bank_reveal_door_code(p_mission_id uuid,p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_m public.sd_flea_pc_missions%rowtype; v_replay jsonb; v_result jsonb;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  v_replay:=private.sd_flea_pc_action_replay(v_user,p_request_id,'bank_reveal_code',p_mission_id,'{}'::jsonb);
  if v_replay is not null then return v_replay; end if;
  select * into v_m from public.sd_flea_pc_missions where id=p_mission_id and user_id=v_user for update;
  if v_m.id is null or v_m.mission_type<>'bank' or v_m.status<>'active' then raise exception using errcode='P1031',message='BANK_MISSION_NOT_ACTIVE'; end if;
  update public.sd_flea_pc_missions set bank_code_revealed=true where id=v_m.id;
  v_result:=jsonb_build_object('ok',true,'mission_id',v_m.id,'bank_code',v_m.bank_door_code);
  return private.sd_flea_pc_save_action(v_user,p_request_id,'bank_reveal_code',p_mission_id,'{}'::jsonb,v_result);
end;
$$;
revoke execute on function public.sd_flea_pc_bank_reveal_door_code(uuid,uuid) from public,anon;
grant execute on function public.sd_flea_pc_bank_reveal_door_code(uuid,uuid) to authenticated;

create or replace function public.sd_flea_pc_bank_unlock_door(p_mission_id uuid,p_code text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_m public.sd_flea_pc_missions%rowtype; v_replay jsonb; v_result jsonb;
begin
 if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_flea_pc_action_replay(v_user,p_request_id,'bank_unlock_door',p_mission_id,jsonb_build_object('code',coalesce(p_code,''))); if v_replay is not null then return v_replay; end if;
 select * into v_m from public.sd_flea_pc_missions where id=p_mission_id and user_id=v_user for update;
 if v_m.id is null or v_m.mission_type<>'bank' or v_m.status<>'active' then raise exception using errcode='P1031',message='BANK_MISSION_NOT_ACTIVE'; end if;
 if v_m.bank_door_unlocked then
   v_result:=jsonb_build_object('ok',true,'mission_id',v_m.id,'already_unlocked',true);
 elsif not v_m.bank_code_revealed then
   raise exception using errcode='P1031',message='BANK_DOOR_CODE_NOT_REVEALED';
 elsif lpad(trim(coalesce(p_code,'')),4,'0')<>v_m.bank_door_code then
   raise exception using errcode='P1031',message='BANK_DOOR_CODE_INVALID';
 else
   update public.sd_flea_pc_missions set bank_door_unlocked=true where id=v_m.id;
   v_result:=jsonb_build_object('ok',true,'mission_id',v_m.id,'unlocked',true);
 end if;
 return private.sd_flea_pc_save_action(v_user,p_request_id,'bank_unlock_door',p_mission_id,jsonb_build_object('code',coalesce(p_code,'')),v_result);
end;
$$;
revoke execute on function public.sd_flea_pc_bank_unlock_door(uuid,text,uuid) from public,anon;
grant execute on function public.sd_flea_pc_bank_unlock_door(uuid,text,uuid) to authenticated;

comment on function public.sd_flea_pc_bank_start_prep(text,uuid) is
  'Issues server-owned bank preparation missions. Required equipment prep must complete before a bank finale can be issued.';
comment on function public.sd_flea_pc_get_state() is
  'Sanitized PC flea state. Server RNG secrets (empty safes, prep target map and unrevealed bank code) are never returned.';

commit;
