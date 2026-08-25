"use strict";

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const root = path.resolve(__dirname, "..", "..");
const { chromium } = require(path.join(root, ".ui-ci", "node_modules", "playwright-core"));
const candidates = [
  process.env.EDGE_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);
const executablePath = candidates.find((candidate) => fs.existsSync(candidate));
if (!executablePath) throw new Error("Microsoft Edge executable not found on Windows runner");

const output = path.join(root, "ui-artifacts", "miner-v1");
fs.mkdirSync(output, { recursive: true });
const pageUrl = `${pathToFileURL(path.join(root, "miner-remake", "ui-v1", "index.html")).href}?demo=1`;
const scenarios = [
  { name: "100", width: 1440, height: 1000 },
  { name: "125", width: 1152, height: 800 },
  { name: "150", width: 960, height: 720 },
];

async function assertLayout(page, label) {
  const result = await page.evaluate(() => {
    const visible = (node) => {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
    };
    const offenders = [...document.querySelectorAll(".panel,button,.topbar,.area-tabs")]
      .filter(visible)
      .map((node) => ({ tag: node.tagName, cls: node.className, box: node.getBoundingClientRect().toJSON() }))
      .filter((entry) => entry.box.left < -2 || entry.box.right > innerWidth + 2);
    const tinyButtons = [...document.querySelectorAll("button")]
      .filter(visible)
      .map((node) => ({ text: node.textContent.trim(), height: node.getBoundingClientRect().height }))
      .filter((entry) => entry.height < 34);
    return {
      innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      offenders,
      tinyButtons,
    };
  });
  if (result.scrollWidth > result.innerWidth + 2 || result.bodyScrollWidth > result.innerWidth + 2) {
    throw new Error(`${label}: horizontal overflow ${JSON.stringify(result)}`);
  }
  if (result.offenders.length) throw new Error(`${label}: clipped elements ${JSON.stringify(result.offenders)}`);
  if (result.tinyButtons.length) throw new Error(`${label}: undersized buttons ${JSON.stringify(result.tinyButtons)}`);
}

(async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const scenario of scenarios) {
      const page = await browser.newPage({ viewport: { width: scenario.width, height: scenario.height } });
      await page.goto(pageUrl, { waitUntil: "load" });
      await assertLayout(page, `${scenario.name}-workshop`);
      await page.screenshot({ path: path.join(output, `workshop-${scenario.name}.png`), fullPage: true });
      await page.click('[data-tab="mine"]');
      await assertLayout(page, `${scenario.name}-mine`);
      await page.screenshot({ path: path.join(output, `mine-${scenario.name}.png`), fullPage: true });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log("miner-ui-v1 Windows render smoke PASS");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
