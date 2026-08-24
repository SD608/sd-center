"use strict";

const fs = require("node:fs");
const path = require("node:path");

const EXPECTED_VERSION = "1.4.1";
const EXPECTED_SHA256 = "032d7e9fec32d99f9ae13a568baa1d1d80c5fb713392bdd103ccbd3ce9f59707";
const BUNDLE_FILE = `SDLink_v${EXPECTED_VERSION}_Desktop.zip`;

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`Patch anchor is not unique: ${label}`);
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

function patchMain(mainPath) {
  let source = fs.readFileSync(mainPath, "utf8");
  if (source.includes("CH3_FINAL_BUNDLED_SDLINK_VERSION")) {
    throw new Error("Bundled SD Link patch already applied.");
  }

  const functionAnchor = `  function sdLinkStartupRegistration() {`;
  const bootstrap = `  const CH3_FINAL_BUNDLED_SDLINK_VERSION = "${EXPECTED_VERSION}";\n` +
`  const CH3_FINAL_BUNDLED_SDLINK_SHA256 = "${EXPECTED_SHA256}";\n` +
`  const CH3_FINAL_BUNDLED_SDLINK_FILE = "${BUNDLE_FILE}";\n\n` +
`  function ensureBundledIntegratedSdLink() {\n` +
`    const existing = appById.get(SD_LINK_ID);\n` +
`    if (existing) {\n` +
`      return { ok: true, installed: false, existing: true, version: rawEntryVersion(existing) };\n` +
`    }\n\n` +
`    const bundlePath = path.join(__dirname, "bundled", CH3_FINAL_BUNDLED_SDLINK_FILE);\n` +
`    if (!fs.existsSync(bundlePath)) {\n` +
`      throw new Error("필수 내장 SD Link 패키지를 찾지 못했습니다.");\n` +
`    }\n` +
`    const actualSha256 = extensionZipSha256(bundlePath);\n` +
`    if (actualSha256 !== CH3_FINAL_BUNDLED_SDLINK_SHA256) {\n` +
`      throw new Error("필수 내장 SD Link 패키지 무결성 검증에 실패했습니다.");\n` +
`    }\n\n` +
`    const inspected = inspectZip(bundlePath);\n` +
`    if (inspected.metadata.id !== SD_LINK_ID) {\n` +
`      throw new Error("필수 내장 SD Link 패키지 ID가 올바르지 않습니다.");\n` +
`    }\n` +
`    if (compareVersions(inspected.metadata.rawVersion, CH3_FINAL_BUNDLED_SDLINK_VERSION) !== 0) {\n` +
`      throw new Error("필수 내장 SD Link 패키지 버전이 올바르지 않습니다.");\n` +
`    }\n\n` +
`    const destinationDirectory = path.join(INSTALLED_APPS_ROOT, SD_LINK_ID);\n` +
`    installInspectedZip(inspected, destinationDirectory);\n` +
`    const packagePath = archiveAppZip(bundlePath, SD_LINK_ID);\n` +
`    const removedExisting = removedById.get(SD_LINK_ID) || null;\n` +
`    const now = new Date().toISOString();\n` +
`    const appEntry = {\n` +
`      ...inspected.metadata,\n` +
`      directory: destinationDirectory,\n` +
`      packagePath,\n` +
`      importedAt: removedExisting?.importedAt || now,\n` +
`      updatedAt: now,\n` +
`      integratedService: true,\n` +
`    };\n` +
`    registry = upsertCustomApp(registry, appEntry);\n` +
`    saveRegistry(REGISTRY_PATH, registry);\n` +
`    reloadCatalog();\n` +
`    const installed = appById.get(SD_LINK_ID);\n` +
`    if (!installed) {\n` +
`      throw new Error("내장 SD Link 등록을 완료하지 못했습니다.");\n` +
`    }\n` +
`    return { ok: true, installed: true, existing: false, version: rawEntryVersion(installed) };\n` +
`  }\n\n` + functionAnchor;
  source = replaceOnce(source, functionAnchor, bootstrap, "SD Link startup function");

  const readyAnchor = `  app.whenReady().then(() => {\n    app.setAppUserModelId("com.sdcenter.desktop");\n    configureCenterAutoUpdater();\n    configureSdLinkWindowsAutoStart();`;
  const readyReplacement = `  app.whenReady().then(() => {\n    app.setAppUserModelId("com.sdcenter.desktop");\n    configureCenterAutoUpdater();\n    try {\n      ensureBundledIntegratedSdLink();\n    } catch (error) {\n      console.error("필수 내장 SD Link 초기화 실패", error?.message || error);\n      dialog.showErrorBox(\n        "SD Link 구성 오류",\n        "필수 내장 SD Link를 준비하지 못했습니다. 설치 파일을 다시 받아 재설치해 주세요.",\n      );\n      app.quit();\n      return;\n    }\n    configureSdLinkWindowsAutoStart();`;
  source = replaceOnce(source, readyAnchor, readyReplacement, "app ready bootstrap");

  fs.writeFileSync(mainPath, source, "utf8");
}

function main() {
  const appRoot = path.resolve(process.argv[2] || "");
  if (!appRoot) throw new Error("Usage: node patch-ch3-final-sdlink-bundle.js <appRoot>");
  const mainPath = path.join(appRoot, "main.js");
  if (!fs.existsSync(mainPath)) throw new Error(`Missing main.js: ${mainPath}`);
  patchMain(mainPath);
  console.log(`PASS patched clean-install bundled SD Link bootstrap v${EXPECTED_VERSION}`);
}

if (require.main === module) main();

module.exports = { EXPECTED_VERSION, EXPECTED_SHA256, BUNDLE_FILE, patchMain };
