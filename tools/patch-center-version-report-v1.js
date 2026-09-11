"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-center-version-report-v1.js <app-root>");

const file = (rel) => path.join(root, rel);
const read = (rel) => fs.readFileSync(file(rel), "utf8").replace(/\r\n/g, "\n");
const write = (rel, value) => {
  fs.mkdirSync(path.dirname(file(rel)), { recursive: true });
  fs.writeFileSync(file(rel), value, "utf8");
};
function replaceOnce(source, needle, replacement, label) {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`center-version-report marker missing: ${label}`);
  return source.slice(0, index) + replacement + source.slice(index + needle.length);
}

const repoRoot = path.resolve(__dirname, "..");
const helperSource = path.join(repoRoot, "preview", "v024-core", "sdlink-center-version-report.js");
const testSource = path.join(repoRoot, "preview", "v024-core", "test-sdlink-center-version-report-v024.js");
for (const required of [helperSource, testSource]) {
  if (!fs.existsSync(required)) throw new Error(`center-version-report asset missing: ${required}`);
}
if (!fs.existsSync(file("src/sdlink-core-runtime.js"))) {
  throw new Error("Apply UI Preview v0.24 Core patch before center version reporting.");
}

fs.copyFileSync(helperSource, file("src/sdlink-center-version-report.js"));
let testText = fs.readFileSync(testSource, "utf8").replace(
  'require("./sdlink-center-version-report")',
  'require("../src/sdlink-center-version-report")',
);
write("tools/test-sdlink-center-version-report-v024.js", testText);

let main = read("main.js");
if (!main.includes("patchIntegratedSdLinkCenterVersionReport")) {
  const importNeedle = 'const { patchIntegratedSdLinkCoreRuntime } = require("./src/sdlink-core-runtime");';
  main = replaceOnce(
    main,
    importNeedle,
    `${importNeedle}\nconst { patchIntegratedSdLinkCenterVersionReport } = require("./src/sdlink-center-version-report");`,
    "version report helper import",
  );

  const hookNeedle = `    const coreRuntimePatch = patchIntegratedSdLinkCoreRuntime(childDirectory);\n    if (!coreRuntimePatch?.ok) {\n      console.warn("SD Link → SD Core 런타임 패치 실패", coreRuntimePatch?.reason || coreRuntimePatch);\n    }`;
  main = replaceOnce(
    main,
    hookNeedle,
    `${hookNeedle}\n    const centerVersionPatch = patchIntegratedSdLinkCenterVersionReport(childDirectory);\n    if (!centerVersionPatch?.ok) {\n      console.warn("종합센터 버전 보고 패치 실패", centerVersionPatch?.reason || centerVersionPatch);\n    }`,
    "version report runtime hook",
  );
}
write("main.js", main);
console.log("SD Center version reporting v1 patch applied");
