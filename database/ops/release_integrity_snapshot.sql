\set ON_ERROR_STOP on

-- Read-only release integrity snapshot.
-- Invoke with psql -At so the output is one JSON line with no formatting chatter.
-- Run immediately before and after additive production migrations while writes are quiesced.
-- It emits only aggregate counts and irreversible row digests; no raw user/device identifiers.

with
profiles_s as (
  select
    count(*)::bigint as row_count,
    count(*) filter (where status = 'active')::bigint as active_count,
    coalesce(md5(string_agg(
      md5(concat_ws('|', id::text, coalesce(nickname,''), coalesce(role,''), coalesce(status,''))),
      '' order by id::text
    )), md5('')) as digest
  from public.profiles
),
wallets_s as (
  select
    count(*)::bigint as row_count,
    coalesce(sum(balance),0)::numeric as balance_sum,
    coalesce(min(balance),0)::numeric as balance_min,
    coalesce(max(balance),0)::numeric as balance_max,
    coalesce(md5(string_agg(
      md5(concat_ws('|', id::text, user_id::text, account_number, balance::text)),
      '' order by user_id::text, id::text
    )), md5('')) as digest
  from public.wallets
),
transactions_s as (
  select
    count(*)::bigint as row_count,
    coalesce(sum(amount),0)::numeric as amount_sum,
    coalesce(max(sync_seq),0)::bigint as max_sync_seq,
    coalesce(md5(string_agg(
      md5(concat_ws('|', id::text, wallet_id::text, user_id::text,
        transaction_type, amount::text, balance_before::text, balance_after::text,
        coalesce(request_id::text,''), platform, sync_seq::text)),
      '' order by sync_seq, id::text
    )), md5('')) as digest
  from public.transactions
),
devices_s as (
  select
    count(*)::bigint as row_count,
    count(*) filter (where revoked_at is not null)::bigint as revoked_count,
    count(*) filter (where revoked_at is null and coalesce(link_status,'active') = 'active')::bigint as active_count,
    coalesce(md5(string_agg(
      md5(concat_ws('|', id::text, user_id::text, md5(device_key), device_name,
        platform, coalesce(link_status,''), coalesce(revoked_at::text,''))),
      '' order by id::text
    )), md5('')) as digest
  from public.devices
),
user_achievements_s as (
  select
    count(*)::bigint as row_count,
    count(distinct user_id)::bigint as user_count,
    coalesce(md5(string_agg(
      md5(concat_ws('|', user_id::text, achievement_id::text, unlocked_at::text)),
      '' order by user_id::text, achievement_id::text
    )), md5('')) as digest
  from public.sd_user_achievements
),
achievement_progress_s as (
  select
    count(*)::bigint as row_count,
    count(*) filter (where unlocked)::bigint as unlocked_count,
    count(distinct user_id)::bigint as user_count,
    coalesce(md5(string_agg(
      md5(concat_ws('|', user_id::text, achievement_id, current_value::text,
        unlocked::text, coalesce(unlocked_at::text,''), source_app)),
      '' order by user_id::text, achievement_id
    )), md5('')) as digest
  from public.sd_achievement_progress
)
select jsonb_build_object(
  'schema_version', 1,
  'strict', jsonb_build_object(
    'profiles', (select to_jsonb(p) from profiles_s p),
    'wallets', (select to_jsonb(w) from wallets_s w),
    'transactions', (select to_jsonb(t) from transactions_s t),
    'devices', (select to_jsonb(d) from devices_s d),
    'user_achievements', (select to_jsonb(a) from user_achievements_s a)
  ),
  'observational', jsonb_build_object(
    'achievement_progress', (select to_jsonb(p) from achievement_progress_s p)
  )
)::text;
