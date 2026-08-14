"use strict";

const fs = require("node:fs");

const target = process.argv[2];
if (!target) throw new Error("Usage: node patch-main.js <main.js>");

let text = fs.readFileSync(target, "utf8");

function replaceOne(oldText, newText, label) {
  if (text.includes(newText)) return;
  if (!text.includes(oldText)) {
    throw new Error(`Patch target missing: ${label}`);
  }
  text = text.replace(oldText, newText);
}

replaceOne(
  '    minVersion: "1.0.7",\n',
  '    minVersion: "1.0.9",\n',
  "logistics fallback version",
);
replaceOne(
  '      "물류회사 경제 밸런스/버전 증명 패치가 필수입니다. v1.0.7 이상으로 업데이트해야 실행할 수 있습니다.",',
  '      "물류회사 진행도 1회 초기화/랭크 밸런스 패치가 필수입니다. v1.0.9 이상으로 업데이트해야 실행할 수 있습니다.",',
  "logistics fallback message",
);

replaceOne(
  'const REQUIRED_POLICY_TTL_MS = 5 * 60 * 1000;\n',
  `const REQUIRED_POLICY_TTL_MS = 5 * 60 * 1000;\nconst EXTENSION_CATALOG_URL =\n  "https://sd608.github.io/sd-center/update/extensions-catalog.json";\nconst EXTENSION_CATALOG_TTL_MS = 5 * 60 * 1000;\nconst FALLBACK_EXTENSION_CATALOG = {\n  apps: {\n    "sdlink-desktop": {\n      name: "SD Link",\n      version: "1.2.4",\n      downloadUrl:\n        "https://sd608.github.io/sd-center/downloads/extensions/SDLink_v1.2.4_Desktop.zip",\n      notes: "SD Link 안정화 및 센터 버전 증명",\n    },\n    "sd-logistics-center-desktop": {\n      name: "SD 물류센터",\n      version: "1.0.9",\n      downloadUrl:\n        "https://sd608.github.io/sd-center/downloads/extensions/SDLogisticsCenter_Season0_Desktop.zip?v=109",\n      notes: "회사 랭크·차량 해금 밸런스 및 진행도 1회 초기화",\n    },\n    "sd-slot": {\n      name: "SD슬롯",\n      version: "1.0.6",\n      downloadUrl:\n        "https://sd608.github.io/sd-center/downloads/extensions/SDSlot_Stage7_Desktop.zip",\n      notes: "SD지갑 연동 슬롯 확장팩",\n    },\n    "sd-mukjippa": {\n      name: "SD묵찌빠",\n      version: "1.0.1",\n      downloadUrl:\n        "https://sd608.github.io/sd-center/downloads/extensions/SDMukjippa_Version1_1_Desktop.zip",\n      notes: "SD지갑 연동 묵찌빠 확장팩",\n    },\n    "sta-expansion": {\n      name: "STA",\n      version: "1.5.1",\n      downloadUrl:\n        "https://sd608.github.io/sd-center/downloads/extensions/STA_Version6_Desktop.zip?v=151",\n      notes: "현금 획득 종료 후 다음 단계 전환 버그 수정",\n    },\n  },\n};\n`,
  "extension catalog constants",
);

replaceOne(
  'let requiredPolicyPromise = null;\n',
  `let requiredPolicyPromise = null;\nlet extensionCatalog = { ...FALLBACK_EXTENSION_CATALOG };\nlet extensionCatalogFetchedAt = 0;\nlet extensionCatalogPromise = null;\n`,
  "extension catalog state",
);

