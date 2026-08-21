"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-v024-extension-update-trust-bootstrap.js <app-root>");

const mainPath = path.join(root, "main.js");
let main = fs.readFileSync(mainPath, "utf8").replace(/\r\n/g, "\n");

function mustReplace(oldText, newText, label) {
  if (!main.includes(oldText)) throw new Error(`missing updater bootstrap marker: ${label}`);
  main = main.replace(oldText, newText);
}

for (const marker of [
  "function verifyOfficialExtensionPackage(",
  "function normalizedOfficialExtensionSha256(rule)",
  'const EXTENSION_CATALOG_URL =',
]) {
  if (!main.includes(marker)) throw new Error(`R3 updater hardening marker missing: ${marker}`);
}

const oldLogisticsFallback = `  "sd-logistics-center-desktop": {\n    required: true,\n    minVersion: "1.0.9",\n    downloadUrl:\n      "https://sd608.github.io/sd-center/downloads/extensions/SDLogisticsCenter_Season0_Desktop.zip",\n    message:\n      "물류회사 진행도 1회 초기화/랭크 밸런스 패치가 필수입니다. v1.0.9 이상으로 업데이트해야 실행할 수 있습니다.",\n  },`;
const newLogisticsFallback = `  "sd-logistics-center-desktop": {\n    required: true,\n    minVersion: "1.1.0",\n    version: "1.1.0",\n    downloadUrl:\n      "https://sd608.github.io/sd-center/downloads/extensions/SDLogisticsCenter_v1.1.0_Desktop.zip?v=110",\n    sha256: "3a1b1c156b233d0d74555dce2f8899030cd4573f00524dc4edeb4e130a1ace08",\n    message:\n      "PC 물류 진행도를 홈페이지 계정에 연동하기 위해 SD 물류센터 v1.1.0 이상이 필요합니다. 기존 진행도와 SD지갑 잔액은 유지됩니다.",\n  },`;
mustReplace(oldLogisticsFallback, newLogisticsFallback, "current logistics required fallback");

const oldSdLinkFallback = `  "sdlink-desktop": {\n    required: true,\n    minVersion: "1.2.4",\n    downloadUrl:\n      "https://sd608.github.io/sd-center/downloads/extensions/SDLink_v1.2.4_Desktop.zip",\n    message:\n      "구 센터 우회 차단을 위해 SD Link v1.2.4 이상이 필수입니다.",\n  },`;
const newSdLinkFallback = `  "sdlink-desktop": {\n    required: true,\n    minVersion: "1.4.0",\n    version: "1.4.1",\n    downloadUrl:\n      "https://sd608.github.io/sd-center/downloads/extensions/SDLink_v1.4.1_Desktop.zip?v=141",\n    sha256: "032d7e9fec32d99f9ae13a568baa1d1d80c5fb713392bdd103ccbd3ce9f59707",\n    message:\n      "PC 슬롯·홀짝의 SD Online 서버 통합을 위해 SD Link v1.4.0 이상이 필요합니다.",\n  },`;
mustReplace(oldSdLinkFallback, newSdLinkFallback, "current SD Link required fallback");

