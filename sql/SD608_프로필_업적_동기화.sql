-- SD608 공개 프로필 업적 동기화
-- sd_achievement_progress의 달성 완료 업적을 공개 프로필에서 안전하게 조회합니다.

begin;

create or replace function public.get_sd_public_profile_achievement_progress(p_user_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_viewer uuid := auth.uid();
  v_target uuid := coalesce(p_user_id, auth.uid());
  v_status text;
  v_profile_enabled boolean;
  v_items jsonb := '[]'::jsonb;
  v_unlocked_count integer := 0;
begin
  if v_viewer is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if v_target is null then
    raise exception '프로필 대상이 없습니다.';
  end if;

  select p.status
    into v_status
  from public.profiles as p
  where p.id = v_target;

  if v_status is null or v_status <> 'active' then
    raise exception '조회할 수 없는 회원입니다.';
  end if;

  select pp.enabled
    into v_profile_enabled
  from public.sd_public_profiles as pp
  where pp.user_id = v_target;

  if not found then
    return jsonb_build_object(
      'created', false,
      'user_id', v_target,
      'unlocked_count', 0,
      'items', '[]'::jsonb
    );
  end if;

  if not coalesce(v_profile_enabled, false) and v_target <> v_viewer then
    raise exception '비공개 프로필입니다.';
  end if;

  select count(*)::integer,
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', ap.achievement_id,
               'current_value', ap.current_value,
               'unlocked', ap.unlocked,
               'unlocked_at', ap.unlocked_at,
               'updated_at', ap.updated_at
             )
             order by coalesce(ap.unlocked_at, ap.updated_at) desc, ap.achievement_id
           ),
           '[]'::jsonb
         )
    into v_unlocked_count, v_items
  from public.sd_achievement_progress as ap
  where ap.user_id = v_target
    and ap.unlocked = true;

  return jsonb_build_object(
    'created', true,
    'user_id', v_target,
    'unlocked_count', v_unlocked_count,
    'items', v_items
  );
end;
$$;

revoke all on function public.get_sd_public_profile_achievement_progress(uuid) from public;
grant execute on function public.get_sd_public_profile_achievement_progress(uuid) to authenticated;

commit;
