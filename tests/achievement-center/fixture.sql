-- Chapter 3-6 profile/title read-model support.

create table if not exists public.sd_public_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default true,
  equipped_title_achievement_id uuid references public.sd_achievements(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Locked hidden progress must never reveal its current value/definition.
insert into public.sd_achievement_progress(
  user_id,achievement_id,current_value,unlocked,unlocked_at,source_app,metadata,updated_at
) values(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bitcoin-05',123,false,null,'server-authority','{"fixture":"masked"}'::jsonb,now()
)
on conflict(user_id,achievement_id) do update set
  current_value=excluded.current_value,unlocked=false,unlocked_at=null,source_app=excluded.source_app,metadata=excluded.metadata,updated_at=excluded.updated_at;

-- Equip an actually earned hidden title from the Chapter 3-5 fixture.
insert into public.sd_public_profiles(user_id,enabled,equipped_title_achievement_id)
select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true,a.id
  from public.sd_achievements a where a.code='oddeven-03'
on conflict(user_id) do update set equipped_title_achievement_id=excluded.equipped_title_achievement_id;
