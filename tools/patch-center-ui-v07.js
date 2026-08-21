"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-center-ui-v07.js <app-root>");

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

let main = read("main.js");
if (!main.includes('const crypto = require("node:crypto");')) {
  main = replaceOnce(
    main,
    'const fs = require("node:fs");',
    'const crypto = require("node:crypto");\nconst fs = require("node:fs");\nconst https = require("node:https");',
    "node crypto/https imports",
  );
}

if (!main.includes("CENTER_UPDATE_MANIFEST_URL")) {
  main = replaceOnce(
    main,
    '  const CENTER_UPDATE_FEED_URL = "https://github.com/SD608/sd-center/releases/latest/download";',
    '  const CENTER_UPDATE_FEED_URL = "https://github.com/SD608/sd-center/releases/latest/download";\n  const CENTER_UPDATE_MANIFEST_URL = "https://sd608.github.io/sd-center/update/center-update.json";',
    "center update manifest url",
  );
}

if (!main.includes("function centerSquirrelUpdateExe()")) {
  const insertion = `

  function centerSquirrelUpdateExe() {
    return path.resolve(path.dirname(process.execPath), "..", "Update.exe");
  }

  function fetchCenterUpdateManifest() {
    return new Promise((resolve, reject) => {
      const requestManifest = (targetUrl) => {
        const request = https.get(
          targetUrl,
          { headers: { "Cache-Control": "no-cache", "User-Agent": "SDCenter-Preview-Updater/0.7" } },
          (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
              response.resume();
              requestManifest(new URL(response.headers.location, targetUrl).toString());
              return;
            }
            if (response.statusCode !== 200) {
              response.resume();
              reject(new Error(\`센터 업데이트 서버 응답 오류: \${response.statusCode || "?"}\`));
              return;
            }
            let body = "";
            response.on("data", (chunk) => {
              body += chunk.toString("utf8");
              if (body.length > 256 * 1024) request.destroy(new Error("센터 업데이트 정보가 너무 큽니다."));
            });
            response.on("end", () => {
              try {
                resolve(JSON.parse(body));
              } catch {
                reject(new Error("센터 업데이트 정보를 읽을 수 없습니다."));
              }
            });
          },
        );
        request.setTimeout(10000, () => request.destroy(new Error("센터 업데이트 서버 연결 시간이 초과되었습니다.")));
        request.on("error", reject);
      };
      requestManifest(\`\${CENTER_UPDATE_MANIFEST_URL}?t=\${Date.now()}\`);
    });
  }

  async function checkCenterPortableUpdate() {
    try {
      sendCenterUpdateState({ phase: "checking", error: "", portable: true });
      const manifest = await fetchCenterUpdateManifest();
      const version = String(manifest?.version || "").replace(/^v/i, "");
      const downloadUrl = String(manifest?.downloadUrl || "");
      const sha256 = String(manifest?.sha256 || "").toLowerCase();
      if (!version || !downloadUrl) throw new Error("센터 업데이트 정보에 버전 또는 다운로드 주소가 없습니다.");
      const updateAvailable = compareVersions(version, app.getVersion()) > 0;
      return {
        ok: true,
        ...sendCenterUpdateState({
          phase: updateAvailable ? "portable-ready" : "latest",
          updateAvailable,
          downloaded: false,
          portable: true,
          version,
          downloadUrl,
          sha256,
          releaseNotes: String(manifest?.notes || ""),
          error: "",
        }),
      };
    } catch (error) {
      return { ok: false, ...sendCenterUpdateState({ phase: "error", portable: true, error: error?.message || String(error) }) };
    }
  }

  async function sha256File(filePath) {
    return await new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const input = fs.createReadStream(filePath);
      input.on("data", (chunk) => hash.update(chunk));
      input.on("error", reject);
      input.on("end", () => resolve(hash.digest("hex")));
    });
  }
`;
  main = replaceOnce(main, '\n  async function checkCenterSelfUpdate() {', insertion + '\n  async function checkCenterSelfUpdate() {', "portable updater helpers");
}

if (!main.includes("if (!fs.existsSync(centerSquirrelUpdateExe())) return checkCenterPortableUpdate();")) {
  main = replaceOnce(
    main,
    '    if (!app.isPackaged || process.platform !== "win32") return { ok: false, error: "Windows 설치 버전에서만 종합센터 자동업데이트를 사용할 수 있습니다." };\n    try {',
    '    if (!app.isPackaged || process.platform !== "win32") return { ok: false, error: "Windows 설치 버전에서만 종합센터 자동업데이트를 사용할 수 있습니다." };\n    // UI Preview v0.7: 포터블 프리뷰에는 Squirrel Update.exe가 없으므로 정식 설치 프로그램 기반으로 확인합니다.\n    if (!fs.existsSync(centerSquirrelUpdateExe())) return checkCenterPortableUpdate();\n    try {',
    "portable updater guard",
  );
}

