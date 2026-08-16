"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-v221-wallet-core.js <app-root>");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
}

function write(rel, content) {
  fs.writeFileSync(path.join(root, rel), content, "utf8");
}

function replaceRequired(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`Patch marker missing: ${label}`);
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.version = "2.2.1";
pkg.description = "SD지갑 코어와 선택형 확장팩 상점으로 구성된 SD종합센터";
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

let main = read("main.js");

const walletOnlyCatalog = `const BUILTIN_CATALOG = [
  {
    id: "wallet",
    name: "SD지갑",
    version: "Stage 11 · v1.1.1",
    folder: "SDWallet",
    productName: "SD지갑",
    userDataFolder: "SD지갑",
    description: "모든 SD 앱과 확장팩이 함께 사용하는 가상 계좌와 거래 내역을 관리합니다.",
    improvement: "SD 생태계의 기본 코어 앱으로 항상 제공됩니다.",
    accent: "blue",
    icon: "public/icons/icon-512.png",
  },
];`;

main = replaceRequired(
  main,
  /const BUILTIN_CATALOG = \[[\s\S]*?\n\];/,
  walletOnlyCatalog,
  "BUILTIN_CATALOG",
);

main = replaceRequired(
  main,
  /function cleanupBitcoinBuiltinDuplicate\(\) \{[\s\S]*?\n\}\n\ncleanupBitcoinBuiltinDuplicate\(\);/,
  "function cleanupBitcoinBuiltinDuplicate() {}\n\ncleanupBitcoinBuiltinDuplicate();",
  "legacy bitcoin cleanup",
);

main = replaceRequired(
  main,
  /function getChildDirectory\(entry\) \{[\s\S]*?\n\}/,
  "function getChildDirectory(entry) {\n  return entry.directory;\n}",
  "bitcoin child directory special case",
);

write("main.js", main);

let html = read("public/index.html");
html = html.replace(
  '<span id="heroAppCount">5</span>개의 앱을<br><span>하나의 센터</span>에서',
  '<span id="heroAppCount">1</span>개의 기본 앱을<br><span>확장하는 센터</span>에서',
);
html = html.replace(
  /          직접 입출금이 차단된 SD지갑을 중심으로 금고, 홀짝, 광부, 비트코인 채굴장을 바로 실행하고 상태를 확인합니다\.\n          삭제한 앱은 보관함에서 원클릭 재설치할 수 있고, 센터 창을 닫아도 시스템 트레이에서 계속 이용할 수 있습니다\./,
  "          SD지갑만 기본 제공하며 금고, 홀짝, 광부, 비트코인 채굴장 등 필요한 기능은 확장팩 상점에서 선택해 설치합니다.\n          설치한 확장팩은 센터에서 실행·관리할 수 있고, 기존 앱 저장 데이터는 같은 저장 폴더를 계속 사용합니다.",
);
html = html.replace(
  '<button id="launchAllButton" class="button button-primary" type="button">5개 앱 모두 실행</button>',
  '<button id="launchAllButton" class="button button-primary" type="button">설치된 앱 모두 실행</button>',
);
html = html.replace(
  '<strong id="registeredCount">5개</strong>',
  '<strong id="registeredCount">1개</strong>',
);
write("public/index.html", html);

for (const folder of ["SDVault", "SDOddEven", "SDMiner", "SDBitcoinMiner"]) {
  fs.rmSync(path.join(root, "apps", folder), { recursive: true, force: true });
}

const validationMain = read("main.js");
const builtinSection = validationMain.match(/const BUILTIN_CATALOG = \[[\s\S]*?\n\];/)?.[0] || "";
if (!builtinSection.includes('id: "wallet"')) throw new Error("wallet builtin missing");
for (const id of ["vault", "odd-even", "miner", "bitcoin"]) {
  if (builtinSection.includes(`id: "${id}"`)) {
    throw new Error(`${id} is still builtin`);
  }
}
for (const folder of ["SDVault", "SDOddEven", "SDMiner", "SDBitcoinMiner"]) {
  if (fs.existsSync(path.join(root, "apps", folder))) {
    throw new Error(`${folder} is still bundled`);
  }
}

console.log("SDCenter v2.2.1 wallet-core conversion patch applied");
