\set ON_ERROR_STOP on

-- v3 must have converted the already-running Season 0 timestamp start into one immutable ledger boundary.
do $$
declare v_started timestamptz; v_start_seq bigint; v_expected bigint; begin
  select started_at,started_sync_seq into v_started,v_start_seq from public.sd_seasons where code='season-0';
  select coalesce(max(sync_seq),0) into v_expected from public.transactions where created_at<v_started;
  if v_start_seq is null or v_start_seq<>v_expected then
    raise exception 'v3 start sync_seq bootstrap mismatch: got %, expected %',v_start_seq,v_expected;
  end if;
end $$;

-- Old v2 signature must fail closed and authenticated callers must not retain execute permission.
do $$ begin
  begin
    perform public.admin_finalize_sd_season_wallet_ranking('season-0');
    raise exception 'legacy one-argument finalizer unexpectedly succeeded';
  exception when sqlstate 'P1030' then null; end;
  if has_function_privilege('authenticated','public.admin_finalize_sd_season_wallet_ranking(text)','EXECUTE') then
    raise exception 'authenticated still has legacy one-argument finalizer execute';
  end if;
  if not has_function_privilege('authenticated','public.admin_finalize_sd_season_wallet_ranking(text,uuid)','EXECUTE') then
    raise exception 'authenticated missing v3 finalizer execute';
  end if;
end $$;

-- Missing auth identity must fail before any season write.
select set_config('request.jwt.claim.sub','',false);
select set_config('request.jwt.claim.session_id','',false);
do $$ begin
  begin
    perform public.admin_finalize_sd_season_wallet_ranking('season-0','91111111-1111-4111-8111-111111111111');
    raise exception 'missing-auth finalize unexpectedly succeeded';
  exception when sqlstate 'P1001' then null; end;
end $$;

-- A JWT subject without a live auth.sessions row is revoked for this sensitive operation.
select set_config('request.jwt.claim.sub','71111111-1111-4111-8111-111111111111',false);
select set_config('request.jwt.claim.session_id','a1111111-1111-4111-8111-111111111113',false);
do $$ begin
  begin
    perform public.admin_finalize_sd_season_wallet_ranking('season-0','91111111-1111-4111-8111-111111111111');
    raise exception 'revoked/deleted Supabase session finalize unexpectedly succeeded';
  exception when sqlstate 'P1008' then null; end;
end $$;

-- A session past not_after is also fail-closed.
select set_config('request.jwt.claim.session_id','a1111111-1111-4111-8111-111111111112',false);
do $$ begin
  begin
    perform public.admin_finalize_sd_season_wallet_ranking('season-0','91111111-1111-4111-8111-111111111111');
    raise exception 'expired Supabase session finalize unexpectedly succeeded';
  exception when sqlstate 'P1008' then null; end;
end $$;

-- Non-admin caller is rejected even with its own live session and healthy device.
select set_config('request.jwt.claim.sub','72222222-2222-4222-8222-222222222222',false);
select set_config('request.jwt.claim.session_id','a2222222-2222-4222-8222-222222222222',false);
do $$ begin
  begin
    perform public.admin_finalize_sd_season_wallet_ranking('season-0','92222222-2222-4222-8222-222222222222');
    raise exception 'non-admin finalize unexpectedly succeeded';
  exception when sqlstate 'P1005' then null; end;
end $$;

select set_config('request.jwt.claim.sub','71111111-1111-4111-8111-111111111111',false);
select set_config('request.jwt.claim.session_id','a1111111-1111-4111-8111-111111111111',false);

-- Device must belong to this live admin session, be non-revoked, and be active.
do $$ begin
  begin
    perform public.admin_finalize_sd_season_wallet_ranking('season-0','92222222-2222-4222-8222-222222222222');
    raise exception 'foreign-device finalize unexpectedly succeeded';
  exception when sqlstate 'P1003' then null; end;

  begin
    perform public.admin_finalize_sd_season_wallet_ranking('season-0','91111111-1111-4111-8111-111111111112');
    raise exception 'revoked-device finalize unexpectedly succeeded';
  exception when sqlstate 'P1006' then null; end;

  begin
    perform public.admin_finalize_sd_season_wallet_ranking('season-0','91111111-1111-4111-8111-111111111113');
    raise exception 'paused-device finalize unexpectedly succeeded';
  exception when sqlstate 'P1004' then null; end;