if (!main.includes("centerUpdateState.portable && centerUpdateState.updateAvailable")) {
  const oldInstallStart = '  async function installCenterSelfUpdate() {\n    if (!centerUpdateState.downloaded) return { ok: false, error: "업데이트 다운로드가 아직 완료되지 않았습니다." };';
  const newInstallStart = `  async function installCenterSelfUpdate() {
    if (centerUpdateState.portable && centerUpdateState.updateAvailable) {
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: "question",
        title: "SD종합센터 업데이트",
        message: centerUpdateState.version ? \`SD종합센터 v\${centerUpdateState.version}(으)로 업데이트할까요?\` : "새 SD종합센터 버전으로 업데이트할까요?",
        detail: "프리뷰는 Squirrel 설치 폴더가 아니므로 정식 설치 프로그램을 내려받아 업데이트합니다.",
        buttons: ["취소", "업데이트"],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
      });
      if (confirmation.response !== 1) return { ok: false, canceled: true };
      try {
        const version = String(centerUpdateState.version || "latest").replace(/[^0-9A-Za-z._-]/g, "");
        const installerPath = path.join(app.getPath("temp"), \`SDCenterSetup-\${version}.exe\`);
        sendCenterUpdateState({ phase: "downloading-installer", error: "" });
        await downloadFile(centerUpdateState.downloadUrl, installerPath);
        if (centerUpdateState.sha256) {
          const actualHash = await sha256File(installerPath);
          if (actualHash.toLowerCase() !== String(centerUpdateState.sha256).toLowerCase()) {
            fs.rmSync(installerPath, { force: true });
            throw new Error("다운로드한 센터 설치 파일의 무결성 확인에 실패했습니다.");
          }
        }
        await Promise.all(appCatalog.map((entry) => terminateAppAndWait(entry.id)));
        sendCenterUpdateState({ phase: "installing", error: "" });
        const child = spawn(installerPath, ["--silent"], { detached: true, stdio: "ignore" });
        child.unref();
        isQuitting = true;
        setTimeout(() => app.quit(), 250);
        return { ok: true, installing: true, portable: true };
      } catch (error) {
        return { ok: false, ...sendCenterUpdateState({ phase: "error", portable: true, error: error?.message || String(error) }) };
      }
    }
    if (!centerUpdateState.downloaded) return { ok: false, error: "업데이트 다운로드가 아직 완료되지 않았습니다." };`;
  main = replaceOnce(main, oldInstallStart, newInstallStart, "portable installer flow");
}
write("main.js", main);

let appJs = read("public/js/app.js");
if (!appJs.includes("update.portable && update.updateAvailable")) {
  appJs = replaceOnce(
    appJs,
    '  if (update.phase === "checking") button.textContent = "센터 업데이트 확인 중...";\n  else if (update.downloaded) button.textContent = update.version ? "센터 v" + update.version + " 설치" : "다운로드 완료 · 설치";\n  else if (update.updateAvailable) button.textContent = "센터 업데이트 다운로드 중...";',
    '  if (update.phase === "checking") button.textContent = "센터 업데이트 확인 중...";\n  else if (update.phase === "downloading-installer") button.textContent = "설치 파일 다운로드 중...";\n  else if (update.phase === "installing") button.textContent = "센터 업데이트 설치 중...";\n  else if (update.portable && update.updateAvailable) button.textContent = update.version ? "센터 v" + update.version + " 설치" : "센터 업데이트 설치";\n  else if (update.downloaded) button.textContent = update.version ? "센터 v" + update.version + " 설치" : "다운로드 완료 · 설치";\n  else if (update.updateAvailable) button.textContent = "센터 업데이트 다운로드 중...";',
    "portable updater button label",
  );
  appJs = replaceOnce(
    appJs,
    '  button.disabled = update.phase === "checking" || update.phase === "installing";',
    '  button.disabled = update.phase === "checking" || update.phase === "downloading-installer" || update.phase === "installing";',
    "portable updater button disabled state",
  );
  appJs = replaceOnce(
    appJs,
    '  if (state.selfUpdate?.downloaded) {',
    '  if (state.selfUpdate?.downloaded || (state.selfUpdate?.portable && state.selfUpdate?.updateAvailable)) {',
    "portable updater install click",
  );
}
write("public/js/app.js", appJs);

