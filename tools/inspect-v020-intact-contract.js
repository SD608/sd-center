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
const testAssets = decode("testAssets");
const assets = decode("themeAssets");
const catalog = decode("themeCatalog");

console.log("V020_TEST_UI_BEGIN");
console.log(testUi);
console.log("V020_TEST_UI_END");
console.log("V020_TEST_ASSETS_BEGIN");
console.log(testAssets);
console.log("V020_TEST_ASSETS_END");

function signatures(label, text) {
  console.log(`${label}_SIGNATURES_BEGIN`);
  for (const line of text.split(/\r?\n/)) {
    if (/^(async\s+)?function\s+|^\s{0,4}(async\s+)?[A-Za-z_$][\w$]*\s*[:=]\s*(async\s*)?\(/.test(line) || /module\.exports|exports\./.test(line)) {
      console.log(line);
    }
  }
  console.log(`${label}_SIGNATURES_END`);
}

function functionChunk(text, name) {
  const start = text.indexOf(`function ${name}(`) >= 0 ? text.indexOf(`function ${name}(`) : text.indexOf(`async function ${name}(`);
  if (start < 0) return "";
  const next = text.indexOf("\n  async function ", start + 1);
  const nextPlain = text.indexOf("\n  function ", start + 1);
  const ends = [next, nextPlain].filter((n) => n > start);
  const end = ends.length ? Math.min(...ends) : Math.min(text.length, start + 7000);
  return text.slice(start, end);
}

signatures("V020_THEME_ASSETS", assets);
signatures("V020_THEME_CATALOG", catalog);
for (const name of ["getThemeState", "getInstalledTheme", "enrichCatalog", "installTheme"]) {
  const chunk = functionChunk(assets, name);
  if (chunk) {
    console.log(`V020_ASSET_FUNCTION_${name}_BEGIN`);
    console.log(chunk);
    console.log(`V020_ASSET_FUNCTION_${name}_END`);
  }
}
