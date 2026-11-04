// Static contract guard only. NOT a runtime, database, or production security test.
// Prevents older Core v1 client-reward examples from silently becoming the
// assumed extension integration API.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const read = (name) => readFileSync(new URL('../../' + name, import.meta.url), 'utf8');
const hardened = read('database/migrations/sd_core_reward_authority_v1.sql');
const legacy = read('database/migrations/sd_core_legacy_reward_authority_v1.sql');
const contract = read('docs/sd-core/CROSS_EXTENSION_AUTHORITY_ADDENDUM_20261104.md');

test('client Core wallet reward must fail closed before delegation', () => {
  const section = hardened.split('create or replace function sd_core_private.apply_client_wallet_event_impl(')[1]?.split('create or replace function public.sd_core_apply_wallet_event(')[0] || '';
  assert.match(section, /if v_event_type\s*=\s*'reward' then[\s\S]*?REWARD_CAPABILITY_REQUIRED/);
  assert.ok(section.indexOf('REWARD_CAPABILITY_REQUIRED') < section.indexOf('apply_wallet_event_impl('));
});

test('public Core wallet API delegates to guarded client path', () => {
  const section = hardened.split('create or replace function public.sd_core_apply_wallet_event(')[1]?.split('create or replace function sd_core_private.apply_sd_link_event_impl(')[0] || '';
  assert.match(section, /security invoker/i);
  assert.match(section, /sd_core_private\.apply_client_wallet_event_impl\(/);
  assert.doesNotMatch(section, /select sd_core_private\.apply_wallet_event_impl\(/);
});

test('legacy client positive deposits fail but exact prior replay remains first', () => {
  const lookup = legacy.indexOf('if v_existing_transaction is not null then');
  const ban = legacy.indexOf("if p_amount>0 then");
  assert.ok(lookup >= 0 && ban > lookup, 'committed replay check must precede positive-reward rejection');
  assert.match(legacy, /if p_amount>0 then[\s\S]*?REWARD_CAPABILITY_REQUIRED/);
});

test('current addendum explicitly warns that v1 reward samples are historical', () => {
  assert.match(contract, /pre-hardening baseline/);
  assert.match(contract, /P1030/);
  assert.match(contract, /TBD/);
  assert.match(contract, /not a live production deployment/i);
});
