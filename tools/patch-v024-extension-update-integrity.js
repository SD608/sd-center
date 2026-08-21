"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-v024-extension-update-integrity.js <app-root>");

const mainPath = path.join(root, "main.js");
let main = fs.readFileSync(mainPath, "utf8").replace(/\r\n/g, "\n");

function mustReplace(oldText, newText, label) {
  if (!main.includes(oldText)) throw new Error(`missing updater source marker: ${label}`);
  main = main.replace(oldText, newText);
}

if (!main.includes('const crypto = require("node:crypto");')) {
  mustReplace(
    'const fs = require("node:fs");\n',
    'const crypto = require("node:crypto");\nconst fs = require("node:fs");\n',
    "crypto import",
  );
}

const helperMarker = "  function extensionStoreRule(id) {";
if (!main.includes("function verifyOfficialExtensionPackage(")) {
  const helpers = `  function normalizedOfficialExtensionSha256(rule) {\n    const expected = String(rule?.sha256 || \"\").trim().toLowerCase();\n    if (!/^[a-f0-9]{64}$/.test(expected)) {\n      throw new Error(\"검증된 확장팩 SHA-256 정보가 없어 설치 또는 업데이트를 중단했습니다.\");\n    }\n    return expected;\n  }\n\n  function extensionZipSha256(filePath) {\n    const hash = crypto.createHash(\"sha256\");\n    hash.update(fs.readFileSync(filePath));\n    return hash.digest(\"hex\");\n  }\n\n  function verifyOfficialExtensionPackage(inspected, rule, zipPath, expectedVersion) {\n    const version = String(expectedVersion || rule?.version || \"\").trim();\n    if (!version) {\n      throw new Error(\"검증된 확장팩 버전 정보가 없어 설치 또는 업데이트를 중단했습니다.\");\n    }\n    if (compareVersions(inspected.metadata.rawVersion, version) !== 0) {\n      throw new Error(\n        \`다운로드된 버전(v\${inspected.metadata.rawVersion})이 검증된 버전(v\${version})과 다릅니다.\`,\n      );\n    }\n    const expectedSha256 = normalizedOfficialExtensionSha256(rule);\n    const actualSha256 = extensionZipSha256(zipPath);\n    if (actualSha256 !== expectedSha256) {\n      throw new Error(\"확장팩 파일 SHA-256이 검증값과 일치하지 않아 설치 또는 업데이트를 중단했습니다.\");\n    }\n    return actualSha256;\n  }\n\n`;
  mustReplace(helperMarker, helpers + helperMarker, "official extension integrity helpers");
}

mustReplace(
  '        downloadUrl: String(rule?.downloadUrl || "").trim(),\n      }))\n      .filter((entry) => {\n        if (!entry.id || !entry.version || !entry.downloadUrl) return false;',
  '        downloadUrl: String(rule?.downloadUrl || "").trim(),\n        sha256: String(rule?.sha256 || "").trim().toLowerCase(),\n      }))\n      .filter((entry) => {\n        if (!entry.id || !entry.version || !entry.downloadUrl) return false;\n        if (!/^[a-f0-9]{64}$/.test(entry.sha256)) return false;',
  "bulk download SHA pin",
);

mustReplace(
  '          inspectZip(temporary);\n          fs.rmSync(destination, { force: true });',
  '          const inspected = inspectZip(temporary);\n          verifyOfficialExtensionPackage(inspected, entry, temporary, entry.version);\n          fs.rmSync(destination, { force: true });',
  "bulk download exact identity verification",
);

const freshVersionCheck = `      if (\n        compareVersions(\n          inspected.metadata.rawVersion,\n          String(rule.version || \"0.0.0\"),\n        ) < 0\n      ) {\n        throw new Error(\n          \`다운로드된 버전(v\${inspected.metadata.rawVersion})이 상점 최신 버전(v\${rule.version})보다 낮습니다.\`,\n        );\n      }`;
mustReplace(
  freshVersionCheck,
  '      verifyOfficialExtensionPackage(\n        inspected,\n        rule,\n        temporaryZipPath,\n        String(rule.version || ""),\n      );',
  "fresh store exact version and SHA verification",
);

const requiredVersionCheck = `      if (\n        compareVersions(\n          inspected.metadata.rawVersion,\n          requiredVersion,\n        ) < 0\n      ) {\n        throw new Error(\n          \`다운로드된 버전(v\${inspected.metadata.rawVersion})이 필수 버전(v\${requiredVersion})보다 낮습니다.\`,\n        );\n      }`;
mustReplace(
  requiredVersionCheck,
  '      const requiredPackageVersion = String(rule.version || "").trim();\n      if (!requiredPackageVersion || compareVersions(requiredPackageVersion, requiredVersion) < 0) {\n        throw new Error("필수 업데이트 정책의 검증 버전 정보가 올바르지 않습니다.");\n      }\n      verifyOfficialExtensionPackage(\n        inspected,\n        rule,\n        temporaryZipPath,\n        requiredPackageVersion,\n      );',
  "required update exact version and SHA verification",
);

const catalogVersionCheck = `      if (\n        compareVersions(inspected.metadata.rawVersion, latestVersion) < 0\n      ) {\n        throw new Error(\n          \`다운로드된 버전(v\${inspected.metadata.rawVersion})이 최신 버전(v\${latestVersion})보다 낮습니다.\`,\n        );\n      }`;
mustReplace(
  catalogVersionCheck,
  '      verifyOfficialExtensionPackage(\n        inspected,\n        rule,\n        temporaryZipPath,\n        latestVersion,\n      );',
  "catalog update exact version and SHA verification",
);

for (const marker of [
  'const crypto = require("node:crypto");',
  "verifyOfficialExtensionPackage",
  "normalizedOfficialExtensionSha256",
  "extensionZipSha256",
  'crypto.createHash("sha256")',
  "actualSha256 !== expectedSha256",
  "compareVersions(inspected.metadata.rawVersion, version) !== 0",
]) {
  if (!main.includes(marker)) throw new Error(`integrity hardening marker missing: ${marker}`);
}

fs.writeFileSync(mainPath, main, "utf8");
console.log("SDCenter extension update integrity hardening applied: exact version + SHA-256 required");
