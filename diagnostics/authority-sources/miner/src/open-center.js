"use strict";

const { spawn } = require("node:child_process");

const CENTER_PROTOCOLS = new Set(["sd-center:", "sdcenter:"]);

function isSdCenterUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const raw = value.trim();
  try {
    const target = new URL(raw);
    return CENTER_PROTOCOLS.has(target.protocol.toLowerCase());
  } catch {
    const lower = raw.toLowerCase();
    return lower.startsWith("sd-center:") || lower.startsWith("sdcenter:");
  }
}

function openSdCenter(app) {
  try {
    const child = spawn(process.execPath, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();

    if (app && typeof app.quit === "function") {
      setTimeout(() => app.quit(), 120);
    }
    return true;
  } catch (error) {
    console.warn("SD종합센터 열기 실패", error?.message || error);
    return false;
  }
}

module.exports = { isSdCenterUrl, openSdCenter };
