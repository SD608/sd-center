"use strict";
const fs=require("node:fs");
const path=require("node:path");
const root=process.argv[2];
if(!root)throw new Error("Usage: node patch <app-root>");
const file=(rel)=>path.join(root,rel);
const read=(rel)=>fs.readFileSync(file(rel),"utf8").replace(/\r\n/g,"\n");
const write=(rel,content)=>{fs.mkdirSync(path.dirname(file(rel)),{recursive:true});fs.writeFileSync(file(rel),content,"utf8");};
function replaceOnce(source,needle,replacement,label){const i=source.indexOf(needle);if(i<0)throw new Error(`v0.21 marker missing: ${label}`);return source.slice(0,i)+replacement+source.slice(i+needle.length);}

const repoRoot=path.resolve(__dirname,"..");
for(const [name,rel] of [["sdlink-integration.js","src/sdlink-integration.js"],["test-sdlink-integration-v021.js","tools/test-sdlink-integration-v021.js"]]){const src=path.join(repoRoot,"preview","v021",name);if(!fs.existsSync(src))throw new Error(`v0.21 asset missing: ${src}`);fs.mkdirSync(path.dirname(file(rel)),{recursive:true});fs.copyFileSync(src,file(rel));}

let main = read("main.js");
main = replaceOnce(
  main,
  `const {\n  compareVersions,\n  downloadFile,\n  fetchRequiredPolicy,\n} = require("./src/required-updates");`,
  `const {\n  compareVersions,\n  downloadFile,\n  fetchRequiredPolicy,\n} = require("./src/required-updates");\n\nconst {\n  SD_LINK_ID,\n  ensureIntegratedSdLinkUserData,\n  integratedSdLinkUserDataPath,\n  integrationState: readSdLinkIntegrationState,\n} = require("./src/sdlink-integration");`,
  "sdlink integration import",
);
main = replaceOnce(
  main,
  `  app.setName(entry.productName || entry.name);\n  app.setPath(\n    "userData",\n    path.join(APP_DATA_ROOT, entry.userDataFolder),\n  );\n  app.setAppUserModelId(\`com.sdcenter.\${entry.id}\`);`,
  `  app.setName(entry.productName || entry.name);\n  if (entry.id === SD_LINK_ID) {\n    // v0.21: SD Link의 계정/기기/세션/동기화 상태를 종합센터 데이터 영역에 귀속합니다.\n    // 프로그램 업데이트가 app-* 폴더를 교체해도 이 경로는 유지됩니다.\n    ensureIntegratedSdLinkUserData({\n      appDataRoot: APP_DATA_ROOT,\n      centerDataRoot: CENTER_DATA_ROOT,\n      entry,\n    });\n    app.setPath("userData", integratedSdLinkUserDataPath(CENTER_DATA_ROOT));\n    process.env.SD_CENTER_LINK_INTEGRATED = "1";\n  } else {\n    app.setPath(\n      "userData",\n      path.join(APP_DATA_ROOT, entry.userDataFolder),\n    );\n  }\n  app.setAppUserModelId(\`com.sdcenter.\${entry.id}\`);\n\n  if (entry.id === SD_LINK_ID) {\n    // 같은 통합 userData 경로를 단일 인스턴스 키로 사용합니다.\n    // 두 번째 실행은 동기화 엔진을 만들지 않고 기존 관리 창만 표시합니다.\n    const linkInstanceLock = app.requestSingleInstanceLock();\n    if (!linkInstanceLock) {\n      app.quit();\n      return;\n    }\n    app.on("second-instance", (_event, argv) => {\n      if (!Array.isArray(argv) || !argv.includes("--sd-link-open-manager")) return;\n      const showManager = () => {\n        for (const window of BrowserWindow.getAllWindows()) {\n          if (!window || window.isDestroyed()) continue;\n          if (window.isMinimized()) window.restore();\n          window.show();\n          window.focus();\n        }\n      };\n      if (app.isReady()) showManager();\n      else app.whenReady().then(showManager).catch(() => {});\n    });\n  }`,
  "integrated link userData",
);
main = replaceOnce(
  main,
  `  let tray = null;\n  let isQuitting = false;\n  const runningApps = new Map();`,
  `  let tray = null;\n  let isQuitting = false;\n  let sdLinkStateTimer = null;\n  const runningApps = new Map();`,
  "sdlink state timer",
);
main = replaceOnce(
  main,
  `      sourceZipName: entry.sourceZipName || "",\n      running: Boolean(child && child.exitCode === null),`,
  `      sourceZipName: entry.sourceZipName || "",\n      systemService: entry.id === SD_LINK_ID,\n      running: Boolean(child && child.exitCode === null),`,
  "system service app state",
);
main = replaceOnce(
  main,
  `  function showCenter() {`,
  `  function getSdLinkIntegrationState() {\n    const entry = appById.get(SD_LINK_ID);\n    const child = runningApps.get(SD_LINK_ID);\n    return readSdLinkIntegrationState({\n      centerDataRoot: CENTER_DATA_ROOT,\n      installed: Boolean(entry),\n      running: Boolean(child && child.exitCode === null),\n    });\n  }\n\n  function sendSdLinkIntegrationState() {\n    const state = getSdLinkIntegrationState();\n    if (mainWindow && !mainWindow.isDestroyed()) {\n      mainWindow.webContents.send("center:sdlink-state", state);\n    }\n    return state;\n  }\n\n  function startSdLinkStateMonitor() {\n    clearInterval(sdLinkStateTimer);\n    sdLinkStateTimer = setInterval(sendSdLinkIntegrationState, 5_000);\n    setTimeout(sendSdLinkIntegrationState, 500);\n  }\n\n  function showCenter() {`,
  "sdlink state publisher",
);
main = replaceOnce(
  main,
  `    runningApps.set(entry.id, child);\n    sendAppStates();`,
  `    runningApps.set(entry.id, child);\n    sendAppStates();\n    if (entry.id === SD_LINK_ID) sendSdLinkIntegrationState();`,
  "sdlink spawn state",
);
main = replaceOnce(
  main,
  `        runningApps.delete(entry.id);\n        sendAppStates();\n      }\n    });\n\n    child.once("error", () => {\n      if (runningApps.get(entry.id) === child) {\n        runningApps.delete(entry.id);\n        sendAppStates();\n      }\n    });`,
  `        runningApps.delete(entry.id);\n        sendAppStates();\n        if (entry.id === SD_LINK_ID) sendSdLinkIntegrationState();\n      }\n    });\n\n    child.once("error", () => {\n      if (runningApps.get(entry.id) === child) {\n        runningApps.delete(entry.id);\n        sendAppStates();\n        if (entry.id === SD_LINK_ID) sendSdLinkIntegrationState();\n      }\n    });`,
  "sdlink exit state",
);
main = replaceOnce(
  main,
  `  async function launchApp(id) {`,
  `  async function openIntegratedSdLinkManager(entry = appById.get(SD_LINK_ID)) {\n    if (!entry) return { ok: false, error: "SD Link가 설치되어 있지 않습니다." };\n\n    const running = runningApps.get(SD_LINK_ID);\n    if (running && running.exitCode === null) {\n      // 단일 인스턴스 잠금을 이용해 숨김 서비스의 기존 창만 표시합니다.\n      // 동기화 중인 프로세스를 강제 종료하지 않으므로 거래 중단 위험을 만들지 않습니다.\n      spawnChild(entry, {\n        track: false,\n        extraArgs: ["--sd-link-open-manager"],\n      });\n      return { ok: true, managerOpened: true, alreadyRunning: true };\n    }\n    spawnChild(entry, { track: true });\n    return { ok: true, managerOpened: true, alreadyRunning: false };\n  }\n\n  async function launchApp(id) {`,
  "open integrated manager",
);
main = replaceOnce(
  main,
  `    if (running && running.exitCode === null) {\n      spawnChild(entry, { track: false });\n      return {\n        ok: true,\n        alreadyRunning: true,\n        mandatoryUpdated: Boolean(requiredCheck.mandatoryUpdated),\n      };\n    }`,
  `    if (running && running.exitCode === null) {\n      if (id === SD_LINK_ID) {\n        const opened = await openIntegratedSdLinkManager(entry);\n        return {\n          ...opened,\n          alreadyRunning: true,\n          mandatoryUpdated: Boolean(requiredCheck.mandatoryUpdated),\n        };\n      }\n      spawnChild(entry, { track: false });\n      return {\n        ok: true,\n        alreadyRunning: true,\n        mandatoryUpdated: Boolean(requiredCheck.mandatoryUpdated),\n      };\n    }`,
  "single sdlink manager process",
);
main = replaceOnce(
  main,
  `  function terminateApp(id) {\n    const child = runningApps.get(id);`,
  `  function terminateApp(id) {\n    if (id === SD_LINK_ID && !isQuitting) {\n      return {\n        ok: false,\n        protected: true,\n        error: "SD Link는 종합센터 시스템 서비스입니다. 종합센터 완전 종료 시 함께 종료됩니다.",\n      };\n    }\n    const child = runningApps.get(id);`,
  "protect sdlink service",
);
main = replaceOnce(
  main,
  `  function terminateAllApps() {\n    for (const entry of appCatalog) {\n      terminateApp(entry.id);\n    }\n  }`,
  `  function terminateAllApps() {\n    for (const entry of appCatalog) {\n      if (entry.id === SD_LINK_ID) continue;\n      terminateApp(entry.id);\n    }\n  }`,
  "skip link in terminate all",
);
main = replaceOnce(
  main,
  `  function launchSdLinkForWindowsLogin() {\n    if (!autoStartLinkMode) return;\n\n    const entry = appById.get("sdlink-desktop");\n    if (!entry) {\n      isQuitting = true;\n      app.quit();\n      return;\n    }\n\n    const running = runningApps.get(entry.id);\n    if (running && running.exitCode === null) return;\n\n    try {\n      spawnChild(entry, {\n        track: true,\n        extraArgs: ["--sd-link-auto-start"],\n      });\n    } catch (error) {\n      console.warn(\n        "Windows 로그인 시 SD Link 자동 실행 실패",\n        error?.message || error,\n      );\n    }\n  }`,
  `  function launchIntegratedSdLinkService() {\n    const entry = appById.get(SD_LINK_ID);\n    if (!entry || isQuitting) return { ok: false, installed: Boolean(entry) };\n\n    const running = runningApps.get(entry.id);\n    if (running && running.exitCode === null) {\n      return { ok: true, alreadyRunning: true };\n    }\n\n    try {\n      ensureIntegratedSdLinkUserData({\n        appDataRoot: APP_DATA_ROOT,\n        centerDataRoot: CENTER_DATA_ROOT,\n        entry,\n      });\n      spawnChild(entry, {\n        track: true,\n        extraArgs: ["--sd-link-auto-start"],\n      });\n      return { ok: true, alreadyRunning: false };\n    } catch (error) {\n      console.warn("SD Link 통합 서비스 자동 시작 실패", error?.message || error);\n      sendSdLinkIntegrationState();\n      return { ok: false, error: error?.message || String(error) };\n    }\n  }\n\n  function launchSdLinkForWindowsLogin() {\n    if (!autoStartLinkMode) return;\n    return launchIntegratedSdLinkService();\n  }`,
  "integrated link autostart",
);
main = replaceOnce(
  main,
  `  function refreshCatalogAndUi() {\n    reloadCatalog();\n    configureSdLinkWindowsAutoStart();\n    updateTrayMenu();\n    sendAppStates();\n  }`,
  `  function refreshCatalogAndUi() {\n    reloadCatalog();\n    configureSdLinkWindowsAutoStart();\n    updateTrayMenu();\n    sendAppStates();\n    sendSdLinkIntegrationState();\n    setTimeout(launchIntegratedSdLinkService, 150);\n  }`,
  "refresh starts system service",
);
main = replaceOnce(
  main,
  `    ipcMain.handle("center:get-center-info", () => ({\n      name: "SD종합센터",\n      version: app.getVersion(),\n    }));`,
  `    ipcMain.handle("center:get-center-info", () => ({\n      name: "SD종합센터",\n      version: app.getVersion(),\n    }));\n    ipcMain.handle("center:get-sdlink-state", () => getSdLinkIntegrationState());\n    ipcMain.handle("center:open-sdlink-manager", async () => {\n      const entry = appById.get(SD_LINK_ID);\n      if (!entry) return { ok: false, error: "SD Link가 설치되어 있지 않습니다." };\n      const requiredCheck = await ensureRequiredVersion(entry);\n      if (!requiredCheck.ok) return requiredCheck;\n      return openIntegratedSdLinkManager(requiredCheck.entry || appById.get(SD_LINK_ID) || entry);\n    });\n    ipcMain.handle("center:start-sdlink-service", () => launchIntegratedSdLinkService());`,
  "sdlink integration ipc",
);
main = replaceOnce(
  main,
  `      for (const entry of appCatalog) {\n        results.push({\n          id: entry.id,\n          ...(await launchApp(entry.id)),\n        });\n      }\n\n      return {\n        ok: results.every((result) => result.ok),\n        count: appCatalog.length,\n        results,\n      };`,
  `      for (const entry of appCatalog) {\n        if (entry.id === SD_LINK_ID) continue;\n        results.push({\n          id: entry.id,\n          ...(await launchApp(entry.id)),\n        });\n      }\n\n      return {\n        ok: results.every((result) => result.ok),\n        count: results.length,\n        results,\n      };`,
  "skip service in launch all",
);
main = replaceOnce(
  main,
  `    registerIpcHandlers();\n    if (autoStartLinkMode) {\n      setTimeout(launchSdLinkForWindowsLogin, 250);\n    }`,
  `    registerIpcHandlers();\n    // v0.21: Windows 로그인뿐 아니라 일반 실행·센터 업데이트 후 재실행에서도\n    // SD Link를 숨김 시스템 서비스로 항상 복구합니다.\n    setTimeout(launchIntegratedSdLinkService, 250);\n    startSdLinkStateMonitor();`,
  "always start integrated link",
);
main = replaceOnce(
  main,
  `  app.on("second-instance", (_event, argv) => {\n    if (Array.isArray(argv) && argv.includes("--sd-center-auto-link")) {\n      return;\n    }\n    showCenter();\n  });`,
  `  app.on("second-instance", (_event, argv) => {\n    if (Array.isArray(argv) && argv.includes("--sd-center-auto-link")) {\n      launchIntegratedSdLinkService();\n      return;\n    }\n    showCenter();\n  });`,
  "second instance service recovery",
);
main = replaceOnce(
  main,
  `  app.on("before-quit", () => {\n    isQuitting = true;\n    globalShortcut.unregisterAll();\n  });`,
  `  app.on("before-quit", () => {\n    isQuitting = true;\n    clearInterval(sdLinkStateTimer);\n    globalShortcut.unregisterAll();\n  });`,
  "clear sdlink state timer",
);
write("main.js", main);
console.log("v0.21 SD Link main integration applied");
