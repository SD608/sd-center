-- Extend the Chapter 3-1 fixture with the complete Flea split and representative assets.
create table public.sd_user_achievements (
  user_id uuid not null,
  achievement_id uuid not null references public.sd_achievements(id) on delete restrict,
  unlocked_at timestamptz not null,
  primary key (user_id, achievement_id)
);

insert into public.sd_achievements(id, code, name, description, title_reward, sort_order, active, hidden)
select gen_random_uuid(),
       format('flea-%s', lpad(i::text,2,'0')),
       format('Fixture Flea %s', i),
       'Fixture Flea accomplishment',
       format('Fixture Flea Title %s', i),
       100+i,
       true,
       false
  from generate_series(1,19) i;

insert into public.sd_achievements(id, code, name, description, title_reward, sort_order, active, hidden)
values (
  gen_random_uuid(), 'logistics-01', 'Fixture Logistics', 'Fixture Delivery',
  'Fixture Driver', 200, true, false
);

insert into public.sd_achievement_progress(
  user_id, achievement_id, current_value, unlocked, unlocked_at, source_app
) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'flea-01', 10, true, '2026-08-20T01:02:03Z', 'fixture-flea-pc'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'flea-05', 12345678, true, '2026-08-20T02:03:04Z', 'fixture-flea-market');

insert into public.sd_user_achievements(user_id, achievement_id, unlocked_at)
select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', id,
       case code
         when 'flea-01' then '2026-08-20T01:02:03Z'::timestamptz
         else '2026-08-20T02:03:04Z'::timestamptz
       end
  from public.sd_achievements
 where code in ('flea-01','flea-05');
