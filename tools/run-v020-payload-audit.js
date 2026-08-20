"use strict";

const fs = require("node:fs");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");

const patchPath = process.argv[2];
const appRoot = process.argv[3];
if (!patchPath || !appRoot) {
  throw new Error("Usage: node run-v020-payload-audit.js <patch-script> <app-root>");
}

const source = fs.readFileSync(patchPath, "utf8");
const start = source.indexOf("const E={");
const tail = source.slice(Math.max(0, start));
const endMatch = /};\r?\nconst d=/.exec(tail);
if (start < 0 || !endMatch) throw new Error("v0.20 embedded payload object not found");
const end = start + endMatch.index;

const objectText = source.slice(start, end);
const payloadRe = /"([A-Za-z0-9_]+)":"([A-Za-z0-9+/=]+)"/g;
const results = [];
let match;
while ((match = payloadRe.exec(objectText))) {
  const key = match[1];
  const encoded = match[2];
  try {
    const decoded = zlib.gunzipSync(Buffer.from(encoded, "base64"));
    results.push({ key, ok: true, encodedBytes: encoded.length, decodedBytes: decoded.length });
  } catch (error) {
    results.push({ key, ok: false, encodedBytes: encoded.length, error: error?.message || String(error) });
  }
}

if (!results.length) throw new Error("v0.20 embedded payload entries not found");
for (const result of results) {
  if (result.ok) console.log(`V020_PAYLOAD_OK ${result.key} encoded=${result.encodedBytes} decoded=${result.decodedBytes}`);
  else console.error(`V020_PAYLOAD_CORRUPT ${result.key} encoded=${result.encodedBytes} error=${result.error}`);
}

const corrupt = results.filter((entry) => !entry.ok);
if (corrupt.length) {
  throw new Error(`v0.20 embedded payload audit failed: ${corrupt.map((entry) => entry.key).join(", ")}`);
}

const run = spawnSync(process.execPath, [patchPath, appRoot], {
  stdio: "inherit",
  windowsHide: true,
});
if (run.error) throw run.error;
if (run.status !== 0) process.exit(run.status || 1);
console.log("v0.20 embedded payload audit + patch completed");
