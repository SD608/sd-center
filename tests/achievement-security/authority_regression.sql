\set ON_ERROR_STOP on

-- Catalog split must be exact and existing inactive assets must remain.
do $$
declare
  v_active bigint;
  v_inactive bigint;
  v_existing_title bigint;
begin
  select count(*) filter(where active),count(*) filter(where not active)
    into v_active,v_inactive
  from public.sd_achievements;
  if v_active<>50 or v_inactive<>49 then
    raise exception 'achievement active split mismatch active=% inactive=%',v_active,v_inactive;
  end if;

  if (select active from public.sd_achievements where code='bitcoin-05') is not false then
    raise exception 'unimplemented bitcoin-05 remained active';
  end if;

  if not exists(
    select 1 from public.sd_achievement_progress
    where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and achievement_id='bitcoin-01' and unlocked=true
  ) then
    raise exception 'existing inactive progress asset was lost';
  end if;

  select count(*) into v_existing_title
  from public.sd_user_achievements ua
  join public.sd_achievements a on a.id=ua.achievement_id
  where ua.user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and a.code='bitcoin-01';
  if v_existing_title<>1 then
    raise exception 'existing inactive title asset was lost: %',v_existing_title;
  end if;
end $$;

-- Authenticated direct writes must fail; legacy sync must be harmless canonical readback.
set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);

do $$
declare
  v_direct_insert_blocked boolean:=false;
  v_direct_update_blocked boolean:=false;
  v_rows bigint;
  v_value numeric;
  v_unlocked boolean;
begin
  begin
    insert into public.sd_achievement_progress(user_id,achievement_id,current_value,unlocked,source_app)
    values(auth.uid(),'bitcoin-04',1000,true,'forged-direct');
  exception when insufficient_privilege then v_direct_insert_blocked:=true; end;
  if not v_direct_insert_blocked then raise exception 'direct achievement INSERT not blocked'; end if;

  begin
    update public.sd_achievement_progress set current_value=999999999,unlocked=true
    where user_id=auth.uid() and achievement_id='bitcoin-01';
  exception when insufficient_privilege then v_direct_update_blocked:=true; end;
  if not v_direct_update_blocked then raise exception 'direct achievement UPDATE not blocked'; end if;

  perform public.sync_sd_achievement_progress(
    jsonb_build_array(
      jsonb_build_object('achievement_id','bitcoin-04','current_value',1000,'unlocked',true),
      jsonb_build_object('achievement_id','wallet-07','current_value',1000000000000,'unlocked',true)
    ),
    'forged-legacy-client'
  );

  select count(*) into v_rows
  from public.sd_achievement_progress
  where user_id=auth.uid() and achievement_id='bitcoin-04';
  if v_rows<>0 then raise exception 'compat sync persisted forged inactive achievement'; end if;

  select current_value,unlocked into v_value,v_unlocked
  from public.sd_achievement_progress
  where user_id=auth.uid() and achievement_id='wallet-07';
  if coalesce(v_value,0)<>0 or coalesce(v_unlocked,false) then
    raise exception 'compat sync forged wallet achievement value=% unlocked=%',v_value,v_unlocked;
  end if;

  if pg_catalog.has_function_privilege('anon','public.sync_sd_achievement_progress(jsonb,text)','EXECUTE') then
    raise exception 'anon unexpectedly has achievement sync EXECUTE';
  end if;
  if pg_catalog.has_function_privilege('authenticated','private.upsert_sd_authoritative_achievement(uuid,text,numeric,numeric,jsonb)','EXECUTE') then
    raise exception 'authenticated can call private achievement upsert';
  end if;
end $$;

reset role;

-- Server-owned wallet state must drive wallet achievements and sticky unlocks.
update public.wallets set balance=10000000 where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
begin
  if not exists(
    select 1 from public.sd_achievement_progress
    where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and achievement_id='wallet-02' and current_value=10000000 and unlocked=true
      and source_app='server-authority'
  ) then raise exception 'wallet-02 authoritative unlock missing'; end if;

  if not exists(
    select 1 from public.sd_user_achievements ua
    join public.sd_achievements a on a.id=ua.achievement_id
    where ua.user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and a.code='wallet-02'
  ) then raise exception 'wallet-02 title bridge missing'; end if;
end $$;

update public.wallets set balance=100 where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
declare v numeric; u boolean; begin
  select current_value,unlocked into v,u from public.sd_achievement_progress
  where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='wallet-02';
  if v<>10000000 or u is not true then raise exception 'wallet achievement regressed value=% unlocked=%',v,u; end if;
end $$;

-- Server-owned vault gold must drive gold achievements and preserve peak.
update public.vaults set gold_bars=10 where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
begin
  if not exists(
    select 1 from public.sd_achievement_progress
    where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and achievement_id='gold-01' and current_value=10 and unlocked=true
      and source_app='server-authority'
  ) then raise exception 'gold-01 authoritative unlock missing'; end if;
end $$;

update public.vaults set gold_bars=1 where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$
declare v numeric; u boolean; begin
  select current_value,unlocked into v,u from public.sd_achievement_progress
  where user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and achievement_id='gold-01';
  if v<>10 or u is not true then raise exception 'gold achievement regressed value=% unlocked=%',v,u; end if;
end $$;

-- Inactive codes cannot become newly titled through the bridge even if a privileged bug inserts progress.
insert into public.sd_achievement_progress(user_id,achievement_id,current_value,unlocked,unlocked_at,source_app)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bitcoin-04',1000,true,now(),'privileged-regression');
do $$
declare v_count bigint; begin
  select count(*) into v_count
  from public.sd_user_achievements ua
  join public.sd_achievements a on a.id=ua.achievement_id
  where ua.user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and a.code='bitcoin-04';
  if v_count<>0 then raise exception 'inactive achievement granted a new title'; end if;
end $$;

select 'SD Achievement authority regression PASS' as result;
