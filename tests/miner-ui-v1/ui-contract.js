"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..", "..");
const uiRoot = path.join(root, "miner-remake/ui-v1");
const html = fs.readFileSync(path.join(uiRoot, "index.html"), "utf8");
const css = fs.readFileSync(path.join(uiRoot, "styles.css"), "utf8");
const js = fs.readFileSync(path.join(uiRoot, "ui.js"), "utf8");
const contract = fs.readFileSync(path.join(uiRoot, "CONTRACT.md"), "utf8");
const gateCmd = fs.readFileSync(path.join(uiRoot, "RUN-WINDOWS-UI-GATE.cmd"), "utf8");
const gateHtml = fs.readFileSync(path.join(uiRoot, "WINDOWS-UI-GATE.html"), "utf8");

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

assert(gateCmd.includes("WINDOWS-UI-GATE.html"), "Windows Gate launcher must open local bootstrap file");
assert(gateCmd.includes("SD_UI_GATE_VALIDATE_ONLY"), "Windows Gate launcher validation mode missing");
assert(gateCmd.includes("SD_UI_GATE_E2E"), "Windows Gate launcher E2E mode missing");
assert(gateCmd.includes("--new-window"), "Windows Gate launcher must use normal local-file navigation");
assert(gateCmd.includes("Microsoft\\Edge\\Application\\msedge.exe"), "Windows Gate launcher must resolve Edge directly");
assert(!/powershell/i.test(gateCmd), "Windows Gate launcher must not require PowerShell");
assert(!fs.existsSync(path.join(uiRoot, "RUN-WINDOWS-UI-GATE.ps1")), "PowerShell Gate launcher must stay removed");
assert(gateHtml.includes("./index.html?demo=1"), "Gate bootstrap must redirect to demo UI with a relative local URL");
assert(!/https?:\/\//i.test(gateHtml), "Gate bootstrap must not require network navigation");

console.log("miner-ui-v1 static authority/layout contract PASS");
