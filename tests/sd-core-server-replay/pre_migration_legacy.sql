\set ON_ERROR_STOP on
-- Intentionally commit a historical event using the PRE-HARDENING function.
select sd_core_private.apply_server_wallet_delta_impl(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'e1111111-1111-4111-8111-111111111111'::uuid,
  'legacy_test',1000,'sd_test','old description','{"case":"historical"}'::jsonb
);
