"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const HOST = "127.0.0.1";
const BRIDGE_FILE = "game-bridge.json";
const SOURCE_VERSION = "1.4.0";
const MAX_BODY_BYTES = 128 * 1024;
const ALLOWED_METHODS = new Set([
  "get_sd_online_game_state",
  "play_sd_slot",
  "start_sd_odd_even",
  "finish_sd_odd_even",
]);
const MUTATING_METHODS = new Set([
  "play_sd_slot",
  "start_sd_odd_even",
  "finish_sd_odd_even",
]);

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

function bridgePaths() {
  return uniquePaths(
    [process.env.APPDATA, process.env.LOCALAPPDATA]
      .filter(Boolean)
      .map((root) => path.join(root, "SD608", "integration", BRIDGE_FILE)),
  );
}

function safeJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function publicError(error) {
  const message = String(error?.message || "온라인 게임 요청에 실패했습니다.");
  return message.length > 300 ? `${message.slice(0, 300)}…` : message;
}

class GameBridgeServer {
  constructor({ authService, onActivity = null } = {}) {
    if (!authService) throw new Error("GameBridgeServer requires authService");
    this.auth = authService;
    this.onActivity = typeof onActivity === "function" ? onActivity : null;
    this.server = null;
    this.port = 0;
    this.token = crypto.randomBytes(32).toString("hex");
    this.files = bridgePaths();
  }

  async start() {
    if (this.server) return this.state();
    this.server = http.createServer((request, response) => {
      void this.handle(request, response);
    });
    this.server.on("clientError", (_error, socket) => {
      try { socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"); } catch {}
    });

    await new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      this.server.once("error", onError);
      this.server.listen(0, HOST, () => {
        this.server.off("error", onError);
        resolve();
      });
    });

    const address = this.server.address();
    this.port = Number(address?.port || 0);
    this.writeState();
    return this.state();
  }

  state() {
    let session = { authenticated: false };
    try { session = this.auth.publicSession?.() || session; } catch {}
    return {
      schemaVersion: 1,
      sourceApp: "sdlink-desktop",
      sourceVersion: SOURCE_VERSION,
      host: HOST,
      port: this.port,
      token: this.token,
      authenticated: Boolean(session?.authenticated),
      userId: session?.authenticated ? String(session?.user?.id || "") : "",
      email: session?.authenticated ? String(session?.user?.email || "") : "",
      updatedAt: new Date().toISOString(),
    };
  }

  writeState() {
    const payload = this.state();
    for (const filePath of this.files) {
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const temp = `${filePath}.${process.pid}.tmp`;
        fs.writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
        fs.renameSync(temp, filePath);
      } catch {
        // 다른 경로가 정상이라면 브리지는 계속 동작합니다.
      }
    }
    return payload;
  }

  refreshState() {
    return this.writeState();
  }

  async stop() {
    const server = this.server;
    this.server = null;
    this.port = 0;
    for (const filePath of this.files) {
      try { fs.rmSync(filePath, { force: true }); } catch {}
    }
    if (!server) return;
    await new Promise((resolve) => server.close(() => resolve()));
  }

  async readBody(request) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      request.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(Object.assign(new Error("요청이 너무 큽니다."), { statusCode: 413 }));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on("end", () => {
        try {
          const text = Buffer.concat(chunks).toString("utf8") || "{}";
          resolve(JSON.parse(text));
        } catch {
          reject(Object.assign(new Error("요청 형식이 올바르지 않습니다."), { statusCode: 400 }));
        }
      });
      request.on("error", reject);
    });
  }

  async handle(request, response) {
    if (request.socket.remoteAddress && ![HOST, "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress)) {
      return safeJson(response, 403, { ok: false, error: "로컬 요청만 허용됩니다." });
    }
    if (request.method !== "POST" || request.url !== "/rpc") {
      return safeJson(response, 404, { ok: false, error: "지원하지 않는 요청입니다." });
    }
    if (String(request.headers["x-sdlink-game-token"] || "") !== this.token) {
      return safeJson(response, 401, { ok: false, error: "SD Link 게임 브리지 인증에 실패했습니다." });
    }

    try {
      const body = await this.readBody(request);
      const method = String(body?.method || "");
      const params = body?.params && typeof body.params === "object" ? body.params : {};
      if (!ALLOWED_METHODS.has(method)) {
        return safeJson(response, 403, { ok: false, error: "허용되지 않은 게임 RPC입니다." });
      }

      const session = this.auth.publicSession?.() || { authenticated: false };
      if (!session.authenticated) {
        this.writeState();
        return safeJson(response, 401, {
          ok: false,
          error: "SD Link에서 SD Online 로그인을 먼저 완료하세요.",
        });
      }

      const data = await this.auth.rpc(method, params);
      let result = data;
      if (method === "get_sd_online_game_state" && result && typeof result === "object" && !Array.isArray(result)) {
        result = {
          ...result,
          email: String(session?.user?.email || ""),
          sdLinkVersion: SOURCE_VERSION,
        };
      }

      this.writeState();
      safeJson(response, 200, { ok: true, data: result });

      if (MUTATING_METHODS.has(method) && this.onActivity) {
        setTimeout(() => {
          try { this.onActivity({ method, data: result }); } catch {}
        }, 50);
      }
    } catch (error) {
      const status = Number(error?.statusCode || 500);
      safeJson(response, status >= 400 && status <= 599 ? status : 500, {
        ok: false,
        error: publicError(error),
      });
    }
  }
}

module.exports = { GameBridgeServer };
