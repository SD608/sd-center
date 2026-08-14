"use strict";

const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");

const POLICY_URL = "https://sd608.github.io/sd-center/update/desktop-policy.json";

function versionParts(value) {
  return String(value || "0")
    .replace(/^v/i, "")
    .split(".")
    .map((part) => {
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
    if (diff !== 0) {
      return diff < 0 ? -1 : 1;
    }
  }

  return 0;
}

function request(url, { timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const doRequest = (targetUrl) => {
      const req = https.get(
        targetUrl,
        {
          headers: {
            "Cache-Control": "no-cache",
            "User-Agent": "SDCenter-Required-Update/2.1.2",
          },
        },
        (response) => {
          if (
            response.statusCode >= 300 &&
            response.statusCode < 400 &&
            response.headers.location
          ) {
            response.resume();
            doRequest(new URL(response.headers.location, targetUrl).toString());
            return;
          }

          if (response.statusCode !== 200) {
            response.resume();
            reject(
              new Error(
                `업데이트 서버 응답 오류: ${response.statusCode || "?"}`,
              ),
            );
            return;
          }

          resolve(response);
        },
      );

      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error("업데이트 서버 연결 시간이 초과되었습니다."));
      });
      req.on("error", reject);
    };

    doRequest(url);
  });
}

async function fetchRequiredPolicy() {
  const response = await request(`${POLICY_URL}?t=${Date.now()}`);
  let body = "";

  for await (const chunk of response) {
    body += chunk.toString("utf8");
    if (body.length > 256 * 1024) {
      throw new Error("업데이트 정책 파일이 너무 큽니다.");
    }
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error("업데이트 정책 파일을 읽을 수 없습니다.");
  }
}

async function downloadFile(url, destinationPath) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  const temporaryPath = `${destinationPath}.${process.pid}.download`;
  fs.rmSync(temporaryPath, { force: true });

  try {
    const response = await request(url, { timeoutMs: 15000 });
    const output = fs.createWriteStream(temporaryPath, { flags: "wx" });

    await new Promise((resolve, reject) => {
      response.pipe(output);
      response.on("error", reject);
      output.on("error", reject);
      output.on("finish", resolve);
    });

    fs.rmSync(destinationPath, { force: true });
    fs.renameSync(temporaryPath, destinationPath);
    return destinationPath;
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

module.exports = {
  POLICY_URL,
  compareVersions,
  downloadFile,
  fetchRequiredPolicy,
};
