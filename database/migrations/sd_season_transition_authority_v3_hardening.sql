-- Chapter 3-8 Release Blocker hardening v3.
-- Additive migration for production where v2 is already applied.
-- Establishes a shared/exclusive economy fence and sync_seq ledger boundaries.
-- Season 0 finalization remains asset-preserving and never grants SD money.

begin;

create schema if not exists sd_core_private;

-- Economy writers take a shared transaction-scoped fence. Multiple writers may run
-- concurrently, while the season finalizer takes the exclusive side of the same key.
create or replace function sd_core_private.acquire_wallet_writer_fence()
returns void
language sql
volatile
security definer
set search_path=''
as $$
  select pg_catalog.pg_advisory_xact_lock_shared(60803803::bigint)
$$;

create or replace function sd_core_private.acquire_season_finalize_fence()
returns void
language sql
volatile
security definer
set search_path=''
as $$
  select pg_catalog.pg_advisory_xact_lock(60803803::bigint)
$$;

revoke all on function sd_core_private.acquire_wallet_writer_fence() from public,anon,authenticated;
revoke all on function sd_core_private.acquire_season_finalize_fence() from public,anon,authenticated;

create or replace function sd_core_private.wallet_writer_fence_trigger()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  perform sd_core_private.acquire_wallet_writer_fence();
  return null;
end;
$$;
revoke all on function sd_core_private.wallet_writer_fence_trigger() from public,anon,authenticated;

-- Statement-level triggers fence every wallet or ledger mutation path, including the
-- existing SD Core reward/spend/transfer implementation, without rewriting prior migrations.
drop trigger if exists trg_sd_wallet_writer_fence on public.wallets;
create trigger trg_sd_wallet_writer_fence
before insert or update or delete on public.wallets
for each statement execute function sd_core_private.wallet_writer_fence_trigger();

drop trigger if exists trg_sd_transaction_writer_fence on public.transactions;
create trigger trg_sd_transaction_writer_fence
before insert or update or delete on public.transactions
for each statement execute function sd_core_private.wallet_writer_fence_trigger();

alter table public.sd_seasons
  add column if not exists started_sync_seq bigint,
  add column if not exists finalized_sync_seq bigint;

alter table public.sd_season_wallet_rankings
  add column if not exists reached_balance_sync_seq bigint;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname='sd_seasons_started_sync_seq_nonnegative_ck'
      and conrelid='public.sd_seasons'::regclass
  ) then
    alter table public.sd_seasons
      add constraint sd_seasons_started_sync_seq_nonnegative_ck
      check (started_sync_seq is null or started_sync_seq>=0);
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname='sd_seasons_finalized_sync_seq_nonnegative_ck'
      and conrelid='public.sd_seasons'::regclass
  ) then
    alter table public.sd_seasons
      add constraint sd_seasons_finalized_sync_seq_nonnegative_ck
      check (finalized_sync_seq is null or finalized_sync_seq>=0);
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname='sd_season_rank_reached_sync_seq_nonnegative_ck'
      and conrelid='public.sd_season_wallet_rankings'::regclass
  ) then
    alter table public.sd_season_wallet_rankings
      add constraint sd_season_rank_reached_sync_seq_nonnegative_ck
      check (reached_balance_sync_seq is null or reached_balance_sync_seq>=0);
  end if;
end $$;

-- One-time bridge for the already-running pre-v3 Season 0: map its historical
-- timestamp start to the last committed ledger sequence strictly before that time.
-- From this point onward, transition boundaries are sync_seq based.
update public.sd_seasons s
set started_sync_seq=coalesce((
  select max(t.sync_seq)
  from public.transactions t
  where t.created_at<s.started_at
),0)
where s.code='season-0'
  and s.started_sync_seq is null;

