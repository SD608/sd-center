"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MAX_SESSION_FILE_BYTES = 64 * 1024;

function normalizeSession(session) {
  if (!session || typeof session !== "object") return null;
  const accessToken = String(session.access_token || "");
  const refreshToken = String(session.refresh_token || "");
  if (!accessToken || !refreshToken) return null;
  if (accessToken.length > 16384 || refreshToken.length > 16384) return null;
  return {
    version: 1,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: Math.max(0, Math.min(Number(session.expires_in) || 0, 86400 * 30))
  };
}

class EncryptedSessionStore {
  constructor(filePath, { isEncryptionAvailable, encryptString, decryptString } = {}) {
    this.filePath = filePath;
    this.isEncryptionAvailable = isEncryptionAvailable;
    this.encryptString = encryptString;
    this.decryptString = decryptString;
  }

  _available() {
    try {
      return typeof this.isEncryptionAvailable === "function" &&
        this.isEncryptionAvailable() === true &&
        typeof this.encryptString === "function" &&
        typeof this.decryptString === "function";
    } catch {
      return false;
    }
  }

  save(session) {
    const normalized = normalizeSession(session);
    if (!normalized) {
      this.clear();
      return false;
    }
    if (!this._available()) return false;

    const encrypted = this.encryptString(JSON.stringify(normalized));
    if (!Buffer.isBuffer(encrypted) || encrypted.length < 1 || encrypted.length > MAX_SESSION_FILE_BYTES) {
      throw new Error("INVALID_ENCRYPTED_SESSION");
    }

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      fs.writeFileSync(tempPath, encrypted, { mode: 0o600 });
      fs.renameSync(tempPath, this.filePath);
    } finally {
      try { fs.rmSync(tempPath, { force: true }); } catch {}
    }
    return true;
  }

  load() {
    if (!fs.existsSync(this.filePath) || !this._available()) return null;
    try {
      const stat = fs.statSync(this.filePath);
      if (!stat.isFile() || stat.size < 1 || stat.size > MAX_SESSION_FILE_BYTES) {
        this.clear();
        return null;
      }
      const encrypted = fs.readFileSync(this.filePath);
      const decrypted = this.decryptString(encrypted);
      const parsed = JSON.parse(String(decrypted || ""));
      const normalized = normalizeSession(parsed);
      if (!normalized) {
        this.clear();
        return null;
      }
      return normalized;
    } catch {
      this.clear();
      return null;
    }
  }

  clear() {
    try { fs.rmSync(this.filePath, { force: true }); } catch {}
  }
}

module.exports = { EncryptedSessionStore, normalizeSession, MAX_SESSION_FILE_BYTES };
