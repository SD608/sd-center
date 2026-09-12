"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-center-self-update-progress.js <app-root>");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
}

function write(rel, content) {
  fs.writeFileSync(path.join(root, rel), content, "utf8");
}

function replaceOnce(source, needle, replacement, label) {
  const index = source.indexOf(needle);
  if (index < 0) throw new Error(`Patch marker missing: ${label}`);
  return source.slice(0, index) + replacement + source.slice(index + needle.length);
}

function replaceAllRequired(source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`Patch marker missing: ${label}`);
  return source.split(needle).join(replacement);
}

let main = read("main.js");

if (!main.includes('progress: null, version: "", error: ""')) {
  main = replaceOnce(
    main,
    '  let centerUpdateState = { phase: "idle", updateAvailable: false, downloaded: false, version: "", error: "" };',
    '  let centerUpdateState = { phase: "idle", updateAvailable: false, downloaded: false, progress: null, version: "", error: "" };',
    "center update state progress",
  );
}

if (!main.includes('phase: "checking", progress: null')) {
  main = replaceAllRequired(
    main,
    'sendCenterUpdateState({ phase: "checking", error: "" })',
    'sendCenterUpdateState({ phase: "checking", progress: null, error: "" })',
    "all checking states",
  );
}
if (!main.includes('phase: "available", updateAvailable: true, downloaded: false, progress: null')) {
  main = replaceAllRequired(
    main,
    'sendCenterUpdateState({ phase: "available", updateAvailable: true, downloaded: false, error: "" })',
    'sendCenterUpdateState({ phase: "available", updateAvailable: true, downloaded: false, progress: null, error: "" })',
    "available state",
  );
}
if (!main.includes('phase: "latest", updateAvailable: false, downloaded: false, progress: 100')) {
  main = replaceAllRequired(
    main,
    'sendCenterUpdateState({ phase: "latest", updateAvailable: false, downloaded: false, version: app.getVersion(), error: "" })',
    'sendCenterUpdateState({ phase: "latest", updateAvailable: false, downloaded: false, progress: 100, version: app.getVersion(), error: "" })',
    "latest state",
  );
}
if (!main.includes('phase: "downloaded", updateAvailable: true, downloaded: true, progress: 100')) {
  main = replaceAllRequired(
    main,
    'sendCenterUpdateState({ phase: "downloaded", updateAvailable: true, downloaded: true, version: match ? match[1] : "", releaseNotes: String(releaseNotes || ""), error: "" })',
    'sendCenterUpdateState({ phase: "downloaded", updateAvailable: true, downloaded: true, progress: 100, version: match ? match[1] : "", releaseNotes: String(releaseNotes || ""), error: "" })',
    "downloaded state",
  );
}
if (!main.includes('phase: "error", progress: null')) {
  main = replaceAllRequired(
    main,
    'sendCenterUpdateState({ phase: "error", error: error?.message || String(error) })',
    'sendCenterUpdateState({ phase: "error", progress: null, error: error?.message || String(error) })',
    "all error states",
  );
}

if (!main.includes('phase: "installing", progress: 100')) {
  main = replaceOnce(
    main,
    '    if (confirmation.response !== 1) return { ok: false, canceled: true };\n    await Promise.all(appCatalog.map((entry) => terminateAppAndWait(entry.id)));',
    '    if (confirmation.response !== 1) return { ok: false, canceled: true };\n    sendCenterUpdateState({ phase: "installing", progress: 100, error: "" });\n    await Promise.all(appCatalog.map((entry) => terminateAppAndWait(entry.id)));',
    "installing state",
  );
}

write("main.js", main);

let css = read("public/css/style.css");
if (!css.includes("center-update-progress-slide")) {
  css += `

/* Next Center update: honest download/install progress indicator. */
.center-update-button {
  position: relative;
  overflow: hidden;
}
.center-update-button::after {
  content: "";
  position: absolute;
  left: 0;
  bottom: 0;
  width: 0;
  height: 3px;
  opacity: 0;
  background: currentColor;
  pointer-events: none;
  transition: width 180ms ease, opacity 180ms ease;
}
.center-update-button.is-progressing::after {
  left: -38%;
  width: 38%;
  opacity: 0.72;
  animation: center-update-progress-slide 1.05s ease-in-out infinite;
}
.center-update-button.has-progress-value::after {
  left: 0;
  width: var(--center-update-progress, 0%);
  opacity: 0.72;
  animation: none;
}
.center-update-button.is-progress-complete::after {
  left: 0;
  width: 100%;
  opacity: 0.72;
  animation: none;
}
@keyframes center-update-progress-slide {
  from { transform: translateX(0); }
  to { transform: translateX(365%); }
}
@media (prefers-reduced-motion: reduce) {
  .center-update-button.is-progressing::after {
    left: 18%;
    width: 64%;
    transform: none;
    animation: none;
  }
}
`;
}
write("public/css/style.css", css);

