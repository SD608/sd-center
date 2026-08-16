"use strict";

const fs = require("node:fs");
const vm = require("node:vm");

function replaceRequired(source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`Missing marker: ${label}`);
  return source.replace(needle, replacement);
}

function loadPacks(file) {
  const source = fs.readFileSync(file, "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename: file });
  if (!Array.isArray(sandbox.window.SD_EXTENSION_PACKS)) {
    throw new Error(`${file}: SD_EXTENSION_PACKS missing`);
  }
  return sandbox.window.SD_EXTENSION_PACKS;
}

const releaseBase = "https://github.com/SD608/sd-center/releases/download/v.2.2.1";
const newPacks = [
  {
    id: "vault",
    name: "SD금고",
    stage: "Vault Expansion",
    version: "v1.2.0",
    category: "자산 시각화 확장팩",
    icon: "assets/icons/vault.png",
    fileName: "SDVault_v1.2.0_Desktop.zip",
    downloadUrl: `${releaseBase}/SDVault_v1.2.0_Desktop.zip`,
    description: "SD지갑의 가상 잔액을 금 중량과 금괴 보관 모습으로 환산해 보여주는 금고 확장팩입니다. 자산 규모에 따라 금고에 쌓이는 금괴와 총 중량을 시각적으로 확인할 수 있습니다.",
    requirements: "SD종합센터 v2.2.1 이상 · SD지갑 · Windows 10/11",
    updatedAt: "2026-08-16",
    tags: ["금고 시각화", "금 중량 환산", "자산 보관"],
    featured: true,
  },
  {
    id: "odd-even",
    name: "SD홀짝",
    stage: "Stage 4",
    version: "v1.1.0",
    category: "게임 확장팩",
    icon: "assets/icons/odd-even.png",
    fileName: "SDOddEven_v1.1.0_Desktop.zip",
    downloadUrl: `${releaseBase}/SDOddEven_v1.1.0_Desktop.zip`,
    description: "보안 난수 주사위 결과의 홀·짝을 맞히는 SD지갑 연동 미니게임입니다. 원하는 가상 금액을 베팅하고 빠르게 결과를 확인할 수 있습니다.",
    requirements: "SD종합센터 v2.2.1 이상 · SD지갑 · Windows 10/11",
    updatedAt: "2026-08-16",
    tags: ["홀짝 게임", "주사위 난수", "SD지갑 연동"],
    featured: true,
  },
  {
    id: "miner",
    name: "SD광부",
    stage: "Stage 3",
    version: "v1.1.0",
    category: "채굴 확장팩",
    icon: "assets/icons/miner.png",
    fileName: "SDMiner_v1.1.0_Desktop.zip",
    downloadUrl: `${releaseBase}/SDMiner_v1.1.0_Desktop.zip`,
    description: "돌·구리·철·에메랄드·다이아몬드를 채굴하고 보관한 뒤 SD지갑 가상 잔액으로 판매하는 성장형 채굴 확장팩입니다.",
    requirements: "SD종합센터 v2.2.1 이상 · SD지갑 · Windows 10/11",
    updatedAt: "2026-08-16",
    tags: ["광물 채굴", "보관·판매", "성장형 채굴"],
    featured: true,
  },
];

for (const file of ["assets/js/extensions-data.js", "extensions-data.js"]) {
  let packs = loadPacks(file);
  const convertedIds = new Set(newPacks.map((pack) => pack.id));
  packs = packs.filter((pack) => !convertedIds.has(pack.id));

  const bitcoin = packs.find((pack) => pack.id === "sd-bitcoin-miner");
  if (bitcoin) {
    bitcoin.fileName = "SDBitcoinMiner_v1.2.2_Desktop.zip";
    bitcoin.downloadUrl = `${releaseBase}/SDBitcoinMiner_v1.2.2_Desktop.zip`;
    bitcoin.requirements = "SD종합센터 v2.2.1 이상 · SD지갑 · Windows 10/11";
  }

  const linkIndex = packs.findIndex((pack) => pack.id === "sd-bitcoin-miner");
  if (linkIndex >= 0) packs.splice(linkIndex, 0, ...newPacks);
  else packs.push(...newPacks);

  fs.writeFileSync(
    file,
    `"use strict";\nwindow.SD_EXTENSION_PACKS = ${JSON.stringify(packs, null, 2)};\n`,
    "utf8",
  );
}

const catalogPath = "update/extensions-catalog.json";
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
catalog.catalogVersion = Number(catalog.catalogVersion || 0) + 1;
catalog.updatedAt = "2026-08-16T22:50:00+09:00";
catalog.apps.vault = {
  name: "SD금고",
  version: "1.2.0",
  downloadUrl: `${releaseBase}/SDVault_v1.2.0_Desktop.zip`,
  notes: "SD지갑 잔액을 금 중량과 금괴 보관 모습으로 환산해 자산 규모를 시각적으로 확인하는 금고 확장팩입니다.",
};
catalog.apps["odd-even"] = {
  name: "SD홀짝",
  version: "1.1.0",
  downloadUrl: `${releaseBase}/SDOddEven_v1.1.0_Desktop.zip`,
  notes: "보안 난수 주사위의 홀·짝을 맞히며 SD지갑 가상 잔액으로 즐기는 빠른 미니게임 확장팩입니다.",
};
catalog.apps.miner = {
  name: "SD광부",
  version: "1.1.0",
  downloadUrl: `${releaseBase}/SDMiner_v1.1.0_Desktop.zip`,
  notes: "여러 광물을 채굴하고 보관·판매하며 누적 성과를 키우는 SD지갑 연동 채굴 확장팩입니다.",
};
if (catalog.apps.bitcoin) {
  catalog.apps.bitcoin.downloadUrl = `${releaseBase}/SDBitcoinMiner_v1.2.2_Desktop.zip`;
  catalog.apps.bitcoin.notes = "방과 채굴 장비를 확장하고 전기세·GPU 내구도를 관리하며 자동 채굴 시설을 운영하는 확장팩입니다.";
}
fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

const sitePath = "site-config.js";
let site = fs.readFileSync(sitePath, "utf8");
site = site.replace(/최신 Windows 배포 정보 ·[^\n]*/, "최신 Windows 배포 정보 · v2.2.1 Wallet Core");
site = site.replace('version: "2.2.0"', 'version: "2.2.1"');
site = site.replace(
  'downloadUrl: "https://github.com/SD608/sd-center/releases/download/v.2.2.0/SDCenterSetup.exe"',
  'downloadUrl: "https://github.com/SD608/sd-center/releases/download/v.2.2.1/SDCenterSetup.exe"',
);
site = site.replace(
  'releasePageUrl: "https://github.com/SD608/sd-center/releases/tag/v.2.2.0"',
  'releasePageUrl: "https://github.com/SD608/sd-center/releases/tag/v.2.2.1"',
);
fs.writeFileSync(sitePath, site, "utf8");

const indexPath = "index.html";
let html = fs.readFileSync(indexPath, "utf8");
html = replaceRequired(
  html,
  '<div class="mini-grid">\n<article><img alt="" src="assets/icons/wallet.png"/><span>SD지갑</span></article>\n<article><img alt="" src="assets/icons/vault.png"/><span>SD금고</span></article>\n<article><img alt="" src="assets/icons/odd-even.png"/><span>SD홀짝</span></article>\n<article><img alt="" src="assets/icons/miner.png"/><span>SD광부</span></article>\n<article class="wide"><img alt="" src="assets/icons/bitcoin.png"/><span>SD비트코인 채굴장</span></article>\n</div>',
  '<div class="mini-grid">\n<article class="wide"><img alt="" src="assets/icons/wallet.png"/><span>SD지갑 · CORE</span></article>\n</div>',
  "hero app preview",
);
html = replaceRequired(html, '<div class="floating-chip chip-apps">5 APPS + PACKS</div>', '<div class="floating-chip chip-apps">1 CORE APP + PACKS</div>', "hero app count");
html = replaceRequired(html, '<div><strong>한 번에 설치</strong><span>설치 파일 하나로 앱 5개 구성</span></div>', '<div><strong>지갑 코어</strong><span>SD지갑 1개만 기본 제공</span></div>', "trust strip");
html = replaceRequired(html, '<h2>기본 제공 앱 5개</h2>', '<h2>기본 제공 앱 1개</h2>', "included apps heading");
html = replaceRequired(
  html,
  '<p>기본 앱은 SD지갑의 가상 계좌를 중심으로 연결되며, 종합센터에서 실행·종료·보관·재설치할 수 있습니다.</p>',
  '<p>SD지갑만 센터에 기본 포함됩니다. 금고·홀짝·광부·비트코인 채굴장 등 나머지 앱은 확장팩 상점에서 원하는 것만 설치할 수 있습니다.</p>',
  "included apps description",
);

for (const cls of ["gold", "purple", "green", "cyan"]) {
  const re = new RegExp(`<article class="app-card ${cls}">[\\s\\S]*?<\\/article>\\n?`);
  if (!re.test(html)) throw new Error(`basic card missing: ${cls}`);
  html = html.replace(re, "");
}

html = replaceRequired(
  html,
  '<p>확장팩 ZIP을 내려받은 뒤 압축을 풀지 않고 SD종합센터의 <strong>ZIP 앱 추가</strong>에서 선택하면 됩니다.</p>',
  '<p>SD종합센터의 <strong>확장팩 상점</strong>에서 원하는 앱을 골라 바로 설치할 수 있습니다. 홈페이지 ZIP 다운로드를 이용한 수동 설치도 지원합니다.</p>',
  "extension store description",
);
html = replaceRequired(
  html,
  '<strong>다운로드한 확장팩을 종합센터에 추가하는 방법</strong>',
  '<strong>종합센터 확장팩 상점에서 앱을 추가하는 방법</strong>',
  "extension guide heading",
);
html = replaceRequired(html, '<li><b>1</b><span>홈페이지에서 확장팩 ZIP 다운로드</span></li>', '<li><b>1</b><span>SD종합센터에서 <strong>확장팩 상점</strong> 열기</span></li>', "extension guide 1");
html = replaceRequired(html, '<li><b>2</b><span>SD종합센터에서 <strong>ZIP 앱 추가</strong> 선택</span></li>', '<li><b>2</b><span>원하는 확장팩을 찾아 설치 선택</span></li>', "extension guide 2");
html = replaceRequired(html, '<li><b>3</b><span>압축을 풀지 않은 ZIP을 선택해 설치 또는 업데이트</span></li>', '<li><b>3</b><span>설치가 끝나면 설치된 앱에서 바로 실행</span></li>', "extension guide 3");
html = html.replace('assets/js/extensions-data.js?v=221', 'assets/js/extensions-data.js?v=221-walletcore');
fs.writeFileSync(indexPath, html, "utf8");

console.log("v2.2.1 wallet-core website/store migration applied");
