"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SUPABASE_URL = "https://qmatphbjzafdtlyviqoa.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_H2qTl_30-7hPUYFhJ_N_QA_X71xZswO";

const REQUEST_TIMEOUT_MS = 15_000;
const REFRESH_MARGIN_MS = 120_000;

function userMessage(error, fallback) {
  const raw = String(
    error?.error_description || error?.msg || error?.message || error?.code || fallback,
  );
  const lower = raw.toLowerCase();
  if (lower.includes("invalid login credentials") || lower.includes("invalid_grant")) {
    return "홈페이지 이메일 또는 비밀번호가 올바르지 않습니다.";
  }
  if (lower.includes("email not confirmed")) {
    return "홈페이지에서 이메일 인증을 먼저 완료하세요.";
  }
  if (lower.includes("jwt expired")) {
    return "온라인 로그인이 만료되었습니다. 다시 로그인하세요.";
  }
  return raw || fallback;
}

class AuthService {
  constructor(userDataDirectory, safeStorage) {
    this.safeStorage = safeStorage;
    this.directory = path.join(userDataDirectory, "sdlink");
    this.filePath = path.join(this.directory, "online-session.dat");
    this.session = null;
    fs.mkdirSync(this.directory, { recursive: true });
    this.session = this.loadSession();
  }

  canEncrypt() {
    return Boolean(
      this.safeStorage &&
        typeof this.safeStorage.isEncryptionAvailable === "function" &&
        this.safeStorage.isEncryptionAvailable(),
    );
  }

  loadSession() {
    if (!this.canEncrypt() || !fs.existsSync(this.filePath)) {
      return null;
    }
    try {
      const encrypted = Buffer.from(fs.readFileSync(this.filePath, "utf8"), "base64");
      const decoded = this.safeStorage.decryptString(encrypted);
      const parsed = JSON.parse(decoded);
      if (!parsed?.accessToken || !parsed?.refreshToken || !parsed?.user?.id) {
        throw new Error("invalid session");
      }
      return parsed;
    } catch {
      this.clearPersisted();
      return null;
    }
  }

  persist() {
    if (!this.session?.remember || !this.canEncrypt()) {
      this.clearPersisted();
      return false;
    }
    const encrypted = this.safeStorage.encryptString(JSON.stringify(this.session));
    fs.writeFileSync(this.filePath, encrypted.toString("base64"), {
      encoding: "utf8",
      mode: 0o600,
    });
    return true;
  }

  clearPersisted() {
    try {
      fs.rmSync(this.filePath, { force: true });
    } catch {
      // 로컬 로그아웃은 계속 진행합니다.
    }
  }

  async requestJson(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const text = await response.text();
      let body = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
      if (!response.ok) {
        const error = new Error(userMessage(body, `서버 요청 실패 (${response.status})`));
        error.statusCode = response.status;
        error.details = body;
        throw error;
      }
      return body;
    } catch (error) {
      if (error?.name === "AbortError") {
        const timeoutError = new Error("온라인 서버 응답이 늦습니다. 인터넷 연결을 확인하세요.");
        timeoutError.statusCode = 504;
        throw timeoutError;
      }
      if (error?.statusCode) {
        throw error;
      }
      const networkError = new Error("온라인 서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.");
      networkError.statusCode = 502;
      throw networkError;
    } finally {
      clearTimeout(timeout);
    }
  }

  mapSession(data, email, remember) {
    if (!data?.access_token || !data?.refresh_token || !data?.user?.id) {
      throw new Error("온라인 로그인 응답이 올바르지 않습니다.");
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Number(data.expires_at || 0) * 1000 ||
        Date.now() + Number(data.expires_in || 3600) * 1000,
      user: data.user,
      email: String(email || data.user.email || ""),
      remember: Boolean(remember),
    };
  }

  async grant(grantType, body) {
    return this.requestJson(
      `${SUPABASE_URL}/auth/v1/token?grant_type=${encodeURIComponent(grantType)}`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          apikey: SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
  }

  async signIn(email, password, remember = true) {
    const data = await this.grant("password", { email, password });
    this.session = this.mapSession(data, email, remember);
    this.persist();
    return this.publicSession();
  }

  async refresh() {
    if (!this.session?.refreshToken) {
      throw Object.assign(new Error("온라인 로그인이 필요합니다."), { statusCode: 401 });
    }
    try {
      const data = await this.grant("refresh_token", {
        refresh_token: this.session.refreshToken,
      });
      this.session = this.mapSession(data, this.session.email, this.session.remember);
      this.persist();
      return this.session;
    } catch (error) {
      this.session = null;
      this.clearPersisted();
      throw Object.assign(new Error("온라인 로그인이 만료되었습니다. 다시 로그인하세요."), {
        statusCode: 401,
        cause: error,
      });
    }
  }

  async requireSession(forceRefresh = false) {
    if (!this.session) {
      this.session = this.loadSession();
    }
    if (!this.session) {
      throw Object.assign(new Error("온라인 로그인이 필요합니다."), { statusCode: 401 });
    }
    if (forceRefresh || this.session.expiresAt <= Date.now() + REFRESH_MARGIN_MS) {
      await this.refresh();
    }
    return this.session;
  }

  publicSession() {
    if (!this.session) {
      return { authenticated: false };
    }
    return {
      authenticated: true,
      user: { id: this.session.user.id, email: this.session.email },
      remembered: Boolean(this.session.remember && this.canEncrypt()),
    };
  }

  async signOut() {
    const previous = this.session;
    this.session = null;
    this.clearPersisted();
    if (!previous) return;
    try {
      await this.requestJson(`${SUPABASE_URL}/auth/v1/logout`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${previous.accessToken}`,
        },
      });
    } catch {
      // 원격 로그아웃 실패와 관계없이 로컬 세션은 제거합니다.
    }
  }

  async rest(route, options = {}, retried = false) {
    const session = await this.requireSession(false);
    try {
      return await this.requestJson(`${SUPABASE_URL}/rest/v1/${route}`, {
        method: options.method || "GET",
        headers: {
          Accept: "application/json",
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json",
          Prefer: options.prefer || "return=representation",
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      if (error.statusCode === 401 && !retried) {
        await this.requireSession(true);
        return this.rest(route, options, true);
      }
      throw error;
    }
  }

  rpc(name, body = {}) {
    return this.rest(`rpc/${name}`, { method: "POST", body });
  }
}

module.exports = { AuthService, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY };
