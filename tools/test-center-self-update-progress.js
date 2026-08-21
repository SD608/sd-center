"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdcenter-update-progress-"));
const publicCss = path.join(tempRoot, "public", "css");
const publicJs = path.join(tempRoot, "public", "js");
fs.mkdirSync(publicCss, { recursive: true });
fs.mkdirSync(publicJs, { recursive: true });

const mainFixture = `
const app = { getVersion: () => "2.2.8" };
const autoUpdater = { on() {}, checkForUpdates() {}, quitAndInstall() {} };
const dialog = { showMessageBox: async () => ({ response: 1 }) };
const appCatalog = [];
const terminateAppAndWait = async () => {};
let isQuitting = false;
let centerUpdateState = { phase: "idle", updateAvailable: false, downloaded: false, version: "", error: "" };
function sendCenterUpdateState(extra = {}) { centerUpdateState = { ...centerUpdateState, ...extra }; return centerUpdateState; }
autoUpdater.on("checking-for-update", () => sendCenterUpdateState({ phase: "checking", error: "" }));
autoUpdater.on("update-available", () => sendCenterUpdateState({ phase: "available", updateAvailable: true, downloaded: false, error: "" }));
autoUpdater.on("update-not-available", () => sendCenterUpdateState({ phase: "latest", updateAvailable: false, downloaded: false, version: app.getVersion(), error: "" }));
autoUpdater.on("update-downloaded", (_event, releaseNotes, releaseName) => {
  const match = String(releaseName || "").match(/(\\d+(?:\\.\\d+){1,3})/);
  sendCenterUpdateState({ phase: "downloaded", updateAvailable: true, downloaded: true, version: match ? match[1] : "", releaseNotes: String(releaseNotes || ""), error: "" });
});
autoUpdater.on("error", (error) => sendCenterUpdateState({ phase: "error", error: error?.message || String(error) }));
async function checkCenterSelfUpdate() {
  try {
    sendCenterUpdateState({ phase: "checking", error: "" });
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (error) {
    return { ok: false, ...sendCenterUpdateState({ phase: "error", error: error?.message || String(error) }) };
  }
}
async function installCenterSelfUpdate() {
  const confirmation = await dialog.showMessageBox();
  if (confirmation.response !== 1) return { ok: false, canceled: true };
  await Promise.all(appCatalog.map((entry) => terminateAppAndWait(entry.id)));
  isQuitting = true;
  setTimeout(() => autoUpdater.quitAndInstall(), 120);
  return { ok: true, installing: true };
}
`;

const rendererFixture = `
const elements = { centerUpdateButton: null };
const state = {
  toastTimer: null,
  selfUpdate: { phase: "idle", updateAvailable: false, downloaded: false, version: "", error: "" },
};
function renderSelfUpdate() {
  const button = elements.centerUpdateButton;
  if (!button) return;
  const update = state.selfUpdate || {};
  button.classList.toggle("is-available", Boolean(update.updateAvailable));
  button.disabled = update.phase === "checking" || update.phase === "installing";
  if (update.phase === "checking") button.textContent = "센터 업데이트 확인 중...";
  else if (update.downloaded) button.textContent = update.version ? "센터 v" + update.version + " 설치" : "다운로드 완료 · 설치";
  else if (update.updateAvailable) button.textContent = "센터 업데이트 다운로드 중...";
  else button.textContent = "센터 업데이트";
}
`;

fs.writeFileSync(path.join(tempRoot, "main.js"), mainFixture, "utf8");
fs.writeFileSync(path.join(publicCss, "style.css"), ".center-update-button{min-height:36px}\n", "utf8");
fs.writeFileSync(path.join(publicJs, "app.js"), rendererFixture, "utf8");

const patchPath = path.join(__dirname, "patch-center-self-update-progress.js");
function runPatch() {
  const result = spawnSync(process.execPath, [patchPath, tempRoot], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
  }
  assert.equal(result.status, 0, "progress patch should succeed");
}

runPatch();
runPatch(); // idempotency regression

const main = fs.readFileSync(path.join(tempRoot, "main.js"), "utf8");
const css = fs.readFileSync(path.join(publicCss, "style.css"), "utf8");
const renderer = fs.readFileSync(path.join(publicJs, "app.js"), "utf8");

assert.match(main, /progress: null, version: "", error: ""/);
assert.equal((main.match(/phase: "checking", progress: null/g) || []).length, 2, "all checking paths must clear stale progress");
assert.equal((main.match(/phase: "error", progress: null/g) || []).length, 2, "all error paths must clear stale progress");
assert.equal((main.match(/phase: "downloaded"[\s\S]*?progress: 100/g) || []).length, 1, "download completion must be 100%");
assert.match(main, /phase: "installing", progress: 100/);
assert.doesNotMatch(main, /phase: "checking", error: ""/);
assert.doesNotMatch(main, /phase: "error", error: error\?\.message/);

assert.match(renderer, /update\.progress == null \? Number\.NaN/);
assert.match(renderer, /is-progressing/);
assert.match(renderer, /has-progress-value/);
assert.match(renderer, /is-progress-complete/);
assert.match(renderer, /--center-update-progress/);
assert.match(renderer, /aria-busy/);
assert.match(renderer, /Math\.round\(progress\) \+ "%"/);
assert.match(renderer, /정확한 바이트 퍼센트를 제공하지 않아/);
assert.doesNotMatch(renderer, /const progressNumber = Number\(update\.progress\)/, "null must never become a fake 0% value");

assert.match(css, /center-update-progress-slide/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /overflow: hidden/);

for (const file of [path.join(tempRoot, "main.js"), path.join(publicJs, "app.js")]) {
  const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  assert.equal(checked.status, 0, `${path.basename(file)} syntax check failed: ${checked.stderr}`);
}

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log("Center update progress regression PASS");
