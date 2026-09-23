"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..", "..");
const electronPath = require(path.join(root, ".runtime-electron-ci", "node_modules", "electron"));
const { chromium } = require(path.join(root, ".runtime-electron-ci", "node_modules", "playwright-core"));
const mainFile = path.join(root, "miner-remake", "runtime-v1", "electron", "app-main.cjs");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sd-miner-runtime-electron-"));
const outDir = path.join(root, "ui-artifacts", "miner-runtime-v1-electron");
const port = 9444;
fs.mkdirSync(outDir, { recursive: true });

let output = "";
const child = spawn(electronPath, [`--remote-debugging-port=${port}`, mainFile], {
  cwd: root,
  env: {
    ...process.env,
    SD_MINER_RUNTIME_GATE: "1",
    SD_MINER_RUNTIME_USER_DATA: profile,
    ELECTRON_ENABLE_LOGGING: "1",
  },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (chunk) => { output += chunk.toString(); process.stdout.write(chunk); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); process.stderr.write(chunk); });

async function waitForCdp() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Electron exited early with code ${child.exitCode}\n${output}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Electron CDP endpoint did not become ready");
}

async function cleanup() {
  if (child.exitCode == null) child.kill();
  await new Promise((resolve) => setTimeout(resolve, 800));
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  } catch (error) {
    console.warn(`Electron gate temp profile cleanup skipped: ${error.code || error.message}`);
  }
}

(async () => {
  await waitForCdp();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    const context = browser.contexts()[0];
    assert(context, "Electron browser context missing");
    const deadline = Date.now() + 20000;
    let page = null;
    while (Date.now() < deadline && !page) {
      for (const candidate of context.pages()) {
        try {
          if ((await candidate.title()) === "SD광부") {
            page = candidate;
            break;
          }
        } catch (_) {}
      }
      if (!page) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert(page, "Electron opened but SD광부 UI did not load");
    await page.waitForFunction(() => window.__sdMinerRuntimeGate?.ready === true || Boolean(window.__sdMinerRuntimeGate?.error), null, { timeout: 20000 });
    const gate = await page.evaluate(() => window.__sdMinerRuntimeGate);
    assert.equal(gate.error, null, `runtime bootstrap error: ${gate.error}`);
    assert.equal(gate.bridgeVersion, "miner-runtime-electron-v1");
    assert.equal(gate.phaserVersion, "4.2.1");
    assert.equal(gate.p1ExecutionAdapterReady, true);
    assert.equal(gate.persistence.appendSeq, 1);
    assert.equal(gate.persistence.writeOk, true);
    assert.equal(gate.persistence.snapshotCount, 1);
    assert.equal(gate.persistence.journalCount, 1);
    assert.equal(gate.persistence.latestCommitSeq, 1);
    assert.equal(await page.locator("#connectionLabel").innerText(), "Core 연동 대기");
    assert(await page.locator('[data-view="mine"]').isVisible(), "mine view must be visible");
    assert(await page.locator("#encounterRuntimeHost canvas").count() >= 1, "integrated Phaser canvas missing");
    assert.equal(await page.locator("#encounterRuntimeStatus").innerText(), "RUNTIME READY");
    await page.screenshot({ path: path.join(outDir, "electron-ui-runtime-integration.png"), fullPage: true });
    console.log("SD광부 UI -> secure Electron -> runtime IPC -> Phaser + P1 execution adapter integration PASS");
  } finally {
    await browser.close();
    await cleanup();
  }
})().catch(async (error) => {
  console.error(error.stack || error);
  await cleanup();
  process.exit(1);
});
