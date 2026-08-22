\set ON_ERROR_STOP on

do $$
declare
  v numeric;
  v_apps integer;
begin
  select value into v
    from public.sd_achievement_core_stats
   where user_id='44444444-4444-4444-8444-444444444444'
     and stat_key='sta.test.concurrent-sum';

  if v is distinct from 12 then
    raise exception '3-3 concurrency regression: concurrent SUM expected 12 got %', v;
  end if;

  select count(*) into v_apps
    from public.sd_achievement_stat_event_applications
   where user_id='44444444-4444-4444-8444-444444444444'
     and stat_key='sta.test.concurrent-sum';

  if v_apps<>2 then
    raise exception '3-3 concurrency regression: expected 2 exact event applications got %', v_apps;
  end if;
end $$;

select 'Chapter 3-3 forced two-session concurrent SUM PASS' as result;
