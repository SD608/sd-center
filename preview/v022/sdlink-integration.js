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

function integrationState({ centerDataRoot, installed, running, legacyConflict = null }) {
  const sdLinkDirectory = integratedSdLinkDirectory(centerDataRoot);
  const configPath = path.join(sdLinkDirectory, "config.json");
  const sessionPath = path.join(sdLinkDirectory, "online-session.dat");
  const config = readJsonSafe(configPath, null);
  const hasRememberedSession = fs.existsSync(sessionPath);
  const linked = Boolean(config?.linkedOnlineUserId);
  const activated = Boolean(config?.activated);
  const migrationStatus = String(config?.migrationStatus || "");
  const lastSyncAt = String(config?.lastSyncAt || "");
  const lastSyncMessage = String(config?.lastSyncMessage || "");
  const parsedLastSyncAt = Date.parse(lastSyncAt);
  const syncAgeMs = Number.isFinite(parsedLastSyncAt)
    ? Math.max(0, Date.now() - parsedLastSyncAt)
    : null;
  const syncText = lastSyncMessage.toLowerCase();
  const syncBusy = /sqlite_busy|database is locked|사용 중|건너뛰고/.test(syncText);
  const syncError = /\berror\b|\bfailed\b|실패|오류|unauthorized|jwt|network|fetch failed|timeout/.test(syncText);

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
  } else if (legacyConflict) {
    phase = "legacy-conflict";
    label = "기존 SD Link 실행 중";
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
  } else if (config?.autoSync === false) {
    phase = "paused";
    label = "자동 동기화 꺼짐";
  } else if (!lastSyncAt) {
    phase = "sync-checking";
    label = "연결 확인 중";
  } else if (syncError) {
    phase = "sync-error";
    label = "동기화 오류";
  } else if (syncBusy) {
    phase = "sync-stale";
    label = "동기화 대기";
  } else if (syncAgeMs !== null && syncAgeMs > 60_000) {
    phase = "sync-stale";
    label = "동기화 지연";
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
    lastSyncAt,
    lastSyncMessage,
    syncAgeMs,
    onlineHealthy: phase === "connected",
    legacyConflict: Boolean(legacyConflict),
    legacyConflictProcess: legacyConflict
      ? String(legacyConflict.name || legacyConflict.processName || "")
      : "",
  };
}

module.exports = {
  SD_LINK_ID,
  ensureIntegratedSdLinkUserData,
  integratedSdLinkDirectory,
  integratedSdLinkUserDataPath,
  integrationState,
};
