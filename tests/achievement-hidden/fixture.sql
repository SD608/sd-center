-- Expand the stacked Chapter 3 fixture to the exact reviewed 99-code catalog.
-- Existing fixture identities are retained; only missing official codes are added.

with manifest(code) as (
  select format('logistics-%s',lpad(i::text,2,'0')) from generate_series(1,16) i
  union all select format('flea-%s',lpad(i::text,2,'0')) from generate_series(1,19) i
  union all select format('miner-%s',lpad(i::text,2,'0')) from generate_series(1,9) i
  union all select format('mukjjippa-%s',lpad(i::text,2,'0')) from generate_series(1,2) i
  union all select format('slot-%s',lpad(i::text,2,'0')) from generate_series(1,7) i
  union all select format('oddeven-%s',lpad(i::text,2,'0')) from generate_series(1,10) i
  union all select format('bitcoin-%s',lpad(i::text,2,'0')) from generate_series(1,5) i
  union all select format('sta-%s',lpad(i::text,2,'0')) from generate_series(1,3) i
  union all select format('gold-%s',lpad(i::text,2,'0')) from generate_series(1,3) i
  union all select format('npcvault-%s',lpad(i::text,2,'0')) from generate_series(1,8) i
  union all select format('sdcoin-coin-%s',lpad(i::text,2,'0')) from generate_series(1,6) i
  union all select format('sdcoin-%s',lpad(i::text,2,'0')) from generate_series(1,3) i
  union all select format('wallet-%s',lpad(i::text,2,'0')) from generate_series(1,7) i
  union all select 'ranking-01'
), missing as (
  select gen_random_uuid() id,m.code,row_number() over(order by m.code)::integer sort_order
    from manifest m
    left join public.sd_achievements a on a.code=m.code
   where a.id is null
)
insert into public.sd_achievements(
  id,code,name,description,title_reward,sort_order,active,hidden,lineage_root_id,supersedes_achievement_id
)
select id,code,'Fixture '||code,'Fixture canonical condition '||code,'Fixture title '||code,
       1000+sort_order,true,false,id,null
  from missing;

do $$
begin
  if (select count(*) from public.sd_achievements)<>99 then
    raise exception '3-5 fixture: expected exact 99 catalog rows';
  end if;
end $$;

-- Reproduce the historical wrong hidden metadata shape observed in Production.
update public.sd_achievements
   set hidden = code=any(array[
     'miner-05','miner-07','miner-09','mukjjippa-01','mukjjippa-02','bitcoin-04','bitcoin-05','sta-03'
   ]::text[]);

-- Earned hidden achievements must remain fully preserved and revealable after policy correction.
insert into public.sd_achievement_progress(
  user_id,achievement_id,current_value,unlocked,unlocked_at,source_app,metadata,updated_at
) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','oddeven-03',8,true,'2026-08-18T01:02:03Z','server-authority','{"fixture":"hidden-earned"}'::jsonb,'2026-08-18T01:02:03Z'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','oddeven-08',1,true,'2026-08-18T04:05:06Z','server-authority','{"fixture":"hidden-earned"}'::jsonb,'2026-08-18T04:05:06Z')
on conflict(user_id,achievement_id) do update set
  current_value=excluded.current_value,
  unlocked=excluded.unlocked,
  unlocked_at=excluded.unlocked_at,
  source_app=excluded.source_app,
  metadata=excluded.metadata,
  updated_at=excluded.updated_at;

insert into public.sd_user_achievements(user_id,achievement_id,unlocked_at)
select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',a.id,
       case a.code when 'oddeven-03' then '2026-08-18T01:02:03Z'::timestamptz else '2026-08-18T04:05:06Z'::timestamptz end
  from public.sd_achievements a
 where a.code in ('oddeven-03','oddeven-08')
on conflict(user_id,achievement_id) do update set unlocked_at=excluded.unlocked_at;
