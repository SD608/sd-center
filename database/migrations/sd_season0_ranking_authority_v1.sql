-- Season 0 final wallet ranking authority v1.
-- The season winner is finalized from server-owned wallet/ledger state only.
-- No client-submitted score/rank is accepted.

begin;

create table if not exists public.sd_seasons (
  code text primary key check (code ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  name text not null,
  status text not null default 'open' check (status in ('open','closed')),
  started_at timestamptz not null,
  ended_at timestamptz null,
  finalized_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status='open' and finalized_at is null) or status='closed')
);

create table if not exists public.sd_season_wallet_rankings (
  season_code text not null references public.sd_seasons(code) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  rank_no integer not null check (rank_no>=1),
  balance bigint not null check (balance>=0),
  gross_income numeric not null default 0 check (gross_income>=0),
  reached_balance_at timestamptz not null,
  finalized_at timestamptz not null,
  primary key (season_code,user_id),
  unique (season_code,rank_no)
);

alter table public.sd_seasons enable row level security;
alter table public.sd_season_wallet_rankings enable row level security;

drop policy if exists sd_seasons_read_authenticated on public.sd_seasons;
create policy sd_seasons_read_authenticated on public.sd_seasons for select to authenticated using (true);
drop policy if exists sd_season_wallet_rankings_read_authenticated on public.sd_season_wallet_rankings;
create policy sd_season_wallet_rankings_read_authenticated on public.sd_season_wallet_rankings for select to authenticated using (true);

revoke insert,update,delete,truncate on public.sd_seasons from public,anon,authenticated;
revoke insert,update,delete,truncate on public.sd_season_wallet_rankings from public,anon,authenticated;
grant select on public.sd_seasons,public.sd_season_wallet_rankings to authenticated;

insert into public.sd_seasons(code,name,status,started_at)
select 'season-0','Season 0','open',coalesce(min(p.created_at),now()) from public.profiles p
on conflict (code) do nothing;

create or replace function private.is_active_sd_admin(p_user_id uuid)
returns boolean language sql security definer set search_path=''
as $$
  select exists(select 1 from public.profiles p where p.id=p_user_id and p.role='admin' and p.status='active')
$$;
revoke all on function private.is_active_sd_admin(uuid) from public,anon,authenticated;

create or replace function public.admin_finalize_sd_season_wallet_ranking(p_season_code text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_admin uuid:=auth.uid();
  v_code text:=lower(trim(coalesce(p_season_code,'')));
  v_status text;
  v_finalized_at timestamptz;
  v_winner uuid;
  v_winner_balance bigint;
  v_count integer;
begin
  if v_admin is null or not private.is_active_sd_admin(v_admin) then
    raise exception using errcode='P1005',message='ADMIN_REQUIRED';
  end if;
  if v_code !~ '^[a-z0-9][a-z0-9-]{1,79}$' then raise exception using errcode='P1010',message='INVALID_SEASON_CODE'; end if;

  select s.status,s.finalized_at into v_status,v_finalized_at from public.sd_seasons s where s.code=v_code for update;
  if v_status is null then raise exception using errcode='P1027',message='SEASON_NOT_FOUND'; end if;
  if v_status='closed' then
    select r.user_id,r.balance into v_winner,v_winner_balance from public.sd_season_wallet_rankings r where r.season_code=v_code and r.rank_no=1;
    return jsonb_build_object('ok',true,'duplicate',true,'season_code',v_code,'winner_user_id',v_winner,'winner_balance',v_winner_balance,'finalized_at',v_finalized_at);
  end if;

  v_finalized_at:=now();
  delete from public.sd_season_wallet_rankings where season_code=v_code;

  with wallet_stats as (
    select w.user_id,w.balance,
      coalesce(sum(case when t.amount>0 then t.amount else 0 end),0)::numeric as gross_income,
      coalesce(min(t.created_at) filter (where t.balance_after=w.balance),w.created_at) as reached_balance_at
    from public.wallets w
    join public.profiles p on p.id=w.user_id and p.status='active'
    left join public.transactions t on t.user_id=w.user_id
    group by w.user_id,w.balance,w.created_at
  ), ranked as (
    select ws.*,row_number() over(order by ws.balance desc,ws.gross_income desc,ws.reached_balance_at asc,ws.user_id asc)::integer as rank_no from wallet_stats ws
  )
  insert into public.sd_season_wallet_rankings(season_code,user_id,rank_no,balance,gross_income,reached_balance_at,finalized_at)
  select v_code,user_id,rank_no,balance,gross_income,reached_balance_at,v_finalized_at from ranked;

  get diagnostics v_count=row_count;
  if v_count<1 then raise exception using errcode='P1027',message='NO_ELIGIBLE_SEASON_USERS'; end if;

  update public.sd_seasons set status='closed',ended_at=v_finalized_at,finalized_at=v_finalized_at,updated_at=v_finalized_at where code=v_code;
  select r.user_id,r.balance into v_winner,v_winner_balance from public.sd_season_wallet_rankings r where r.season_code=v_code and r.rank_no=1;

  if v_code='season-0' and v_winner is not null then
    perform private.upsert_sd_authoritative_achievement(v_winner,'ranking-01',1,1,jsonb_build_object('season_code',v_code,'rank',1,'final_balance',v_winner_balance,'finalized_at',v_finalized_at,'authority','season-final-wallet-ranking'));
  end if;

  return jsonb_build_object('ok',true,'duplicate',false,'season_code',v_code,'ranked_users',v_count,'winner_user_id',v_winner,'winner_balance',v_winner_balance,'finalized_at',v_finalized_at);
end;
$$;

revoke execute on function public.admin_finalize_sd_season_wallet_ranking(text) from public,anon;
grant execute on function public.admin_finalize_sd_season_wallet_ranking(text) to authenticated;

comment on table public.sd_season_wallet_rankings is 'Immutable season-final wallet ranking snapshot. Rank is derived from server wallet/ledger only.';
comment on function public.admin_finalize_sd_season_wallet_ranking(text) is 'Active-admin season close operation. Finalizes wallet ranking server-side and awards ranking-01 for Season 0 rank #1.';

update public.sd_achievements set active=true where code='ranking-01';

commit;