-- Remove the v2 one-argument authenticated entry point. Even privileged stale callers
-- fail closed rather than bypassing session/device ownership and revocation checks.
create or replace function public.admin_finalize_sd_season_wallet_ranking(p_season_code text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
begin
  raise exception using errcode='P1030',message='SEASON_FINALIZE_DEVICE_REQUIRED';
end;
$$;
revoke execute on function public.admin_finalize_sd_season_wallet_ranking(text) from public,anon,authenticated;

-- Season finalization is a sensitive operation. Supabase access tokens can remain valid
-- until JWT expiry after sign-out, so require the JWT session_id to still exist in
-- auth.sessions and belong to the same user. not_after is also enforced when present.
create or replace function private.is_current_sd_auth_session(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_session_text text;
  v_session_id uuid;
begin
  if p_user_id is null then
    return false;
  end if;

  v_session_text:=nullif(auth.jwt()->>'session_id','');
  if v_session_text is null then
    return false;
  end if;

  begin
    v_session_id:=v_session_text::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  return exists(
    select 1
    from auth.sessions s
    where s.id=v_session_id
      and s.user_id=p_user_id
      and (s.not_after is null or s.not_after>now())
  );
end;
$$;
revoke all on function private.is_current_sd_auth_session(uuid) from public,anon,authenticated;

create or replace function public.admin_finalize_sd_season_wallet_ranking(
  p_season_code text,
  p_device_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_admin uuid:=auth.uid();
  v_code text:=lower(trim(coalesce(p_season_code,'')));
  v_device_status text;
  v_device_revoked_at timestamptz;
  v_status text;
  v_started_at timestamptz;
  v_started_sync_seq bigint;
  v_finalized_at timestamptz;
  v_cutoff_sync_seq bigint;
  v_existing_finalized_sync_seq bigint;
  v_winner uuid;
  v_winner_balance bigint;
  v_count integer;
begin
  if v_admin is null then
    raise exception using errcode='P1001',message='AUTH_REQUIRED';
  end if;
  if not private.is_current_sd_auth_session(v_admin) then
    raise exception using errcode='P1008',message='SESSION_REVOKED';
  end if;
  if not private.is_active_sd_admin(v_admin) then
    raise exception using errcode='P1005',message='ADMIN_REQUIRED';
  end if;
  if p_device_id is null then
    raise exception using errcode='P1003',message='DEVICE_NOT_FOUND';
  end if;

  select d.link_status,d.revoked_at
    into v_device_status,v_device_revoked_at
  from public.devices d
  where d.id=p_device_id
    and d.user_id=v_admin;

  if v_device_status is null then
    raise exception using errcode='P1003',message='DEVICE_NOT_FOUND';
  end if;
  if v_device_revoked_at is not null then
    raise exception using errcode='P1006',message='DEVICE_REVOKED';
  end if;
  if v_device_status<>'active' then
    raise exception using errcode='P1004',message='DEVICE_INACTIVE';
  end if;

  -- This Chapter 3 authority is deliberately Season-0-only. Any other season fails closed.
  if v_code<>'season-0' then
    raise exception using errcode='P1030',message='SEASON_FINALIZE_NOT_ALLOWED';
  end if;

  -- Exclusive fence waits for all in-flight economy writers and blocks new ones until
  -- ranking, reward ownership, close, and Season 1 creation commit atomically.
  perform sd_core_private.acquire_season_finalize_fence();

  select s.status,s.started_at,s.started_sync_seq,s.finalized_at,s.finalized_sync_seq
    into v_status,v_started_at,v_started_sync_seq,v_finalized_at,v_existing_finalized_sync_seq
  from public.sd_seasons s
  where s.code='season-0'
  for update;

  if v_status is null then
    raise exception using errcode='P1027',message='SEASON_NOT_FOUND';
  end if;

  if v_status='closed' then
    if not exists(
      select 1
      from public.sd_seasons s1
      where s1.code='season-1'
        and s1.status='open'
        and s1.started_sync_seq=v_existing_finalized_sync_seq
    ) then
      raise exception using errcode='P1030',message='SEASON_SUCCESSOR_INVARIANT_BROKEN';
    end if;
    select r.user_id,r.balance
      into v_winner,v_winner_balance
    from public.sd_season_wallet_rankings r
    where r.season_code='season-0' and r.rank_no=1;
    return jsonb_build_object(
      'ok',true,
      'duplicate',true,
      'season_code','season-0',
      'winner_user_id',v_winner,
      'winner_balance',v_winner_balance,
      'finalized_at',v_finalized_at,
      'finalized_sync_seq',v_existing_finalized_sync_seq,
      'next_season_code','season-1',
      'reward_achievement_code','ranking-01',
      'money_reward',false
    );
  end if;

  if v_status<>'open' then
    raise exception using errcode='P1030',message='SEASON_STATUS_INVALID';
  end if;
  if v_started_at is null or v_started_sync_seq is null then
    raise exception using errcode='P1027',message='SEASON_START_BOUNDARY_MISSING';
  end if;
  if exists(select 1 from public.sd_seasons s where s.code='season-1') then
    raise exception using errcode='P1030',message='NEXT_SEASON_ALREADY_EXISTS';
  end if;
  if (select count(*) from public.sd_seasons s where s.status='open')<>1 then
    raise exception using errcode='P1030',message='OPEN_SEASON_INVARIANT_BROKEN';
  end if;

  select coalesce(max(t.sync_seq),0)
    into v_cutoff_sync_seq
  from public.transactions t;

  if v_cutoff_sync_seq<v_started_sync_seq then
    raise exception using errcode='P1030',message='INVALID_LEDGER_BOUNDARY';
  end if;

  v_finalized_at:=now();
  if v_finalized_at<v_started_at then
    raise exception using errcode='P1030',message='INVALID_SEASON_INTERVAL';
  end if;

  delete from public.sd_season_wallet_rankings where season_code='season-0';

  with eligible as (
    select w.user_id,w.balance
    from public.wallets w
    join public.profiles p
      on p.id=w.user_id
     and p.status='active'
  ), stats as (
    select
      e.user_id,
      e.balance,
      coalesce((
        select sum(case when t.amount>0 then t.amount else 0 end)::numeric
        from public.transactions t
        where t.user_id=e.user_id
          and t.sync_seq>v_started_sync_seq
          and t.sync_seq<=v_cutoff_sync_seq
      ),0::numeric) as gross_income,
      coalesce(
        (
          select t0.balance_after
          from public.transactions t0
          where t0.user_id=e.user_id
            and t0.sync_seq<=v_started_sync_seq
          order by t0.sync_seq desc
          limit 1
        ),
        (
          select t1.balance_before
          from public.transactions t1
          where t1.user_id=e.user_id
            and t1.sync_seq>v_started_sync_seq
            and t1.sync_seq<=v_cutoff_sync_seq
          order by t1.sync_seq asc
          limit 1
        ),
        e.balance
      ) as start_balance,
      (
        select t2.sync_seq
        from public.transactions t2
        where t2.user_id=e.user_id
          and t2.sync_seq>v_started_sync_seq
          and t2.sync_seq<=v_cutoff_sync_seq
          and t2.balance_after=e.balance
        order by t2.sync_seq asc
        limit 1
      ) as first_final_sync_seq,
      (
        select t3.created_at
        from public.transactions t3
        where t3.user_id=e.user_id
          and t3.sync_seq>v_started_sync_seq
          and t3.sync_seq<=v_cutoff_sync_seq
          and t3.balance_after=e.balance
        order by t3.sync_seq asc
        limit 1
      ) as first_final_at
    from eligible e
  ), wallet_stats as (
    select
      s.user_id,
      s.balance,
      s.gross_income,
      case
        when s.start_balance=s.balance then v_started_sync_seq
        else coalesce(s.first_final_sync_seq,v_cutoff_sync_seq)
      end as reached_balance_sync_seq,
      case
        when s.start_balance=s.balance then v_started_at
        else greatest(
          v_started_at,
          least(coalesce(s.first_final_at,v_finalized_at),v_finalized_at)
        )
      end as reached_balance_at
    from stats s
  ), ranked as (
    select
      ws.*,
      row_number() over(
        order by
          ws.balance desc,
          ws.gross_income desc,
          ws.reached_balance_sync_seq asc,
          ws.user_id asc
      )::integer as rank_no
    from wallet_stats ws
  )
  insert into public.sd_season_wallet_rankings(
    season_code,user_id,rank_no,balance,gross_income,
    reached_balance_at,reached_balance_sync_seq,finalized_at
  )
  select
    'season-0',user_id,rank_no,balance,gross_income,
    reached_balance_at,reached_balance_sync_seq,v_finalized_at
  from ranked;

  get diagnostics v_count=row_count;
  if v_count<1 then
    raise exception using errcode='P1027',message='NO_ELIGIBLE_SEASON_USERS';
  end if;

  update public.sd_seasons
     set status='closed',
         ended_at=v_finalized_at,
         finalized_at=v_finalized_at,
         finalized_sync_seq=v_cutoff_sync_seq,
         updated_at=v_finalized_at
   where code='season-0';

  select r.user_id,r.balance
    into v_winner,v_winner_balance
  from public.sd_season_wallet_rankings r
  where r.season_code='season-0' and r.rank_no=1;

  if v_winner is not null then
    perform private.upsert_sd_authoritative_achievement(
      v_winner,
      'ranking-01',
      1,
      1,
      jsonb_build_object(
        'season_code','season-0',
        'rank',1,
        'final_balance',v_winner_balance,
        'finalized_at',v_finalized_at,
        'finalized_sync_seq',v_cutoff_sync_seq,
        'authority','season-final-wallet-ranking-v3'
      )
    );
  end if;

  insert into public.sd_seasons(
    code,name,status,started_at,started_sync_seq,created_at,updated_at
  ) values(
    'season-1','Season 1','open',v_finalized_at,v_cutoff_sync_seq,v_finalized_at,v_finalized_at
  );

  return jsonb_build_object(
    'ok',true,
    'duplicate',false,
    'season_code','season-0',
    'ranked_users',v_count,
    'winner_user_id',v_winner,
    'winner_balance',v_winner_balance,
    'finalized_at',v_finalized_at,
    'finalized_sync_seq',v_cutoff_sync_seq,
    'next_season_code','season-1',
    'reward_achievement_code','ranking-01',
    'money_reward',false
  );
end;
$$;

revoke execute on function public.admin_finalize_sd_season_wallet_ranking(text,uuid) from public,anon;
grant execute on function public.admin_finalize_sd_season_wallet_ranking(text,uuid) to authenticated;

-- Explicitly remove unnecessary table capabilities left outside the intended read-only client contract.
revoke trigger,references on table public.sd_seasons from public,anon,authenticated;
revoke trigger,references on table public.sd_season_wallet_rankings from public,anon,authenticated;

comment on function sd_core_private.acquire_wallet_writer_fence() is
  'Shared Chapter 3-8 economy fence used automatically by wallet/transaction mutations.';
comment on function sd_core_private.acquire_season_finalize_fence() is
  'Exclusive Chapter 3-8 season transition fence. Waits for in-flight economy writes before capturing sync_seq cutoff.';
comment on function private.is_current_sd_auth_session(uuid) is
  'Strict sensitive-action session check: JWT session_id must still exist in auth.sessions for the same user and not be past not_after.';
comment on function public.admin_finalize_sd_season_wallet_ranking(text,uuid) is
  'Chapter 3-8 v3 Season-0-only finalizer. Requires a live Supabase session plus active admin-owned non-revoked device, captures a transactions.sync_seq cutoff under an exclusive economy fence, preserves assets, grants no SD money, and atomically opens Season 1.';
comment on function public.admin_finalize_sd_season_wallet_ranking(text) is
  'Disabled v2-compatible signature. v3 requires a live session and explicit admin-owned active device.';

commit;
