"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const mainPath = process.argv[2];
if (!mainPath) throw new Error("Usage: node test-extension-update-integrity-helper.js <patched-main.js>");
const main = fs.readFileSync(mainPath, "utf8").replace(/\r\n/g, "\n");

const startMarker = "  function normalizedOfficialExtensionSha256(rule) {";
const endMarker = "  function extensionStoreRule(id) {";
const start = main.indexOf(startMarker);
const end = main.indexOf(endMarker, start + startMarker.length);
if (start < 0 || end < 0 || end <= start) throw new Error("integrity helper block not found");

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
vm.runInContext(`${helperSource}\nthis.verifyOfficialExtensionPackage = verifyOfficialExtensionPackage;`, context);
const verify = context.verifyOfficialExtensionPackage;
if (typeof verify !== "function") throw new Error("verifyOfficialExtensionPackage was not exported from helper sandbox");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-updater-integrity-"));
try {
  const zip = path.join(dir, "candidate.zip");
  fs.writeFileSync(zip, Buffer.from("exact approved package bytes\n", "utf8"));
  const digest = crypto.createHash("sha256").update(fs.readFileSync(zip)).digest("hex");
  const inspected = { metadata: { rawVersion: "1.2.4" } };

  verify(inspected, { version: "1.2.4", sha256: digest }, zip, "1.2.4");

  let badHashBlocked = false;
  try {
    verify(inspected, { version: "1.2.4", sha256: "0".repeat(64) }, zip, "1.2.4");
  } catch {
    badHashBlocked = true;
  }
  if (!badHashBlocked) throw new Error("wrong SHA-256 was accepted");

  let higherVersionBlocked = false;
  try {
    verify({ metadata: { rawVersion: "1.2.5" } }, { version: "1.2.4", sha256: digest }, zip, "1.2.4");
  } catch {
    higherVersionBlocked = true;
  }
  if (!higherVersionBlocked) throw new Error("unexpected higher version was accepted");

  let missingHashBlocked = false;
  try {
    verify(inspected, { version: "1.2.4" }, zip, "1.2.4");
  } catch {
    missingHashBlocked = true;
  }
  if (!missingHashBlocked) throw new Error("missing SHA-256 was accepted");

  let missingVersionBlocked = false;
  try {
    verify(inspected, { sha256: digest }, zip, "");
  } catch {
    missingVersionBlocked = true;
  }
  if (!missingVersionBlocked) throw new Error("missing exact version was accepted");

  console.log("extension update integrity helper regression PASS");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
