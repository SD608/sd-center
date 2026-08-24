"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  EXPECTED_VERSION,
  EXPECTED_SHA256,
  BUNDLE_FILE,
  patchMain,
} = require("./patch-ch3-final-sdlink-bundle.js");

const sourceMain = process.argv[2];
assert.ok(sourceMain && fs.existsSync(sourceMain), "existing staged main.js path is required");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sdlink-bundle-patch-test-"));
try {
  const target = path.join(temp, "main.js");
  fs.copyFileSync(sourceMain, target);
  patchMain(target);
  const patched = fs.readFileSync(target, "utf8");

  assert.match(patched, new RegExp(`CH3_FINAL_BUNDLED_SDLINK_VERSION = "${EXPECTED_VERSION.replaceAll('.', '\\.')}"`));
  assert.ok(patched.includes(`CH3_FINAL_BUNDLED_SDLINK_SHA256 = "${EXPECTED_SHA256}"`));
  assert.ok(patched.includes(`CH3_FINAL_BUNDLED_SDLINK_FILE = "${BUNDLE_FILE}"`));
  assert.ok(patched.includes("ensureBundledIntegratedSdLink();"));
  assert.ok(patched.includes("const existing = appById.get(SD_LINK_ID);"));
  assert.ok(patched.includes("const bundlePath = path.join(__dirname, \"bundled\", CH3_FINAL_BUNDLED_SDLINK_FILE);"));
  assert.ok(patched.includes("installInspectedZip(inspected, destinationDirectory);"));
  assert.ok(patched.includes("registry = upsertCustomApp(registry, appEntry);"));
  assert.ok(patched.includes("reloadCatalog();"));
  assert.ok(patched.includes("app.quit();"));
  assert.equal((patched.match(/ensureBundledIntegratedSdLink\(\);/g) || []).length, 1);

  assert.throws(() => patchMain(target), /already applied/);
  console.log("PASS bundled SD Link bootstrap patch regression");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