replaceOne(
  '  async function refreshRequiredPolicy({ force = false } = {}) {\n',
  `  function catalogRuleFor(entry) {\n    const rule = extensionCatalog?.apps?.[entry?.id];\n    if (!rule || !rule.version || !rule.downloadUrl) {\n      return null;\n    }\n    return rule;\n  }\n\n  function updateAvailabilityFor(entry) {\n    const rule = catalogRuleFor(entry);\n    if (!rule) {\n      return {\n        updateAvailable: false,\n        latestVersion: "",\n        updateNotes: "",\n      };\n    }\n\n    const latestVersion = String(rule.version || "0.0.0");\n    const currentVersion = rawEntryVersion(entry);\n\n    return {\n      updateAvailable:\n        compareVersions(currentVersion, latestVersion) < 0,\n      latestVersion,\n      updateNotes: String(rule.notes || ""),\n    };\n  }\n\n  async function refreshRequiredPolicy({ force = false } = {}) {\n`,
  "catalog availability helpers",
);

replaceOne(
  '  async function installRequiredUpdate(entry, rule) {\n',
  `  async function refreshExtensionCatalog({ force = false } = {}) {\n    if (\n      !force &&\n      extensionCatalogFetchedAt > 0 &&\n      Date.now() - extensionCatalogFetchedAt < EXTENSION_CATALOG_TTL_MS\n    ) {\n      return extensionCatalog;\n    }\n\n    if (extensionCatalogPromise) {\n      return extensionCatalogPromise;\n    }\n\n    extensionCatalogPromise = (async () => {\n      try {\n        const response = await fetch(EXTENSION_CATALOG_URL, {\n          cache: "no-store",\n          headers: { Accept: "application/json" },\n        });\n        if (!response.ok) {\n          throw new Error(\`확장팩 카탈로그 HTTP \${response.status}\`);\n        }\n        const remote = await response.json();\n        if (!remote || typeof remote !== "object" || !remote.apps) {\n          throw new Error("확장팩 카탈로그 형식이 올바르지 않습니다.");\n        }\n        extensionCatalog = {\n          ...remote,\n          apps: {\n            ...(FALLBACK_EXTENSION_CATALOG.apps || {}),\n            ...(remote.apps || {}),\n          },\n        };\n      } catch (error) {\n        extensionCatalog = {\n          ...extensionCatalog,\n          apps: {\n            ...(FALLBACK_EXTENSION_CATALOG.apps || {}),\n            ...(extensionCatalog?.apps || {}),\n          },\n        };\n        console.warn(\n          "확장팩 업데이트 카탈로그를 불러오지 못해 내장 목록을 사용합니다.",\n          error?.message || error,\n        );\n      } finally {\n        extensionCatalogFetchedAt = Date.now();\n        extensionCatalogPromise = null;\n      }\n      return extensionCatalog;\n    })();\n\n    return extensionCatalogPromise;\n  }\n\n  async function installRequiredUpdate(entry, rule) {\n`,
  "catalog refresh function",
);

