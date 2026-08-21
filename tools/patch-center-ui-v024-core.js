"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-center-ui-v024-core.js <app-root>");

const file = (rel) => path.join(root, rel);
const read = (rel) => fs.readFileSync(file(rel), "utf8").replace(/\r\n/g, "\n");
const write = (rel, value) => {
  fs.mkdirSync(path.dirname(file(rel)), { recursive: true });
  fs.writeFileSync(file(rel), value, "utf8");
};
function replaceOnce(source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`v0.24 marker missing: ${label}`);
  return source.replace(needle, () => replacement);
}

const repoRoot = path.resolve(__dirname, "..");
const helperSource = path.join(repoRoot, "preview", "v024-core", "sdlink-core-runtime.js");
const testSource = path.join(repoRoot, "preview", "v024-core", "test-sdlink-core-runtime-v024.js");
const publicErrorTestSource = path.join(repoRoot, "preview", "v024-core", "test-core-public-errors-v024.js");
const backgroundGuardSource = path.join(repoRoot, "preview", "v024-core", "sdlink-background-window-guard.js");
const backgroundGuardTestSource = path.join(repoRoot, "preview", "v024-core", "test-sdlink-background-window-guard-v024.js");
for (const required of [helperSource, testSource, publicErrorTestSource, backgroundGuardSource, backgroundGuardTestSource]) {
  if (!fs.existsSync(required)) throw new Error(`v0.24 Core bridge asset missing: ${required}`);
}

fs.copyFileSync(helperSource, file("src/sdlink-core-runtime.js"));
fs.copyFileSync(backgroundGuardSource, file("src/sdlink-background-window-guard.js"));

let testText = fs.readFileSync(testSource, "utf8").replace(
  'require("./sdlink-core-runtime")',
  'require("../src/sdlink-core-runtime")',
);
write("tools/test-sdlink-core-runtime-v024.js", testText);
let publicErrorTestText = fs.readFileSync(publicErrorTestSource, "utf8").replace(
  'require("./sdlink-core-runtime")',
  'require("../src/sdlink-core-runtime")',
);
write("tools/test-core-public-errors-v024.js", publicErrorTestText);
let backgroundGuardTestText = fs.readFileSync(backgroundGuardTestSource, "utf8").replace(
  'require("./sdlink-background-window-guard")',
  'require("../src/sdlink-background-window-guard")',
);
write("tools/test-sdlink-background-window-guard-v024.js", backgroundGuardTestText);

let main = read("main.js");
if (!main.includes("patchIntegratedSdLinkCoreRuntime")) {
  const importNeedle = 'const { patchIntegratedSdLinkAuthSession } = require("./src/sdlink-session-persistence");';
  main = replaceOnce(
    main,
    importNeedle,
    `${importNeedle}\nconst { patchIntegratedSdLinkCoreRuntime } = require("./src/sdlink-core-runtime");`,
    "Core runtime helper import",
  );

  const hookNeedle = `    const sessionPatch = patchIntegratedSdLinkAuthSession(childDirectory);\n    if (!sessionPatch?.ok) {\n      console.warn("SD Link 로그인 세션 유지 패치 실패", sessionPatch?.reason || sessionPatch);\n    }`;
  main = replaceOnce(
    main,
    hookNeedle,
    `${hookNeedle}\n    const coreRuntimePatch = patchIntegratedSdLinkCoreRuntime(childDirectory);\n    if (!coreRuntimePatch?.ok) {\n      console.warn("SD Link → SD Core 런타임 패치 실패", coreRuntimePatch?.reason || coreRuntimePatch);\n    }`,
    "integrated Core runtime hook",
  );
}

// Final Gate R2: SD Link v1.2.8/v1.2.9 background startup appended a hide handler
// after the original ready-to-show => show() behavior. Depending on listener ordering,
// the manager window could become visible for ~150 ms during Windows login. Guard the
// child BrowserWindow before requiring the extension so background startup can never show
// until an explicit --sd-link-open-manager second-instance request arrives.
if (!main.includes("createSdLinkBackgroundWindowGuard")) {
  const importNeedle = 'const { patchIntegratedSdLinkAuthSession } = require("./src/sdlink-session-persistence");';
  main = replaceOnce(
    main,
    importNeedle,
    `${importNeedle}\nconst { createSdLinkBackgroundWindowGuard } = require("./src/sdlink-background-window-guard");`,
    "SD Link background window guard import",
  );
}

if (!main.includes("const sdLinkBackgroundWindowGuard = entry.id === SD_LINK_ID")) {
  const guardNeedle = `  if (!fs.existsSync(childMainPath)) {\n    app.quit();\n    return;\n  }\n\n  app.setName(entry.productName || entry.name);`;
  main = replaceOnce(
    main,
    guardNeedle,
    `  if (!fs.existsSync(childMainPath)) {\n    app.quit();\n    return;\n  }\n\n  const sdLinkBackgroundWindowGuard = entry.id === SD_LINK_ID\n    ? createSdLinkBackgroundWindowGuard({ app, argv: process.argv })\n    : null;\n\n  app.setName(entry.productName || entry.name);`,
    "SD Link background window guard initialization",
  );
}

if (!main.includes("sdLinkBackgroundWindowGuard?.allowManagerWindow();")) {
  const managerNeedle = `    app.on("second-instance", (_event, argv) => {\n      if (!Array.isArray(argv) || !argv.includes("--sd-link-open-manager")) return;\n      const showManager = () => {`;
  main = replaceOnce(
    main,
    managerNeedle,
    `    app.on("second-instance", (_event, argv) => {\n      if (!Array.isArray(argv) || !argv.includes("--sd-link-open-manager")) return;\n      sdLinkBackgroundWindowGuard?.allowManagerWindow();\n      const showManager = () => {`,
    "explicit SD Link manager allow",
  );
}

if (!main.includes('entry.id === SD_LINK_ID && extraArgs.includes("--sd-link-auto-start")')) {
  const hideNeedle = `        stdio: "ignore",\n        windowsHide: false,`;
  main = replaceOnce(
    main,
    hideNeedle,
    `        stdio: "ignore",\n        windowsHide:\n          entry.id === SD_LINK_ID && extraArgs.includes("--sd-link-auto-start"),`,
    "background SD Link native window hide",
  );
}

write("main.js", main);

for (const rel of ["public/index.html", "public/js/ui-preview.js", "UI_PREVIEW.txt"]) {
  if (!fs.existsSync(file(rel))) continue;
  write(rel, read(rel).replaceAll("UI Preview v0.23", "UI Preview v0.24"));
}

console.log("UI Preview v0.24 integrated SD Core wallet bridge + SD Link background window guard applied");
