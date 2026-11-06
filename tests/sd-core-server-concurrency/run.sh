#!/usr/bin/env bash
# Independent PostgreSQL 17 CI fixture. Never run against a real Supabase project.
set -euo pipefail
uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
sql() { psql -X -v ON_ERROR_STOP=1 -Aqt "$@"; }
bal() { sql -c "select balance from public.wallets where user_id='$uid'::uuid"; }
mutate() {
  sql -c "select sd_core_private.apply_server_wallet_delta_impl('$uid'::uuid,'$1'::uuid,'concurrency_spend',$2::bigint,'sd_core_ci','$3','{}'::jsonb)"
}
eq() { test "$1" = "$2" || { echo "Expected $2, received $1"; exit 1; }; }
eq "$(bal)" "10000000"
# Different events on the same wallet must serialize and both debit.
mutate e1111111-1111-4111-8111-111111111111 -1000000 first >/tmp/first.out 2>&1 &
a=$!
mutate e2222222-2222-4222-8222-222222222222 -2000000 second >/tmp/second.out 2>&1 &
b=$!
wait "$a"
wait "$b"
eq "$(bal)" "7000000"
# Exact concurrent retry with the same event_id debits only once.
mutate e3333333-3333-4333-8333-333333333333 -750000 replay >/tmp/replay-a.out 2>&1 &
a=$!
mutate e3333333-3333-4333-8333-333333333333 -750000 replay >/tmp/replay-b.out 2>&1 &
b=$!
wait "$a"
wait "$b"
eq "$(bal)" "6250000"
eq "$(sql -c "select count(*) from public.sd_core_server_wallet_events where user_id='$uid'::uuid")" "3"
eq "$(sql -c "select count(*) from public.transactions where user_id='$uid'::uuid")" "3"
eq "$(sql -c "select coalesce(sum(amount),0) from public.transactions where user_id='$uid'::uuid")" "-3750000"
sql -c "do \$\$ begin
begin
 perform sd_core_private.apply_server_wallet_delta_impl(
'$uid'::uuid,'e4444444-4444-4444-8444-444444444444'::uuid,
'overspend',-999999999,'sd_core_ci','must rollback','{}'::jsonb);
 raise exception 'unexpected spend success';
exception when sqlstate 'P1013' then null; end;
if exists(select 1 from public.sd_core_server_wallet_events where event_id='e4444444-4444-4444-8444-444444444444'::uuid) then raise exception 'orphan event'; end if;
if exists(select 1 from public.transactions where request_id='e4444444-4444-4444-8444-444444444444'::uuid) then raise exception 'orphan ledger'; end if;
if has_function_privilege('anon','sd_core_private.apply_server_wallet_delta_impl(uuid,uuid,text,bigint,text,text,jsonb)','EXECUTE') then raise exception 'anon helper access'; end if;
if has_function_privilege('authenticated','sd_core_private.apply_server_wallet_delta_impl(uuid,uuid,text,bigint,text,text,jsonb)','EXECUTE') then raise exception 'authenticated helper access'; end if;
end \$\$;"
eq "$(bal)" "6250000"
echo 'ISOLATED_PG17_SERVER_CONCURRENCY_AND_ROLLBACK_PASS'
