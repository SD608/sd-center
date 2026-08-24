"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const migrationPath = path.join(root, "database", "migrations", "sd_admin_wallet_session_device_v2.sql");
const membersPath = path.join(root, "assets", "js", "members-page.js");
const migration = fs.readFileSync(migrationPath, "utf8");
const members = fs.readFileSync(membersPath, "utf8");

function expect(label, condition) {
  if (!condition) throw new Error(`FAIL ${label}`);
  console.log(`PASS ${label}`);
}

expect("migration adds access-device revocation", /add column if not exists revoked_at timestamptz/i.test(migration));
expect("migration binds one device per auth session", /bound_session_id uuid/i.test(migration) && /sd_access_devices_user_session_unique_idx/i.test(migration));
expect("migration reads live auth.sessions", /get_current_sd_session_id_v2/i.test(migration) && /from auth\.sessions/i.test(migration));
expect("heartbeat rejects revoked sessions", /record_sd_access_heartbeat[\s\S]*SESSION_REVOKED/i.test(migration));
expect("heartbeat rejects revoked devices", /record_sd_access_heartbeat[\s\S]*DEVICE_REVOKED/i.test(migration));
expect("heartbeat rejects session-device mismatch", /record_sd_access_heartbeat[\s\S]*SESSION_DEVICE_MISMATCH/i.test(migration));
expect("admin device secret is server hashed", /admin_secret_hash bytea/i.test(migration) && /extensions\.digest\(v_device_secret, 'sha256'\)/i.test(migration));
expect("v2 admin RPC requires explicit request id", /sd_admin_v2_adjust_wallet[\s\S]*REQUEST_ID_REQUIRED/i.test(migration));
expect("v2 admin RPC uses device assertion", /sd_admin_v2_adjust_wallet[\s\S]*assert_sd_admin_wallet_device_v2/i.test(migration));
expect("v2 admin RPC routes through Core server delta", /sd_admin_v2_adjust_wallet[\s\S]*apply_server_wallet_delta_impl/i.test(migration));
expect("legacy credit RPC is fail closed", /admin_credit_sd_wallet[\s\S]*ADMIN_WALLET_V2_REQUIRED/i.test(migration));
expect("legacy debit RPC is fail closed", /admin_debit_sd_wallet[\s\S]*ADMIN_WALLET_V2_REQUIRED/i.test(migration));
expect("authenticated legacy RPC grants are revoked", /revoke execute on function public\.admin_credit_sd_wallet\(uuid,bigint,text\) from public, anon, authenticated/i.test(migration) && /revoke execute on function public\.admin_debit_sd_wallet\(uuid,bigint,text\) from public, anon, authenticated/i.test(migration) && /revoke execute on function public\.sd_admin_v1_adjust_wallet\(uuid,text,bigint,text,uuid\) from public, anon, authenticated/i.test(migration));
expect("admin member list does not expose reusable full device key", /when char_length\(lastdev\.device_key\) <= 14 then '등록됨'/i.test(migration));

expect("members UI no longer calls legacy admin credit", !members.includes('rpc("admin_credit_sd_wallet"'));
expect("members UI no longer calls legacy admin debit", !members.includes('rpc("admin_debit_sd_wallet"'));
expect("members UI calls v2 admin RPC", members.includes('rpc("sd_admin_v2_adjust_wallet"'));
expect("members UI binds device secret before wallet actions", members.includes('rpc("admin_bind_sd_wallet_device_v2"') && members.includes("p_device_secret"));
expect("members UI supplies stable request id", members.includes("pendingRequestId") && members.includes("p_request_id: pendingRequestId"));
expect("members UI reuses request id for exact same intent", members.includes("pendingFingerprint !== fingerprint || !pendingRequestId"));
expect("members UI fails closed when device binding is unavailable", members.includes("adminWalletReady") && members.includes("지급/차감 기능은 비활성화됩니다"));

console.log("PASS admin wallet security v2 static regression");
