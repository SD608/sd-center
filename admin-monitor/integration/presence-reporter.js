"use strict";

const crypto = require("node:crypto");

const APP_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function normalizeMetadata(value) {
  const metadata = value == null ? {} : value;
  if (!metadata || Array.isArray(metadata) || typeof metadata !== "object") {
    throw new Error("INVALID_METADATA");
  }
  let encoded;
  try {
    encoded = JSON.stringify(metadata);
  } catch {
    throw new Error("INVALID_METADATA");
  }
  if (Buffer.byteLength(encoded, "utf8") > 4096) throw new Error("INVALID_METADATA");
  return metadata;
}

function createSupabaseRpc(client) {
  if (!client || typeof client.rpc !== "function") throw new Error("SUPABASE_CLIENT_REQUIRED");
  return async (name, args) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  };
}

class PresenceReporter {
  constructor({
    rpc,
    appId,
    appName,
    appVersion = null,
    deviceId = null,
    metadata = {},
    instanceId = crypto.randomUUID(),
    intervalMs = 30000,
    onError = null,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval
  }) {
    if (typeof rpc !== "function") throw new Error("RPC_REQUIRED");

    this.appId = String(appId || "").trim().toLowerCase();
    this.appName = String(appName || "").trim();
    this.appVersion = appVersion == null || String(appVersion).trim() === "" ? null : String(appVersion).trim();
    this.deviceId = deviceId || null;
    this.instanceId = String(instanceId || "").trim();
    this.metadata = normalizeMetadata(metadata);

    if (!APP_ID_RE.test(this.appId)) throw new Error("INVALID_APP_ID");
    if (!this.appName || this.appName.length > 80) throw new Error("INVALID_APP_NAME");
    if (this.appVersion && this.appVersion.length > 32) throw new Error("INVALID_APP_VERSION");
    if (!this.instanceId) throw new Error("INVALID_INSTANCE_ID");

    this.rpc = rpc;
    this.intervalMs = Math.max(15000, Number(intervalMs) || 30000);
    this.onError = typeof onError === "function" ? onError : null;
    this._setInterval = setIntervalFn;
    this._clearInterval = clearIntervalFn;
    this.timer = null;
    this.inFlight = null;
    this.running = false;
    this.ended = false;
    this.lastError = null;
    this.lastSuccessAt = null;
  }

  payload() {
    return {
      p_instance_id: this.instanceId,
      p_app_id: this.appId,
      p_app_name: this.appName,
      p_app_version: this.appVersion,
      p_device_id: this.deviceId,
      p_metadata: this.metadata
    };
  }

  updateMetadata(metadata) {
    if (this.ended) throw new Error("REPORTER_ENDED");
    this.metadata = normalizeMetadata(metadata);
  }

  async heartbeat() {
    if (this.ended) throw new Error("REPORTER_ENDED");
    if (this.inFlight) return this.inFlight;

    const request = Promise.resolve()
      .then(() => this.rpc("sd_presence_v1_heartbeat", this.payload()))
      .then((result) => {
        this.lastError = null;
        this.lastSuccessAt = new Date();
        return result;
      })
      .catch((error) => {
        this.lastError = error;
        throw error;
      })
      .finally(() => {
        if (this.inFlight === request) this.inFlight = null;
      });

    this.inFlight = request;
    return request;
  }

  _tick() {
    if (!this.running || this.ended || this.inFlight) return;
    this.heartbeat().catch((error) => {
      try { this.onError?.(error); } catch { /* monitoring callbacks must not kill the app */ }
    });
  }

  async start() {
    if (this.ended) throw new Error("REPORTER_ENDED");
    if (this.running) return;

    this.running = true;
    try {
      await this.heartbeat();
    } catch (error) {
      this.running = false;
      throw error;
    }

    if (!this.running || this.ended) return;
    this.timer = this._setInterval(() => this._tick(), this.intervalMs);
    this.timer?.unref?.();
  }

  async stop() {
    if (this.ended) return null;

    this.running = false;
    if (this.timer) this._clearInterval(this.timer);
    this.timer = null;

    const pending = this.inFlight;
    if (pending) {
      try { await pending; } catch { /* end still needs to be attempted */ }
    }

    if (this.ended) return null;
    try {
      const result = await this.rpc("sd_presence_v1_end", { p_instance_id: this.instanceId });
      this.ended = true;
      return result;
    } catch (error) {
      this.lastError = error;
      try { this.onError?.(error); } catch { /* ignore callback failures */ }
      return null;
    }
  }
}

module.exports = { PresenceReporter, createSupabaseRpc, normalizeMetadata };
