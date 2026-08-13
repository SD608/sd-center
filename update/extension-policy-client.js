"use strict";

const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");

const POLICY_URL = "https://sd608.github.io/sd-center/update/desktop-policy.json";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function versionParts(value) {
  return String(value || "0").replace(/^v/i, "").split(".").map((part) => {
    const match = String(part).match(/^\d+/);
    return match ? Number(match[0]) : 0;
  });
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

function requestJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        "Cache-Control": "no-cache",
        "User-Agent": "SD608-Economy-Guard",
      },
    }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        requestJson(new URL(response.headers.location, url).toString(), timeoutMs).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`업데이트 정책 서버 응답 ${response.statusCode || "?"}`));
        return;
      }
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
        if (body.length > 256 * 1024) request.destroy(new Error("업데이트 정책 파일이 너무 큽니다."));
      });
      response.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error("업데이트 정책 파일 형식이 올바르지 않습니다.")); }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("업데이트 정책 확인 시간이 초과되었습니다.")));
    request.on("error", reject);
  });
}

function cachePath(userDataPath) {
  return path.join(userDataPath, "economy-policy-cache.json");
}

function readFreshCache(userDataPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath(userDataPath), "utf8"));
    const checkedAt = Date.parse(String(parsed.checkedAt || ""));
    if (!Number.isFinite(checkedAt) || Date.now() - checkedAt > CACHE_MAX_AGE_MS) return null;
    return parsed.policy || null;
  } catch { return null; }
}

function writeCache(userDataPath, policy) {
  try {
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(cachePath(userDataPath), JSON.stringify({ checkedAt: new Date().toISOString(), policy }, null, 2), "utf8");
  } catch {}
}

async function checkRequiredUpdate({ appId, currentVersion, userDataPath }) {
  let policy = null;
  let source = "network";
  try {
    policy = await requestJson(`${POLICY_URL}?t=${Date.now()}`);
    writeCache(userDataPath, policy);
  } catch (error) {
    policy = readFreshCache(userDataPath);
    source = "cache";
    if (!policy) {
      return {
        ok: false,
        reason: "policy-unavailable",
        message: `필수 업데이트 확인에 실패했습니다. 인터넷 연결 후 다시 실행하세요.\n${error.message}`,
      };
    }
  }

  const rule = policy?.apps?.[appId];
  if (!rule) {
    return {
      ok: false,
      reason: "policy-missing",
      message: "이 앱의 필수 업데이트 정책을 확인하지 못했습니다. 잠시 후 다시 실행하세요.",
    };
  }

  const minVersion = String(rule.minVersion || "0.0.0");
  if (rule.required !== false && compareVersions(currentVersion, minVersion) < 0) {
    return {
      ok: false,
      reason: "update-required",
      minVersion,
      downloadUrl: String(rule.downloadUrl || "https://sd608.github.io/sd-center/"),
      message: String(rule.message || `필수 밸런스 업데이트 v${minVersion} 이상이 필요합니다.`),
    };
  }

  return { ok: true, source, minVersion };
}

module.exports = { checkRequiredUpdate, compareVersions };
