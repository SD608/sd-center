"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  ensureIntegratedSdLinkUserData,
  integratedSdLinkDirectory,
  integratedSdLinkUserDataPath,
  integrationState,
} = require("../src/sdlink-integration");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sdlink-center-v021-"));
try {
  const appDataRoot = path.join(temp, "AppData");
  const centerDataRoot = path.join(appDataRoot, "SD종합센터");
  const legacy = path.join(appDataRoot, "SD Link", "sdlink");
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, "online-session.dat"), "encrypted-session", "utf8");
  fs.writeFileSync(path.join(legacy, "sync-state.sqlite"), "sqlite-placeholder", "utf8");
  fs.writeFileSync(path.join(legacy, "config.json"), JSON.stringify({
    selectedAccountId: "local-wallet-7",
    walletFingerprint: "fp-old",
    deviceKey: "d".repeat(64),
    linkedOnlineUserId: "online-user-1",
    linkedOnlineEmail: "user@example.com",
    activated: true,
    autoSync: true,
    migrationStatus: "completed",
    lastSyncAt: "2026-08-20T00:00:00.000Z",
    lastSyncMessage: "ok",
  }), "utf8");

  const first = ensureIntegratedSdLinkUserData({
    appDataRoot,
    centerDataRoot,
    entry: { userDataFolder: "SD Link", productName: "SD Link", name: "SD Link" },
  });
  assert.equal(first.targetUserData, integratedSdLinkUserDataPath(centerDataRoot));
  assert.ok(first.copiedFiles >= 3);
  const target = integratedSdLinkDirectory(centerDataRoot);
  assert.equal(fs.readFileSync(path.join(target, "online-session.dat"), "utf8"), "encrypted-session");

  // 새 통합 경로에 이미 존재하는 설정은 구형 경로가 절대 덮어쓰지 못해야 합니다.
  const integratedConfig = JSON.parse(fs.readFileSync(path.join(target, "config.json"), "utf8"));
  integratedConfig.walletFingerprint = "fp-new";
  fs.writeFileSync(path.join(target, "config.json"), JSON.stringify(integratedConfig), "utf8");
  fs.writeFileSync(path.join(legacy, "config.json"), JSON.stringify({ walletFingerprint: "fp-legacy-overwrite" }), "utf8");
  ensureIntegratedSdLinkUserData({
    appDataRoot,
    centerDataRoot,
    entry: { userDataFolder: "SD Link" },
  });
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, "config.json"), "utf8")).walletFingerprint, "fp-new");

  const connected = integrationState({ centerDataRoot, installed: true, running: true });
  assert.equal(connected.phase, "connected");
  assert.equal(connected.localAccountId, "local-wallet-7");
  assert.equal(connected.onlineUserId, "online-user-1");
  assert.equal(connected.hasRememberedSession, true);

  const binding = JSON.parse(fs.readFileSync(path.join(centerDataRoot, "sd-link-binding.json"), "utf8"));
  assert.equal(binding.localAccountId, "local-wallet-7");
  assert.equal(binding.onlineUserId, "online-user-1");
  assert.equal(Object.hasOwn(binding, "accessToken"), false);
  assert.equal(Object.hasOwn(binding, "refreshToken"), false);

  fs.rmSync(path.join(target, "online-session.dat"), { force: true });
  const noSession = integrationState({ centerDataRoot, installed: true, running: true });
  assert.equal(noSession.phase, "session-not-persisted");

  const stopped = integrationState({ centerDataRoot, installed: true, running: false });
  assert.equal(stopped.phase, "stopped");

  console.log("SD Link × Center v0.21 integration tests passed");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