let previewJs = read("public/js/ui-preview.js");
previewJs = previewJs.replace("/* SD종합센터 UI Preview v0.6", "/* SD종합센터 UI Preview v0.7");
if (!previewJs.includes('update.phase === "portable-ready"')) {
  previewJs = replaceOnce(
    previewJs,
    '  if (update.phase === "checking") status = "새 SD종합센터 버전을 확인하고 있습니다.";\n  else if (update.downloaded) status = update.version ? `v${update.version} 다운로드 완료 · 설치할 수 있습니다.` : "새 버전 다운로드 완료 · 설치할 수 있습니다.";',
    '  if (update.phase === "checking") status = "새 SD종합센터 버전을 확인하고 있습니다.";\n  else if (update.phase === "downloading-installer") status = "정식 SD종합센터 설치 프로그램을 다운로드하고 있습니다.";\n  else if (update.phase === "installing") status = "센터 업데이트 설치 프로그램을 시작하고 있습니다.";\n  else if (update.phase === "portable-ready") status = update.version ? `v${update.version} 새 버전이 있습니다. 설치 버튼을 누르면 정식 설치 프로그램을 내려받습니다.` : "새 센터 버전이 있습니다. 설치 버튼을 누르면 정식 설치 프로그램을 내려받습니다.";\n  else if (update.downloaded) status = update.version ? `v${update.version} 다운로드 완료 · 설치할 수 있습니다.` : "새 버전 다운로드 완료 · 설치할 수 있습니다.";',
    "portable updater preview status",
  );
}
write("public/js/ui-preview.js", previewJs);

let css = read("public/css/ui-preview.css");
if (!css.includes("UI Preview v0.7: 앱 아이콘 확대")) {
  css += `\n\n/* UI Preview v0.7: 앱 아이콘 확대 */\n.preview-home-grid{grid-template-columns:repeat(auto-fill,minmax(122px,1fr));gap:20px 10px}\n.preview-home-tile{padding:10px 5px}\n.preview-home-icon{width:80px;height:80px;margin-bottom:9px;border-radius:17px;font-size:21px}\n.preview-home-folder-preview{width:80px;height:80px;margin-bottom:9px;padding:8px;border-radius:15px;gap:3px}\n.preview-home-folder-preview::before{left:10px;width:30px;height:6px}\n.preview-home-name{font-size:12px}\n.preview-home-sub{font-size:9.5px}\n.preview-recent-card{min-height:146px;padding:15px}\n.preview-recent-icon{left:15px;top:16px;width:58px;height:58px;border-radius:12px;font-size:16px}\n.preview-favorite-card{min-height:82px;padding:10px 11px;gap:11px}\n.preview-favorite-icon{width:50px;height:50px;border-radius:11px}\n.ui-preview-mode .app-card.preview-library-row{min-height:82px;grid-template-columns:64px minmax(180px,1.4fr) minmax(110px,.55fr) auto}\n.preview-library-app-icon{width:54px;height:54px;border-radius:11px}\n.ui-preview-mode .removed-app-card{min-height:82px;grid-template-columns:64px minmax(180px,1.4fr) minmax(110px,.55fr) auto}\n.ui-preview-mode .removed-app-card .app-icon{width:54px;height:54px;border-radius:11px}\n.ui-preview-mode .store-app-icon{width:60px;height:60px;border-radius:12px}\n.preview-update-row{min-height:82px;grid-template-columns:64px 1fr auto}\n.preview-update-icon{width:54px;height:54px;border-radius:11px}\n.preview-folder-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}\n.preview-folder-app{padding:11px 6px}\n.preview-folder-app-icon{width:62px;height:62px;margin-bottom:8px;border-radius:13px}\n@media(max-width:820px){.preview-home-grid{grid-template-columns:repeat(auto-fill,minmax(110px,1fr))}.preview-folder-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}\n`;
}
write("public/css/ui-preview.css", css);

for (const [rel, markers] of Object.entries({
  "main.js": ["CENTER_UPDATE_MANIFEST_URL", "centerSquirrelUpdateExe", "checkCenterPortableUpdate", "downloading-installer", "sha256File"],
  "public/js/app.js": ["update.portable && update.updateAvailable", "설치 파일 다운로드 중"],
  "public/js/ui-preview.js": ['update.phase === "portable-ready"', "정식 SD종합센터 설치 프로그램"],
  "public/css/ui-preview.css": ["UI Preview v0.7: 앱 아이콘 확대", ".preview-home-icon{width:80px", ".preview-library-app-icon{width:54px"],
})) {
  const content = read(rel);
  for (const marker of markers) {
    if (!content.includes(marker)) throw new Error(`Missing v0.7 marker in ${rel}: ${marker}`);
  }
}

console.log("SDCenter UI Preview v0.7 updater fallback + icon sizing patch applied");