replaceOne(
  '  async function ensureRequiredVersion(entry) {\n',
  `  async function installCatalogUpdate(entry, rule) {\n    const downloadUrl = String(rule.downloadUrl || "").trim();\n    const latestVersion = String(rule.version || "0.0.0");\n    if (!downloadUrl) {\n      throw new Error("업데이트 다운로드 주소가 없습니다.");\n    }\n\n    ensureManagedDirectory(APP_PACKAGES_ROOT);\n    const temporaryZipPath = path.join(\n      APP_PACKAGES_ROOT,\n      \`.catalog-\${entry.id}-\${Date.now()}.zip\`,\n    );\n\n    try {\n      await downloadFile(downloadUrl, temporaryZipPath);\n      const inspected = inspectZip(temporaryZipPath);\n\n      if (inspected.metadata.id !== entry.id) {\n        throw new Error(\n          \`업데이트 앱 ID가 다릅니다. (\${inspected.metadata.id})\`,\n        );\n      }\n\n      if (\n        compareVersions(inspected.metadata.rawVersion, latestVersion) < 0\n      ) {\n        throw new Error(\n          \`다운로드된 버전(v\${inspected.metadata.rawVersion})이 최신 버전(v\${latestVersion})보다 낮습니다.\`,\n        );\n      }\n\n      await terminateAppAndWait(entry.id);\n      const destinationDirectory = path.join(\n        INSTALLED_APPS_ROOT,\n        inspected.metadata.id,\n      );\n      installInspectedZip(inspected, destinationDirectory);\n      const packagePath = archiveAppZip(\n        temporaryZipPath,\n        inspected.metadata.id,\n      );\n      const appEntry = {\n        ...inspected.metadata,\n        directory: destinationDirectory,\n        packagePath,\n        importedAt: entry.importedAt || new Date().toISOString(),\n        updatedAt: new Date().toISOString(),\n      };\n\n      registry = upsertCustomApp(registry, appEntry);\n      saveRegistry(REGISTRY_PATH, registry);\n      refreshCatalogAndUi();\n      return appById.get(appEntry.id);\n    } finally {\n      fs.rmSync(temporaryZipPath, { force: true });\n    }\n  }\n\n  async function updateAppFromCatalog(id) {\n    const entry = appById.get(id);\n    if (!entry) {\n      return { ok: false, error: "등록되지 않은 앱입니다." };\n    }\n\n    await refreshExtensionCatalog();\n    const rule = catalogRuleFor(entry);\n    if (!rule) {\n      return {\n        ok: false,\n        error: "이 앱은 종합센터 자동 업데이트 목록에 없습니다.",\n      };\n    }\n\n    const availability = updateAvailabilityFor(entry);\n    if (!availability.updateAvailable) {\n      return {\n        ok: true,\n        alreadyLatest: true,\n        app: publicAppState(entry),\n      };\n    }\n\n    const confirmation = await dialog.showMessageBox(mainWindow, {\n      type: "question",\n      title: "확장팩 업데이트",\n      message: \`\${entry.name}을 v\${availability.latestVersion}으로 업데이트할까요?\`,\n      detail: \`현재 버전: v\${rawEntryVersion(entry)}\\n최신 버전: v\${availability.latestVersion}\\n\\n\${availability.updateNotes || "최신 확장팩 파일로 교체합니다."}\\n\\n앱 파일만 교체하며 저장 데이터는 유지합니다.\`,\n      buttons: ["취소", "업데이트"],\n      defaultId: 1,\n      cancelId: 0,\n      noLink: true,\n    });\n\n    if (confirmation.response !== 1) {\n      return { ok: false, canceled: true };\n    }\n\n    try {\n      const updatedEntry = await installCatalogUpdate(entry, rule);\n      await dialog.showMessageBox(mainWindow, {\n        type: "info",\n        title: "업데이트 완료",\n        message: \`\${entry.name} 업데이트가 완료되었습니다.\`,\n        detail: \`v\${rawEntryVersion(updatedEntry)} 버전으로 교체했습니다. 기존 저장 데이터는 유지됩니다.\`,\n        buttons: ["확인"],\n        defaultId: 0,\n        noLink: true,\n      });\n      return {\n        ok: true,\n        updated: true,\n        app: publicAppState(updatedEntry),\n      };\n    } catch (error) {\n      await dialog.showMessageBox(mainWindow, {\n        type: "error",\n        title: "업데이트 실패",\n        message: \`\${entry.name}을 업데이트하지 못했습니다.\`,\n        detail: error.message,\n        buttons: ["확인"],\n        defaultId: 0,\n        noLink: true,\n      });\n      return { ok: false, error: error.message };\n    }\n  }\n\n  async function updateAllAvailableApps() {\n    await refreshExtensionCatalog({ force: true });\n    const targets = appCatalog.filter(\n      (entry) => updateAvailabilityFor(entry).updateAvailable,\n    );\n\n    if (targets.length === 0) {\n      sendAppStates();\n      return { ok: true, count: 0, updatedCount: 0, results: [] };\n    }\n\n    const confirmation = await dialog.showMessageBox(mainWindow, {\n      type: "question",\n      title: "확장팩 모두 업데이트",\n      message: \`업데이트 가능한 확장팩 \${targets.length}개를 모두 업데이트할까요?\`,\n      detail: targets\n        .map((entry) => {\n          const availability = updateAvailabilityFor(entry);\n          return \`• \${entry.name}: v\${rawEntryVersion(entry)} → v\${availability.latestVersion}\`;\n        })\n        .join("\\n"),\n      buttons: ["취소", "모두 업데이트"],\n      defaultId: 1,\n      cancelId: 0,\n      noLink: true,\n    });\n\n    if (confirmation.response !== 1) {\n      return { ok: false, canceled: true };\n    }\n\n    const results = [];\n    for (const originalEntry of targets) {\n      const entry = appById.get(originalEntry.id) || originalEntry;\n      const rule = catalogRuleFor(entry);\n      try {\n        const updatedEntry = await installCatalogUpdate(entry, rule);\n        results.push({\n          id: entry.id,\n          name: entry.name,\n          ok: true,\n          version: rawEntryVersion(updatedEntry),\n        });\n      } catch (error) {\n        results.push({\n          id: entry.id,\n          name: entry.name,\n          ok: false,\n          error: error.message,\n        });\n      }\n    }\n\n    const updatedCount = results.filter((result) => result.ok).length;\n    const failed = results.filter((result) => !result.ok);\n    refreshCatalogAndUi();\n\n    await dialog.showMessageBox(mainWindow, {\n      type: failed.length ? "warning" : "info",\n      title: "확장팩 업데이트 결과",\n      message: failed.length\n        ? \`\${updatedCount}개 업데이트 완료 · \${failed.length}개 실패\`\n        : \`확장팩 \${updatedCount}개 업데이트를 완료했습니다.\`,\n      detail: failed.length\n        ? failed.map((result) => \`• \${result.name}: \${result.error}\`).join("\\n")\n        : "기존 저장 데이터는 유지됩니다.",\n      buttons: ["확인"],\n      defaultId: 0,\n      noLink: true,\n    });\n\n    return {\n      ok: failed.length === 0,\n      count: targets.length,\n      updatedCount,\n      failedCount: failed.length,\n      results,\n    };\n  }\n\n  async function ensureRequiredVersion(entry) {\n`,
  "catalog update installers",
);

