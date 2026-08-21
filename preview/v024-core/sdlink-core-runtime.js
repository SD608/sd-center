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
  return String(error?.details?.code || error?.code || "").trim();
}

function coreErrorMessage(error) {
  return String(error?.message || error?.details?.message || "").trim();
}

function isInsufficientFunds(error) {
  const code = coreErrorCode(error);
  const message = coreErrorMessage(error);
  return code === "P1013" || /INSUFFICIENT_FUNDS/i.test(message);
}

function makePublicCoreError(message, error, { code = "SD_CORE_ERROR", retryable = false } = {}) {
  const translated = new Error(message, { cause: error });
  translated.code = code;
  translated.retryable = Boolean(retryable);
  translated.coreCode = coreErrorCode(error) || null;
  return translated;
}

function translateCoreError(error) {
  if (error?.code && /^SD_CORE_/.test(String(error.code))) return error;
  const code = coreErrorCode(error);
  const message = coreErrorMessage(error);

  if (isInsufficientFunds(error)) {
    return makePublicCoreError("온라인 가상잔액이 부족합니다.", error, { code: "SD_CORE_INSUFFICIENT_FUNDS" });
  }

  const known = {
    P1001: ["로그인이 필요합니다.", "SD_CORE_AUTH_REQUIRED", false],
    P1002: ["계정 상태를 확인할 수 없습니다.", "SD_CORE_ACCOUNT_INACTIVE", false],
    P1003: ["등록된 기기를 찾지 못했습니다.", "SD_CORE_DEVICE_NOT_FOUND", false],
    P1004: ["현재 기기 연결이 비활성화되어 있습니다.", "SD_CORE_DEVICE_INACTIVE", false],
    P1006: ["이 기기의 연결이 해제되었습니다.", "SD_CORE_DEVICE_REVOKED", false],
    P1010: ["거래 종류가 올바르지 않습니다.", "SD_CORE_INVALID_EVENT_TYPE", false],
    P1011: ["거래 금액이 올바르지 않습니다.", "SD_CORE_INVALID_AMOUNT", false],
    P1012: ["거래 대상이 올바르지 않습니다.", "SD_CORE_INVALID_TARGET", false],
    P1014: ["가상잔액 한도를 초과할 수 없습니다.", "SD_CORE_BALANCE_LIMIT", false],
    P1015: ["거래 재시도 정보가 일치하지 않습니다.", "SD_CORE_IDEMPOTENCY_CONFLICT", false],
    P1016: ["가상지갑을 찾지 못했습니다.", "SD_CORE_WALLET_NOT_FOUND", false],
    P1017: ["받는 계좌를 찾지 못했습니다.", "SD_CORE_TARGET_NOT_FOUND", false],
    P1018: ["본인 계좌로는 송금할 수 없습니다.", "SD_CORE_SELF_TRANSFER", false],
    P1019: ["기기 식별값이 올바르지 않습니다.", "SD_CORE_INVALID_DEVICE_KEY", false],
    P1020: ["기기 이름이 올바르지 않습니다.", "SD_CORE_INVALID_DEVICE_NAME", false],
    P1021: ["지원하지 않는 기기 환경입니다.", "SD_CORE_INVALID_PLATFORM", false],
    P1022: ["거래 출처 정보가 올바르지 않습니다.", "SD_CORE_INVALID_SOURCE_APP", false],
    P1023: ["거래 부가 정보가 너무 큽니다.", "SD_CORE_METADATA_TOO_LARGE", false],
    P1024: ["받는 계정의 상태를 확인할 수 없습니다.", "SD_CORE_TARGET_INACTIVE", false],
    P1025: ["이전 거래 처리가 완료되지 않았습니다.", "SD_CORE_EVENT_PENDING", true],
    P1026: ["거래 부가 정보가 올바르지 않습니다.", "SD_CORE_INVALID_METADATA", false],
    P1030: ["이 보상은 서버 검증이 필요합니다. 거래는 보존되며 검증 경로가 준비된 뒤 다시 동기화합니다.", "SD_CORE_REWARD_CAPABILITY_REQUIRED", false],
  };
  if (known[code]) {
    const [publicMessage, publicCode, retryable] = known[code];
    return makePublicCoreError(publicMessage, error, { code: publicCode, retryable });
  }

  const coreUnavailable = new Set(["PGRST202", "42883", "42P01", "3F000"]);
  if (
    coreUnavailable.has(code) ||
    /schema\s*cache|could not find (?:the )?function|function\s+[^\s]+\s+does not exist|relation\s+[^\s]+\s+does not exist/i.test(message)
  ) {
    return makePublicCoreError(
      "SD Core가 아직 준비되지 않았습니다. 거래는 보존되며 연결이 복구되면 다시 동기화합니다.",
      error,
      { code: "SD_CORE_UNAVAILABLE", retryable: true },
    );
  }

  if (
    error instanceof TypeError ||
    /failed to fetch|fetch failed|network|timeout|timed out|econnreset|enotfound|eai_again/i.test(message)
  ) {
    return makePublicCoreError(
      "SD Core에 연결할 수 없습니다. 네트워크 연결을 확인한 뒤 다시 시도합니다.",
      error,
      { code: "SD_CORE_NETWORK_ERROR", retryable: true },
    );
  }

  return makePublicCoreError(
    "SD Core 처리 중 오류가 발생했습니다. 거래는 보존되며 다시 동기화합니다.",
    error,
    { code: "SD_CORE_ERROR", retryable: true },
  );
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
    throw translateCoreError(error);
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
          throw translateCoreError(error);
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
          throw translateCoreError(error);
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
  translateCoreError,
};
