"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-v222-sdlink-autostart.js <app-root>");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
}

function write(rel, content) {
  fs.writeFileSync(path.join(root, rel), content, "utf8");
}

function replaceOnce(source, needle, replacement, label) {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`Patch marker missing: ${label}`);
  return source.slice(0, index) + replacement + source.slice(index + needle.length);
}

const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.version = "2.2.2";
pkg.description = "SD지갑 코어 · 확장팩 상점 · SD Link Windows 자동 시작";
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

let main = read("main.js");

main = replaceOnce(
  main,
  "function runCenterMode() {\n  const singleInstanceLock = app.requestSingleInstanceLock();",
  "function runCenterMode() {\n  const autoStartLinkMode = process.argv.includes(\"--sd-center-auto-link\");\n  const singleInstanceLock = app.requestSingleInstanceLock();",
  "auto-start mode flag",
);

main = replaceOnce(
  main,
  `  function childLaunchArgs(id) {\n    const childArgument = \`--sd-child-app=\${id}\`;\n\n    if (app.isPackaged) {\n      return [childArgument];\n    }\n\n    return [__dirname, childArgument];\n  }`,
  `  function childLaunchArgs(id, extraArgs = []) {\n    const childArgument = \`--sd-child-app=\${id}\`;\n    const normalizedExtraArgs = Array.isArray(extraArgs)\n      ? extraArgs.filter((value) => typeof value === \"string\" && value)\n      : [];\n\n    if (app.isPackaged) {\n      return [childArgument, ...normalizedExtraArgs];\n    }\n\n    return [__dirname, childArgument, ...normalizedExtraArgs];\n  }`,
  "child launch args",
);

main = replaceOnce(
  main,
  "  function spawnChild(entry, { track = true } = {}) {",
  "  function spawnChild(entry, { track = true, extraArgs = [] } = {}) {",
  "spawn child options",
);

main = replaceOnce(
  main,
  "      childLaunchArgs(entry.id),",
  "      childLaunchArgs(entry.id, extraArgs),",
  "spawn child args call",
);

main = replaceOnce(
  main,
  `  function terminateAllApps() {\n    for (const entry of appCatalog) {\n      terminateApp(entry.id);\n    }\n  }\n\n  function updateTrayMenu() {`,
  `  function terminateAllApps() {\n    for (const entry of appCatalog) {\n      terminateApp(entry.id);\n    }\n  }\n\n  function sdLinkStartupRegistration() {\n    if (process.platform !== \"win32\" || !app.isPackaged) return null;\n\n    const startupArgument = \"--sd-center-auto-link\";\n    const squirrelUpdateExe = path.resolve(\n      path.dirname(process.execPath),\n      \"..\",\n      \"Update.exe\",\n    );\n\n    if (fs.existsSync(squirrelUpdateExe)) {\n      return {\n        path: squirrelUpdateExe,\n        args: [\n          \"--processStart\",\n          path.basename(process.execPath),\n          \"--process-start-args\",\n          startupArgument,\n        ],\n      };\n    }\n\n    return {\n      path: process.execPath,\n      args: [startupArgument],\n    };\n  }\n\n  function configureSdLinkWindowsAutoStart() {\n    const registration = sdLinkStartupRegistration();\n    if (!registration) return;\n\n    const enabled = appById.has(\"sdlink-desktop\");\n    try {\n      app.setLoginItemSettings({\n        openAtLogin: enabled,\n        path: registration.path,\n        args: registration.args,\n      });\n      console.log(\n        \`SD Link Windows 자동 시작: \${enabled ? \"ON\" : \"OFF\"}\`,\n      );\n    } catch (error) {\n      console.warn(\n        \"SD Link Windows 자동 시작 등록 실패\",\n        error?.message || error,\n      );\n    }\n  }\n\n  function launchSdLinkForWindowsLogin() {\n    if (!autoStartLinkMode) return;\n\n    const entry = appById.get(\"sdlink-desktop\");\n    if (!entry) {\n      isQuitting = true;\n      app.quit();\n      return;\n    }\n\n    const running = runningApps.get(entry.id);\n    if (running && running.exitCode === null) return;\n\n    try {\n      spawnChild(entry, {\n        track: true,\n        extraArgs: [\"--sd-link-auto-start\"],\n      });\n    } catch (error) {\n      console.warn(\n        \"Windows 로그인 시 SD Link 자동 실행 실패\",\n        error?.message || error,\n      );\n    }\n  }\n\n  function updateTrayMenu() {`,
  "windows auto-start helpers",
);

main = replaceOnce(
  main,
  `  function refreshCatalogAndUi() {\n    reloadCatalog();\n    updateTrayMenu();\n    sendAppStates();\n  }`,
  `  function refreshCatalogAndUi() {\n    reloadCatalog();\n    configureSdLinkWindowsAutoStart();\n    updateTrayMenu();\n    sendAppStates();\n  }`,
  "refresh auto-start registration",
);

main = replaceOnce(
  main,
  `    mainWindow.once(\"ready-to-show\", () => {\n      showCenter();\n      sendAppStates();\n    });`,
  `    mainWindow.once(\"ready-to-show\", () => {\n      if (autoStartLinkMode) {\n        mainWindow.hide();\n      } else {\n        showCenter();\n      }\n      sendAppStates();\n    });`,
  "hidden center login startup",
);

main = replaceOnce(
  main,
  `  app.whenReady().then(() => {\n    app.setAppUserModelId(\"com.sdcenter.desktop\");\n    createMainWindow();\n    createTray();\n    registerIpcHandlers();`,
  `  app.whenReady().then(() => {\n    app.setAppUserModelId(\"com.sdcenter.desktop\");\n    configureSdLinkWindowsAutoStart();\n    createMainWindow();\n    createTray();\n    registerIpcHandlers();\n    if (autoStartLinkMode) {\n      setTimeout(launchSdLinkForWindowsLogin, 250);\n    }`,
  "app ready auto-start",
);

main = replaceOnce(
  main,
  "  app.on(\"second-instance\", showCenter);",
  `  app.on(\"second-instance\", (_event, argv) => {\n    if (Array.isArray(argv) && argv.includes(\"--sd-center-auto-link\")) {\n      return;\n    }\n    showCenter();\n  });`,
  "second instance auto-start guard",
);

// v2.2.2 내장 fallback에도 최신 SD Link를 넣어 네트워크 카탈로그 장애 시 업데이트 경로를 유지합니다.
main = main.replace(
  /("sdlink-desktop"\s*:\s*\{[\s\S]*?version:\s*")1\.2\.4("[\s\S]*?downloadUrl:\s*\n\s*")https:\/\/sd608\.github\.io\/sd-center\/downloads\/extensions\/SDLink_v1\.2\.4_Desktop\.zip("[\s\S]*?notes:\s*")([^\"]*)(")/,
  `$11.2.8$2https://github.com/SD608/sd-center/releases/download/v.2.2.2/SDLink_v1.2.8_Desktop.zip$3Windows 로그인 시 자동으로 백그라운드 실행되도록 개선$5`,
);

write("main.js", main);

const validation = read("main.js");
for (const marker of [
  "--sd-center-auto-link",
  "--sd-link-auto-start",
  "configureSdLinkWindowsAutoStart",
  "launchSdLinkForWindowsLogin",
  "app.setLoginItemSettings",
]) {
  if (!validation.includes(marker)) throw new Error(`v2.2.2 marker missing: ${marker}`);
}

console.log("SDCenter v2.2.2 SD Link Windows auto-start patch applied");