let renderer = read("public/js/app.js");
if (!renderer.includes('selfUpdate: { phase: "idle", updateAvailable: false, downloaded: false, progress: null')) {
  renderer = replaceOnce(
    renderer,
    '  selfUpdate: { phase: "idle", updateAvailable: false, downloaded: false, version: "", error: "" },',
    '  selfUpdate: { phase: "idle", updateAvailable: false, downloaded: false, progress: null, version: "", error: "" },',
    "renderer update progress state",
  );
}

const oldRender = `function renderSelfUpdate() {
  const button = elements.centerUpdateButton;
  if (!button) return;
  const update = state.selfUpdate || {};
  button.classList.toggle("is-available", Boolean(update.updateAvailable));
  button.disabled = update.phase === "checking" || update.phase === "installing";
  if (update.phase === "checking") button.textContent = "센터 업데이트 확인 중...";
  else if (update.downloaded) button.textContent = update.version ? "센터 v" + update.version + " 설치" : "다운로드 완료 · 설치";
  else if (update.updateAvailable) button.textContent = "센터 업데이트 다운로드 중...";
  else button.textContent = "센터 업데이트";
}`;

const newRender = `function renderSelfUpdate() {
  const button = elements.centerUpdateButton;
  if (!button) return;

  const update = state.selfUpdate || {};
  const phase = String(update.phase || "idle");
  const progressNumber = update.progress == null ? Number.NaN : Number(update.progress);
  const hasProgressValue = Number.isFinite(progressNumber) && progressNumber >= 0 && progressNumber <= 100;
  const progress = hasProgressValue ? Math.max(0, Math.min(100, progressNumber)) : null;
  const indeterminate = phase === "checking" || phase === "available" || phase === "downloading";
  const complete = phase === "downloaded" || phase === "installing";

  button.classList.toggle("is-available", Boolean(update.updateAvailable));
  button.classList.toggle("is-progressing", indeterminate && progress === null);
  button.classList.toggle("has-progress-value", progress !== null && !complete);
  button.classList.toggle("is-progress-complete", complete);
  if (progress !== null) button.style.setProperty("--center-update-progress", progress + "%");
  else button.style.removeProperty("--center-update-progress");

  const busy = indeterminate || phase === "installing";
  button.disabled = busy;
  button.setAttribute("aria-busy", busy ? "true" : "false");

  if (phase === "checking") {
    button.textContent = "센터 업데이트 확인 중...";
    button.title = "업데이트 정보를 확인하는 중입니다.";
  } else if (phase === "installing") {
    button.textContent = "센터 업데이트 설치 준비 중...";
    button.title = "다운로드가 완료되어 설치 및 재시작을 준비하는 중입니다.";
  } else if (update.downloaded) {
    button.textContent = update.version ? "센터 v" + update.version + " 설치" : "다운로드 완료 · 설치";
    button.title = "다운로드가 완료되었습니다. 설치 후 재시작할 수 있습니다.";
  } else if (update.updateAvailable) {
    button.textContent = progress === null
      ? "센터 업데이트 다운로드 중..."
      : "센터 업데이트 다운로드 " + Math.round(progress) + "%";
    button.title = progress === null
      ? "다운로드 중입니다. 현재 updater는 정확한 바이트 퍼센트를 제공하지 않아 진행바를 불확정 상태로 표시합니다."
      : "업데이트 다운로드 " + Math.round(progress) + "%";
  } else if (phase === "error") {
    button.textContent = "센터 업데이트";
    button.title = update.error || "종합센터 업데이트 중 오류가 발생했습니다.";
  } else {
    button.textContent = "센터 업데이트";
    button.title = "SD종합센터 업데이트를 확인합니다.";
  }
}`;

if (!renderer.includes("--center-update-progress")) {
  renderer = replaceOnce(renderer, oldRender, newRender, "renderSelfUpdate progress UI");
}

write("public/js/app.js", renderer);

for (const marker of [
  'progress: null, version: "", error: ""',
  'phase: "checking", progress: null',
  'phase: "error", progress: null',
  'phase: "installing", progress: 100',
]) {
  if (!read("main.js").includes(marker)) throw new Error(`Missing main updater progress marker: ${marker}`);
}
for (const marker of [
  "center-update-progress-slide",
  "is-progressing",
  "is-progress-complete",
]) {
  if (!read("public/css/style.css").includes(marker)) throw new Error(`Missing updater progress CSS marker: ${marker}`);
}
for (const marker of [
  "update.progress == null ? Number.NaN",
  "--center-update-progress",
  "aria-busy",
  "정확한 바이트 퍼센트를 제공하지 않아",
]) {
  if (!read("public/js/app.js").includes(marker)) throw new Error(`Missing updater progress renderer marker: ${marker}`);
}

console.log("Center self-update progress UI patch applied");
