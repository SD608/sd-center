"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-center-ui-v05.js <app-root>");

const file = path.join(root, "public/js/ui-preview.js");
let source = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

source = source.replace(
  "/* SD종합센터 UI Preview v0.4",
  "/* SD종합센터 UI Preview v0.5",
);

if (!source.includes("appsReady: false")) {
  const stateNeedle = `  nameMode: "",\n  nameFolderId: "",\n};`;
  const stateReplacement = `  nameMode: "",\n  nameFolderId: "",\n  appsReady: false,\n};`;
  if (!source.includes(stateNeedle)) throw new Error("preview state patch marker missing");
  source = source.replace(stateNeedle, stateReplacement);
}

const guardMarker = "UI Preview v0.5: 앱 목록 로딩 전에는 저장된 폴더 멤버십을 정리하지 않습니다.";
if (!source.includes(guardMarker)) {
  const needle = `function syncPreviewLayout() {\n  const validIds = new Set(state.apps.map((app) => app.id));`;
  const replacement = `function syncPreviewLayout() {\n  // ${guardMarker}\n  // 초기 부팅 시 state.apps가 빈 배열인 순간 폴더 apps를 검사하면 저장된 앱 ID가 모두 제거됩니다.\n  if (!preview.appsReady) return;\n\n  const validIds = new Set(state.apps.map((app) => app.id));`;
  if (!source.includes(needle)) throw new Error("syncPreviewLayout patch marker missing");
  source = source.replace(needle, replacement);
}

if (!source.includes("preview.appsReady = true;")) {
  const renderNeedle = `renderApps = function previewRenderApps() {\n  originalRenderApps();`;
  const renderReplacement = `renderApps = function previewRenderApps() {\n  // 원본 앱 목록 렌더가 시작된 뒤에만 저장된 배치를 현재 설치 앱 목록과 동기화합니다.\n  preview.appsReady = true;\n  originalRenderApps();`;
  if (!source.includes(renderNeedle)) throw new Error("renderApps readiness patch marker missing");
  source = source.replace(renderNeedle, renderReplacement);
}

fs.writeFileSync(file, source, "utf8");

const check = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
for (const marker of [
  guardMarker,
  "appsReady: false",
  "if (!preview.appsReady) return;",
  "preview.appsReady = true;",
  "writeJsonStorage(PREVIEW_LAYOUT_KEY, preview.layout);",
]) {
  if (!check.includes(marker)) throw new Error(`Missing v0.5 persistence marker: ${marker}`);
}

const guardIndex = check.indexOf(guardMarker);
const validIdsIndex = check.indexOf("const validIds = new Set(state.apps.map((app) => app.id));");
if (guardIndex < 0 || validIdsIndex < 0 || guardIndex > validIdsIndex) {
  throw new Error("v0.5 startup guard must run before layout pruning");
}

console.log("SDCenter UI Preview v0.5 folder persistence patch applied");
