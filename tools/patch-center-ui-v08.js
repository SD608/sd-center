"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-center-ui-v08.js <app-root>");

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

// HIGH-1: 앱 목록과 보관함 목록이 동시에 초기화될 때 폴더 멤버십이 지워지는 레이스 제거.
let previewJs = read("public/js/ui-preview.js");
previewJs = previewJs.replace("/* SD종합센터 UI Preview v0.7", "/* SD종합센터 UI Preview v0.8");

const oldRenderAppsHook = `const originalRenderApps = renderApps;\nrenderApps = function previewRenderApps() {\n  // 원본 앱 목록 렌더가 시작된 뒤에만 저장된 배치를 현재 설치 앱 목록과 동기화합니다.\n  preview.appsReady = true;\n  originalRenderApps();`;
const newRenderAppsHook = `const originalSetApps = setApps;\nsetApps = function previewSetApps(apps) {\n  // UI Preview v0.8: 실제 앱 목록을 받은 경우에만 폴더 정리를 허용합니다.\n  preview.appsReady = true;\n  return originalSetApps(apps);\n};\n\nconst originalRenderApps = renderApps;\nrenderApps = function previewRenderApps() {\n  originalRenderApps();`;
if (previewJs.includes(oldRenderAppsHook)) {
  previewJs = previewJs.replace(oldRenderAppsHook, newRenderAppsHook);
} else if (!previewJs.includes("function previewSetApps(apps)")) {
  throw new Error("appsReady race patch marker missing");
}

// MEDIUM: 손상된 recent 저장값 때문에 홈 전체가 깨지지 않도록 정규화.
const oldRecentLoad = `preview.layout = readJsonStorage(PREVIEW_LAYOUT_KEY, []);\npreview.recent = readJsonStorage(PREVIEW_RECENT_KEY, []);`;
const newRecentLoad = `preview.layout = readJsonStorage(PREVIEW_LAYOUT_KEY, []);\nconst savedPreviewRecent = readJsonStorage(PREVIEW_RECENT_KEY, []);\npreview.recent = Array.isArray(savedPreviewRecent)\n  ? savedPreviewRecent.filter((id) => typeof id === "string" && id).slice(0, 8)\n  : [];`;
if (previewJs.includes(oldRecentLoad)) previewJs = previewJs.replace(oldRecentLoad, newRecentLoad);

// LOW: 저장값에 중복/빈 폴더 ID가 있어도 안전하게 복구.
if (!previewJs.includes("const folderIds = new Set();")) {
  previewJs = replaceOnce(
    previewJs,
    `  const seen = new Set();\n  const cleaned = [];`,
    `  const seen = new Set();\n  const folderIds = new Set();\n  const cleaned = [];`,
    "folder id set",
  );
  previewJs = replaceOnce(
    previewJs,
    `      cleaned.push({\n        type: "folder",\n        id: String(raw.id || \`folder-\${Date.now()}-\${cleaned.length}\`),\n        name: String(raw.name || "새 폴더"),\n        apps,\n      });`,
    `      let folderId = String(raw.id || "").trim();\n      if (!folderId || folderIds.has(folderId)) {\n        do {\n          folderId = \`folder-\${Date.now()}-\${cleaned.length}-\${Math.random().toString(36).slice(2, 7)}\`;\n        } while (folderIds.has(folderId));\n      }\n      folderIds.add(folderId);\n      const folderName = String(raw.name || "새 폴더").trim().slice(0, 40) || "새 폴더";\n      cleaned.push({ type: "folder", id: folderId, name: folderName, apps });`,
    "folder id normalization",
  );
}

