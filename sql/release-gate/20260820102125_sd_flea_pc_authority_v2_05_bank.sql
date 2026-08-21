-- SD Flea PC authority v2 segment 5/6
begin;

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

create or replace function public.sd_flea_pc_bank_hit_guard(p_mission_id uuid,p_guard_no integer,p_hit_zone text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_user uuid:=auth.uid(); v_m public.sd_flea_pc_missions%rowtype; v_g public.sd_flea_pc_bank_guards%rowtype; v_replay jsonb; v_result jsonb; v_damage int; v_hp int;
begin
 if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 p_hit_zone:=lower(trim(coalesce(p_hit_zone,'body'))); if p_hit_zone not in('body','head') then p_hit_zone:='body'; end if;
 v_replay:=private.sd_flea_pc_action_replay(v_user,p_request_id,'bank_hit_guard',p_mission_id,jsonb_build_object('guard_no',p_guard_no,'hit_zone',p_hit_zone)); if v_replay is not null then return v_replay; end if;
 select * into v_m from public.sd_flea_pc_missions where id=p_mission_id and user_id=v_user for update;
 if v_m.id is null or v_m.mission_type<>'bank' or v_m.status<>'active' or not v_m.bank_door_unlocked then raise exception using errcode='P1031',message='BANK_COMBAT_NOT_READY'; end if;
 if v_m.last_bank_combat_at is not null and now()<v_m.last_bank_combat_at+interval '120 milliseconds' then raise exception using errcode='P1052',message='BANK_COMBAT_RATE_LIMIT'; end if;
 select * into v_g from public.sd_flea_pc_bank_guards where mission_id=v_m.id and guard_no=p_guard_no for update;
 if v_g.mission_id is null then raise exception using errcode='P1031',message='BANK_GUARD_NOT_FOUND'; end if;
 if v_g.hp<=0 then raise exception using errcode='P1031',message='BANK_GUARD_ALREADY_NEUTRALIZED'; end if;
 v_damage:=case when p_hit_zone='head' then 25 else 10 end;
 v_hp:=greatest(0,v_g.hp-v_damage);
 update public.sd_flea_pc_bank_guards set hp=v_hp,neutralized_at=case when v_hp=0 then coalesce(neutralized_at,now()) else neutralized_at end where mission_id=v_m.id and guard_no=p_guard_no;
 update public.sd_flea_pc_missions set
   last_bank_combat_at=now(),
   bank_guards_neutralized=bank_guards_neutralized+case when v_g.hp>0 and v_hp=0 then 1 else 0 end
 where id=v_m.id returning * into v_m;
 v_result:=jsonb_build_object('ok',true,'mission_id',v_m.id,'guard_no',p_guard_no,'hit_zone',p_hit_zone,'damage',v_damage,'guard_hp',v_hp,'guards_neutralized',v_m.bank_guards_neutralized,'guards_total',3);
 return private.sd_flea_pc_save_action(v_user,p_request_id,'bank_hit_guard',p_mission_id,jsonb_build_object('guard_no',p_guard_no,'hit_zone',p_hit_zone),v_result);
end;
$$;
revoke execute on function public.sd_flea_pc_bank_hit_guard(uuid,integer,text,uuid) from public,anon;
grant execute on function public.sd_flea_pc_bank_hit_guard(uuid,integer,text,uuid) to authenticated;

create or replace function public.sd_flea_pc_bank_carry_safe(p_mission_id uuid,p_box_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_m public.sd_flea_pc_missions%rowtype; v_replay jsonb; v_result jsonb; v_count int;
begin
 if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_flea_pc_action_replay(v_user,p_request_id,'bank_carry_safe',p_mission_id,jsonb_build_object('box_id',p_box_id)); if v_replay is not null then return v_replay; end if;
 select * into v_m from public.sd_flea_pc_missions where id=p_mission_id and user_id=v_user for update;
 if v_m.id is null or v_m.mission_type<>'bank' or v_m.status<>'active' then raise exception using errcode='P1031',message='BANK_MISSION_NOT_ACTIVE'; end if;
 if not v_m.bank_door_unlocked or v_m.bank_guards_neutralized<3 then raise exception using errcode='P1031',message='BANK_SAFE_AREA_NOT_SECURED'; end if;
 if not exists(select 1 from public.sd_flea_pc_boxes where id=p_box_id and mission_id=v_m.id and user_id=v_user and source_kind='bank_safe') then
   raise exception using errcode='P1031',message='BANK_SAFE_NOT_FOUND';
 end if;
 update public.sd_flea_pc_boxes set carried=true where id=p_box_id and mission_id=v_m.id and user_id=v_user and source_kind='bank_safe' and not carried;
 select count(*) into v_count from public.sd_flea_pc_boxes where mission_id=v_m.id and carried;
 update public.sd_flea_pc_missions set carried_safes=v_count where id=v_m.id;
 v_result:=jsonb_build_object('ok',true,'mission_id',v_m.id,'box_id',p_box_id,'carried_safes',v_count);
 return private.sd_flea_pc_save_action(v_user,p_request_id,'bank_carry_safe',p_mission_id,jsonb_build_object('box_id',p_box_id),v_result);
end;
$$;
revoke execute on function public.sd_flea_pc_bank_carry_safe(uuid,uuid,uuid) from public,anon;
grant execute on function public.sd_flea_pc_bank_carry_safe(uuid,uuid,uuid) to authenticated;

create or replace function public.sd_flea_pc_bank_begin_escape(p_mission_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_m public.sd_flea_pc_missions%rowtype; v_replay jsonb; v_result jsonb;
begin
 if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_flea_pc_action_replay(v_user,p_request_id,'bank_begin_escape',p_mission_id,'{}'::jsonb); if v_replay is not null then return v_replay; end if;
 select * into v_m from public.sd_flea_pc_missions where id=p_mission_id and user_id=v_user for update;
 if v_m.id is null or v_m.mission_type<>'bank' or v_m.status<>'active' or v_m.carried_safes<1 then raise exception using errcode='P1031',message='BANK_ESCAPE_NOT_READY'; end if;
 update public.sd_flea_pc_missions set status='escaping',escape_started_at=now(),last_checkpoint_at=now(),escape_checkpoint_count=0,top_speed_distance_m=0 where id=v_m.id;
 v_result:=jsonb_build_object('ok',true,'mission_id',v_m.id,'status','escaping','carried_safes',v_m.carried_safes);
 return private.sd_flea_pc_save_action(v_user,p_request_id,'bank_begin_escape',p_mission_id,'{}'::jsonb,v_result);
end;
$$;
revoke execute on function public.sd_flea_pc_bank_begin_escape(uuid,uuid) from public,anon;
grant execute on function public.sd_flea_pc_bank_begin_escape(uuid,uuid) to authenticated;

create or replace function public.sd_flea_pc_bank_checkpoint(p_mission_id uuid,p_at_max_speed boolean,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_m public.sd_flea_pc_missions%rowtype; v_replay jsonb; v_result jsonb; v_elapsed numeric; v_add numeric:=0;
begin
 if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_flea_pc_action_replay(v_user,p_request_id,'bank_checkpoint',p_mission_id,jsonb_build_object('at_max_speed',coalesce(p_at_max_speed,false))); if v_replay is not null then return v_replay; end if;
 select * into v_m from public.sd_flea_pc_missions where id=p_mission_id and user_id=v_user for update;
 if v_m.id is null or v_m.status<>'escaping' then raise exception using errcode='P1031',message='BANK_ESCAPE_NOT_ACTIVE'; end if;
 v_elapsed:=greatest(0,least(5,extract(epoch from (now()-coalesce(v_m.last_checkpoint_at,now())))));
 -- The official chase caps at 150 km/h. The client reports only the max-speed state;
 -- accepted distance is derived from server elapsed time, capped to five seconds per checkpoint.
 -- Ignore max-speed claims during the first three seconds of the server-owned escape window.
 if coalesce(p_at_max_speed,false) and now()>=coalesce(v_m.escape_started_at,now())+interval '3 seconds' then
   v_add:=v_elapsed*(150.0/3.6);
 end if;
 update public.sd_flea_pc_missions set
   top_speed_distance_m=top_speed_distance_m+v_add,
   last_checkpoint_at=now(),
   escape_checkpoint_count=escape_checkpoint_count+1
 where id=v_m.id returning * into v_m;
 v_result:=jsonb_build_object('ok',true,'mission_id',v_m.id,'accepted_seconds',v_elapsed,'checkpoint_count',v_m.escape_checkpoint_count,'top_speed_distance_m',v_m.top_speed_distance_m);
 return private.sd_flea_pc_save_action(v_user,p_request_id,'bank_checkpoint',p_mission_id,jsonb_build_object('at_max_speed',coalesce(p_at_max_speed,false)),v_result);
end;
$$;
revoke execute on function public.sd_flea_pc_bank_checkpoint(uuid,boolean,uuid) from public,anon;
grant execute on function public.sd_flea_pc_bank_checkpoint(uuid,boolean,uuid) to authenticated;

create or replace function public.sd_flea_pc_bank_finish(p_mission_id uuid,p_success boolean,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_user uuid:=auth.uid(); v_m public.sd_flea_pc_missions%rowtype; v_replay jsonb; v_result jsonb; v_box record; v_loot jsonb:='[]'::jsonb; v_one jsonb;
begin
 if v_user is null then raise exception using errcode='P1001',message='AUTH_REQUIRED'; end if;
 v_replay:=private.sd_flea_pc_action_replay(v_user,p_request_id,'bank_finish',p_mission_id,jsonb_build_object('success',coalesce(p_success,false))); if v_replay is not null then return v_replay; end if;
 select * into v_m from public.sd_flea_pc_missions where id=p_mission_id and user_id=v_user for update;
 if v_m.id is null or v_m.mission_type<>'bank' or v_m.status<>'escaping' then raise exception using errcode='P1031',message='BANK_ESCAPE_NOT_ACTIVE'; end if;
 if coalesce(p_success,false) and now()<coalesce(v_m.escape_started_at,now())+interval '10 seconds' then raise exception using errcode='P1052',message='BANK_ESCAPE_TOO_EARLY'; end if;
 if coalesce(p_success,false) and v_m.escape_checkpoint_count<2 then raise exception using errcode='P1052',message='BANK_ESCAPE_CHECKPOINTS_INCOMPLETE'; end if;
 if coalesce(p_success,false) then
   update public.sd_flea_pc_missions set status='completed',completed_at=now() where id=v_m.id;
   insert into public.sd_flea_pc_accounts(user_id,bank_successes,max_top_speed_distance_m)
   values(v_user,1,v_m.top_speed_distance_m)
   on conflict(user_id) do update set bank_successes=public.sd_flea_pc_accounts.bank_successes+1,max_top_speed_distance_m=greatest(public.sd_flea_pc_accounts.max_top_speed_distance_m,excluded.max_top_speed_distance_m),updated_at=now();
   for v_box in select id from public.sd_flea_pc_boxes where mission_id=v_m.id and carried order by created_at,id loop
     v_one:=private.sd_flea_pc_grant_box_item(v_box.id);
     v_loot:=v_loot||jsonb_build_array(v_one);
   end loop;
 else
   update public.sd_flea_pc_missions set status='failed',completed_at=now() where id=v_m.id;
   insert into public.sd_flea_pc_accounts(user_id,bank_failures,max_top_speed_distance_m)
   values(v_user,1,v_m.top_speed_distance_m)
   on conflict(user_id) do update set bank_failures=public.sd_flea_pc_accounts.bank_failures+1,max_top_speed_distance_m=greatest(public.sd_flea_pc_accounts.max_top_speed_distance_m,excluded.max_top_speed_distance_m),updated_at=now();
 end if;
 perform private.refresh_sd_flea_pc_achievements(v_user);
 v_result:=jsonb_build_object('ok',true,'mission_id',v_m.id,'success',coalesce(p_success,false),'top_speed_distance_m',v_m.top_speed_distance_m,'loot',case when p_success then v_loot else '[]'::jsonb end);
 return private.sd_flea_pc_save_action(v_user,p_request_id,'bank_finish',p_mission_id,jsonb_build_object('success',coalesce(p_success,false)),v_result);
end;
$$;
revoke execute on function public.sd_flea_pc_bank_finish(uuid,boolean,uuid) from public,anon;
grant execute on function public.sd_flea_pc_bank_finish(uuid,boolean,uuid) to authenticated;

commit;
