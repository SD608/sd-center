\set ON_ERROR_STOP on

set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);

do $$
declare
  v_blocked boolean := false;
  v_rpc_blocked boolean := false;
begin
  begin
    insert into public.sd_achievement_progress(
      user_id, achievement_id, current_value, unlocked, unlocked_at, source_app
    ) values (
      auth.uid(), 'wallet-02', 999999999999, true, now(), 'forged-client'
    );
  exception when insufficient_privilege then
    v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'authenticated direct achievement INSERT was not blocked';
  end if;

  begin
    perform public.sync_sd_achievement_progress(
      '[{"achievement_id":"wallet-02","current_value":999999999999,"unlocked":true}]'::jsonb,
      'forged-client'
    );
  exception when insufficient_privilege then
    v_rpc_blocked := true;
  end;

  if not v_rpc_blocked then
    raise exception 'legacy achievement sync RPC remained callable';
  end if;
end;
$$;

reset role;

-- Trusted server producer must still be able to update progress and drive the title bridge.
select achievement_test_private.server_unlock(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'wallet-02'
);

do $$
begin
  if not exists (
    select 1 from public.sd_achievement_progress
    where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and achievement_id='wallet-02'
      and unlocked=true
      and source_app='server-test'
  ) then
    raise exception 'trusted server producer failed';
  end if;

  if not exists (
    select 1
    from public.sd_user_achievements ua
    join public.sd_achievements a on a.id=ua.achievement_id
    where ua.user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and a.code='wallet-02'
  ) then
    raise exception 'title bridge failed after trusted producer';
  end if;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);

do $$
declare
  v_count bigint;
begin
  select count(*) into v_count
  from public.sd_achievement_progress
  where user_id=auth.uid() and achievement_id='wallet-02';

  if v_count <> 1 then
    raise exception 'authenticated SELECT own progress failed: %', v_count;
  end if;
end;
$$;

reset role;
select 'Achievement authority hardening regression PASS' as result;
