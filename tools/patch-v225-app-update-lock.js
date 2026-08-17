"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-v225-app-update-lock.js <app-root>");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
}
function write(rel, content) {
  fs.writeFileSync(path.join(root, rel), content, "utf8");
}

const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
if (pkg.version !== "2.2.4") {
  throw new Error(`Expected v2.2.4 base, got ${pkg.version}`);
}
pkg.version = "2.2.5";
pkg.description = "SD지갑 코어 · 확장팩 상점 · 잠금 안전 업데이트 · SD Link 백그라운드 자동 시작";
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

let main = read("main.js");

for (const marker of [
  "async function terminateAppAndWait(id)",
  "installInspectedZip(inspected, destinationDirectory);",
  "const runningApps = new Map();",
  "--sd-link-auto-start",
  "autoUpdater",
]) {
  if (!main.includes(marker)) throw new Error(`v2.2.4 base marker missing: ${marker}`);
}

const oldTerminate = /  async function terminateAppAndWait\(id\) \{[\s\S]*?\n  \}\n\n  function terminateAllApps\(\) \{/;
if (!oldTerminate.test(main)) {
  throw new Error("terminateAppAndWait block not found");
}

const replacement = `  function updateDelay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function waitForChildExit(child, timeoutMs) {
    if (!child || child.exitCode !== null) return Promise.resolve(true);

    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const finish = (exited) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        child.removeListener("exit", onExit);
        resolve(exited);
      };
      const onExit = () => finish(true);
      child.once("exit", onExit);
      timer = setTimeout(() => finish(child.exitCode !== null), timeoutMs);
    });
  }

  async function forceKillChildTree(child) {
    if (!child || child.exitCode !== null) return true;

    try {
      child.kill();
    } catch {}

    if (await waitForChildExit(child, 900)) return true;

    if (process.platform === "win32" && child.pid) {
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };

        try {
          const killer = spawn(
            "taskkill.exe",
            ["/PID", String(child.pid), "/T", "/F"],
            { windowsHide: true, stdio: "ignore" },
          );
          killer.once("exit", finish);
          killer.once("error", finish);
          setTimeout(finish, 2200);
        } catch {
          finish();
        }
      });
    } else {
      try {
        child.kill("SIGKILL");
      } catch {}
    }

    return waitForChildExit(child, 1800);
  }

  async function installInspectedZipWithRetry(inspected, destinationDirectory) {
    const retryableCodes = new Set(["EBUSY", "EPERM", "EACCES"]);
    let lastError = null;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        installInspectedZip(inspected, destinationDirectory);
        return;
      } catch (error) {
        lastError = error;
        const code = String(error?.code || "").toUpperCase();
        if (!retryableCodes.has(code) || attempt === 7) throw error;
        await updateDelay(300 + attempt * 250);
      }
    }

    throw lastError || new Error("앱 파일 교체에 실패했습니다.");
  }

  async function terminateAppAndWait(id) {
    const child = runningApps.get(id);

    if (!child || child.exitCode !== null) {
      runningApps.delete(id);
      sendAppStates();
      return;
    }

    const exited = await forceKillChildTree(child);
    if (!exited && child.exitCode === null) {
      throw new Error(
        "실행 중인 앱 프로세스를 완전히 종료하지 못했습니다. 앱을 닫은 뒤 다시 업데이트해 주세요.",
      );
    }

    runningApps.delete(id);
    sendAppStates();
    // Windows가 종료된 Electron 프로세스의 파일 핸들을 정리할 시간을 줍니다.
    await updateDelay(350);
  }

  function terminateAllApps() {`;
main = main.replace(oldTerminate, replacement);

const installCall = "installInspectedZip(inspected, destinationDirectory);";
const installCount = main.split(installCall).length - 1;
if (installCount < 2) {
  throw new Error(`Expected multiple installInspectedZip calls, got ${installCount}`);
}
main = main.split(installCall).join("await installInspectedZipWithRetry(inspected, destinationDirectory);");

write("main.js", main);

const validation = read("main.js");
for (const marker of [
  "forceKillChildTree",
  "taskkill.exe",
  "installInspectedZipWithRetry",
  "retryableCodes",
  "await updateDelay(350)",
  "--sd-link-auto-start",
  "autoUpdater",
]) {
  if (!validation.includes(marker)) throw new Error(`v2.2.5 marker missing: ${marker}`);
}
if (validation.includes("powershell.exe")) {
  throw new Error("PowerShell dependency unexpectedly returned");
}

console.log(`SDCenter v2.2.5 app update lock patch applied (${installCount} install calls hardened)`);
