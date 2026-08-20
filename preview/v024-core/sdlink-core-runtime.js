"use strict";

const crypto = require("node:crypto");
const path = require("node:path");

const PATCH_MARK = Symbol.for("sd.center.sdlink.core.v1");

function stableCoreEventId(syncState, deviceKey, localTransactionId) {
  if (!syncState || typeof syncState.getMeta !== "function" || typeof syncState.setMeta !== "function") {
    throw new Error("SD Core 전환에 필요한 syncState가 없습니다.");
  }
  const localId = String(localTransactionId || "").trim();
  if (!localId) throw new Error("로컬 거래 식별값이 없습니다.");
  const seed = `${String(deviceKey || "").trim().toLowerCase()}\n${localId}`;
  const key = `sdcore:event:${crypto.createHash("sha256").update(seed).digest("hex")}`;
  const existing = String(syncState.getMeta(key, "") || "").trim();
  if (existing) return existing;
  const created = crypto.randomUUID();
  // Persist BEFORE the RPC. A timeout/restart must reuse the exact event_id.
  syncState.setMeta(key, created);
  return created;
}

function semanticFromLegacyAmount(value) {
  const signed = Number(value);
  if (!Number.isSafeInteger(signed) || signed === 0) {
    throw new Error("SD Link 거래 금액이 올바르지 않습니다.");
  }
  return { type: signed > 0 ? "reward" : "spend", amount: Math.abs(signed) };
}

function coreErrorCode(error) {
  return String(error?.details?.code || error?.code || "").trim().toUpperCase();
}

function coreErrorText(error) {
  return [error?.message, error?.details?.message, error?.details, error?.hint]
    .filter(Boolean)
    .map(String)
    .join(" ");
}

function publicCoreError(error) {
  const code = coreErrorCode(error);
  const raw = coreErrorText(error);
  let message = "SD Core 동기화 중 오류가 발생했습니다. 다시 시도해 주세요.";

  if (code === "P1001" || /AUTH_REQUIRED/i.test(raw)) {
    message = "로그인이 필요합니다. 다시 로그인해 주세요.";
  } else if (code === "P1002" || /ACCOUNT_INACTIVE/i.test(raw)) {
    message = "현재 이용할 수 없는 계정입니다.";
  } else if (code === "P1003" || /DEVICE_NOT_FOUND/i.test(raw)) {
    message = "등록된 기기를 확인하지 못했습니다. SD Link를 다시 연결해 주세요.";
  } else if (code === "P1004" || /DEVICE_INACTIVE/i.test(raw)) {
    message = "이 기기는 현재 비활성 상태입니다.";
  } else if (code === "P1006" || /DEVICE_REVOKED/i.test(raw)) {
    message = "연결 해제된 기기입니다. 기기를 다시 등록해 주세요.";
  } else if (code === "P1013" || /INSUFFICIENT_FUNDS/i.test(raw)) {
    message = "온라인 가상잔액이 부족합니다.";
  } else if (code === "P1015" || /IDEMPOTENCY_CONFLICT/i.test(raw)) {
    message = "동기화 거래 정보가 이전 요청과 일치하지 않습니다.";
  } else if (code === "P1025" || /EVENT_NOT_COMPLETED/i.test(raw)) {
    message = "거래 처리 상태를 확인하는 중입니다. 다시 동기화해 주세요.";
  } else if (code === "P1030" || /REWARD_CAPABILITY_REQUIRED/i.test(raw)) {
    message = "이 보상은 아직 SD Core 서버 검증을 지원하지 않습니다.";
  } else if (
    code === "PGRST202" || code === "42883" || code === "42P01" ||
    /schema cache|could not find .*function|function .* does not exist|relation .* does not exist/i.test(raw)
  ) {
    message = "SD Core 서버 기능을 준비 중입니다. 다시 동기화해 주세요.";
  } else if (
    /fetch failed|failed to fetch|network|timeout|timed out|econnreset|econnrefused|enotfound|socket hang up/i.test(raw)
  ) {
    message = "네트워크 연결을 확인한 뒤 다시 시도해 주세요.";
  }

  const translated = new Error(message);
  translated.code = code || "SD_CORE_ERROR";
  translated.cause = error;
  return translated;
}

function isInsufficientFunds(error) {
  return coreErrorCode(error) === "P1013" || /INSUFFICIENT_FUNDS/i.test(coreErrorText(error));
}

