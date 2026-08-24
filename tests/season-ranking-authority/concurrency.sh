#!/usr/bin/env bash
set -euo pipefail

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

cat >"$workdir/writer.sql" <<'SQL'
\set ON_ERROR_STOP on
begin;
update public.wallets
set balance=850
where user_id='76666666-6666-4666-8666-666666666666';
-- Hold the writer-side shared fence while wallet and ledger are intentionally between statements.
select pg_sleep(2);
insert into public.transactions(
  wallet_id,user_id,transaction_type,description,amount,
  balance_before,balance_after,request_id,platform,created_at
) values(
  '86666666-6666-4666-8666-666666666666',
  '76666666-6666-4666-8666-666666666666',
  'income','concurrent-core-like-reward',50,
  800,850,'e0000000-0000-4000-8000-000000000001','server',now()
);
commit;
SQL

cat >"$workdir/finalize.sql" <<'SQL'
\set ON_ERROR_STOP on
select set_config('request.jwt.claim.sub','71111111-1111-4111-8111-111111111111',false);
select set_config('request.jwt.claim.session_id','a1111111-1111-4111-8111-111111111111',false);
select public.admin_finalize_sd_season_wallet_ranking(
  'season-0','91111111-1111-4111-8111-111111111111'
);
SQL

psql -v ON_ERROR_STOP=1 -f "$workdir/writer.sql" >"$workdir/writer.out" 2>&1 &
writer_pid=$!
sleep 0.35

psql -At -v ON_ERROR_STOP=1 -f "$workdir/finalize.sql" >"$workdir/finalize-1.out" 2>&1 &
finalizer1_pid=$!
sleep 0.10
psql -At -v ON_ERROR_STOP=1 -f "$workdir/finalize.sql" >"$workdir/finalize-2.out" 2>&1 &
finalizer2_pid=$!

wait "$writer_pid"
wait "$finalizer1_pid"
wait "$finalizer2_pid"

cat "$workdir/writer.out"
cat "$workdir/finalize-1.out"
cat "$workdir/finalize-2.out"

fresh_count="$(awk '/"duplicate": false/{c++} END{print c+0}' "$workdir/finalize-1.out" "$workdir/finalize-2.out")"
dupe_count="$(awk '/"duplicate": true/{c++} END{print c+0}' "$workdir/finalize-1.out" "$workdir/finalize-2.out")"
if [[ "$fresh_count" -ne 1 || "$dupe_count" -ne 1 ]]; then
  echo "expected exactly one fresh finalize and one duplicate retry; fresh=$fresh_count duplicate=$dupe_count" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare v_writer_seq bigint; v_cutoff bigint; v_e record; begin
  select sync_seq into v_writer_seq
  from public.transactions
  where request_id='e0000000-0000-4000-8000-000000000001';
  if v_writer_seq is null then raise exception 'concurrent writer transaction missing'; end if;

  select finalized_sync_seq into v_cutoff
  from public.sd_seasons where code='season-0';
  if v_cutoff is null or v_cutoff<v_writer_seq then
    raise exception 'finalizer cutoff did not include committed writer: cutoff %, writer %',v_cutoff,v_writer_seq;
  end if;
  if v_cutoff<>(select max(sync_seq) from public.transactions) then
    raise exception 'finalized sync_seq is not the committed ledger boundary';
  end if;

  select * into v_e
  from public.sd_season_wallet_rankings
  where season_code='season-0' and user_id='76666666-6666-4666-8666-666666666666';
  if v_e.balance<>850 or v_e.gross_income<>50 or v_e.reached_balance_sync_seq<>v_writer_seq then
    raise exception 'ranking saw torn writer state: balance %, gross %, reached_seq %, writer_seq %',v_e.balance,v_e.gross_income,v_e.reached_balance_sync_seq,v_writer_seq;
  end if;

  if (select status from public.sd_seasons where code='season-0')<>'closed' then raise exception 'Season 0 not closed after concurrency test'; end if;
  if (select status from public.sd_seasons where code='season-1')<>'open' then raise exception 'Season 1 not open after concurrency test'; end if;
  if (select started_sync_seq from public.sd_seasons where code='season-1')<>v_cutoff then raise exception 'Season 1 sync boundary mismatch'; end if;
  if (select count(*) from public.sd_seasons where status='open')<>1 then raise exception 'open season invariant broken after concurrent finalizers'; end if;
  if (select count(*) from public.sd_seasons where code='season-1')<>1 then raise exception 'concurrent finalizers duplicated Season 1'; end if;
end $$;
SQL

echo "season transition v3 multi-session concurrency regression PASS"
