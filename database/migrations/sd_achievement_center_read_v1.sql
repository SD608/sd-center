begin;

-- Chapter 3-6: one server-authoritative read model for achievement UI + title/profile state.
-- The client receives canonical catalog/presentation data and current user's server-owned progress only.

do $$
begin
  if (select count(*) from public.sd_achievements) <> 99 then
    raise exception 'Chapter 3-6 requires the exact reviewed 99-achievement catalog';
  end if;
  if (select count(*) from public.sd_achievement_migration_classification)
     <> (select count(*) from public.sd_achievements) then
    raise exception 'Chapter 3-6 requires complete migration classification coverage';
  end if;
  if (select count(*) from public.sd_achievements where hidden) <> 10 then
    raise exception 'Chapter 3-6 requires Chapter 3-5 hidden policy first';
  end if;
end $$;

create or replace function public.get_sd_achievement_center_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_rows jsonb;
begin
  if v_user_id is null then
    raise exception using errcode='P1001',message='AUTH_REQUIRED';
  end if;

  with canonical as (
    select
      a.id,
      a.code,
      case c.target_content_key
        when 'logistics' then 'logistics'
        when 'flea_market' then 'flea'
        when 'miner' then 'miner'
        when 'mukjjippa' then 'mukjjippa'
        when 'slot' then 'slot'
        when 'oddeven' then 'oddeven'
        when 'bitcoin' then 'bitcoin'
        when 'sta' then 'sta'
        when 'core_gold' then 'gold'
        when 'npc_vault' then 'npcvault'
        when 'sdcoin' then 'sdcoin'
        when 'core_wallet' then 'wallet'
        when 'season' then 'ranking'
        else c.target_content_key
      end as category,
      a.name,
      a.description,
      a.icon,
      a.title_reward,
      a.sort_order,
      a.hidden,
      coalesce(p.current_value,0) as current_value,
      (coalesce(p.unlocked,false) or ua.achievement_id is not null) as unlocked,
      case
        when p.unlocked_at is null then ua.unlocked_at
        when ua.unlocked_at is null then p.unlocked_at
        else least(p.unlocked_at,ua.unlocked_at)
      end as unlocked_at,
      (ua.achievement_id is not null and nullif(btrim(a.title_reward),'') is not null) as title_owned,
      coalesce(pp.equipped_title_achievement_id=a.id,false) as title_equipped
    from public.sd_achievements a
    join public.sd_achievement_migration_classification c
      on c.achievement_id=a.id and c.permanent_code=a.code
    left join public.sd_achievement_progress p
      on p.user_id=v_user_id and p.achievement_id=a.code
    left join public.sd_user_achievements ua
      on ua.user_id=v_user_id and ua.achievement_id=a.id
    left join public.sd_public_profiles pp
      on pp.user_id=v_user_id
    where a.active=true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,
    'code',code,
    'category',category,
    'name',case when hidden and not unlocked then '???' else name end,
    'description',case when hidden and not unlocked then '???' else description end,
    'icon',case when hidden and not unlocked then '❔' else coalesce(icon,'🏆') end,
    'title_reward',case when hidden and not unlocked then null else title_reward end,
    'sort_order',sort_order,
    'hidden',hidden,
    'unlocked',unlocked,
    'unlocked_at',unlocked_at,
    'current_value',case when hidden and not unlocked then null else current_value end,
    'title_owned',title_owned,
    'title_equipped',title_equipped
  ) order by sort_order,code),'[]'::jsonb)
  into v_rows
  from canonical;

  return jsonb_build_object(
    'schema_version',1,
    'catalog_count',jsonb_array_length(v_rows),
    'achievements',v_rows
  );
end;
$$;

revoke all on function public.get_sd_achievement_center_v1() from public,anon;
grant execute on function public.get_sd_achievement_center_v1() to authenticated;
comment on function public.get_sd_achievement_center_v1() is
  'Chapter 3-6 canonical achievement/title read model. Hidden locked definitions and progress are masked; completion/title ownership are server-owned.';

commit;
