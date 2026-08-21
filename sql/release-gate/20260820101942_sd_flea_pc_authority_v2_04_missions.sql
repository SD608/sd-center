-- SD Flea PC authority v2 segment 4/6
begin;

create or replace function public.sd_flea_pc_get_state()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_a public.sd_flea_pc_accounts%rowtype; v_m jsonb; v_items jsonb;
begin
  if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
  insert into public.sd_flea_pc_accounts(user_id) values(v_user) on conflict(user_id) do nothing;
  select * into v_a from public.sd_flea_pc_accounts where user_id=v_user;
  select to_jsonb(m) into v_m from public.sd_flea_pc_missions m where m.user_id=v_user and m.status in('active','escaping') order by m.created_at desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'local_item_id',i.local_item_key,'name',i.name,'tier',i.tier,'original_value',i.original_value,'current_value',i.current_value,'box_id',i.box_id,'acquired_at',i.acquired_at,'sellable',coalesce(r.sellable,true),'catalog_key',r.catalog_key) order by i.acquired_at desc),'[]'::jsonb)
    into v_items
  from public.sd_flea_items i left join public.sd_flea_pc_loot_receipts r on r.flea_item_id=i.id
  where i.owner_user_id=v_user and i.status='owned' and i.acquisition_kind='server_loot';
  return jsonb_build_object('ok',true,'account',to_jsonb(v_a),'active_mission',v_m,'server_loot_items',v_items);
end;
$$;
revoke execute on function public.sd_flea_pc_get_state() from public,anon;
grant execute on function public.sd_flea_pc_get_state() to authenticated;

