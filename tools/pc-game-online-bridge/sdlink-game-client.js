"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const BRIDGE_FILE = "game-bridge.json";
const REQUEST_TIMEOUT_MS = 12_000;

function uniquePaths(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!value) continue;
    const resolved = path.resolve(String(value));
    const key = resolved.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(resolved);
  }
  return result;
}

function bridgeFiles() {
  return uniquePaths(
    [process.env.APPDATA, process.env.LOCALAPPDATA]
      .filter(Boolean)
      .map((root) => path.join(root, "SD608", "integration", BRIDGE_FILE)),
  );
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readBridgeConfig() {
  let newest = null;
  for (const filePath of bridgeFiles()) {
    if (!fs.existsSync(filePath)) continue;
    const value = readJson(filePath);
    if (!value || typeof value !== "object") continue;
    const host = String(value.host || "");
    const port = Math.trunc(Number(value.port || 0));
    const token = String(value.token || "");
    if (host !== "127.0.0.1" || port < 1 || port > 65535 || token.length < 32) continue;
    const timestamp = Date.parse(value.updatedAt || "") || fs.statSync(filePath).mtimeMs || 0;
    if (!newest || timestamp > newest.timestamp) {
      newest = { ...value, host, port, token, timestamp, filePath };
    }
  }
  return newest;
}

function bridgeError(message, code = "SD_LINK_REQUIRED") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requestJson(config, method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ method, params: params || {} });
    const request = http.request({
      hostname: config.host,
      port: config.port,
      path: "/rpc",
      method: "POST",
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "X-SDLink-Game-Token": config.token,
        "Cache-Control": "no-store",
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        let payload = null;
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        } catch {
          return reject(bridgeError("SD Link 게임 브리지 응답 형식이 올바르지 않습니다.", "BAD_BRIDGE_RESPONSE"));
        }
        if (response.statusCode < 200 || response.statusCode >= 300 || payload?.ok !== true) {
          return reject(bridgeError(
            String(payload?.error || `SD Link 게임 브리지 요청 실패 (${response.statusCode})`),
            response.statusCode === 401 ? "SD_LINK_LOGIN_REQUIRED" : "BRIDGE_RPC_FAILED",
          ));
        }
        resolve(payload.data);
      });
    });

    request.on("timeout", () => request.destroy(bridgeError("SD Link 응답이 늦습니다. SD Link 상태를 확인하세요.", "BRIDGE_TIMEOUT")));
    request.on("error", (error) => {
      if (error?.code === "SD_LINK_REQUIRED" || error?.code === "SD_LINK_LOGIN_REQUIRED" || error?.code === "BRIDGE_RPC_FAILED" || error?.code === "BRIDGE_TIMEOUT") {
        reject(error);
        return;
      }
      reject(bridgeError(
        "SD Link v1.4.0을 실행하고 SD Online 로그인 상태인지 확인하세요.",
        "SD_LINK_REQUIRED",
      ));
    });
    request.end(body);
  });
}

function normalizeTransaction(item) {
  return {
    id: String(item?.id || ""),
    type: item?.type === "withdraw" ? "withdraw" : "deposit",
    memo: String(item?.memo || item?.description || "거래"),
    amount: Math.max(0, Math.trunc(Number(item?.amount || 0))),
    createdAt: String(item?.createdAt || item?.created_at || new Date().toISOString()),
  };
}

function accountFromState(state) {
  return {
    id: "sd-online",
    bankName: "SD Online",
    accountNumber: String(state?.account_number || "ONLINE"),
    ownerName: String(state?.email || "SD Online 계정"),
    balance: Math.trunc(Number(state?.balance || 0)),
    updatedAt: String(state?.updated_at || new Date().toISOString()),
  };
}

function transactionsFromState(state) {
  return Array.isArray(state?.transactions)
    ? state.transactions.map(normalizeTransaction)
    : [];
}

class SdLinkGameClient {
  uuid() {
    return crypto.randomUUID();
  }

  config() {
    const config = readBridgeConfig();
    if (!config) {
      throw bridgeError(
        "SD Link v1.4.0을 실행하고 SD Online 로그인을 완료하세요.",
        "SD_LINK_REQUIRED",
      );
    }
    return config;
  }

  rpc(method, params = {}) {
    return requestJson(this.config(), method, params);
  }

  async state() {
    const state = await this.rpc("get_sd_online_game_state", {});
    return {
      ...state,
      account: accountFromState(state),
      normalizedTransactions: transactionsFromState(state),
    };
  }
}

module.exports = {
  SdLinkGameClient,
  accountFromState,
  transactionsFromState,
};
