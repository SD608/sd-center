-- SD Flea PC authority v2 segment 2/6
begin;

create or replace function private.refresh_sd_flea_pc_achievements(p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_a public.sd_flea_pc_accounts%rowtype;
  v_collection bigint:=0;
  v_collection_target bigint:=0;
  v_max_same bigint:=0;
begin
  if p_user_id is null then return; end if;
  insert into public.sd_flea_pc_accounts(user_id) values(p_user_id) on conflict(user_id) do nothing;
  select * into v_a from public.sd_flea_pc_accounts where user_id=p_user_id;
  select count(*) into v_collection_target from public.sd_flea_pc_item_catalog where collection_required;
  select count(*) into v_collection
    from public.sd_flea_pc_item_counts c join public.sd_flea_pc_item_catalog i on i.item_key=c.catalog_key
   where c.user_id=p_user_id and c.acquired_count>0 and i.collection_required;
  select coalesce(max(acquired_count),0) into v_max_same from public.sd_flea_pc_item_counts where user_id=p_user_id;

  perform private.upsert_sd_authoritative_achievement(p_user_id,'flea-01',v_a.bank_successes,1,jsonb_build_object('metric','bank_successes'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'flea-02',v_a.bank_successes,10,jsonb_build_object('metric','bank_successes'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'flea-03',v_a.bank_successes,100,jsonb_build_object('metric','bank_successes'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'flea-04',case when v_a.red_diamond_found then 1 else 0 end,1,jsonb_build_object('metric','red_diamond_found'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'flea-08',v_a.boxes_looted,100,jsonb_build_object('metric','boxes_looted'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'flea-09',v_a.boxes_looted,500,jsonb_build_object('metric','boxes_looted'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'flea-10',v_a.boxes_looted,1000,jsonb_build_object('metric','boxes_looted'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'flea-11',v_collection,v_collection_target,jsonb_build_object('metric','collection_types','target',v_collection_target));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'flea-14',v_a.bank_failures,10,jsonb_build_object('metric','bank_failures'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'flea-15',case when v_a.highest_tier_found then 1 else 0 end,1,jsonb_build_object('metric','highest_tier_found'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'flea-16',v_a.lowest_only_boxes,1,jsonb_build_object('metric','lowest_only_boxes'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'flea-17',v_max_same,100,jsonb_build_object('metric','max_same_item_acquired'));
  perform private.upsert_sd_authoritative_achievement(p_user_id,'flea-18',v_a.max_top_speed_distance_m,500,jsonb_build_object('metric','max_single_bank_top_speed_distance_m'));
end;
$$;
revoke all on function private.refresh_sd_flea_pc_achievements(uuid) from public,anon,authenticated;

create or replace function private.sd_flea_pc_action_replay(
  p_user_id uuid,p_request_id uuid,p_action_type text,p_mission_id uuid,p_input jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.sd_flea_pc_actions%rowtype;
begin
  if p_request_id is null then raise exception using errcode='P1007',message='REQUEST_ID_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into v from public.sd_flea_pc_actions where request_id=p_request_id;
  if v.request_id is null then return null; end if;
  if v.user_id is distinct from p_user_id or v.action_type is distinct from p_action_type
     or v.mission_id is distinct from p_mission_id or v.input is distinct from coalesce(p_input,'{}'::jsonb) then
    raise exception using errcode='P1015',message='FLEA_REQUEST_IDEMPOTENCY_CONFLICT';
  end if;
  return v.result;
end;
$$;
revoke all on function private.sd_flea_pc_action_replay(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;

create or replace function private.sd_flea_pc_save_action(
 p_user_id uuid,p_request_id uuid,p_action_type text,p_mission_id uuid,p_input jsonb,p_result jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  insert into public.sd_flea_pc_actions(request_id,user_id,action_type,mission_id,input,result)
  values(p_request_id,p_user_id,p_action_type,p_mission_id,coalesce(p_input,'{}'::jsonb),coalesce(p_result,'{}'::jsonb));
  return p_result;
end;
$$;
revoke all on function private.sd_flea_pc_save_action(uuid,uuid,text,uuid,jsonb,jsonb) from public,anon,authenticated;

commit;
