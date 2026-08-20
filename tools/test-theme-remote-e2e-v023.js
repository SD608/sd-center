"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const assert = require("node:assert/strict");
const { fileURLToPath } = require("node:url");

const repoRoot = path.resolve(__dirname, "..");
const patchPath = path.join(repoRoot, "tools", "patch-center-ui-v020.js");
const CATALOG_URL = "https://raw.githubusercontent.com/SD608/sd-center/theme-catalog/themes/catalog.json";
const THEME_ID = "e2e-validation";
const V1_MANIFEST_URL = "https://raw.githubusercontent.com/SD608/sd-center/theme-catalog/themes/assets/e2e-validation/v1/manifest.json";
const V1_MANIFEST_SHA = "7d6a51c74e64592b394ebd2ff658e3ce78e32381f39f6c6695128796f6163606";

function extractGzipSource(patchText, key) {
  const re = new RegExp(`"${key}":"([A-Za-z0-9+/=]+)"`);
  const match = patchText.match(re);
  if (!match) throw new Error(`v0.20 embedded source not found: ${key}`);
  return zlib.gunzipSync(Buffer.from(match[1], "base64")).toString("utf8");
}

async function main() {
  const patchText = fs.readFileSync(patchPath, "utf8");
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sd-theme-remote-e2e-"));
  const moduleRoot = path.join(workRoot, "src");
  const dataRoot = path.join(workRoot, "data");
  fs.mkdirSync(moduleRoot, { recursive: true });
  fs.writeFileSync(path.join(moduleRoot, "theme-catalog.js"), extractGzipSource(patchText, "themeCatalog"), "utf8");
  fs.writeFileSync(path.join(moduleRoot, "theme-assets.js"), extractGzipSource(patchText, "themeAssets"), "utf8");

  const { createThemeCatalogService } = require(path.join(moduleRoot, "theme-catalog.js"));
  const { createThemeAssetService } = require(path.join(moduleRoot, "theme-assets.js"));

  const originalFetch = global.fetch;
  try {
    const catalogService = createThemeCatalogService({ dataRoot, catalogUrl: CATALOG_URL, ttlMs: 0 });
    const catalog = await catalogService.getCatalog({ force: true });
    assert.equal(catalog.ok, true);
    assert.equal(catalog.source, "remote");
    const remoteV2 = (catalog.themes || []).find((theme) => theme.id === THEME_ID);
    assert.ok(remoteV2, "remote catalog에서 E2E 검증 테마를 찾지 못했습니다.");
    assert.equal(remoteV2.version, "2");
    assert.match(remoteV2.manifestSha256, /^[0-9a-f]{64}$/);
    console.log("PASS catalog discovery: remote v2");

    const assetService = createThemeAssetService({ dataRoot, fetchImpl: originalFetch, timeoutMs: 15000 });
    const remoteV1 = {
      ...remoteV2,
      version: "1",
      manifestUrl: V1_MANIFEST_URL,
      manifestSha256: V1_MANIFEST_SHA,
    };
    const installedV1 = await assetService.installTheme(remoteV1);
    assert.equal(installedV1.ok, true);
    assert.equal(installedV1.theme.version, "1");
    assert.equal(installedV1.theme.assetState.installed, true);
    console.log("PASS remote v1 manifest/assets download + SHA verify + atomic install");

    const updateState = await assetService.getThemeState(remoteV2, { verifyHashes: true });
    assert.equal(updateState.installed, true);
    assert.equal(updateState.installedVersion, "1");
    assert.equal(updateState.updateAvailable, true);
    console.log("PASS remote update detection: installed v1 -> catalog v2");

    const installedV2 = await assetService.installTheme(remoteV2);
    assert.equal(installedV2.ok, true);
    assert.equal(installedV2.theme.version, "2");
    const postUpdate = await assetService.getThemeState(remoteV2, { verifyHashes: true });
    assert.equal(postUpdate.updateAvailable, false);
    console.log("PASS remote v2 update + SHA verify + active swap");

    global.fetch = async () => { throw new Error("offline-e2e"); };
    const offlineAssetService = createThemeAssetService({
      dataRoot,
      fetchImpl: async () => { throw new Error("offline-e2e"); },
      timeoutMs: 1000,
    });
    const offlineInstalled = await offlineAssetService.getInstalledTheme(THEME_ID);
    assert.equal(offlineInstalled.ok, true);
    assert.equal(offlineInstalled.theme.version, "2");
    console.log("PASS relaunch/offline installed-theme persistence");

    const offlineCatalogService = createThemeCatalogService({ dataRoot, catalogUrl: CATALOG_URL, ttlMs: 0 });
    const cachedCatalog = await offlineCatalogService.getCatalog({ force: true });
    assert.equal(cachedCatalog.ok, true);
    assert.equal(cachedCatalog.source, "cache");
    assert.ok((cachedCatalog.themes || []).some((theme) => theme.id === THEME_ID));
    console.log("PASS offline catalog cache fallback");

    global.fetch = originalFetch;
    const healthy = await assetService.getInstalledTheme(THEME_ID);
    assert.equal(healthy.ok, true);
    const homePath = fileURLToPath(healthy.theme.assetState.assets.home);
    fs.writeFileSync(homePath, Buffer.from("intentional-corruption"));
    const corrupt = await assetService.getThemeState(remoteV2, { verifyHashes: true });
    assert.equal(corrupt.installed, false);
    assert.equal(corrupt.corrupt, true);
    console.log("PASS corruption detection");

    const repaired = await assetService.installTheme(remoteV2);
    assert.equal(repaired.ok, true);
    const repairedState = await assetService.getThemeState(remoteV2, { verifyHashes: true });
    assert.equal(repairedState.installed, true);
    assert.equal(repairedState.corrupt, false);
    console.log("PASS remote repair download");

    await assert.rejects(
      () => assetService.installTheme({ ...remoteV2, manifestSha256: "0".repeat(64) }),
      /SHA-256/,
    );
    const preserved = await assetService.getInstalledTheme(THEME_ID);
    assert.equal(preserved.ok, true);
    assert.equal(preserved.theme.version, "2");
    console.log("PASS failed-update preservation");

    console.log("REMOTE THEME PACKAGE V1 E2E PASS");
  } finally {
    global.fetch = originalFetch;
    try { fs.rmSync(workRoot, { recursive: true, force: true }); } catch {}
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
