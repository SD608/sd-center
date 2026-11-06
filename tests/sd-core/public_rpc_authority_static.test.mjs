import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(path)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const client=read('database/migrations/sd_core_reward_authority_v1.sql');
const server=read('database/migrations/sd_core_server_wallet_delta_v1.sql');
const logistics=read('database/migrations/sd_logistics_reward_authority_v1.sql');
const admin=read('sql/release-gate/20260821092200_sd_release_admin_wallet_core_route_v1.sql');
const doc=read('docs/sd-core/PUBLIC_RPC_AUTHORITY_AUDIT_20261106.md');

test('public client wallet calls restricted implementation, and rewards fail closed',()=>{
 const p=client.split('create or replace function public.sd_core_apply_wallet_event(')[1]?.split('create or replace function sd_core_private.apply_sd_link_event_impl(')[0]||'';
 assert.match(p,/security invoker/i);
 assert.match(p,/apply_client_wallet_event_impl/);
 const guard=client.split('create or replace function sd_core_private.apply_client_wallet_event_impl(')[1]?.split('create or replace function public.sd_core_apply_wallet_event(')[0]||'';
 assert.match(guard,/if v_event_type = 'reward' then[\s\S]*?P1030/);
});
test('server settlement is private and denies direct client execute',()=>{
 assert.match(server,/security definer\s+set search_path\s*=\s*''/i);
 assert.match(server,/revoke all on function sd_core_private\.apply_server_wallet_delta_impl\([\s\S]*?from public,anon,authenticated/i);
});
test('legacy logistics rejects new credits and checks fixed cost spend',()=>{
 assert.match(logistics,/if p_amount>0 then[\s\S]*?P1030/);
 assert.match(logistics,/when 'vehicle_buy_small' then[\s\S]*?p_amount<>-250000/);
});
test('admin credit and debit each require authenticated active admin',()=>{
 for(const name of ['admin_credit_sd_wallet','admin_debit_sd_wallet']){
  const body=admin.split('create or replace function public.'+name+'(')[1]?.split('end;\n$$;')[0]||'';
  assert.match(body,/v_admin uuid\s*:=\s*auth\.uid\(\)/);
  assert.match(body,/p\.role='admin' and p\.status='active'/);
  assert.match(body,/ADMIN_REQUIRED/);
 }
});
test('source-only audit does not claim live verification',()=>{
 assert.match(doc,/source audit/i);
 assert.match(doc,/NOT VERIFIED/);
 assert.match(doc,/NOT_RUN/);
});
