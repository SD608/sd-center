"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-center-ui-v023-sdlink-session.js <app-root>");

const file = (rel) => path.join(root, rel);
const read = (rel) => fs.readFileSync(file(rel), "utf8").replace(/\r\n/g, "\n");
const write = (rel, value) => {
  fs.mkdirSync(path.dirname(file(rel)), { recursive: true });
  fs.writeFileSync(file(rel), value, "utf8");
};
function replaceOnce(source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`v0.23 marker missing: ${label}`);
  return source.replace(needle, () => replacement);
}

const repoRoot = path.resolve(__dirname, "..");
const helperSource = path.join(repoRoot, "preview", "v023-sdlink-session", "sdlink-session-persistence.js");
const testSource = path.join(repoRoot, "preview", "v023-sdlink-session", "test-sdlink-session-persistence-v023.js");
if (!fs.existsSync(helperSource) || !fs.existsSync(testSource)) throw new Error("v0.23 session assets missing");
fs.copyFileSync(helperSource, file("src/sdlink-session-persistence.js"));
let testText = fs.readFileSync(testSource, "utf8").replace(
  'require("./sdlink-session-persistence")',
  'require("../src/sdlink-session-persistence")',
);
write("tools/test-sdlink-session-persistence-v023.js", testText);

let main = read("main.js");
if (!main.includes("patchIntegratedSdLinkAuthSession")) {
  const importNeedle = `const {\n  SD_LINK_ID,\n  ensureIntegratedSdLinkUserData,\n  integratedSdLinkUserDataPath,\n  integrationState: readSdLinkIntegrationState,\n} = require("./src/sdlink-integration");`;
  main = replaceOnce(
    main,
    importNeedle,
    `${importNeedle}\nconst { patchIntegratedSdLinkAuthSession } = require("./src/sdlink-session-persistence");`,
    "session helper import",
  );

  const userDataNeedle = `    app.setPath("userData", integratedSdLinkUserDataPath(CENTER_DATA_ROOT));\n    process.env.SD_CENTER_LINK_INTEGRATED = "1";`;
  main = replaceOnce(
    main,
    userDataNeedle,
    `${userDataNeedle}\n    const sessionPatch = patchIntegratedSdLinkAuthSession(childDirectory);\n    if (!sessionPatch?.ok) {\n      console.warn("SD Link 로그인 세션 유지 패치 실패", sessionPatch?.reason || sessionPatch);\n    }`,
    "integrated session patch hook",
  );
}
write("main.js", main);

for (const rel of ["public/index.html", "public/js/ui-preview.js", "UI_PREVIEW.txt"]) {
  if (!fs.existsSync(file(rel))) continue;
  write(rel, read(rel).replaceAll("UI Preview v0.22", "UI Preview v0.23"));
}

console.log("UI Preview v0.23 SD Link session persistence patch applied");
