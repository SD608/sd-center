"use strict";
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { chromium } = require(path.resolve(__dirname, "../../../.runtime-ci/node_modules/playwright-core"));

function edgePath() {
  const candidates = [
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

(async () => {
  const executablePath = edgePath();
  assert(executablePath, "Microsoft Edge executable not found");
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
    const url = pathToFileURL(path.join(__dirname, "..", "dev", "index.html")).href;
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector("#runtimeStatus")?.textContent === "READY", null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => window.runtimeHarness.phaserVersion()), "4.2.1");
    assert((await page.locator("canvas").count()) >= 1, "Phaser canvas missing");
    assert.equal(await page.evaluate(() => window.runtimeHarness.runCycles(100)), 100);
    const outDir = path.resolve(__dirname, "../../../ui-artifacts/miner-runtime-v1");
    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, "runtime-foundation.png"), fullPage: true });
    console.log("miner runtime Phaser 4.2.1 boot/re-enter x100 PASS");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
