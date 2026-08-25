"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");
const assert = require("assert");
const { chromium } = require(path.resolve(__dirname, "../../.ui-ci/node_modules/playwright-core"));

const root = path.resolve(__dirname, "..", "..");
const launcher = path.join(root, "miner-remake", "ui-v1", "RUN-WINDOWS-UI-GATE.cmd");
const port = "9333";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sd-miner-ui-gate-"));
const outDir = path.join(root, "ui-artifacts", "miner-v1");
fs.mkdirSync(outDir, { recursive: true });

function cleanupProfile() {
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  } catch (error) {
    console.warn(`UI gate temp profile cleanup skipped: ${error.code || error.message}`);
  }
}

const env = {
  ...process.env,
  SD_UI_GATE_E2E: "1",
  SD_UI_GATE_E2E_PORT: port,
  SD_UI_GATE_USER_DATA: profile,
};

const launch = spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/c", "call", launcher], {
  cwd: root,
  env,
  encoding: "utf8",
  timeout: 15000,
  windowsHide: true,
});

process.stdout.write(launch.stdout || "");
process.stderr.write(launch.stderr || "");
assert.strictEqual(launch.status, 0, `launcher exit ${launch.status}`);

async function waitForCdp() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Edge CDP endpoint did not become ready");
}

(async () => {
  await waitForCdp();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    const context = browser.contexts()[0];
    assert(context, "Edge context missing");

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

    assert(page, "CMD launched Edge but SD광부 page did not load");
    await page.waitForLoadState("domcontentloaded");
    assert(/index\.html\?demo=1/.test(page.url()), `unexpected URL: ${page.url()}`);
    assert.strictEqual(await page.locator("#connectionLabel").innerText(), "UI 미리보기");
    assert.strictEqual(await page.locator("#previewBadge").innerText(), "UI PREVIEW");
    assert(await page.locator("#previewBadge").isVisible(), "preview badge must be visible");
    assert(await page.locator('[data-view="workshop"]').isVisible(), "workshop must be visible");
    assert(await page.locator("#toolName").innerText(), "tool name missing");
    assert(await page.locator("#inventoryList .ore-row").count() === 5, "inventory rows missing");

    await page.screenshot({ path: path.join(outDir, "launcher-e2e.png"), fullPage: true });
    console.log("miner-ui-v1 CMD -> Edge -> SD광부 E2E PASS");
  } finally {
    await browser.close();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    cleanupProfile();
  }
})().catch((error) => {
  console.error(error.stack || error);
  cleanupProfile();
  process.exit(1);
});
