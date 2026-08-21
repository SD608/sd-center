"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = process.argv[2];
if (!root) throw new Error("Usage: node apply-center-ui-v021-sdlink.js <app-root>");

const mainPath = path.join(root, "main.js");
let main = fs.readFileSync(mainPath, "utf8").replace(/\r\n/g, "\n");

// 실제 v0.20 결과물은 center:launch-all 내부가 콜백 깊이만큼 8칸 들여쓰기입니다.
// 초기 v0.21 패치가 역사적 소스의 6칸 형태만 기대했으므로, 의미를 바꾸지 않고
// 해당 블록의 들여쓰기만 패치가 기대하는 형태로 정규화합니다.
const actualV020LaunchAll = `        for (const entry of appCatalog) {\n          results.push({\n            id: entry.id,\n            ...(await launchApp(entry.id)),\n          });\n        }\n\n        return {\n          ok: results.every((result) => result.ok),\n          count: appCatalog.length,\n          results,\n        };`;
const patchExpectedLaunchAll = `      for (const entry of appCatalog) {\n        results.push({\n          id: entry.id,\n          ...(await launchApp(entry.id)),\n        });\n      }\n\n      return {\n        ok: results.every((result) => result.ok),\n        count: appCatalog.length,\n        results,\n      };`;

if (main.includes(actualV020LaunchAll) && !main.includes(patchExpectedLaunchAll)) {
  main = main.replace(actualV020LaunchAll, patchExpectedLaunchAll);
  fs.writeFileSync(mainPath, main, "utf8");
}

function run(script) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script), root], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${script} failed with exit code ${result.status}`);
  }
}

run("patch-center-ui-v021-sdlink-main.js");
run("patch-center-ui-v021-sdlink-ui.js");

console.log("v0.21 SD Link integration applied to verified v0.20 layout");