const oldShaHelper = `  function normalizedOfficialExtensionSha256(rule) {\n    const expected = String(rule?.sha256 || "").trim().toLowerCase();\n    if (!/^[a-f0-9]{64}$/.test(expected)) {\n      throw new Error("검증된 확장팩 SHA-256 정보가 없어 설치 또는 업데이트를 중단했습니다.");\n    }\n    return expected;\n  }`;
const newShaHelper = `  const CURRENT_OFFICIAL_EXTENSION_PACKAGE_SHA256 = Object.freeze({\n    "sdlink-desktop@1.4.1": "032d7e9fec32d99f9ae13a568baa1d1d80c5fb713392bdd103ccbd3ce9f59707",\n    "sd-logistics-center-desktop@1.1.0": "3a1b1c156b233d0d74555dce2f8899030cd4573f00524dc4edeb4e130a1ace08",\n    "sd-slot@1.1.0": "66ae3b9ee4e6d5bb97fb08d90e5bd045a6f463b155ec194ebb6d37a2f7478d5b",\n    "sd-mukjippa@1.0.1": "70e62db0a82e1f4fb4ee01639471ff88017e3c32f24fb49853ebbac7feb297ca",\n    "sta-expansion@1.5.1": "f9633beca57d218ac441f066c7021299a81fcb82ce707a7ed0e09a4bd7f9f320",\n    "bitcoin@1.2.2": "cd1dbc64f81f90fc3b2518ccee534243e521ca0f18a92d9839d2507ede45e65d",\n    "sd-flea-market@1.2.3": "5ee869af576045fae3bc48366a8de58bdcac7bfeedad77a9a9d1d94bd5ac3e75",\n    "vault@1.2.1": "468030d343b97c09c152a9589c0e14d2831d6a6197e88e44c62b798af09ab95a",\n    "odd-even@1.2.0": "da5b4aa44f78d87f14e5ca3386c9b530fccdf293ceba562fce2c69eeff4f26f9",\n    "miner@1.1.1": "bb180fec1e7e7d3db394d58a53bb1775c5be77801c0d78b529ececf0e75da70c",\n  });\n\n  function canonicalOfficialExtensionPackageId(id) {\n    const value = String(id || "").trim();\n    const aliases = {\n      "sd-bitcoin-miner-desktop": "bitcoin",\n      "sd-bitcoin-miner": "bitcoin",\n      "sd-slot-desktop": "sd-slot",\n      "sd-odd-even-desktop": "odd-even",\n      "sd-vault": "vault",\n      "sd-vault-desktop": "vault",\n      "sd-miner-desktop": "miner",\n    };\n    return aliases[value] || value;\n  }\n\n  function embeddedOfficialExtensionSha256(packageId, version) {\n    const id = canonicalOfficialExtensionPackageId(packageId);\n    const cleanVersion = String(version || "").trim();\n    return CURRENT_OFFICIAL_EXTENSION_PACKAGE_SHA256[\`\${id}@\${cleanVersion}\`] || "";\n  }\n\n  function normalizedOfficialExtensionSha256(rule, packageId, version) {\n    const remote = String(rule?.sha256 || "").trim().toLowerCase();\n    const remotePresent = Boolean(remote);\n    if (remotePresent && !/^[a-f0-9]{64}$/.test(remote)) {\n      throw new Error("확장팩 카탈로그 SHA-256 형식이 올바르지 않아 설치 또는 업데이트를 중단했습니다.");\n    }\n\n    const embedded = embeddedOfficialExtensionSha256(packageId, version);\n    if (embedded) {\n      if (remotePresent && remote !== embedded) {\n        throw new Error("확장팩 카탈로그 SHA-256이 센터의 검증값과 충돌해 설치 또는 업데이트를 중단했습니다.");\n      }\n      return embedded;\n    }\n\n    if (!remotePresent) {\n      throw new Error("검증된 확장팩 SHA-256 정보가 없어 설치 또는 업데이트를 중단했습니다.");\n    }\n    return remote;\n  }`;
mustReplace(oldShaHelper, newShaHelper, "embedded current package trust pins");

mustReplace(
  "    const expectedSha256 = normalizedOfficialExtensionSha256(rule);",
  "    const expectedSha256 = normalizedOfficialExtensionSha256(\n      rule,\n      inspected.metadata.id,\n      version,\n    );",
  "verify with embedded package identity",
);

mustReplace(
  '        sha256: String(rule?.sha256 || "").trim().toLowerCase(),',
  '        sha256: normalizedOfficialExtensionSha256(\n          rule,\n          id,\n          String(rule?.version || "").trim(),\n        ),',
  "bulk downloader uses embedded trust pin",
);

for (const marker of [
  "CURRENT_OFFICIAL_EXTENSION_PACKAGE_SHA256",
  "embeddedOfficialExtensionSha256",
  "canonicalOfficialExtensionPackageId",
  "확장팩 카탈로그 SHA-256이 센터의 검증값과 충돌",
  'version: "1.4.1"',
  'version: "1.1.0"',
  'sha256: "032d7e9fec32d99f9ae13a568baa1d1d80c5fb713392bdd103ccbd3ce9f59707"',
  'sha256: "3a1b1c156b233d0d74555dce2f8899030cd4573f00524dc4edeb4e130a1ace08"',
]) {
  if (!main.includes(marker)) throw new Error(`bootstrap hardening marker missing: ${marker}`);
}

fs.writeFileSync(mainPath, main, "utf8");
console.log("SDCenter extension updater trust bootstrap applied: current official SHA pins embedded + required-policy fallback current");
