-- Chapter 3-4 fixture additions after Chapter 3-1/3-2/3-3 setup.
-- This models only the server-authoritative legacy Flea state consumed by the
-- content-move adapter and provides the monotonic achievement helper used in DEV.

alter table public.sd_achievement_progress
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table public.sd_flea_pc_accounts (
  user_id uuid primary key,
  bank_successes bigint not null default 0,
  bank_failures bigint not null default 0,
  boxes_looted bigint not null default 0,
  red_diamond_found boolean not null default false,
  highest_tier_found boolean not null default false,
  lowest_only_boxes bigint not null default 0,
  max_top_speed_distance_m numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sd_flea_pc_item_catalog (
  item_key text primary key,
  collection_required boolean not null default true
);

insert into public.sd_flea_pc_item_catalog(item_key,collection_required)
select format('legacy-item-%s',lpad(i::text,2,'0')),true
  from generate_series(1,35) i;

create table public.sd_flea_pc_item_counts (
  user_id uuid not null,
  catalog_key text not null references public.sd_flea_pc_item_catalog(item_key),
  acquired_count bigint not null default 0,
  first_acquired_at timestamptz not null default now(),
  last_acquired_at timestamptz not null default now(),
  primary key(user_id,catalog_key)
);

create or replace function private.upsert_sd_authoritative_achievement(
  p_user_id uuid,
  p_achievement_id text,
  p_server_value numeric,
  p_target numeric,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_value numeric:=greatest(0,coalesce(p_server_value,0));
  v_target numeric:=greatest(0,coalesce(p_target,0));
begin
  if p_user_id is null then return; end if;

  insert into public.sd_achievement_progress as p(
    user_id,achievement_id,current_value,unlocked,unlocked_at,source_app,metadata,updated_at
  ) values(
    p_user_id,p_achievement_id,v_value,v_value>=v_target,
    case when v_value>=v_target then now() else null end,
    'server-authority',coalesce(p_metadata,'{}'::jsonb),now()
  )
  on conflict on constraint sd_achievement_progress_pkey do update set
    current_value=greatest(p.current_value,excluded.current_value),
    unlocked=p.unlocked or excluded.unlocked,
    unlocked_at=case
      when p.unlocked_at is not null then p.unlocked_at
      when p.unlocked or excluded.unlocked then now()
      else null
    end,
    source_app=case when excluded.current_value>=p.current_value then excluded.source_app else p.source_app end,
    metadata=coalesce(p.metadata,'{}'::jsonb)||excluded.metadata,
    updated_at=now();
end;
$$;

revoke all on function private.upsert_sd_authoritative_achievement(uuid,text,numeric,numeric,jsonb)
  from public, anon, authenticated;

insert into public.profiles(id,nickname)
values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','chapter34-fixture');

insert into public.sd_flea_pc_accounts(
  user_id,bank_successes,bank_failures,boxes_looted,red_diamond_found,
  highest_tier_found,lowest_only_boxes,max_top_speed_distance_m
) values(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',12,3,600,true,true,1,550
);

insert into public.sd_flea_pc_item_counts(user_id,catalog_key,acquired_count)
select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,item_key,
       case when row_number() over(order by item_key)=1 then 100 else 1 end
  from public.sd_flea_pc_item_catalog;

-- Chapter 3-2 already seeded flea-01=10 unlocked and flea-05. Add a higher
-- progress record that the moved producer must never lower, plus a near-threshold
-- locked record that only unlocks after later authoritative server state advances.
insert into public.sd_achievement_progress(
  user_id,achievement_id,current_value,unlocked,unlocked_at,source_app,metadata
) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','flea-03',150,true,'2026-08-19T09:08:07Z','legacy-source','{"keep":"flea03"}'::jsonb),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','flea-14',9,false,null,'legacy-source','{"keep":"flea14"}'::jsonb);

insert into public.sd_user_achievements(user_id,achievement_id,unlocked_at)
select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',id,'2026-08-19T09:08:07Z'::timestamptz
  from public.sd_achievements
 where code='flea-03';
