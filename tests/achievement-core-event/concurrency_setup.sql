\set ON_ERROR_STOP on

insert into public.profiles(id,nickname)
values('44444444-4444-4444-8444-444444444444','chapter33-concurrency');

insert into public.sd_achievement_stat_registry(stat_key,producer_key,aggregation_mode,allow_negative,description)
values('sta.test.concurrent-sum','official.sta','sum',false,'forced two-session concurrency fixture');

select private.accept_sd_achievement_event_v1(
  '44444444-4444-4444-8444-444444444444','official.sta','sta.operation.accepted',
  'chapter33:concurrent:0001','sta-expansion','{"worker":1}'::jsonb,'{"worker":1}'::jsonb,
  '[]'::jsonb,'fixture-server','2026-08-22T05:10:00Z'
);

select private.accept_sd_achievement_event_v1(
  '44444444-4444-4444-8444-444444444444','official.sta','sta.operation.accepted',
  'chapter33:concurrent:0002','sta-expansion','{"worker":2}'::jsonb,'{"worker":2}'::jsonb,
  '[]'::jsonb,'fixture-server','2026-08-22T05:11:00Z'
);
