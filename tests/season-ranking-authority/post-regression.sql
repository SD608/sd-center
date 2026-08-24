\set ON_ERROR_STOP on
select set_config('request.jwt.claim.sub','71111111-1111-4111-8111-111111111111',false);
select set_config('request.jwt.claim.session_id','a1111111-1111-4111-8111-111111111111',false);

do $$
declare
  v_winner uuid;
  v_row record;
  v_start_at timestamptz;
  v_start_seq bigint;
  v_finalized_at timestamptz;
  v_finalized_seq bigint;
  v_reward_id uuid;
begin
  select started_at,started_sync_seq,finalized_at,finalized_sync_seq
    into v_start_at,v_start_seq,v_finalized_at,v_finalized_seq
  from public.sd_seasons where code='season-0';

  if v_finalized_seq is null or v_finalized_seq<>(select max(sync_seq) from public.transactions) then
    raise exception 'finalized ledger boundary mismatch';
  end if;
  if (select started_sync_seq from public.sd_seasons where code='season-1')<>v_finalized_seq then
    raise exception 'Season 1 did not inherit exact Season 0 ledger boundary';
  end if;
  if (select started_at from public.sd_seasons where code='season-1')<>v_finalized_at then
    raise exception 'Season 1 timestamp boundary mismatch';
  end if;
  if (select count(*) from public.sd_seasons where status='open')<>1 or
     (select status from public.sd_seasons where code='season-1')<>'open' then
    raise exception 'exactly one open Season 1 invariant failed';
  end if;

  select user_id into v_winner
  from public.sd_season_wallet_rankings
  where season_code='season-0' and rank_no=1;
  if v_winner<>'73333333-3333-4333-8333-333333333333' then
    raise exception 'wrong Season 0 winner: %',v_winner;
  end if;

  if (select count(*) from public.sd_season_wallet_rankings where season_code='season-0')<>7 then
    raise exception 'active-only ranking count mismatch';
  end if;
  if exists(select 1 from public.sd_season_wallet_rankings where season_code='season-0' and user_id='75555555-5555-4555-8555-555555555555') then
    raise exception 'inactive profile entered ranking';
  end if;

  select * into v_row from public.sd_season_wallet_rankings where season_code='season-0' and user_id='72222222-2222-4222-8222-222222222222';
  if v_row.gross_income<>100 or v_row.rank_no<>3 then raise exception 'pre-season income leaked or A rank wrong: income %, rank %',v_row.gross_income,v_row.rank_no; end if;

  select * into v_row from public.sd_season_wallet_rankings where season_code='season-0' and user_id='73333333-3333-4333-8333-333333333333';
  if v_row.gross_income<>200 or v_row.rank_no<>1 then raise exception 'B ranking mismatch'; end if;

  select * into v_row from public.sd_season_wallet_rankings where season_code='season-0' and user_id='74444444-4444-4444-8444-444444444444';
  if v_row.gross_income<>200 or v_row.rank_no<>2 then raise exception 'B/C sync_seq tie-break mismatch'; end if;

  select * into v_row from public.sd_season_wallet_rankings where season_code='season-0' and user_id='77777777-7777-4777-8777-777777777777';
  if v_row.gross_income<>10 or v_row.rank_no<>4 or v_row.reached_balance_sync_seq<>v_start_seq or v_row.reached_balance_at<>v_start_at then
    raise exception 'preexisting-final-balance tie edge failed for F: rank %, reached_seq %, start_seq %',v_row.rank_no,v_row.reached_balance_sync_seq,v_start_seq;
  end if;

  select * into v_row from public.sd_season_wallet_rankings where season_code='season-0' and user_id='78888888-8888-4888-8888-888888888888';
  if v_row.gross_income<>10 or v_row.rank_no<>5 or v_row.reached_balance_sync_seq<=v_start_seq then
    raise exception 'later reached-balance tie edge failed for G';
  end if;

  select * into v_row from public.sd_season_wallet_rankings where season_code='season-0' and user_id='76666666-6666-4666-8666-666666666666';
  if v_row.balance<>850 or v_row.gross_income<>50 or v_row.rank_no<>6 then
    raise exception 'concurrent writer result missing from final ranking';
  end if;

  -- Season finalization itself must not create money transactions or alter wallet balances.
  if (select count(*) from public.transactions)<>11 then raise exception 'season finalization changed monetary transaction count'; end if;
  if (select balance from public.wallets where user_id='71111111-1111-4111-8111-111111111111')<>0 or
     (select balance from public.wallets where user_id='72222222-2222-4222-8222-222222222222')<>1000 or
     (select balance from public.wallets where user_id='73333333-3333-4333-8333-333333333333')<>1000 or
     (select balance from public.wallets where user_id='74444444-4444-4444-8444-444444444444')<>1000 or
     (select balance from public.wallets where user_id='75555555-5555-4555-8555-555555555555')<>999999999 or
     (select balance from public.wallets where user_id='76666666-6666-4666-8666-666666666666')<>850 or
     (select balance from public.wallets where user_id='77777777-7777-4777-8777-777777777777')<>900 or
     (select balance from public.wallets where user_id='78888888-8888-4888-8888-888888888888')<>900 then
    raise exception 'season finalization changed wallet assets';
  end if;

  -- Preexisting winner ranking-01 remains exactly-once and keeps its original unlock time.
  if (select unlocked_at from public.sd_achievement_progress where user_id='73333333-3333-4333-8333-333333333333' and achievement_id='ranking-01')<>'2026-08-01 00:00:00+00'::timestamptz then
    raise exception 'preexisting winner ranking-01 unlocked_at changed';
  end if;
  if not exists(select 1 from public.sd_achievement_progress where user_id='73333333-3333-4333-8333-333333333333' and achievement_id='ranking-01' and unlocked and current_value>=1) then
    raise exception 'winner ranking-01 missing';
  end if;
  select id into v_reward_id from public.sd_achievements where code='ranking-01';
  if (select count(*) from public.sd_user_achievements where user_id='73333333-3333-4333-8333-333333333333' and achievement_id=v_reward_id)<>1 then
    raise exception 'winner ranking-01/title ownership duplicated or missing';
  end if;
  if (select count(*) from public.sd_user_achievements)<>2 then raise exception 'season finalization changed unrelated achievement/title ownership'; end if;
  if (select current_value from public.sd_achievement_progress where user_id='74444444-4444-4444-8444-444444444444' and achievement_id='other-01')<>7 or
     (select unlocked_at from public.sd_achievement_progress where user_id='74444444-4444-4444-8444-444444444444' and achievement_id='other-01')<>'2026-08-02 00:00:00+00'::timestamptz then
    raise exception 'unrelated achievement asset changed';
  end if;
