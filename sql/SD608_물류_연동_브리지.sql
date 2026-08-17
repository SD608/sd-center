-- SD608 PC 물류센터 → SD Link → 홈페이지 계정 공통 진행도 브리지
-- 실제 Supabase에는 2026-08-18 적용 완료.

begin;

create or replace function public.sync_sd_logistics_progress(p_state jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_state jsonb := coalesce(p_state, '{}'::jsonb);
  v_updated_at timestamptz := now();
  v_merged jsonb;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode='28000';
  end if;
  if jsonb_typeof(v_state) <> 'object' then
    raise exception 'STATE_MUST_BE_OBJECT';
  end if;

  insert into public.sd_logistics_progress as p (user_id, state, updated_at)
  values (v_user_id, v_state, v_updated_at)
  on conflict (user_id) do update
    set state = coalesce(p.state, '{}'::jsonb) || excluded.state,
        updated_at = excluded.updated_at
  returning state into v_merged;

  return jsonb_build_object(
    'ok', true,
    'user_id', v_user_id,
    'logistics_rep', greatest(0, coalesce(nullif(v_merged->>'logisticsRep','')::numeric, nullif(v_merged->>'logistics_rep','')::numeric, 0)),
    'headquarters_level', greatest(0, coalesce(nullif(v_merged->>'headquartersLevel','')::int, nullif(v_merged->>'headquarters_level','')::int, 0)),
    'updated_at', v_updated_at
  );
exception
  when invalid_text_representation then
    raise exception 'INVALID_LOGISTICS_PROGRESS';
end;
$$;

grant execute on function public.sync_sd_logistics_progress(jsonb) to authenticated;

create or replace function public.get_sd_flea_company_snapshot()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_state jsonb;
  v_updated timestamptz;
  v_rep numeric := 0;
  v_hq integer := 0;
  v_grade text := 'F';
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode='28000';
  end if;

  select p.state, p.updated_at
    into v_state, v_updated
  from public.sd_logistics_progress as p
  where p.user_id = v_user_id;

  if v_state is not null then
    begin
      v_rep := greatest(0, coalesce(nullif(v_state->>'logisticsRep','')::numeric, nullif(v_state->>'logistics_rep','')::numeric, 0));
    exception when others then
      v_rep := 0;
    end;
    begin
      v_hq := greatest(0, coalesce(nullif(v_state->>'headquartersLevel','')::int, nullif(v_state->>'headquarters_level','')::int, 0));
    exception when others then
      v_hq := 0;
    end;
  end if;

  v_grade := case
    when v_rep >= 7000 then 'S'
    when v_rep >= 4500 then 'A'
    when v_rep >= 2800 then 'B'
    when v_rep >= 1600 then 'C'
    when v_rep >= 800 then 'D'
    when v_rep >= 300 then 'E'
    else 'F'
  end;

  return jsonb_build_object(
    'available', v_state is not null,
    'logistics_rep', v_rep,
    'headquarters_level', v_hq,
    'logistics_grade', v_grade,
    'eligible_for_s_content', (v_rep >= 7000 or v_hq >= 1),
    'updated_at', v_updated
  );
end;
$$;

grant execute on function public.get_sd_flea_company_snapshot() to authenticated;

commit;
