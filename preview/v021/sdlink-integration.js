"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SD_LINK_ID = "sdlink-desktop";
const INTEGRATION_SCHEMA_VERSION = 1;

function integratedSdLinkUserDataPath(centerDataRoot) {
  return path.join(centerDataRoot, "linked-services", "sd-link", "userdata");
}

function integratedSdLinkDirectory(centerDataRoot) {
  return path.join(integratedSdLinkUserDataPath(centerDataRoot), "sdlink");
}

function readJsonSafe(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomicIfChanged(filePath, value) {
  const next = JSON.stringify(value, null, 2) + "\n";
  try {
    if (fs.readFileSync(filePath, "utf8") === next) return false;
  } catch {}
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = filePath + "." + process.pid + ".tmp";
  fs.writeFileSync(temporaryPath, next, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
  return true;
}

function legacyUserDataCandidates(appDataRoot, entry) {
  const names = [
    entry?.userDataFolder,
    entry?.productName,
    entry?.name,
    "SD Link",
    "SDLink",
    "sdlink-desktop",
  ].filter((value) => typeof value === "string" && value.trim());
  return [...new Set(names.map((name) => path.resolve(appDataRoot, name.trim())))];
}

function copyMissingTree(source, destination) {
  if (!source || !fs.existsSync(source)) return 0;
  let copied = 0;
  const sourceStat = fs.statSync(source);
  if (!sourceStat.isDirectory()) return 0;
  fs.mkdirSync(destination, { recursive: true });
  for (const item of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, item.name);
    const to = path.join(destination, item.name);
    if (item.isDirectory()) {
      copied += copyMissingTree(from, to);
      continue;
    }
    if (!item.isFile() || fs.existsSync(to)) continue;
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    copied += 1;
  }
  return copied;
}

function ensureIntegratedSdLinkUserData({ appDataRoot, centerDataRoot, entry }) {
  const targetUserData = integratedSdLinkUserDataPath(centerDataRoot);
  const targetSdLink = integratedSdLinkDirectory(centerDataRoot);
  fs.mkdirSync(targetSdLink, { recursive: true });

  let copiedFiles = 0;
  let migratedFrom = "";
  for (const candidate of legacyUserDataCandidates(appDataRoot, entry)) {
    if (path.resolve(candidate) === path.resolve(targetUserData)) continue;
    const sourceSdLink = path.join(candidate, "sdlink");
    if (!fs.existsSync(sourceSdLink)) continue;
    const copied = copyMissingTree(sourceSdLink, targetSdLink);
    if (copied > 0) {
      copiedFiles += copied;
      if (!migratedFrom) migratedFrom = candidate;
    }
  }

  if (copiedFiles > 0) {
    writeJsonAtomicIfChanged(
      path.join(centerDataRoot, "linked-services", "sd-link", "migration-v1.json"),
      {
        schemaVersion: INTEGRATION_SCHEMA_VERSION,
        migratedFrom,
        migratedFiles: copiedFiles,
      },
    );
  }

  return { targetUserData, copiedFiles, migratedFrom };
}

function sdLinkBindingFromConfig(config) {
  if (!config || typeof config !== "object") return null;
  return {
    schemaVersion: INTEGRATION_SCHEMA_VERSION,
    localAccountId: String(config.selectedAccountId || ""),
    walletFingerprint: String(config.walletFingerprint || ""),
    deviceKey: String(config.deviceKey || ""),
    onlineUserId: String(config.linkedOnlineUserId || ""),
    onlineEmail: String(config.linkedOnlineEmail || ""),
    activated: Boolean(config.activated),
    autoSync: config.autoSync !== false,
  };
}

function integrationState({ centerDataRoot, installed, running }) {
  const sdLinkDirectory = integratedSdLinkDirectory(centerDataRoot);
  const configPath = path.join(sdLinkDirectory, "config.json");
  const sessionPath = path.join(sdLinkDirectory, "online-session.dat");
  const config = readJsonSafe(configPath, null);
  const hasRememberedSession = fs.existsSync(sessionPath);
  const linked = Boolean(config?.linkedOnlineUserId);
  const activated = Boolean(config?.activated);
  const migrationStatus = String(config?.migrationStatus || "");

  const binding = sdLinkBindingFromConfig(config);
  if (binding) {
    writeJsonAtomicIfChanged(
      path.join(centerDataRoot, "sd-link-binding.json"),
      binding,
    );
  }

  let phase = "setup-required";
  let label = "설정 필요";
  if (!installed) {
    phase = "not-installed";
    label = "미설치";
  } else if (!running) {
    phase = "stopped";
    label = "중단됨";
  } else if (!config) {
    phase = "setup-required";
    label = "설정 필요";
  } else if (migrationStatus && migrationStatus !== "completed") {
    phase = migrationStatus === "pending" ? "migration-pending" : "migration-required";
    label = migrationStatus === "pending" ? "승인 대기" : "연결 필요";
  } else if (!linked) {
    phase = "login-required";
    label = "로그인 필요";
  } else if (!hasRememberedSession) {
    phase = "session-not-persisted";
    label = "로그인 유지 꺼짐";
  } else if (!activated) {
    phase = "linking";
    label = "연결 준비";
  } else {
    phase = "connected";
    label = "연결됨";
  }

  return {
    schemaVersion: INTEGRATION_SCHEMA_VERSION,
    installed: Boolean(installed),
    running: Boolean(running),
    phase,
    label,
    linked,
    activated,
    autoSync: config?.autoSync !== false,
    hasRememberedSession,
    localAccountId: String(config?.selectedAccountId || ""),
    walletFingerprint: String(config?.walletFingerprint || ""),
    onlineUserId: String(config?.linkedOnlineUserId || ""),
    onlineEmail: String(config?.linkedOnlineEmail || ""),
    deviceName: String(config?.deviceName || ""),
    migrationStatus,
    lastSyncAt: String(config?.lastSyncAt || ""),
    lastSyncMessage: String(config?.lastSyncMessage || ""),
  };
}

module.exports = {
  SD_LINK_ID,
  ensureIntegratedSdLinkUserData,
  integratedSdLinkDirectory,
  integratedSdLinkUserDataPath,
  integrationState,
};