create or replace function public.sd_flea_pc_start_mission(p_location_id text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_user uuid:=auth.uid(); v_replay jsonb; v_result jsonb; v_nodes int; v_max int; v_special int; v_rep bigint:=0; v_hq int:=0; v_status text; v_cost jsonb; v_bank_code text;
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
 if p_location_id='bank' then
   v_nodes:=6; v_max:=6; v_special:=null; v_bank_code:=lpad(floor(random()*10000)::int::text,4,'0');
   v_cost:=sd_core_private.apply_server_wallet_delta_impl(v_user,p_request_id,'flea_bank_entry',-500000,'sd_flea','SD 플리마켓 · 은행 피날레 진입',jsonb_build_object('mission_id',p_request_id));
 else
   select node_count,max_boxes into v_nodes,v_max from (values ('alley',6,4),('abandoned_store',8,3),('logistics',8,2)) q(location_id,node_count,max_boxes) where location_id=p_location_id;
   v_special:=case when random()<0.20 then 1+floor(random()*v_nodes)::int else null end;
 end if;
 insert into public.sd_flea_pc_accounts(user_id) values(v_user) on conflict(user_id) do nothing;
 insert into public.sd_flea_pc_missions(id,user_id,mission_type,location_id,node_count,special_node,max_boxes,bank_door_code)
 values(p_request_id,v_user,case when p_location_id='bank' then 'bank' else 'regular' end,p_location_id,v_nodes,v_special,v_max,v_bank_code);
 insert into public.sd_flea_pc_nodes(mission_id,node_index) select p_request_id,g from generate_series(1,v_nodes) g;
 if p_location_id='bank' then
   insert into public.sd_flea_pc_boxes(mission_id,user_id,tier,source_kind,empty)
   select p_request_id,v_user,'safe','bank_safe',false from generate_series(1,4);
   insert into public.sd_flea_pc_boxes(mission_id,user_id,tier,source_kind,empty)
   select p_request_id,v_user,'safe','bank_safe',true from generate_series(1,2);
   insert into public.sd_flea_pc_bank_guards(mission_id,guard_no,hp,max_hp)
   select p_request_id,g,50,50 from generate_series(1,3) g;
 end if;
 v_result:=jsonb_build_object('ok',true,'mission_id',p_request_id,'mission_type',case when p_location_id='bank' then 'bank' else 'regular' end,'location_id',p_location_id,'node_count',v_nodes,'max_boxes',v_max,'bank_entry_cost',case when p_location_id='bank' then 500000 else 0 end,'bank_code',case when p_location_id='bank' then v_bank_code else null end);
 return private.sd_flea_pc_save_action(v_user,p_request_id,'start_mission',p_request_id,jsonb_build_object('location_id',p_location_id),v_result);
end;
$$;
revoke execute on function public.sd_flea_pc_start_mission(text,uuid) from public,anon;
grant execute on function public.sd_flea_pc_start_mission(text,uuid) to authenticated;

create or replace function public.sd_flea_pc_search_node(p_mission_id uuid,p_node_index integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_user uuid:=auth.uid(); v_m public.sd_flea_pc_missions%rowtype; v_replay jsonb; v_result jsonb; v_found boolean; v_special boolean; v_chance numeric; v_tier text; v_box uuid;
begin
 if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_flea_pc_action_replay(v_user,p_request_id,'search_node',p_mission_id,jsonb_build_object('node_index',p_node_index));
 if v_replay is not null then return v_replay; end if;
 select * into v_m from public.sd_flea_pc_missions where id=p_mission_id and user_id=v_user for update;
 if v_m.id is null or v_m.mission_type<>'regular' or v_m.status<>'active' or v_m.expires_at<=now() then raise exception using errcode='P1031',message='FLEA_REGULAR_MISSION_NOT_ACTIVE'; end if;
 if p_node_index is null or p_node_index<1 or p_node_index>v_m.node_count then raise exception using errcode='P1010',message='INVALID_FLEA_NODE'; end if;
 if exists(select 1 from public.sd_flea_pc_nodes where mission_id=v_m.id and node_index=p_node_index and searched_at is not null) then raise exception using errcode='P1031',message='FLEA_NODE_ALREADY_SEARCHED'; end if;
 update public.sd_flea_pc_missions set search_count=search_count+1 where id=v_m.id returning * into v_m;
 v_special:=v_m.special_node=p_node_index;
 v_chance:=case v_m.location_id when 'alley' then 78 when 'abandoned_store' then 70 when 'logistics' then 64 else 0 end;
 v_chance:=least(96,v_chance+least(30,v_m.miss_streak*15));
 v_found:=v_m.found_boxes<v_m.max_boxes and (v_special or (v_m.found_boxes=0 and v_m.search_count>=2) or random()*100<v_chance);
 if v_found then
   v_tier:=private.sd_flea_pc_roll_tier(v_m.location_id,v_special);
   insert into public.sd_flea_pc_boxes(mission_id,user_id,tier,source_kind) values(v_m.id,v_user,v_tier,'regular') returning id into v_box;
   update public.sd_flea_pc_missions set found_boxes=found_boxes+1,miss_streak=0 where id=v_m.id;
 else
   update public.sd_flea_pc_missions set miss_streak=miss_streak+1 where id=v_m.id;
 end if;
 update public.sd_flea_pc_nodes set searched_at=now(),box_id=v_box where mission_id=v_m.id and node_index=p_node_index;
 if not exists(select 1 from public.sd_flea_pc_nodes where mission_id=v_m.id and searched_at is null)
    or (select found_boxes>=max_boxes from public.sd_flea_pc_missions where id=v_m.id) then
   update public.sd_flea_pc_missions set status='completed',completed_at=now() where id=v_m.id;
 end if;
 v_result:=jsonb_build_object('ok',true,'mission_id',v_m.id,'node_index',p_node_index,'found',v_found,'box_id',v_box,'tier',v_tier);
 return private.sd_flea_pc_save_action(v_user,p_request_id,'search_node',p_mission_id,jsonb_build_object('node_index',p_node_index),v_result);
end;
$$;
revoke execute on function public.sd_flea_pc_search_node(uuid,integer,uuid) from public,anon;
grant execute on function public.sd_flea_pc_search_node(uuid,integer,uuid) to authenticated;

create or replace function public.sd_flea_pc_open_box(p_box_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_b public.sd_flea_pc_boxes%rowtype; v_replay jsonb; v_result jsonb;
begin
 if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 select * into v_b from public.sd_flea_pc_boxes where id=p_box_id and user_id=v_user;
 if v_b.id is null then raise exception using errcode='P1031',message='FLEA_BOX_NOT_FOUND'; end if;
 v_replay:=private.sd_flea_pc_action_replay(v_user,p_request_id,'open_box',v_b.mission_id,jsonb_build_object('box_id',p_box_id));
 if v_replay is not null then return v_replay; end if;
 if v_b.source_kind='bank_safe' then
   raise exception using errcode='P1031',message='BANK_SAFE_SETTLES_ONLY_AFTER_ESCAPE';
 end if;
 v_result:=private.sd_flea_pc_grant_box_item(p_box_id);
 return private.sd_flea_pc_save_action(v_user,p_request_id,'open_box',v_b.mission_id,jsonb_build_object('box_id',p_box_id),v_result);
end;
$$;
revoke execute on function public.sd_flea_pc_open_box(uuid,uuid) from public,anon;
grant execute on function public.sd_flea_pc_open_box(uuid,uuid) to authenticated;

commit;
