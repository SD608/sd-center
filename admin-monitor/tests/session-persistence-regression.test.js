"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EncryptedSessionStore } = require("../lib/encrypted-session-store");
const { SdAdminApi, ApiError } = require("../lib/sd-admin-api");

const BASE = "https://example.supabase.co";
const KEY = "sb_publishable_abcdefghijklmnopqrstuvwxyz";
function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => body == null ? "" : JSON.stringify(body) };
}
function fakeCrypto() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`ENC:${Buffer.from(value, "utf8").toString("base64")}`, "utf8"),
    decryptString: (buffer) => Buffer.from(String(buffer).slice(4), "base64").toString("utf8")
  };
}

test("saved admin session is encrypted and round-trips without storing password or plaintext tokens", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-admin-session-"));
  const file = path.join(dir, "session.bin");
  const store = new EncryptedSessionStore(file, fakeCrypto());
  assert.equal(store.save({ access_token: "access-secret", refresh_token: "refresh-secret", expires_in: 3600 }), true);
  const raw = fs.readFileSync(file, "utf8");
  assert.equal(raw.includes("access-secret"), false);
  assert.equal(raw.includes("refresh-secret"), false);
  assert.deepEqual(store.load(), { version: 1, access_token: "access-secret", refresh_token: "refresh-secret", expires_in: 3600 });
  store.clear();
  assert.equal(fs.existsSync(file), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("session persistence is disabled rather than falling back to plaintext when OS encryption is unavailable", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-admin-session-no-crypto-"));
  const file = path.join(dir, "session.bin");
  const store = new EncryptedSessionStore(file, {
    isEncryptionAvailable: () => false,
    encryptString: (value) => Buffer.from(value),
    decryptString: (value) => String(value)
  });
  assert.equal(store.save({ access_token: "access", refresh_token: "refresh" }), false);
  assert.equal(fs.existsSync(file), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("corrupt encrypted session is rejected and removed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-admin-session-corrupt-"));
  const file = path.join(dir, "session.bin");
  fs.writeFileSync(file, Buffer.from("not-valid-encrypted-json"));
  const store = new EncryptedSessionStore(file, fakeCrypto());
  assert.equal(store.load(), null);
  assert.equal(fs.existsSync(file), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("expired saved login refreshes once and persists rotated tokens after admin verification", async () => {
  const persisted = [];
  let rpcCalls = 0;
  const fetchImpl = async (url) => {
    if (url.includes("grant_type=refresh_token")) {
      return jsonResponse(200, { access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 });
    }
    if (url.includes("sd_admin_v1_me")) {
      rpcCalls += 1;
      if (rpcCalls === 1) return jsonResponse(401, { message: "JWT expired" });
      return jsonResponse(200, { user_id: "admin", nickname: "관리자", role: "admin" });
    }
    throw new Error(`unexpected ${url}`);
  };
  const api = new SdAdminApi({ baseUrl: BASE, publishableKey: KEY, fetchImpl, onSessionChange: (value) => persisted.push(value) });
  const admin = await api.restoreSession({ access_token: "old-access", refresh_token: "old-refresh", expires_in: 1 });
  assert.equal(admin.role, "admin");
  assert.equal(api.session.access_token, "new-access");
  assert.equal(api.session.refresh_token, "new-refresh");
  assert.ok(persisted.some((value) => value?.refresh_token === "new-refresh"));
});

test("revoked or non-admin saved login is cleared, but transient offline restore does not erase persisted credentials", async () => {
  const revokedChanges = [];
  const revokedApi = new SdAdminApi({
    baseUrl: BASE,
    publishableKey: KEY,
    fetchImpl: async () => jsonResponse(403, { message: "ADMIN_REQUIRED" }),
    onSessionChange: (value) => revokedChanges.push(value)
  });
  await assert.rejects(revokedApi.restoreSession({ access_token: "a", refresh_token: "r" }), (error) => error instanceof ApiError && error.status === 403);
  assert.equal(revokedApi.isAuthenticated, false);
  assert.equal(revokedChanges.at(-1), null);

  const offlineChanges = [];
  const offlineApi = new SdAdminApi({
    baseUrl: BASE,
    publishableKey: KEY,
    fetchImpl: async () => { throw new TypeError("offline"); },
    onSessionChange: (value) => offlineChanges.push(value)
  });
  await assert.rejects(offlineApi.restoreSession({ access_token: "saved-access", refresh_token: "saved-refresh" }), (error) => error instanceof ApiError && error.status === 0);
  assert.equal(offlineApi.isAuthenticated, false);
  assert.notEqual(offlineChanges.at(-1), null, "일시 네트워크 실패는 암호화 저장 세션 삭제 신호를 보내면 안 됨");
});

test("renderer restores saved login before unauthenticated roadmap fallback and preload exposes only session restore, not password storage", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "renderer", "app.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "..", "preload.js"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.match(preload, /restoreLogin:\s*\(\)\s*=>\s*invoke\("sd:restore-login"\)/);
  assert.match(main, /safeStorage\.encryptString/);
  assert.match(main, /process\.platform\s*===\s*"win32"\s*&&\s*safeStorage\.isEncryptionAvailable\(\)/);
  assert.doesNotMatch(main, /password[^\n]*writeFile/i);
  assert.match(renderer, /async function initialize\(\).*restoreSavedLogin\(\).*if\(!restored\)await loadRoadmap\(false\)/s);
  assert.match(renderer, /activateAdmin\(result\.data,\{syncRoadmap:true\}\)/);
});
