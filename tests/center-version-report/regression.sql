\set ON_ERROR_STOP on

select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
select public.sd_core_report_center_version(
  '11111111-1111-4111-8111-111111111111', '2.2.9', 'main-0123456789abcdef'
);

do $$
declare v text; b text; t timestamptz;
begin
  select center_version,center_build_id,center_version_reported_at into v,b,t
  from public.devices where id='11111111-1111-4111-8111-111111111111';
  if v <> '2.2.9' or b <> 'main-0123456789abcdef' or t is null then
    raise exception 'version report was not stored';
  end if;
end $$;

do $$
begin
  begin
    perform public.sd_core_report_center_version('22222222-2222-4222-8222-222222222222','2.2.9',null);
    raise exception 'cross-user report unexpectedly succeeded';
  exception when sqlstate 'P1003' then null;
  end;
end $$;

update public.devices set revoked_at=now() where id='11111111-1111-4111-8111-111111111111';
do $$
begin
  begin
    perform public.sd_core_report_center_version('11111111-1111-4111-8111-111111111111','2.2.10',null);
    raise exception 'revoked report unexpectedly succeeded';
  exception when sqlstate 'P1006' then null;
  end;
end $$;
update public.devices set revoked_at=null where id='11111111-1111-4111-8111-111111111111';

do $$
begin
  begin
    perform public.sd_core_report_center_version('11111111-1111-4111-8111-111111111111','../../bad',null);
    raise exception 'invalid version unexpectedly succeeded';
  exception when sqlstate 'P1027' then null;
  end;
end $$;

select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
do $$
begin
  begin
    perform * from public.admin_list_sd_members_v2();
    raise exception 'non-admin member list unexpectedly succeeded';
  exception when sqlstate 'P1005' then null;
  end;
end $$;

select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
do $$
declare r record;
begin
  select * into r from public.admin_list_sd_members_v2() where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if r.latest_center_version <> '2.2.9' or r.latest_center_build_id <> 'main-0123456789abcdef' then
    raise exception 'admin v2 did not expose latest reported center version';
  end if;
end $$;

select 'center version report regression PASS' as result;
