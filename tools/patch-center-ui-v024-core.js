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
if (!fs.existsSync(helperSource) || !fs.existsSync(testSource)) throw new Error("v0.24 Core bridge assets missing");
fs.copyFileSync(helperSource, file("src/sdlink-core-runtime.js"));
let testText = fs.readFileSync(testSource, "utf8").replace(
  'require("./sdlink-core-runtime")',
  'require("../src/sdlink-core-runtime")',
);
write("tools/test-sdlink-core-runtime-v024.js", testText);

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
write("main.js", main);

for (const rel of ["public/index.html", "public/js/ui-preview.js", "UI_PREVIEW.txt"]) {
  if (!fs.existsSync(file(rel))) continue;
  write(rel, read(rel).replaceAll("UI Preview v0.23", "UI Preview v0.24"));
}

console.log("UI Preview v0.24 integrated SD Core wallet bridge patch applied");
