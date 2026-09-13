"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PATCH_MARK = Symbol.for("sd.center.sdlink.center-version-report.v1");
const REPORT_TTL_MS = 6 * 60 * 60 * 1000;

function cleanVersion(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 32 || !/^[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(text)) return "";
  return text;
}

function cleanBuildId(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 64 || !/^[0-9A-Za-z][0-9A-Za-z._:+-]*$/.test(text)) return "";
  return text;
}

function readCenterRuntimeIdentity(centerRoot = path.resolve(__dirname, "..")) {
  try {
    const pkgPath = path.join(centerRoot, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const version = cleanVersion(pkg?.version);
    if (!version) return { version: "", buildId: "" };

    const mainRel = String(pkg?.main || "main.js").trim() || "main.js";
    const mainPath = path.resolve(centerRoot, mainRel);
    let buildId = "";
    try {
      const digest = crypto.createHash("sha256").update(fs.readFileSync(mainPath)).digest("hex");
      buildId = cleanBuildId(`main-${digest.slice(0, 16)}`);
    } catch {
      buildId = cleanBuildId(`version-${version}`);
    }
    return { version, buildId };
  } catch {
    return { version: "", buildId: "" };
  }
}

function getMeta(syncState, key, fallback = "") {
  try {
    if (syncState && typeof syncState.getMeta === "function") return syncState.getMeta(key, fallback);
  } catch {}
  return fallback;
}

function setMeta(syncState, key, value) {
  try {
    if (syncState && typeof syncState.setMeta === "function") syncState.setMeta(key, value);
  } catch {}
}

function reportCacheKey(deviceKey) {
  return `sdcore:center-version-report:${String(deviceKey || "").trim().toLowerCase()}`;
}

function parseCachedReport(value) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function shouldReport(syncState, deviceKey, identity, now = Date.now()) {
  const cached = parseCachedReport(getMeta(syncState, reportCacheKey(deviceKey), ""));
  if (!cached) return true;
  if (cached.version !== identity.version || cached.buildId !== identity.buildId) return true;
  const at = Number(cached.reportedAt || 0);
  return !Number.isFinite(at) || now - at >= REPORT_TTL_MS;
}

async function reportCenterVersion(engine, config, { centerRoot = path.resolve(__dirname, ".."), now = Date.now() } = {}) {
  if (!engine?.auth || typeof engine.auth.rpc !== "function") return { ok: false, skipped: true, reason: "auth-unavailable" };
  const deviceKey = String(config?.deviceKey || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(deviceKey)) return { ok: false, skipped: true, reason: "invalid-device-key" };

  const identity = readCenterRuntimeIdentity(centerRoot);
  if (!identity.version) return { ok: false, skipped: true, reason: "version-unavailable" };
  if (!shouldReport(engine.syncState, deviceKey, identity, now)) {
    return { ok: true, skipped: true, reason: "recently-reported", ...identity };
  }

  try {
    const rpc = engine.auth.rpc.bind(engine.auth);
    const registered = await rpc("sd_core_register_device", {
      p_device_key: deviceKey,
      p_device_name: String(config?.deviceName || "SD종합센터 PC").trim() || "SD종합센터 PC",
      p_platform: "windows",
    });
    const value = Array.isArray(registered) && registered.length === 1 ? registered[0] : registered;
    const deviceId = String(value?.device_id || "").trim();
    if (!deviceId) return { ok: false, skipped: true, reason: "device-id-unavailable", ...identity };

    await rpc("sd_core_report_center_version", {
      p_device_id: deviceId,
      p_center_version: identity.version,
      p_build_id: identity.buildId || null,
    });

    setMeta(engine.syncState, reportCacheKey(deviceKey), JSON.stringify({
      version: identity.version,
      buildId: identity.buildId,
      reportedAt: now,
    }));
    return { ok: true, deviceId, ...identity };
  } catch (error) {
    // Version telemetry must never block wallet sync. The Core wallet runtime will
    // independently surface auth/revocation/network failures where they matter.
    return { ok: false, skipped: true, reason: String(error?.code || error?.message || error || "report-failed"), ...identity };
  }
}

function patchIntegratedSdLinkCenterVersionReport(childDirectory, options = {}) {
  if (process.env.SD_CENTER_LINK_INTEGRATED !== "1") {
    return { ok: true, skipped: true, reason: "standalone" };
  }
  try {
    const modulePath = path.join(childDirectory, "src", "sync-engine.js");
    const loaded = require(modulePath);
    const SyncEngine = loaded?.SyncEngine;
    if (!SyncEngine?.prototype) return { ok: false, reason: "SyncEngine not found" };
    if (SyncEngine.prototype[PATCH_MARK]) return { ok: true, patched: false, reason: "already-patched" };

    const originalPush = SyncEngine.prototype.pushLocalTransactions;
    const originalPull = SyncEngine.prototype.pullRemoteTransactions;
    if (typeof originalPush !== "function" || typeof originalPull !== "function") {
      return { ok: false, reason: "wallet sync methods not found" };
    }

    SyncEngine.prototype.pushLocalTransactions = async function centerVersionPush(config, expectedBalance) {
      await reportCenterVersion(this, config, options);
      return originalPush.call(this, config, expectedBalance);
    };

    SyncEngine.prototype.pullRemoteTransactions = async function centerVersionPull(config, initialCursor) {
      await reportCenterVersion(this, config, options);
      return originalPull.call(this, config, initialCursor);
    };

    Object.defineProperty(SyncEngine.prototype, PATCH_MARK, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return { ok: true, patched: true };
  } catch (error) {
    return { ok: false, reason: String(error?.message || error) };
  }
}

module.exports = {
  REPORT_TTL_MS,
  cleanBuildId,
  cleanVersion,
  patchIntegratedSdLinkCenterVersionReport,
  readCenterRuntimeIdentity,
  reportCenterVersion,
  shouldReport,
};