async function ensureCoreDevice(engine, config, originalRpc) {
  const deviceKey = String(config?.deviceKey || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(deviceKey)) {
    throw new Error("SD Core 기기 식별값이 올바르지 않습니다.");
  }
  if (engine.__sdCoreDeviceId && engine.__sdCoreDeviceKey === deviceKey) {
    return engine.__sdCoreDeviceId;
  }

  let result;
  try {
    result = await originalRpc("sd_core_register_device", {
      p_device_key: deviceKey,
      p_device_name: String(config?.deviceName || "SD종합센터 PC").trim() || "SD종합센터 PC",
      p_platform: "windows",
    });
  } catch (error) {
    throw publicCoreError(error);
  }

  const value = Array.isArray(result) && result.length === 1 ? result[0] : result;
  const deviceId = String(value?.device_id || "").trim();
  if (!deviceId) throw new Error("SD Core 기기 등록 응답이 올바르지 않습니다.");
  engine.__sdCoreDeviceId = deviceId;
  engine.__sdCoreDeviceKey = deviceKey;
  return deviceId;
}

function patchIntegratedSdLinkCoreRuntime(childDirectory) {
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

    SyncEngine.prototype.pushLocalTransactions = async function sdCorePushLocalTransactions(config, expectedBalance) {
      const auth = this.auth;
      if (!auth || typeof auth.rpc !== "function") throw new Error("SD Link 인증 RPC를 찾지 못했습니다.");
      const originalRpc = auth.rpc.bind(auth);
      const deviceId = await ensureCoreDevice(this, config, originalRpc);
      const deviceKey = String(config?.deviceKey || "").trim().toLowerCase();
      const previousRpc = auth.rpc;
      auth.rpc = async (name, body = {}) => {
        if (name !== "push_sd_link_transaction") return originalRpc(name, body);
        const semantic = semanticFromLegacyAmount(body.p_amount);
        const localTransactionId = String(body.p_local_transaction_id || "").trim();
        const eventId = stableCoreEventId(this.syncState, deviceKey, localTransactionId);
        const metadata = body.p_metadata && typeof body.p_metadata === "object" && !Array.isArray(body.p_metadata)
          ? { ...body.p_metadata }
          : {};
        try {
          return await originalRpc("sd_core_apply_sd_link_event", {
            p_device_id: deviceId,
            p_event_id: eventId,
            p_local_transaction_id: localTransactionId,
            p_event_type: semantic.type,
            p_amount: semantic.amount,
            p_source_app: "sd_link",
            p_description: String(body.p_description || "SD Link 로컬 거래"),
            p_metadata: {
              ...metadata,
              sd_link_device_key: deviceKey,
              sd_link_local_transaction_id: localTransactionId,
              local_transaction_type: String(body.p_transaction_type || ""),
              sd_core_bridge: "integrated-v1",
            },
          });
        } catch (error) {
          // Preserve the old engine's insufficient-funds rejected-withdraw behavior.
          if (isInsufficientFunds(error)) throw publicCoreError(error);
          throw publicCoreError(error);
        }
      };
      try {
        return await originalPush.call(this, config, expectedBalance);
      } finally {
        auth.rpc = previousRpc;
      }
    };

    SyncEngine.prototype.pullRemoteTransactions = async function sdCorePullRemoteTransactions(config, initialCursor) {
      const auth = this.auth;
      if (!auth || typeof auth.rpc !== "function") throw new Error("SD Link 인증 RPC를 찾지 못했습니다.");
      const originalRpc = auth.rpc.bind(auth);
      const deviceId = await ensureCoreDevice(this, config, originalRpc);
      const previousRpc = auth.rpc;
      auth.rpc = async (name, body = {}) => {
        if (name !== "pull_sd_link_transactions") return originalRpc(name, body);
        try {
          return await originalRpc("sd_core_list_transactions", {
            p_device_id: deviceId,
            p_after_seq: Math.max(0, Number(body.p_after_seq || 0)),
            p_limit: Math.min(200, Math.max(1, Number(body.p_limit || 100))),
          });
        } catch (error) {
          throw publicCoreError(error);
        }
      };
      try {
        return await originalPull.call(this, config, initialCursor);
      } finally {
        auth.rpc = previousRpc;
      }
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
  patchIntegratedSdLinkCoreRuntime,
  semanticFromLegacyAmount,
  stableCoreEventId,
  coreErrorCode,
  publicCoreError,
};
