from pathlib import Path
import json
import sys

root = Path(sys.argv[1])
main = root / "main.js"
pkg_path = root / "package.json"

text = main.read_text(encoding="utf-8")
old = 'const { isSdCenterUrl, openSdCenter } = require("../../shared/open-center");'
new = 'const { isSdCenterUrl, openSdCenter } = require("./src/open-center");'
if old not in text:
    raise SystemExit("open-center require marker missing")
text = text.replace(old, new, 1)
main.write_text(text, encoding="utf-8")

pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
pkg["version"] = "1.1.1"
pkg["description"] = "SD지갑 연동 주사위 홀짝 시뮬레이션 · 종합센터 실행 모듈 자체 포함"
pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

module = r'''"use strict";

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
'''
(root / "src" / "open-center.js").write_text(module, encoding="utf-8")

sd_app = root / "sd-app.json"
if sd_app.exists():
    data = json.loads(sd_app.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data["version"] = "1.1.1"
        sd_app.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print("SDOddEven v1.1.1 patch applied")
