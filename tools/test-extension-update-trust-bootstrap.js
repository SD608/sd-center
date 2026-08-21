"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const mainPath = process.argv[2];
if (!mainPath) throw new Error("Usage: node test-extension-update-trust-bootstrap.js <patched-main.js>");
const main = fs.readFileSync(mainPath, "utf8").replace(/\r\n/g, "\n");

const startMarker = "  const CURRENT_OFFICIAL_EXTENSION_PACKAGE_SHA256 = Object.freeze({";
const endMarker = "  function extensionStoreRule(id) {";
const start = main.indexOf(startMarker);
const end = main.indexOf(endMarker, start + startMarker.length);
if (start < 0 || end < 0 || end <= start) throw new Error("trust bootstrap helper block not found");
const helperSource = main.slice(start, end).replace(/^  /gm, "");

function compareVersions(left, right) {
  const a = String(left || "").split(".").map((v) => Number(v) || 0);
  const b = String(right || "").split(".").map((v) => Number(v) || 0);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

const context = { crypto, fs, compareVersions };
vm.createContext(context);
vm.runInContext(`${helperSource}\nthis.verifyOfficialExtensionPackage = verifyOfficialExtensionPackage; this.normalizedOfficialExtensionSha256 = normalizedOfficialExtensionSha256;`, context);
const verify = context.verifyOfficialExtensionPackage;
const resolveSha = context.normalizedOfficialExtensionSha256;
if (typeof verify !== "function" || typeof resolveSha !== "function") throw new Error("trust helper export failed");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-updater-trust-"));
try {
  const zip = path.join(dir, "candidate.zip");

  const pinnedVault = resolveSha({ version: "1.2.1" }, "vault", "1.2.1");
  if (pinnedVault !== "468030d343b97c09c152a9589c0e14d2831d6a6197e88e44c62b798af09ab95a") {
    throw new Error("embedded vault trust pin resolution failed");
  }

  const pinnedBitcoinAlias = resolveSha({ version: "1.2.2" }, "sd-bitcoin-miner-desktop", "1.2.2");
  if (pinnedBitcoinAlias !== "cd1dbc64f81f90fc3b2518ccee534243e521ca0f18a92d9839d2507ede45e65d") {
    throw new Error("bitcoin alias trust pin resolution failed");
  }

  let conflictBlocked = false;
  try {
    resolveSha({ version: "1.2.1", sha256: "0".repeat(64) }, "vault", "1.2.1");
  } catch {
    conflictBlocked = true;
  }
  if (!conflictBlocked) throw new Error("conflicting remote SHA was accepted over embedded current pin");

  let malformedBlocked = false;
  try {
    resolveSha({ version: "1.2.1", sha256: "bad" }, "vault", "1.2.1");
  } catch {
    malformedBlocked = true;
  }
  if (!malformedBlocked) throw new Error("malformed remote SHA was accepted");

  let futureMissingBlocked = false;
  try {
    resolveSha({ version: "1.2.2" }, "vault", "1.2.2");
  } catch {
    futureMissingBlocked = true;
  }
  if (!futureMissingBlocked) throw new Error("unpinned future version without remote SHA was accepted");

  const futureSha = "a".repeat(64);
  if (resolveSha({ version: "1.2.2", sha256: futureSha }, "vault", "1.2.2") !== futureSha) {
    throw new Error("future reviewed SHA could not be resolved");
  }

  const fakeBytes = Buffer.from("exact approved package bytes\n", "utf8");
  fs.writeFileSync(zip, fakeBytes);
  const digest = crypto.createHash("sha256").update(fakeBytes).digest("hex");
  let higherVersionBlocked = false;
  try {
    verify({ metadata: { id: "future-test", rawVersion: "2.0.1" } }, { version: "2.0.0", sha256: digest }, zip, "2.0.0");
  } catch {
    higherVersionBlocked = true;
  }
  if (!higherVersionBlocked) throw new Error("unexpected higher version was accepted");

  console.log("extension updater trust bootstrap regression PASS");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