end $$;

-- Retry is read-only/idempotent, and Season 1 itself remains non-finalizable by this authority.
do $$
declare v_retry jsonb; v_before_tx int; v_before_earned int; begin
  select count(*) into v_before_tx from public.transactions;
  select count(*) into v_before_earned from public.sd_user_achievements;
  v_retry:=public.admin_finalize_sd_season_wallet_ranking('season-0','91111111-1111-4111-8111-111111111111');
  if coalesce((v_retry->>'duplicate')::boolean,false) is not true then raise exception 'Season 0 retry was not duplicate'; end if;
  if v_retry->>'next_season_code'<>'season-1' then raise exception 'retry successor contract mismatch'; end if;
  if coalesce((v_retry->>'money_reward')::boolean,true) is not false then raise exception 'retry emitted money reward'; end if;
  if (select count(*) from public.transactions)<>v_before_tx then raise exception 'retry wrote money transaction'; end if;
  if (select count(*) from public.sd_user_achievements)<>v_before_earned then raise exception 'retry duplicated achievement/title'; end if;
  if (select count(*) from public.sd_seasons where code='season-1')<>1 then raise exception 'retry duplicated Season 1'; end if;

  begin
    perform public.admin_finalize_sd_season_wallet_ranking('season-1','91111111-1111-4111-8111-111111111111');
    raise exception 'Season 1 finalize unexpectedly succeeded after transition';
  exception when sqlstate 'P1030' then null; end;
end $$;

-- Client season tables remain read-only with low-level capabilities removed.
do $$ begin
  if has_table_privilege('authenticated','public.sd_season_wallet_rankings','INSERT') or
     has_table_privilege('authenticated','public.sd_season_wallet_rankings','UPDATE') or
     has_table_privilege('authenticated','public.sd_season_wallet_rankings','DELETE') or
     has_table_privilege('authenticated','public.sd_season_wallet_rankings','TRIGGER') or
     has_table_privilege('authenticated','public.sd_season_wallet_rankings','REFERENCES') then
    raise exception 'client has mutable ranking-table capability';
  end if;
  if has_table_privilege('authenticated','public.sd_seasons','INSERT') or
     has_table_privilege('authenticated','public.sd_seasons','UPDATE') or
     has_table_privilege('authenticated','public.sd_seasons','DELETE') or
     has_table_privilege('authenticated','public.sd_seasons','TRIGGER') or
     has_table_privilege('authenticated','public.sd_seasons','REFERENCES') then
    raise exception 'client has mutable season-table capability';
  end if;
end $$;

select 'season transition authority v3 post-finalize regression PASS' as result;
