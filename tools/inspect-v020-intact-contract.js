"use strict";

const fs = require("node:fs");
const zlib = require("node:zlib");

const patchPath = process.argv[2] || "tools/patch-center-ui-v020.js";
const source = fs.readFileSync(patchPath, "utf8");

function decode(name) {
  const match = new RegExp(`"${name}":"([A-Za-z0-9+/=]+)"`).exec(source);
  if (!match) throw new Error(`payload missing: ${name}`);
  return zlib.gunzipSync(Buffer.from(match[1], "base64")).toString("utf8");
}

const testUi = decode("testUi");
const assets = decode("themeAssets");
const catalog = decode("themeCatalog");

console.log("V020_TEST_UI_BEGIN");
console.log(testUi);
console.log("V020_TEST_UI_END");

function signatures(label, text) {
  console.log(`${label}_SIGNATURES_BEGIN`);
  for (const line of text.split(/\r?\n/)) {
    if (/^(async\s+)?function\s+|^\s{0,4}(async\s+)?[A-Za-z_$][\w$]*\s*[:=]\s*(async\s*)?\(/.test(line) || /module\.exports|exports\./.test(line)) {
      console.log(line);
    }
  }
  console.log(`${label}_SIGNATURES_END`);
}

signatures("V020_THEME_ASSETS", assets);
signatures("V020_THEME_CATALOG", catalog);

for (const marker of [
  "installTheme",
  "getInstalledTheme",
  "repair",
  "updateAvailable",
  "manifestSha256",
  "backgroundPath",
  "thumbnailPath",
]) {
  const hits = assets.split(/\r?\n/).filter((line) => line.includes(marker));
  if (hits.length) {
    console.log(`V020_ASSET_MARKER ${marker}`);
    for (const line of hits.slice(0, 12)) console.log(line);
  }
}
