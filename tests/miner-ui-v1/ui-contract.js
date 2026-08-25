"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..", "..");
const html = fs.readFileSync(path.join(root, "miner-remake/ui-v1/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "miner-remake/ui-v1/styles.css"), "utf8");
const js = fs.readFileSync(path.join(root, "miner-remake/ui-v1/ui.js"), "utf8");
const contract = fs.readFileSync(path.join(root, "miner-remake/ui-v1/CONTRACT.md"), "utf8");

const requiredIds = [
  "appRoot", "connectionLabel", "toolSummary", "storageSummary", "dailySummary",
  "upgradeToolButton", "upgradeStorageButton", "inventoryList", "sellAllButton",
  "mineStage", "mineButton", "claimButton", "jobStatus", "mineInventoryList", "toast",
];
for (const id of requiredIds) assert(html.includes(`id=\"${id}\"`), `missing UI id ${id}`);

for (const action of ["start", "claim", "upgrade-tool", "upgrade-storage", "sell-all"]) {
  assert(html.includes(`data-ui-action=\"${action}\"`), `missing action ${action}`);
}

for (const banned of [
  "wallet:auto-detect", "wallet:choose-database", "wallet:get-account-state",
  "mining:mine", "shop:sell", "shop:sell-all", "buyAutoMiningUpgrade",
  "sdwallet.sqlite", "sqlite3", "window.sdMiner.",
]) {
  assert(!html.includes(banned) && !js.includes(banned), `legacy authority token present: ${banned}`);
}

assert(js.includes('CustomEvent("sd-miner-ui-action"'), "UI actions must cross the explicit adapter event boundary");
assert(js.includes("window.sdMinerUI = Object.freeze"), "server-to-UI contract must be explicit and immutable");
assert(js.includes('connection: "waiting"'), "default UI must fail closed while Core adapter is absent");
assert(js.includes('get("demo") === "1"'), "demo state must be opt-in only");
assert(js.includes("Core 연동 후 사용할 수 있습니다."), "disconnected mutation must fail closed visibly");
assert(js.includes("ERROR_TEXT"), "public error translation is required");
assert(!js.includes("innerHTML"), "UI should not use innerHTML for server-derived values");

assert(css.includes("@media(max-width:1180px)"), "wide responsive breakpoint missing");
assert(css.includes("@media(max-width:920px)"), "medium responsive breakpoint missing");
assert(css.includes("@media(max-width:650px)"), "narrow responsive breakpoint missing");
assert(css.includes("prefers-reduced-motion"), "reduced-motion support missing");
assert(!css.includes("min-width:930px"), "legacy fixed min-width must not return");
assert(contract.includes("실제 Windows 사용자 시각 검증 전에는 최종 UI Gate PASS가 아니다"), "physical UI Gate warning missing");

console.log("miner-ui-v1 static authority/layout contract PASS");
