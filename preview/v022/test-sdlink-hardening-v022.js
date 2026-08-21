"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { integrationState, integratedSdLinkDirectory } = require("../src/sdlink-integration");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sdlink-v022-"));
try {
  const centerDataRoot = path.join(temp, "SD종합센터");
  const dir = integratedSdLinkDirectory(centerDataRoot);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "online-session.dat"), "encrypted", "utf8");
  const base = {
    selectedAccountId: "wallet-1",
    deviceKey: "d".repeat(64),
    linkedOnlineUserId: "user-1",
    linkedOnlineEmail: "user@example.com",
    activated: true,
    autoSync: true,
    migrationStatus: "completed",
    lastSyncAt: new Date().toISOString(),
    lastSyncMessage: "완료 · PC 0건 전송 / 온라인 0건 반영",
  };
  const write = (next) => fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ ...base, ...next }), "utf8");

  write({});
  assert.equal(integrationState({ centerDataRoot, installed: true, running: true }).phase, "connected");
  assert.equal(integrationState({ centerDataRoot, installed: true, running: false, legacyConflict: { name: "SD Link.exe", pid: 123 } }).phase, "legacy-conflict");

  write({ lastSyncAt: new Date(Date.now() - 120_000).toISOString() });
  assert.equal(integrationState({ centerDataRoot, installed: true, running: true }).phase, "sync-stale");

  write({ lastSyncMessage: "network error: fetch failed" });
  assert.equal(integrationState({ centerDataRoot, installed: true, running: true }).phase, "sync-error");

  write({ autoSync: false });
  assert.equal(integrationState({ centerDataRoot, installed: true, running: true }).phase, "paused");

  write({ lastSyncAt: "", lastSyncMessage: "" });
  assert.equal(integrationState({ centerDataRoot, installed: true, running: true }).phase, "sync-checking");

  fs.rmSync(path.join(dir, "online-session.dat"), { force: true });
  write({});
  assert.equal(integrationState({ centerDataRoot, installed: true, running: true }).phase, "session-not-persisted");

  console.log("SD Link v0.22 hardening state tests passed");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
