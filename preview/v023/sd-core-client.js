"use strict";

const crypto = require("node:crypto");

const CORE_V1_RPCS = Object.freeze({
  registerDevice: "sd_core_register_device",
  getSnapshot: "sd_core_get_snapshot",
  applyWalletEvent: "sd_core_apply_wallet_event",
  listTransactions: "sd_core_list_transactions",
});

function positiveInteger(value, label = "amount") {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return number;
}

function uuidFromSeed(seed) {
  const bytes = crypto.createHash("sha256").update(String(seed)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stableEventId(syncState, localTransactionId) {
  if (!syncState || typeof syncState.getMeta !== "function" || typeof syncState.setMeta !== "function") {
    throw new Error("syncState with getMeta/setMeta is required for retry-safe event IDs");
  }
  const localId = String(localTransactionId || "").trim();
  if (!localId) throw new Error("local transaction id is required");
  const keyHash = crypto.createHash("sha256").update(localId).digest("hex");
  const key = `sdcore:event:${keyHash}`;
  const existing = String(syncState.getMeta(key, "") || "").trim();
  if (existing) return existing;
  const created = crypto.randomUUID();
  // Persist before the network request so timeout/restart retries reuse exactly one event_id.
  syncState.setMeta(key, created);
  return created;
}

function semanticWalletEvent(transaction, signedDelta) {
  const delta = Number(signedDelta);
  if (!Number.isSafeInteger(delta) || delta === 0) {
    throw new Error("signedDelta must be a non-zero safe integer");
  }
  return {
    type: delta > 0 ? "reward" : "spend",
    amount: Math.abs(delta),
    targetAccountNumber: null,
    description: String(transaction?.memo || transaction?.description || "SD Link local wallet event"),
  };
}

class SdCoreHttpAuth {
  constructor({ supabaseUrl, publishableKey, fetchImpl = globalThis.fetch } = {}) {
    this.supabaseUrl = String(supabaseUrl || "").replace(/\/+$/, "");
    this.publishableKey = String(publishableKey || "");
    this.fetchImpl = fetchImpl;
    this.session = null;
    if (!this.supabaseUrl || !this.publishableKey) throw new Error("Supabase URL and publishable key are required");
    if (typeof this.fetchImpl !== "function") throw new Error("fetch implementation is required");
  }

  async requestJson(url, options = {}) {
    const response = await this.fetchImpl(url, options);
    const text = await response.text();
    let body = null;
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    if (!response.ok) {
      const error = new Error(String(body?.message || body?.error_description || body?.msg || `HTTP ${response.status}`));
      error.statusCode = response.status;
      error.code = String(body?.code || body?.error_code || "");
      error.details = body;
      throw error;
    }
    return body;
  }

  acceptSession(payload) {
    if (!payload?.access_token || !payload?.user?.id) return false;
    this.session = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || "",
      user: payload.user,
    };
    return true;
  }

  async signIn(email, password) {
    const payload = await this.requestJson(`${this.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: this.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: String(email), password: String(password) }),
    });
    if (!this.acceptSession(payload)) throw new Error("SD Core Dev sign-in returned no session");
    return this.session;
  }

  async signUp(email, password) {
    const payload = await this.requestJson(`${this.supabaseUrl}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: this.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: String(email), password: String(password) }),
    });
    this.acceptSession(payload);
    return payload;
  }

  async rpc(name, body = {}) {
    if (!this.session?.accessToken) throw new Error("SD Core Dev authentication required");
    return this.requestJson(`${this.supabaseUrl}/rest/v1/rpc/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        apikey: this.publishableKey,
        Authorization: `Bearer ${this.session.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }
}

class SdCoreClient {
  constructor({ auth } = {}) {
    if (!auth || typeof auth.rpc !== "function") throw new Error("auth.rpc is required");
    this.auth = auth;
  }

  registerDevice({ deviceKey, deviceName, platform = "windows" }) {
    return this.auth.rpc(CORE_V1_RPCS.registerDevice, {
      p_device_key: String(deviceKey || "").trim().toLowerCase(),
      p_device_name: String(deviceName || "").trim(),
      p_platform: String(platform || "windows").trim().toLowerCase(),
    });
  }

  getSnapshot(deviceId) {
    return this.auth.rpc(CORE_V1_RPCS.getSnapshot, { p_device_id: String(deviceId || "") });
  }

  applyWalletEvent({ deviceId, eventId, type, amount, targetAccountNumber = null, sourceApp = "sd_link", description = "", metadata = {} }) {
    const normalizedType = String(type || "").trim().toLowerCase();
    if (!new Set(["reward", "spend", "transfer"]).has(normalizedType)) throw new Error("invalid Core wallet event type");
    const normalizedAmount = positiveInteger(amount);
    const target = targetAccountNumber == null ? null : String(targetAccountNumber).trim();
    if (normalizedType === "transfer" && !target) throw new Error("transfer target account number is required");
    if (normalizedType !== "transfer" && target) throw new Error("reward/spend must not include a transfer target");
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("metadata must be an object");
    return this.auth.rpc(CORE_V1_RPCS.applyWalletEvent, {
      p_device_id: String(deviceId || ""),
      p_event_id: String(eventId || ""),
      p_event_type: normalizedType,
      p_amount: normalizedAmount,
      p_target_account_number: target,
      p_source_app: String(sourceApp || "sd_link"),
      p_description: String(description || ""),
      p_metadata: metadata,
    });
  }

  listTransactions(deviceId, afterSeq = 0, limit = 100) {
    return this.auth.rpc(CORE_V1_RPCS.listTransactions, {
      p_device_id: String(deviceId || ""),
      p_after_seq: Math.max(0, Number(afterSeq || 0)),
      p_limit: Math.min(200, Math.max(1, Number(limit || 100))),
    });
  }

  applyLegacyLocalTransaction({ deviceId, deviceKey, transaction, signedDelta, syncState, sourceApp = "sd_link" }) {
    const semantic = semanticWalletEvent(transaction, signedDelta);
    const eventId = stableEventId(syncState, transaction?.id);
    return this.applyWalletEvent({
      deviceId,
      eventId,
      type: semantic.type,
      amount: semantic.amount,
      targetAccountNumber: null,
      sourceApp,
      description: semantic.description,
      metadata: {
        sd_link_local_transaction_id: String(transaction?.id || ""),
        sd_link_device_key: String(deviceKey || ""),
        local_transaction_type: String(transaction?.transactionType || ""),
      },
    });
  }
}

module.exports = {
  CORE_V1_RPCS,
  SdCoreClient,
  SdCoreHttpAuth,
  positiveInteger,
  semanticWalletEvent,
  stableEventId,
  uuidFromSeed,
};
