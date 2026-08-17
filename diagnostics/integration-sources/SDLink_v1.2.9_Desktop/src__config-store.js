"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  databasePath: "",
  selectedAccountId: "",
  deviceKey: "",
  deviceName: "",
  autoSync: true,
  activated: false,
  linkedOnlineUserId: "",
  linkedOnlineEmail: "",
  migrationId: "",
  migrationStatus: "",
  walletFingerprint: "",
  lastServerCursor: 0,
  lastExpectedLocalBalance: null,
  lastSyncAt: "",
  lastSyncMessage: "",
});

function ensureDeviceKey(value) {
  const text = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(text)
    ? text
    : crypto.randomBytes(32).toString("hex");
}

class ConfigStore {
  constructor(userDataDirectory) {
    this.directory = path.join(userDataDirectory, "sdlink");
    this.filePath = path.join(this.directory, "config.json");
    fs.mkdirSync(this.directory, { recursive: true });
  }

  load() {
    let parsed = {};
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch {
      parsed = {};
    }

    const config = {
      ...DEFAULT_CONFIG,
      ...parsed,
      deviceKey: ensureDeviceKey(parsed.deviceKey),
    };

    if (!config.deviceName) {
      config.deviceName = `Windows PC (${process.env.COMPUTERNAME || "SD Link"})`;
    }

    this.save(config);
    return config;
  }

  save(config) {
    const normalized = {
      ...DEFAULT_CONFIG,
      ...config,
      deviceKey: ensureDeviceKey(config.deviceKey),
      lastServerCursor: Math.max(0, Number(config.lastServerCursor || 0)),
    };

    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(normalized, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, this.filePath);
    return normalized;
  }

  update(patch) {
    return this.save({ ...this.load(), ...patch });
  }
}

module.exports = { ConfigStore };