end $$;

-- Chapter 3 finalizer is Season-0-only. Season 1 and arbitrary codes fail closed.
do $$ begin
  begin
    perform public.admin_finalize_sd_season_wallet_ranking('season-1','91111111-1111-4111-8111-111111111111');
    raise exception 'Season 1 finalize unexpectedly succeeded';
  exception when sqlstate 'P1030' then null; end;
  begin
    perform public.admin_finalize_sd_season_wallet_ranking('season-99','91111111-1111-4111-8111-111111111111');
    raise exception 'arbitrary season finalize unexpectedly succeeded';
  exception when sqlstate 'P1030' then null; end;
end $$;

-- Legacy TRIGGER/REFERENCES residue must be explicitly removed by v3.
do $$ begin
  if has_table_privilege('authenticated','public.sd_seasons','TRIGGER') or
     has_table_privilege('authenticated','public.sd_seasons','REFERENCES') or
     has_table_privilege('authenticated','public.sd_season_wallet_rankings','TRIGGER') or
     has_table_privilege('authenticated','public.sd_season_wallet_rankings','REFERENCES') then
    raise exception 'season table privilege cleanup failed';
  end if;
  if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.wallets'::regclass and tgname='trg_sd_wallet_writer_fence' and not tgisinternal) then
    raise exception 'wallet writer fence trigger missing';
  end if;
  if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.transactions'::regclass and tgname='trg_sd_transaction_writer_fence' and not tgisinternal) then
    raise exception 'transaction writer fence trigger missing';
  end if;
end $$;

-- Fault injection after season/ranking mutation begins must roll the whole finalization back.
create or replace function private.fail_v3_ranking_reward()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.achievement_id='ranking-01'
     and coalesce(new.metadata->>'authority','')='season-final-wallet-ranking-v3' then
    raise exception using errcode='P9001',message='INJECTED_ACHIEVEMENT_FAILURE';
  end if;
  return new;
end $$;
create trigger trg_fail_v3_ranking_reward
before insert or update on public.sd_achievement_progress
for each row execute function private.fail_v3_ranking_reward();

do $$ begin
  begin
    perform public.admin_finalize_sd_season_wallet_ranking('season-0','91111111-1111-4111-8111-111111111111');
    raise exception 'fault-injected finalization unexpectedly succeeded';
  exception when sqlstate 'P9001' then null; end;
end $$;

drop trigger trg_fail_v3_ranking_reward on public.sd_achievement_progress;
drop function private.fail_v3_ranking_reward();

-- Every mutation performed before the injected fault must have rolled back.
do $$ begin
  if (select status from public.sd_seasons where code='season-0')<>'open' then raise exception 'fault rollback left Season 0 closed'; end if;
  if (select finalized_at from public.sd_seasons where code='season-0') is not null then raise exception 'fault rollback left finalized_at'; end if;
  if (select finalized_sync_seq from public.sd_seasons where code='season-0') is not null then raise exception 'fault rollback left finalized_sync_seq'; end if;
  if exists(select 1 from public.sd_seasons where code='season-1') then raise exception 'fault rollback left Season 1'; end if;
  if exists(select 1 from public.sd_season_wallet_rankings where season_code='season-0') then raise exception 'fault rollback left ranking rows'; end if;
  if (select count(*) from public.transactions)<>10 then raise exception 'fault rollback changed ledger transaction count'; end if;
  if (select balance from public.wallets where user_id='76666666-6666-4666-8666-666666666666')<>800 then raise exception 'fault rollback changed E wallet'; end if;
  if (select unlocked_at from public.sd_achievement_progress where user_id='73333333-3333-4333-8333-333333333333' and achievement_id='ranking-01')<>'2026-08-01 00:00:00+00'::timestamptz then
    raise exception 'fault rollback changed preexisting ranking-01 unlocked_at';
  end if;
end $$;

select 'season transition v3 pre-finalize authorization/session/device/fault regression PASS' as result;
