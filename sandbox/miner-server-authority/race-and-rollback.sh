#!/usr/bin/env bash
# Disposable PostgreSQL 17 CI only. No network/project credentials.
set -euo pipefail
r2=00000000-0000-0000-0000-000000000002
p2=00000000-0000-0000-0000-0000000000c3
src2=00000000-0000-0000-0000-000000000104
acq2=00000000-0000-0000-0000-000000000206
ret_a=00000000-0000-0000-0000-000000000406
ret_b=00000000-0000-0000-0000-000000000407
run3=00000000-0000-0000-0000-000000000003
p3=00000000-0000-0000-0000-0000000000d4
src3=00000000-0000-0000-0000-000000000105
acq3=00000000-0000-0000-0000-000000000207
ret3=00000000-0000-0000-0000-000000000408
psql -X -v ON_ERROR_STOP=1 -Atc "
 INSERT INTO miner_a_sandbox.runs(run_id) VALUES('$r2'),('$run3');
 INSERT INTO miner_a_sandbox.players(run_id,player_id,exit_verified)
 VALUES('$r2','$p2',true),('$run3','$p3',true);
 INSERT INTO miner_a_sandbox.sources(run_id,source_id,class_id,quantity)
 VALUES('$r2','$src2','ore1',60),('$run3','$src3','ore1',30);
 SELECT miner_a_sandbox.trusted_claim('$r2','$p2','$acq2','$src2');
 SELECT miner_a_sandbox.trusted_claim('$run3','$p3','$acq3','$src3');
" >/dev/null
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
set +e
psql -X -v ON_ERROR_STOP=1 -Atc "BEGIN; SELECT pg_sleep(0.5); SELECT miner_a_sandbox.trusted_settle('$r2','$p2','$ret_a'); COMMIT;" >"$tmp/a" 2>&1 &
pid_a=$!
psql -X -v ON_ERROR_STOP=1 -Atc "BEGIN; SELECT pg_sleep(0.5); SELECT miner_a_sandbox.trusted_settle('$r2','$p2','$ret_b'); COMMIT;" >"$tmp/b" 2>&1 &
pid_b=$!
wait "$pid_a"; status_a=$?
wait "$pid_b"; status_b=$?
set -e
if [[ "$status_a" -eq 0 && "$status_b" -ne 0 ]]; then
 winner="$ret_a"; loser="$tmp/b"
elif [[ "$status_b" -eq 0 && "$status_a" -ne 0 ]]; then
 winner="$ret_b"; loser="$tmp/a"
else
 echo "FAIL: expected exactly one of the racing returns to commit" >&2
 cat "$tmp/a" "$tmp/b" >&2
 exit 1
fi
grep -q "SECOND_RETURN_DENIED" "$loser" || { echo "FAIL: losing request was not rejected by return guard" >&2; cat "$loser" >&2; exit 1; }
replay="$(psql -X -v ON_ERROR_STOP=1 -Atc "SELECT miner_a_sandbox.trusted_settle('$r2','$p2','$winner') ->> 'replay';")"
[[ "$replay" == "true" ]] || { echo "FAIL: ACK-loss return retry not idempotent" >&2; exit 1; }
ledger_count="$(psql -X -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM miner_a_sandbox.ledger WHERE run_id='$r2';")"
[[ "$ledger_count" == "1" ]] || { echo "FAIL: concurrent ledger duplicated" >&2; exit 1; }
balance="$(psql -X -v ON_ERROR_STOP=1 -Atc "SELECT test_coins FROM miner_a_sandbox.balances WHERE player_id='$p2';")"
[[ "$balance" == "2" ]] || { echo "FAIL: concurrent wallet credited wrong amount $balance" >&2; exit 1; }
# An outer rollback must revert the player return, ledger and virtual wallet atomically.
psql -X -v ON_ERROR_STOP=1 -Atc "
 BEGIN;
 SELECT miner_a_sandbox.trusted_settle('$run3','$p3','$ret3');
 ROLLBACK;
" >"$tmp/rollback"
result="$(psql -X -v ON_ERROR_STOP=1 -Atc "
 SELECT count(*) FROM miner_a_sandbox.ledger WHERE run_id='$run3';
 SELECT count(*) FROM miner_a_sandbox.settlements WHERE run_id='$run3';
 SELECT count(*) FROM miner_a_sandbox.balances WHERE player_id='$p3';
 SELECT status FROM miner_a_sandbox.players WHERE run_id='$run3' AND player_id='$p3';
")"
[[ "$result" == $'0\n0\n0\nACTIVE' ]] || { echo "FAIL: rolled-back return mutated durable state: $result" >&2; exit 1; }
# After rollback a clean retry may commit once, without asset loss.
coin="$(psql -X -v ON_ERROR_STOP=1 -Atc "SELECT miner_a_sandbox.trusted_settle('$run3','$p3','$ret3') ->> 'coins';")"
[[ "$coin" == "1" ]] || { echo "FAIL: retry after rollback expected 1 coin" >&2; exit 1; }
echo "PASS DISPOSABLE_PG17_RACE_1OF2_AND_ATOMIC_ROLLBACK (NOT CORE/UNITY)"