replaceOne(
  '      ...updateRequirementFor(entry),\n',
  '      ...updateRequirementFor(entry),\n      ...updateAvailabilityFor(entry),\n',
  "public app update availability",
);

replaceOne(
  '    ipcMain.handle("center:add-app-zip", addAppFromZip);\n',
  `    ipcMain.handle("center:add-app-zip", addAppFromZip);\n    ipcMain.handle("center:check-app-updates", async () => {\n      try {\n        await refreshExtensionCatalog({ force: true });\n        sendAppStates();\n        const available = appCatalog\n          .filter((entry) => updateAvailabilityFor(entry).updateAvailable)\n          .map((entry) => ({\n            id: entry.id,\n            name: entry.name,\n            currentVersion: rawEntryVersion(entry),\n            latestVersion: updateAvailabilityFor(entry).latestVersion,\n          }));\n        return { ok: true, count: available.length, apps: available };\n      } catch (error) {\n        return { ok: false, error: error.message };\n      }\n    });\n    ipcMain.handle("center:update-app", (event, id) =>\n      updateAppFromCatalog(id),\n    );\n    ipcMain.handle("center:update-all-apps", () =>\n      updateAllAvailableApps(),\n    );\n`,
  "update IPC handlers",
);

replaceOne(
  '    void refreshRequiredPolicy({ force: true }).then(() => {\n      sendAppStates();\n    });\n',
  `    void Promise.all([\n      refreshRequiredPolicy({ force: true }),\n      refreshExtensionCatalog({ force: true }),\n    ]).then(() => {\n      sendAppStates();\n    });\n`,
  "startup catalog refresh",
);

if (!text.includes('ipcMain.handle("center:update-app"')) {
  throw new Error("Update IPC verification failed");
}
if (!text.includes("EXTENSION_CATALOG_URL")) {
  throw new Error("Catalog URL verification failed");
}
if (!text.includes('minVersion: "1.0.9"')) {
  throw new Error("Logistics fallback verification failed");
}

fs.writeFileSync(target, text, "utf8");
console.log("Patched main.js with v2.1.3 extension auto-updater");
