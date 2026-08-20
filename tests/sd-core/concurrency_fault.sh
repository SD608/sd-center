#!/usr/bin/env bash
set -u -o pipefail

JWT_A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
DEVICE_KEY='cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'

psql -v ON_ERROR_STOP=1 <<SQL
set role authenticated;
select set_config('request.jwt.claim.sub', '${JWT_A}', false);
select public.sd_core_register_device('${DEVICE_KEY}', 'Concurrency Device', 'windows');
SQL

# Two different spends of 600k race against the same 1M wallet.
# Row locking must serialize them: exactly one succeeds, exactly one is rejected.
set +e
(
  psql -v ON_ERROR_STOP=1 <<SQL
set role authenticated;
select set_config('request.jwt.claim.sub', '${JWT_A}', false);
select public.sd_core_apply_wallet_event(
  (select id from public.devices where user_id='${JWT_A}' and device_key='${DEVICE_KEY}'),
  'aaaaaaaa-0000-4000-8000-000000000001', 'spend', 600000, null, 'concurrency', 'race spend A', '{}'::jsonb
);
SQL
) >/tmp/sdcore-spend-a.log 2>&1 &
pid_a=$!
(
  psql -v ON_ERROR_STOP=1 <<SQL
set role authenticated;
select set_config('request.jwt.claim.sub', '${JWT_A}', false);
select public.sd_core_apply_wallet_event(
  (select id from public.devices where user_id='${JWT_A}' and device_key='${DEVICE_KEY}'),
  'aaaaaaaa-0000-4000-8000-000000000002', 'spend', 600000, null, 'concurrency', 'race spend B', '{}'::jsonb
);
SQL
) >/tmp/sdcore-spend-b.log 2>&1 &
pid_b=$!
wait "$pid_a"; rc_a=$?
wait "$pid_b"; rc_b=$?
set -e

if [[ "$rc_a" -eq 0 && "$rc_b" -eq 0 ]] || [[ "$rc_a" -ne 0 && "$rc_b" -ne 0 ]]; then
  echo 'Expected exactly one concurrent spend to succeed.' >&2
  cat /tmp/sdcore-spend-a.log >&2 || true
  cat /tmp/sdcore-spend-b.log >&2 || true
  exit 1
fi

if [[ "$rc_a" -ne 0 ]] && ! grep -q 'INSUFFICIENT_FUNDS' /tmp/sdcore-spend-a.log; then
  cat /tmp/sdcore-spend-a.log >&2
  exit 1
fi
if [[ "$rc_b" -ne 0 ]] && ! grep -q 'INSUFFICIENT_FUNDS' /tmp/sdcore-spend-b.log; then
  cat /tmp/sdcore-spend-b.log >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
declare v_balance bigint; v_events bigint; v_txs bigint;
begin
  select balance into v_balance from public.wallets where user_id='${JWT_A}';
  select count(*) into v_events from public.sd_core_wallet_events where event_id in ('aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002');
  select count(*) into v_txs from public.transactions where metadata ->> 'sd_core_event_id' in ('aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002');
  if v_balance <> 400000 or v_events <> 1 or v_txs <> 1 then
    raise exception 'concurrent spend serialization failed balance=% events=% txs=%', v_balance, v_events, v_txs;
  end if;
end \$\$;
SQL

# Exact same reward event racing twice must mint only once, while both callers may safely receive a result.
set +e
(
  psql -v ON_ERROR_STOP=1 <<SQL
set role authenticated;
select set_config('request.jwt.claim.sub', '${JWT_A}', false);
select public.sd_core_apply_wallet_event(
  (select id from public.devices where user_id='${JWT_A}' and device_key='${DEVICE_KEY}'),
  'aaaaaaaa-0000-4000-8000-000000000003', 'reward', 100000, null, 'concurrency', 'same event race', '{}'::jsonb
);
SQL
) >/tmp/sdcore-replay-a.log 2>&1 &
pid_a=$!
(
  psql -v ON_ERROR_STOP=1 <<SQL
set role authenticated;
select set_config('request.jwt.claim.sub', '${JWT_A}', false);
select public.sd_core_apply_wallet_event(
  (select id from public.devices where user_id='${JWT_A}' and device_key='${DEVICE_KEY}'),
  'aaaaaaaa-0000-4000-8000-000000000003', 'reward', 100000, null, 'concurrency', 'same event race', '{}'::jsonb
);
SQL
) >/tmp/sdcore-replay-b.log 2>&1 &
pid_b=$!
wait "$pid_a"; rc_a=$?
wait "$pid_b"; rc_b=$?
set -e

if [[ "$rc_a" -ne 0 || "$rc_b" -ne 0 ]]; then
  echo 'Concurrent exact replay should be safe for both callers.' >&2
  cat /tmp/sdcore-replay-a.log >&2 || true
  cat /tmp/sdcore-replay-b.log >&2 || true
  exit 1
fi

psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
declare v_balance bigint; v_events bigint; v_txs bigint;
begin
  select balance into v_balance from public.wallets where user_id='${JWT_A}';
  select count(*) into v_events from public.sd_core_wallet_events where event_id='aaaaaaaa-0000-4000-8000-000000000003';
  select count(*) into v_txs from public.transactions where metadata ->> 'sd_core_event_id'='aaaaaaaa-0000-4000-8000-000000000003';
  if v_balance <> 500000 or v_events <> 1 or v_txs <> 1 then
    raise exception 'concurrent exact replay minted twice balance=% events=% txs=%', v_balance, v_events, v_txs;
  end if;
end \$\$;
SQL

echo 'SD Core concurrency fault regression PASS'
