"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-center-ui-v022-sdlink-hardening.js <app-root>");
const file = (rel) => path.join(root, rel);
const read = (rel) => fs.readFileSync(file(rel), "utf8").replace(/\r\n/g, "\n");
const write = (rel, value) => { fs.mkdirSync(path.dirname(file(rel)), { recursive: true }); fs.writeFileSync(file(rel), value, "utf8"); };
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
function rep(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`v0.22 marker missing: ${label}`);
  return source.replace(from, () => to);
}
function replaceBetween(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`v0.22 function marker missing: ${label}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

const repoRoot = path.resolve(__dirname, "..");
for (const [srcRel, destRel] of [
  ["preview/v022/sdlink-integration.js", "src/sdlink-integration.js"],
  ["preview/v022/test-sdlink-hardening-v022.js", "tools/test-sdlink-hardening-v022.js"],
]) {
  const src = path.join(repoRoot, srcRel);
  if (!fs.existsSync(src)) throw new Error(`v0.22 asset missing: ${srcRel}`);
  fs.mkdirSync(path.dirname(file(destRel)), { recursive: true });
  fs.copyFileSync(src, file(destRel));
}

let main = read("main.js");
const expectedV021 = "5e47e76e0aabdb7dd2ab7cfc8e1853ccbe310955a37c9d25f52bbfecc40e790f";
if (sha256(main) !== expectedV021 && !main.includes("UI Preview v0.22: SD Link hardening")) {
  for (const marker of ["launchIntegratedSdLinkService", "center:get-sdlink-state", "systemService: entry.id === SD_LINK_ID"]) {
    if (!main.includes(marker)) throw new Error(`v0.22 requires v0.21 base: ${marker}`);
  }
}

main = rep(main,
  "  let sdLinkStateTimer = null;\n  const runningApps = new Map();",
  "  let sdLinkStateTimer = null;\n  let sdLinkRestartTimer = null;\n  let sdLinkStableTimer = null;\n  let sdLinkRestartAttempt = 0;\n  let sdLinkSuppressRestart = false;\n  let sdLinkLegacyConflict = null;\n  const runningApps = new Map();",
  "recovery state",
);
main = rep(main,
  "  function getAllAppStates() {\n    return appCatalog.map(publicAppState);\n  }",
  "  function getAllAppStates() {\n    // UI Preview v0.22: SD Link hardening — 시스템 서비스는 일반 앱 목록에 노출하지 않습니다.\n    return appCatalog.filter((entry) => entry.id !== SD_LINK_ID).map(publicAppState);\n  }",
  "hide system service from apps",
);
main = rep(main,
  "  function getRemovedAppStates() {\n    return removedCatalog.map(publicRemovedAppState);\n  }",
  "  function getRemovedAppStates() {\n    return removedCatalog.filter((entry) => entry.id !== SD_LINK_ID).map(publicRemovedAppState);\n  }",
  "hide system service from removed apps",
);
main = rep(main,
  "        .filter(([, rule]) => rule?.version && rule?.downloadUrl)",
  "        .filter(([id, rule]) => id !== SD_LINK_ID && rule?.version && rule?.downloadUrl)",
  "hide system service from store",
);
main = rep(main,
  "    const targets = appCatalog.filter(\n      (entry) => updateAvailabilityFor(entry).updateAvailable,\n    );",
  "    const targets = appCatalog.filter(\n      (entry) => entry.id !== SD_LINK_ID && updateAvailabilityFor(entry).updateAvailable,\n    );",
  "hide service from bulk updates",
);
main = rep(main,
  "        const available = appCatalog\n          .filter((entry) => updateAvailabilityFor(entry).updateAvailable)",
  "        const available = appCatalog\n          .filter((entry) => entry.id !== SD_LINK_ID && updateAvailabilityFor(entry).updateAvailable)",
  "hide service from update count",
);
main = rep(main,
  "      installed: Boolean(entry),\n      running: Boolean(child && child.exitCode === null),\n    });",
  "      installed: Boolean(entry),\n      running: Boolean(child && child.exitCode === null),\n      legacyConflict: sdLinkLegacyConflict,\n    });",
  "state conflict",
);

const recoveryHelpers = `  function clearSdLinkRecoveryTimers() {\n    clearTimeout(sdLinkRestartTimer);\n    clearTimeout(sdLinkStableTimer);\n    sdLinkRestartTimer = null;\n    sdLinkStableTimer = null;\n  }\n\n  function scheduleSdLinkRestart(reason = "unexpected-exit") {\n    if (isQuitting || sdLinkSuppressRestart || sdLinkRestartTimer) return;\n    const delays = [3_000, 10_000, 30_000];\n    const delay = delays[Math.min(sdLinkRestartAttempt, delays.length - 1)];\n    sdLinkRestartAttempt = Math.min(sdLinkRestartAttempt + 1, delays.length - 1);\n    console.warn(\`SD Link 자동 복구 예약: \${reason} · \${delay}ms\`);\n    sdLinkRestartTimer = setTimeout(() => {\n      sdLinkRestartTimer = null;\n      void launchIntegratedSdLinkService({ recovery: true });\n    }, delay);\n  }\n\n  function detectLegacyStandaloneSdLink() {\n    if (process.platform !== "win32") return Promise.resolve(null);\n    return new Promise((resolve) => {\n      const currentPid = Number(process.pid);\n      const script = [\n        "$ErrorActionPreference='SilentlyContinue'",\n        \`$currentPid=\${currentPid}\`,\n        "$p=Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $currentPid -and (($_.Name -match '^(SD ?Link|sdlink-desktop)\\\\.exe$') -or (($_.Name -ieq 'SDCenter.exe') -and ($_.CommandLine -match '--sd-child-app=sdlink-desktop'))) } | Select-Object -First 1 ProcessId,Name,ExecutablePath,CommandLine",\n        "if($p){ $p | ConvertTo-Json -Compress }",\n      ].join("; ");\n      let output = "";\n      let settled = false;\n      let child;\n      const finish = (value) => { if (!settled) { settled = true; resolve(value); } };\n      try {\n        child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });\n        child.stdout?.on("data", (chunk) => { output += String(chunk || ""); });\n        child.once("error", () => finish(null));\n        child.once("close", () => {\n          try {\n            const parsed = output.trim() ? JSON.parse(output.trim()) : null;\n            finish(parsed && parsed.ProcessId ? { pid: Number(parsed.ProcessId), name: String(parsed.Name || "SD Link") } : null);\n          } catch { finish(null); }\n        });\n        setTimeout(() => { try { child?.kill(); } catch {} finish(null); }, 2_500);\n      } catch { finish(null); }\n    });\n  }\n\n`;
main = rep(main, "  function childLaunchArgs(id, extraArgs = []) {", recoveryHelpers + "  function childLaunchArgs(id, extraArgs = []) {", "recovery helpers");

main = rep(main,
`    runningApps.set(entry.id, child);\n    sendAppStates();\n    if (entry.id === SD_LINK_ID) sendSdLinkIntegrationState();\n\n    child.once("exit", () => {\n      if (runningApps.get(entry.id) === child) {\n        runningApps.delete(entry.id);\n        sendAppStates();\n        if (entry.id === SD_LINK_ID) sendSdLinkIntegrationState();\n      }\n    });\n\n    child.once("error", () => {\n      if (runningApps.get(entry.id) === child) {\n        runningApps.delete(entry.id);\n        sendAppStates();\n        if (entry.id === SD_LINK_ID) sendSdLinkIntegrationState();\n      }\n    });`,
`    runningApps.set(entry.id, child);\n    sendAppStates();\n    if (entry.id === SD_LINK_ID) {\n      sdLinkLegacyConflict = null;\n      clearTimeout(sdLinkStableTimer);\n      sdLinkStableTimer = setTimeout(() => {\n        if (runningApps.get(SD_LINK_ID) === child && child.exitCode === null) sdLinkRestartAttempt = 0;\n      }, 60_000);\n      sendSdLinkIntegrationState();\n    }\n\n    child.once("exit", () => {\n      if (runningApps.get(entry.id) === child) {\n        runningApps.delete(entry.id);\n        sendAppStates();\n        if (entry.id === SD_LINK_ID) {\n          clearTimeout(sdLinkStableTimer);\n          sdLinkStableTimer = null;\n          sendSdLinkIntegrationState();\n          scheduleSdLinkRestart("process-exit");\n        }\n      }\n    });\n\n    child.once("error", () => {\n      if (runningApps.get(entry.id) === child) {\n        runningApps.delete(entry.id);\n        sendAppStates();\n        if (entry.id === SD_LINK_ID) {\n          clearTimeout(sdLinkStableTimer);\n          sdLinkStableTimer = null;\n          sendSdLinkIntegrationState();\n          scheduleSdLinkRestart("process-error");\n        }\n      }\n    });`,
  "crash recovery handlers",
);

const terminateFn = `  async function terminateAppAndWait(id) {\n    const suppressRestart = id === SD_LINK_ID;\n    if (suppressRestart) {\n      sdLinkSuppressRestart = true;\n      clearSdLinkRecoveryTimers();\n    }\n    try {\n      const child = runningApps.get(id);\n      if (!child || child.exitCode !== null) {\n        runningApps.delete(id);\n        sendAppStates();\n        return;\n      }\n      const exited = await forceKillChildTree(child);\n      if (!exited && child.exitCode === null) {\n        throw new Error("실행 중인 앱 프로세스를 완전히 종료하지 못했습니다. 앱을 닫은 뒤 다시 업데이트해 주세요.");\n      }\n      runningApps.delete(id);\n      sendAppStates();\n      await updateDelay(350);\n    } finally {\n      if (suppressRestart && !isQuitting) sdLinkSuppressRestart = false;\n    }\n  }\n\n`;
main = replaceBetween(main, "  async function terminateAppAndWait(id) {", "  function terminateAllApps()", terminateFn, "terminateAppAndWait");

const launchFn = `  async function launchIntegratedSdLinkService({ recovery = false } = {}) {\n    const entry = appById.get(SD_LINK_ID);\n    if (!entry || isQuitting) return { ok: false, installed: Boolean(entry) };\n    const running = runningApps.get(entry.id);\n    if (running && running.exitCode === null) return { ok: true, alreadyRunning: true };\n    sdLinkSuppressRestart = false;\n    const conflict = await detectLegacyStandaloneSdLink();\n    if (conflict) {\n      sdLinkLegacyConflict = conflict;\n      sendSdLinkIntegrationState();\n      scheduleSdLinkRestart("legacy-conflict");\n      return { ok: false, conflict: true, error: "기존 SD Link 프로세스가 실행 중이라 내장 SD Link 시작을 보류했습니다." };\n    }\n    sdLinkLegacyConflict = null;\n    try {\n      ensureIntegratedSdLinkUserData({ appDataRoot: APP_DATA_ROOT, centerDataRoot: CENTER_DATA_ROOT, entry });\n      spawnChild(entry, { track: true, extraArgs: ["--sd-link-auto-start"] });\n      if (!recovery) sdLinkRestartAttempt = 0;\n      return { ok: true, alreadyRunning: false };\n    } catch (error) {\n      console.warn("SD Link 통합 서비스 자동 시작 실패", error?.message || error);\n      sendSdLinkIntegrationState();\n      scheduleSdLinkRestart("launch-failure");\n      return { ok: false, error: error?.message || String(error) };\n    }\n  }\n\n`;
main = replaceBetween(main, "  function launchIntegratedSdLinkService() {", "  function launchSdLinkForWindowsLogin()", launchFn, "launchIntegratedSdLinkService");

main = rep(main,
  "    spawnChild(entry, { track: true });\n    return { ok: true, managerOpened: true, alreadyRunning: false };",
  "    const started = await launchIntegratedSdLinkService();\n    if (!started?.ok) return started;\n    setTimeout(() => {\n      try { spawnChild(entry, { track: false, extraArgs: [\"--sd-link-open-manager\"] }); } catch {}\n    }, 450);\n    return { ok: true, managerOpened: true, alreadyRunning: false };",
  "manager conflict guard",
);

for (const [signature, message] of [
  ["  async function deleteApp(id) {", "SD Link는 종합센터 내부 시스템 서비스라 제거할 수 없습니다."],
  ["  async function restoreRemovedApp(id) {", "SD Link는 삭제된 앱 보관함에서 관리하지 않습니다."],
  ["  async function permanentlyDeleteRemovedApp(id) {", "SD Link 시스템 데이터는 보관함 영구 삭제 대상이 아닙니다."],
]) {
  main = rep(main, signature, `${signature}\n    if (id === SD_LINK_ID) return { ok: false, protected: true, error: ${JSON.stringify(message)} };`, `guard ${signature}`);
}
main = rep(main,
  "  app.on(\"before-quit\", () => {\n    isQuitting = true;\n    clearInterval(sdLinkStateTimer);\n    globalShortcut.unregisterAll();\n  });",
  "  app.on(\"before-quit\", () => {\n    isQuitting = true;\n    sdLinkSuppressRestart = true;\n    clearInterval(sdLinkStateTimer);\n    clearSdLinkRecoveryTimers();\n    globalShortcut.unregisterAll();\n  });",
  "quit recovery cleanup",
);
write("main.js", main);

let html = read("public/index.html");
html = html.replace("<span>UI Preview v0.21</span>", "<span>UI Preview v0.22</span>\n        <!-- UI Preview v0.20 theme-engine compatibility marker -->");
write("public/index.html", html);
let renderer = read("public/js/ui-preview.js").replaceAll("UI Preview v0.21", "UI Preview v0.22");
write("public/js/ui-preview.js", renderer);
let css = read("public/css/ui-preview.css");
if (!css.includes("UI Preview v0.22: SD Link 상태 정확도")) css += `\n\n/* UI Preview v0.22: SD Link 상태 정확도 */\n.preview-sdlink-status[data-phase="sync-checking"] .preview-sdlink-dot,.preview-sdlink-status[data-phase="paused"] .preview-sdlink-dot,.preview-sdlink-status[data-phase="sync-stale"] .preview-sdlink-dot{background:#e5bd69;box-shadow:0 0 0 3px rgba(229,189,105,.1)}\n.preview-sdlink-status[data-phase="sync-error"] .preview-sdlink-dot,.preview-sdlink-status[data-phase="legacy-conflict"] .preview-sdlink-dot{background:#e07b7b;box-shadow:0 0 0 3px rgba(224,123,123,.1)}\n`;
write("public/css/ui-preview.css", css);
write("UI_PREVIEW.txt", "SD종합센터 UI Preview\nBase: v2.2.7\nPreview: UI Remake v0.22\nSD Link native integration hardening: hidden system service, crash recovery, deletion guard, legacy conflict guard, sync health state.\nOfficial update metadata is NOT changed.\n");
console.log("v0.22 SD Link hardening applied");
