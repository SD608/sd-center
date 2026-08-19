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

const guardMarker = "UI Preview v0.5: 앱 목록이 로딩되기 전에는 저장된 폴더 멤버십을 정리하지 않습니다.";
if (!source.includes(guardMarker)) {
  const needle = `function syncPreviewLayout() {\n  const validIds = new Set(state.apps.map((app) => app.id));`;
  const replacement = `function syncPreviewLayout() {\n  // ${guardMarker}\n  // 초기 부팅 시 state.apps가 비어 있는 순간 기존 폴더의 apps 배열을 검사하면\n  // 저장된 앱 ID가 모두 제거되어 재실행 후 폴더 밖으로 풀리는 문제가 생깁니다.\n  if (!Array.isArray(state.apps) || state.apps.length === 0) {\n    preview.layout = Array.isArray(preview.layout) ? preview.layout : [];\n    return;\n  }\n\n  const validIds = new Set(state.apps.map((app) => app.id));`;
  if (!source.includes(needle)) throw new Error("syncPreviewLayout patch marker missing");
  source = source.replace(needle, replacement);
}

fs.writeFileSync(file, source, "utf8");

const check = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
for (const marker of [
  guardMarker,
  "if (!Array.isArray(state.apps) || state.apps.length === 0)",
  "preview.layout = Array.isArray(preview.layout) ? preview.layout : [];",
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
