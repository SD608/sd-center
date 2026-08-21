"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

const patchPath = process.argv[2] || "tools/patch-center-ui-v020.js";
const outputPath = process.argv[3] || "";
const source = fs.readFileSync(patchPath, "utf8");

function payload(name) {
  const re = new RegExp(`"${name}":"([A-Za-z0-9+/=]+)"`);
  const match = re.exec(source);
  if (!match) throw new Error(`payload missing: ${name}`);
  return match[1];
}

function gunzip(encoded) {
  return zlib.gunzipSync(Buffer.from(encoded, "base64")).toString("utf8");
}

const encoded = payload("uiBlock");
console.log(`uiBlock encoded length=${encoded.length} mod4=${encoded.length % 4}`);

const required = [
  "UI Preview v0.20",
  "restorePreviewThemeFromDisk",
  "installPreviewTheme",
  "updateAvailable",
  "data-preview-install-theme",
];

const candidates = [];
for (let index = 0; index < encoded.length; index += 1) {
  const repaired = encoded.slice(0, index) + encoded.slice(index + 1);
  try {
    const decoded = gunzip(repaired);
    if (!required.every((marker) => decoded.includes(marker))) continue;
    const sha256 = crypto.createHash("sha256").update(decoded, "utf8").digest("hex");
    candidates.push({ index, removed: encoded[index], decoded, sha256 });
    console.log(`V020_UI_RECOVERY_CANDIDATE index=${index} removed=${JSON.stringify(encoded[index])} decodedBytes=${Buffer.byteLength(decoded)} sha256=${sha256}`);
  } catch {
    // Expected for non-matching deletion positions.
  }
}

if (candidates.length !== 1) {
  throw new Error(`expected exactly one valid uiBlock recovery candidate, found ${candidates.length}`);
}

const winner = candidates[0];
if (outputPath) {
  fs.writeFileSync(outputPath, winner.decoded, "utf8");
  console.log(`Recovered uiBlock written: ${outputPath}`);
}
console.log(`V020_UI_RECOVERY_UNIQUE index=${winner.index} removed=${JSON.stringify(winner.removed)} sha256=${winner.sha256}`);