// MEDIUM: 업데이트 오류가 updateAvailable 상태에 가려지지 않도록 오류를 우선 표시.
previewJs = previewJs.replace(
  `  else if (update.downloaded) status = update.version ? \`v\${update.version} 다운로드 완료 · 설치할 수 있습니다.\` : "새 버전 다운로드 완료 · 설치할 수 있습니다.";\n  else if (update.updateAvailable) status = update.version ? \`v\${update.version} 업데이트를 다운로드하고 있습니다.\` : "새 센터 업데이트를 다운로드하고 있습니다.";\n  else if (update.phase === "error") status = update.error || "센터 업데이트를 확인하지 못했습니다.";`,
  `  else if (update.phase === "error") status = update.error || "센터 업데이트를 확인하지 못했습니다.";\n  else if (update.downloaded) status = update.version ? \`v\${update.version} 다운로드 완료 · 설치할 수 있습니다.\` : "새 버전 다운로드 완료 · 설치할 수 있습니다.";\n  else if (update.updateAvailable) status = update.version ? \`v\${update.version} 업데이트를 다운로드하고 있습니다.\` : "새 센터 업데이트를 다운로드하고 있습니다.";`,
);
write("public/js/ui-preview.js", previewJs);

// HIGH-2/3: 포터블 센터 업데이트 검증과 설치 프로세스 시작 확인 강화.
let main = read("main.js");

if (!main.includes("function validatePortableCenterManifest")) {
  const validationCode = `

  function validatePortableCenterManifest(manifest) {
    const version = String(manifest?.version || "").replace(/^v/i, "").trim();
    const downloadUrl = String(manifest?.downloadUrl || "").trim();
    const sha256 = String(manifest?.sha256 || "").trim().toLowerCase();
    if (!/^\\d+(?:\\.\\d+){1,3}$/.test(version)) {
      throw new Error("센터 업데이트 버전 정보가 올바르지 않습니다.");
    }
    let parsed;
    try { parsed = new URL(downloadUrl); } catch { throw new Error("센터 업데이트 다운로드 주소가 올바르지 않습니다."); }
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "github.com" ||
      !parsed.pathname.startsWith("/SD608/sd-center/releases/download/")
    ) {
      throw new Error("공식 GitHub 릴리스가 아닌 센터 업데이트 주소는 사용할 수 없습니다.");
    }
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
      throw new Error("센터 업데이트 SHA256 정보가 없거나 올바르지 않습니다.");
    }
    return { version, downloadUrl: parsed.toString(), sha256 };
  }
`;
  main = replaceOnce(main, "\n  async function checkCenterPortableUpdate() {", validationCode + "\n  async function checkCenterPortableUpdate() {", "portable manifest validator");
}

main = main.replace(
  `      const manifest = await fetchCenterUpdateManifest();\n      const version = String(manifest?.version || "").replace(/^v/i, "");\n      const downloadUrl = String(manifest?.downloadUrl || "");\n      const sha256 = String(manifest?.sha256 || "").toLowerCase();\n      if (!version || !downloadUrl) throw new Error("센터 업데이트 정보에 버전 또는 다운로드 주소가 없습니다.");`,
  `      const manifest = await fetchCenterUpdateManifest();\n      const { version, downloadUrl, sha256 } = validatePortableCenterManifest(manifest);`,
);

// LOW: manifest 리다이렉트 루프 제한.
main = main.replace(
  `      const requestManifest = (targetUrl) => {`,
  `      const requestManifest = (targetUrl, redirectCount = 0) => {\n        if (redirectCount > 5) { reject(new Error("센터 업데이트 서버 리다이렉트가 너무 많습니다.")); return; }`,
);
main = main.replace(
  `              requestManifest(new URL(response.headers.location, targetUrl).toString());`,
  `              requestManifest(new URL(response.headers.location, targetUrl).toString(), redirectCount + 1);`,
);

// 확인 실패 시 이전 updateAvailable 상태를 들고 있지 않게 함.
main = main.replace(
  `      return { ok: false, ...sendCenterUpdateState({ phase: "error", portable: true, error: error?.message || String(error) }) };`,
  `      return { ok: false, ...sendCenterUpdateState({ phase: "error", portable: true, updateAvailable: false, downloaded: false, error: error?.message || String(error) }) };`,
);

const oldSpawn = `        const child = spawn(installerPath, ["--silent"], { detached: true, stdio: "ignore" });\n        child.unref();\n        isQuitting = true;\n        setTimeout(() => app.quit(), 250);`;
const newSpawn = `        const child = spawn(installerPath, ["--silent"], { detached: true, stdio: "ignore" });\n        await new Promise((resolve, reject) => {\n          child.once("spawn", resolve);\n          child.once("error", reject);\n        });\n        child.unref();\n        isQuitting = true;\n        setTimeout(() => app.quit(), 350);`;
if (main.includes(oldSpawn)) main = main.replace(oldSpawn, newSpawn);
else if (!main.includes('child.once("spawn", resolve)')) throw new Error("installer spawn verification marker missing");
write("main.js", main);

