"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const appRoot = process.argv[2];
if (!appRoot) throw new Error("Usage: node validate-v220-store-catalog.js <app-root>");

const { inspectZip } = require(path.join(appRoot, "src", "app-registry.js"));
const { compareVersions } = require(path.join(appRoot, "src", "required-updates.js"));
const catalogUrl = "https://sd608.github.io/sd-center/update/extensions-catalog.json";

(async () => {
  const response = await fetch(catalogUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`catalog HTTP ${response.status}`);
  const catalog = await response.json();
  const entries = Object.entries(catalog?.apps || {});
  if (entries.length < 1) throw new Error("store catalog is empty");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sd-store-check-"));
  try {
    for (const [id, rule] of entries) {
      if (!rule?.version || !rule?.downloadUrl) {
        throw new Error(`${id}: missing version/downloadUrl`);
      }
      const res = await fetch(String(rule.downloadUrl), { cache: "no-store" });
      if (!res.ok) throw new Error(`${id}: ZIP HTTP ${res.status}`);
      const zipPath = path.join(tempRoot, `${id}.zip`);
      fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
      const inspected = inspectZip(zipPath);
      if (inspected.metadata.id !== id) {
        throw new Error(`${id}: ZIP id mismatch (${inspected.metadata.id})`);
      }
      if (compareVersions(inspected.metadata.rawVersion, String(rule.version)) < 0) {
        throw new Error(`${id}: ZIP v${inspected.metadata.rawVersion} < catalog v${rule.version}`);
      }
      console.log(`${id}: v${inspected.metadata.rawVersion} OK`);
    }
    console.log(`Validated ${entries.length} store catalog ZIPs`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
