\set ON_ERROR_STOP on

do $$
declare
  v jsonb;
  v_row jsonb;
  failed boolean:=false;
begin
  perform set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
  v:=public.get_sd_achievement_center_v1();
  if (v->>'catalog_count')::int<>99 then raise exception '3-6 regression: catalog_count expected 99'; end if;
  if jsonb_array_length(v->'achievements')<>99 then raise exception '3-6 regression: achievement rows expected 99'; end if;

  select x into v_row from jsonb_array_elements(v->'achievements') x where x->>'code'='flea-01';
  if v_row->>'category'<>'sta' then raise exception '3-6 regression: moved flea-01 is not presented under STA'; end if;

  select x into v_row from jsonb_array_elements(v->'achievements') x where x->>'code'='flea-05';
  if v_row->>'category'<>'flea' then raise exception '3-6 regression: flea marketplace identity moved incorrectly'; end if;

  select x into v_row from jsonb_array_elements(v->'achievements') x where x->>'code'='bitcoin-05';
  if v_row->>'name'<>'???' or v_row->>'description'<>'???' or v_row->>'icon'<>'❔'
     or (v_row ? 'title_reward' and v_row->'title_reward'<>'null'::jsonb)
     or (v_row ? 'current_value' and v_row->'current_value'<>'null'::jsonb)
     or coalesce((v_row->>'unlocked')::boolean,true) then
    raise exception '3-6 regression: locked hidden definition/progress leaked';
  end if;

  select x into v_row from jsonb_array_elements(v->'achievements') x where x->>'code'='oddeven-03';
  if v_row->>'name'='???' or not coalesce((v_row->>'unlocked')::boolean,false)
     or not coalesce((v_row->>'title_owned')::boolean,false)
     or not coalesce((v_row->>'title_equipped')::boolean,false)
     or v_row->>'unlocked_at'<>'2026-08-18T01:02:03+00:00' then
    raise exception '3-6 regression: earned hidden/title state was not revealed/preserved: %',v_row;
  end if;

  if not has_function_privilege('authenticated','public.get_sd_achievement_center_v1()','EXECUTE')
     or has_function_privilege('anon','public.get_sd_achievement_center_v1()','EXECUTE') then
    raise exception '3-6 regression: RPC execute grants incorrect';
  end if;

  perform set_config('request.jwt.claim.sub','',true);
  begin perform public.get_sd_achievement_center_v1();
  exception when sqlstate 'P1001' then failed:=true; end;
  if not failed then raise exception '3-6 regression: unauthenticated read did not fail closed'; end if;
end $$;

select 'Chapter 3-6 canonical achievement/title/profile read regression PASS' as result;
