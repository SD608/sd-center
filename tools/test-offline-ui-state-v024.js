"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "js", "app.js"), "utf8");
const preview = fs.readFileSync(path.join(root, "public", "js", "ui-preview.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "css", "ui-preview.css"), "utf8");

function has(text, marker, label) {
  assert.ok(text.includes(marker), `${label}: missing ${marker}`);
}

has(main, 'let extensionCatalogSource = "fallback";', "main catalog source state");
has(main, 'extensionCatalogSource = "remote";', "main remote success state");
has(main, 'extensionCatalogSource = "fallback";', "main failure fallback state");
has(main, 'catalogSource: extensionCatalogSource', "store/check response source");
has(main, 'if (extensionCatalogSource !== "remote")', "update check fail-closed on stale catalog");
has(main, '온라인 업데이트 정보를 확인할 수 없습니다.', "public update failure message");

// R4 supply-chain hardening must remain intact while fixing UI state.
has(main, "CURRENT_OFFICIAL_EXTENSION_PACKAGE_SHA256", "R4 embedded package pins");
has(main, "verifyOfficialExtensionPackage", "R4 package verifier");
has(main, "embeddedOfficialExtensionSha256", "R4 trust bootstrap");

has(html, 'id="previewNetworkStatus"', "explicit connection indicator");
has(html, 'id="storeTabCount" title="상점 정보 확인 중">…</i>', "non-misleading initial store badge");
assert.ok(!html.includes('id="storeTabCount">0</i>'), "store badge must not start as a real-looking zero");

has(app, 'networkOffline: navigator.onLine === false', "initial offline detection");
has(app, 'window.addEventListener("offline", handleBrowserOffline)', "offline event listener");
has(app, 'window.addEventListener("online"', "online event listener");
has(app, 'elements.storeTabCount.textContent = "!";', "offline/failure badge");
has(app, '"오프라인 · 최신 상품 수를 확인할 수 없습니다."', "offline store status");
has(app, '"온라인 상점 연결 실패 · 최신 상품 수를 확인할 수 없습니다."', "remote failure store status");
has(app, 'const unavailable = catalogConnectionUnavailable() || state.networkReconnecting;', "store action protection");
has(app, 'const apps = await bridge.listApps();', "reconnect app-state refresh");

has(preview, 'previewElements.updateNavCount.textContent = "!";', "update nav unavailable state");
has(preview, "최신 업데이트 여부를 확인할 수 없습니다.", "update status uncertainty");
has(preview, '"인터넷 연결 후 자동으로 최신 업데이트 상태를 다시 확인합니다."', "reconnect explanation");

has(css, ".preview-network-status", "network status styling");
has(css, ".preview-nav>i.network-unavailable", "unavailable badge styling");

console.log("Offline/remote-failure UI state regression PASS");
