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
    assert.equal(await page.evaluate(() => window.runtimeHarness.p1ExecutionAdapterVersion()), true);
    assert((await page.locator("canvas").count()) >= 1, "Phaser canvas missing");
    assert.equal(await page.evaluate(() => window.runtimeHarness.runCycles(100)), 100);

    const gate = await page.evaluate(() => window.runtimeHarness.runP1ExecutionGate());
    assert.equal(gate.forepaw.hits.length, 1);
    assert.equal(gate.forepaw.state.armor, 0);
    assert.equal(gate.forepaw.state.hp, 88);
    assert.equal(gate.forepaw.state.laceration_percent, 12);

    assert.equal(gate.jumpGuard.hits.length, 1);
    assert.equal(gate.jumpGuard.hits[0].shield_guard_applied, true);
    assert.equal(gate.jumpGuard.state.hp, 92);
    assert.equal(gate.jumpGuard.state.laceration_percent, 0);

    assert.equal(gate.tailParry.hits.length, 1, "tail sweep must apply at most one contact per use");
    assert.equal(gate.tailParry.hits[0].nullified_by, "SWORD_PARRY");
    assert.equal(gate.tailParry.state.hp, 100);

    assert.equal(gate.spikes.burst.spawned, 6);
    assert.equal(gate.spikes.burst.hits, 6);
    assert.equal(gate.spikes.hits.length, 6);
    assert.equal(gate.spikes.state.hp, 52);
    assert.equal(gate.spikes.state.laceration_percent, 48);

    assert.equal(gate.blockedSpikes.burst.spawned, 6);
    assert.equal(gate.blockedSpikes.burst.hits, 0);
    assert.equal(gate.blockedSpikes.hits.length, 0);
    assert.equal(gate.blockedSpikes.state.hp, 100);

    const outDir = path.resolve(__dirname, "../../../ui-artifacts/miner-runtime-v1");
    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, "runtime-foundation.png"), fullPage: true });
    console.log("miner runtime Phaser 4.2.1 boot/re-enter x100 + Abister P1 execution/damage Gate PASS");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