// LOW: 모든 다운로드 공통 HTTP 요청에도 리다이렉트 상한 적용.
let required = read("src/required-updates.js");
if (!required.includes("redirectCount = 0")) {
  required = required.replace(
    `    const doRequest = (targetUrl) => {`,
    `    const doRequest = (targetUrl, redirectCount = 0) => {\n      if (redirectCount > 5) {\n        reject(new Error("업데이트 서버 리다이렉트가 너무 많습니다."));\n        return;\n      }`,
  );
  required = required.replace(
    `            doRequest(new URL(response.headers.location, targetUrl).toString());`,
    `            doRequest(\n              new URL(response.headers.location, targetUrl).toString(),\n              redirectCount + 1,\n            );`,
  );
}
write("src/required-updates.js", required);

// MEDIUM: 실패한 실행을 최근 실행으로 기록하지 않도록 원본 launchApp이 결과를 반환하게 함.
let appJs = read("public/js/app.js");
appJs = appJs.replace(
  `  if (!result.ok) {\n    showToast(result.error || "앱을 실행하지 못했습니다.");\n    return;\n  }`,
  `  if (!result.ok) {\n    showToast(result.error || "앱을 실행하지 못했습니다.");\n    return result;\n  }`,
);
appJs = appJs.replace(
  `    result.mandatoryUpdated ? 4200 : 3000,\n  );\n}\n\nasync function terminateApp`,
  `    result.mandatoryUpdated ? 4200 : 3000,\n  );\n  return result;\n}\n\nasync function terminateApp`,
);

// MEDIUM: silent 자동 확인의 오류는 화면 상태에는 남기되 토스트를 강제하지 않음. 수동 확인은 checkSelfUpdate(false)가 직접 표시.
appJs = appJs.replace(
  `    if (update?.phase === "error") showToast(update.error || "종합센터 업데이트 오류", 4500);\n`,
  `    // 오류는 업데이트 카드에 표시합니다. 수동 확인 오류는 checkSelfUpdate(false)가 토스트를 담당합니다.\n`,
);
write("public/js/app.js", appJs);

previewJs = read("public/js/ui-preview.js");
previewJs = previewJs.replace(
  `launchApp = async function previewLaunchApp(id) {\n  saveRecent(id);\n  renderPreviewRecent();\n  const result = await originalLaunchApp(id);\n  renderPreviewHome();\n  return result;\n};`,
  `launchApp = async function previewLaunchApp(id) {\n  const result = await originalLaunchApp(id);\n  if (result?.ok) {\n    saveRecent(id);\n    renderPreviewRecent();\n  }\n  renderPreviewHome();\n  return result;\n};`,
);
write("public/js/ui-preview.js", previewJs);

// 최종 회귀 마커 검증.
const checks = {
  "main.js": [
    "function validatePortableCenterManifest",
    "공식 GitHub 릴리스가 아닌 센터 업데이트 주소",
    "센터 업데이트 SHA256 정보가 없거나 올바르지 않습니다.",
    'child.once("spawn", resolve)',
    "redirectCount > 5",
  ],
  "public/js/app.js": [
    "return result;",
    "수동 확인 오류는 checkSelfUpdate(false)가 토스트를 담당합니다.",
  ],
  "public/js/ui-preview.js": [
    "function previewSetApps(apps)",
    "savedPreviewRecent",
    "const folderIds = new Set();",
    "if (result?.ok)",
    'update.phase === "error"',
  ],
  "src/required-updates.js": ["redirectCount = 0", "redirectCount > 5"],
};
for (const [rel, markers] of Object.entries(checks)) {
  const content = read(rel);
  for (const marker of markers) {
    if (!content.includes(marker)) throw new Error(`Missing v0.8 audit fix marker in ${rel}: ${marker}`);
  }
}

console.log("SDCenter UI Preview v0.8 audited bug fixes applied");
