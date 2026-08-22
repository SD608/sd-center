-- Chapter 3-8: season-final ranking + Season 1 transition authority v2.
-- Corrects v1 tie-break statistics so only the finalized season interval is counted.
-- Season transition never resets wallet/history/achievement/title assets and emits no money reward.

begin;

do $$
begin
  if (select count(*) from public.sd_seasons where status='open') > 1 then
    raise exception using errcode='P1030',message='MULTIPLE_OPEN_SEASONS';
  end if;
end $$;

create unique index if not exists sd_seasons_one_open_idx
  on public.sd_seasons ((1))
  where status='open';

create or replace function public.admin_finalize_sd_season_wallet_ranking(p_season_code text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_admin uuid:=auth.uid();
  v_code text:=lower(trim(coalesce(p_season_code,'')));
  v_status text;
  v_started_at timestamptz;
  v_finalized_at timestamptz;
  v_winner uuid;
  v_winner_balance bigint;
  v_count integer;
  v_next_code text;
  v_next_name text;
begin
  if v_admin is null or not private.is_active_sd_admin(v_admin) then
    raise exception using errcode='P1005',message='ADMIN_REQUIRED';
  end if;
  if v_code !~ '^[a-z0-9][a-z0-9-]{1,79}$' then
    raise exception using errcode='P1010',message='INVALID_SEASON_CODE';
  end if;

  select s.status,s.started_at,s.finalized_at
    into v_status,v_started_at,v_finalized_at
  from public.sd_seasons s
  where s.code=v_code
  for update;

  if v_status is null then
    raise exception using errcode='P1027',message='SEASON_NOT_FOUND';
  end if;

  if v_status='closed' then
    select r.user_id,r.balance
      into v_winner,v_winner_balance
    from public.sd_season_wallet_rankings r
    where r.season_code=v_code and r.rank_no=1;
    return jsonb_build_object(
      'ok',true,
      'duplicate',true,
      'season_code',v_code,
      'winner_user_id',v_winner,
      'winner_balance',v_winner_balance,
      'finalized_at',v_finalized_at,
      'next_season_code',case when v_code='season-0' then 'season-1' else null end,
      'reward_achievement_code',case when v_code='season-0' then 'ranking-01' else null end,
      'money_reward',false
    );
  end if;

  if v_started_at is null then
    raise exception using errcode='P1027',message='SEASON_START_MISSING';
  end if;

  if v_code='season-0' then
    v_next_code:='season-1';
    v_next_name:='Season 1';
    if exists(select 1 from public.sd_seasons s where s.code=v_next_code) then
      raise exception using errcode='P1030',message='NEXT_SEASON_ALREADY_EXISTS';
    end if;
  end if;

  v_finalized_at:=now();
  if v_finalized_at < v_started_at then
    raise exception using errcode='P1030',message='INVALID_SEASON_INTERVAL';
  end if;

  delete from public.sd_season_wallet_rankings where season_code=v_code;

  with wallet_stats as (
    select
      w.user_id,
      w.balance,
      coalesce(sum(case when t.amount>0 then t.amount else 0 end),0)::numeric as gross_income,
      coalesce(
        min(t.created_at) filter (where t.balance_after=w.balance),
        v_started_at
      ) as reached_balance_at
    from public.wallets w
    join public.profiles p
      on p.id=w.user_id
     and p.status='active'
    left join public.transactions t
      on t.user_id=w.user_id
     and t.created_at>=v_started_at
     and t.created_at<=v_finalized_at
    group by w.user_id,w.balance
  ), ranked as (
    select
      ws.*,
      row_number() over(
        order by
          ws.balance desc,
          ws.gross_income desc,
          ws.reached_balance_at asc,
          ws.user_id asc
      )::integer as rank_no
    from wallet_stats ws
  )
  insert into public.sd_season_wallet_rankings(
    season_code,user_id,rank_no,balance,gross_income,reached_balance_at,finalized_at
  )
  select v_code,user_id,rank_no,balance,gross_income,reached_balance_at,v_finalized_at
  from ranked;

  get diagnostics v_count=row_count;
  if v_count<1 then
    raise exception using errcode='P1027',message='NO_ELIGIBLE_SEASON_USERS';
  end if;

  update public.sd_seasons
     set status='closed',
         ended_at=v_finalized_at,
         finalized_at=v_finalized_at,
         updated_at=v_finalized_at
   where code=v_code;

  select r.user_id,r.balance
    into v_winner,v_winner_balance
  from public.sd_season_wallet_rankings r
  where r.season_code=v_code and r.rank_no=1;

  if v_code='season-0' and v_winner is not null then
    -- The reviewed Season 0 reward is ranking-01 + its title reward (전설).
    -- No SD money reward is defined, so this transition never writes wallet/transactions.
    perform private.upsert_sd_authoritative_achievement(
      v_winner,
      'ranking-01',
      1,
      1,
      jsonb_build_object(
        'season_code',v_code,
        'rank',1,
        'final_balance',v_winner_balance,
        'finalized_at',v_finalized_at,
        'authority','season-final-wallet-ranking-v2'
      )
    );
  end if;

  if v_next_code is not null then
    insert into public.sd_seasons(code,name,status,started_at,created_at,updated_at)
    values(v_next_code,v_next_name,'open',v_finalized_at,v_finalized_at,v_finalized_at);
  end if;

  return jsonb_build_object(
    'ok',true,
    'duplicate',false,
    'season_code',v_code,
    'ranked_users',v_count,
    'winner_user_id',v_winner,
    'winner_balance',v_winner_balance,
    'finalized_at',v_finalized_at,
    'next_season_code',v_next_code,
    'reward_achievement_code',case when v_code='season-0' then 'ranking-01' else null end,
    'money_reward',false
  );
end;
$$;

revoke execute on function public.admin_finalize_sd_season_wallet_ranking(text) from public,anon;
grant execute on function public.admin_finalize_sd_season_wallet_ranking(text) to authenticated;

comment on function public.admin_finalize_sd_season_wallet_ranking(text) is
  'Chapter 3-8 v2 active-admin season close. Uses only in-season ledger activity for tie-breaks; Season 0 awards ranking-01/title and atomically opens Season 1. Never resets assets or grants money.';

commit;
