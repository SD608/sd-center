"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  achievementUrl,
  claimNewUnlocks,
  computeOverlayPosition,
  escapeHtml,
  normalizeAchievementRows,
  overlayHtml,
  sanitizeState,
} = require("../preview/v024-core/sdlink-achievement-overlay");
const { patchMainSource } = require("./achievement-overlay-main-patch");

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const A1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const A2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function row(id, code, extra = {}) {
  return { id, code, unlocked: true, name: `업적 ${code}`, description: "검증 조건", icon: "🏆", unlocked_at: "2026-08-22T00:00:00Z", ...extra };
}

{
  const normalized = normalizeAchievementRows({ achievements: [row(A1, "wallet-01"), row(A2, "secret-01", { name: "???" }), { ...row(A2, "bad code"), name: "bad" }, { ...row(A2, "wallet-02"), unlocked: false }] });
  assert.equal(normalized.length, 1, "only server-unlocked, valid, unmasked rows are eligible");
  assert.equal(normalized[0].id, A1);
}

{
  let state = sanitizeState({});
  let result = claimNewUnlocks(state, U1, [row(A1, "wallet-01")], "t0");
  state = result.state;
  assert.equal(result.initializedNow, true, "first successful snapshot is baseline only");
  assert.equal(result.claimed.length, 0, "historical unlocks must never spam on first run");

  result = claimNewUnlocks(state, U1, [row(A1, "wallet-01"), row(A2, "wallet-02")], "t1");
  state = result.state;
  assert.deepEqual(result.claimed.map((x) => x.id), [A2], "one new server unlock is claimed once");

  result = claimNewUnlocks(state, U1, [row(A1, "wallet-01"), row(A2, "wallet-02")], "t2");
  assert.equal(result.claimed.length, 0, "retry/relogin snapshot must not duplicate overlay");

  const other = claimNewUnlocks(state, U2, [row(A1, "wallet-01"), row(A2, "wallet-02")], "t3");
  assert.equal(other.initializedNow, true, "notification baseline is partitioned by authenticated user");
  assert.equal(other.claimed.length, 0);
}

{
  const escaped = escapeHtml(`<img src=x onerror="boom">&'`);
  assert.equal(escaped.includes("<img"), false);
  const html = overlayHtml({ id: A1, code: "wallet-01", name: `<script>alert(1)</script>`, description: `\" onclick=\"x`, icon: "🏆", titleReward: "왕" });
  assert.equal(html.includes("<script>alert"), false, "server text is HTML-escaped");
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /sd-achievement:\/\/open\?code=wallet-01/);
  assert.equal(achievementUrl("../evil"), "https://sd608.github.io/sd-center/achievements.html");
}

{
  assert.deepEqual(computeOverlayPosition({ x: 0, y: 0, width: 1920, height: 1040 }, 372, 104, 18), { x: 1530, y: 918 });
  assert.deepEqual(computeOverlayPosition({ x: -1536, y: 0, width: 1536, height: 824 }, 372, 104, 18), { x: -390, y: 702 });
  for (const scale of [1, 1.25, 1.5, 2]) {
    const logical = { x: 0, y: 0, width: Math.round(1920 / scale), height: Math.round(1040 / scale) };
    const pos = computeOverlayPosition(logical, 372, 104, 18);
    assert.ok(pos.x >= logical.x && pos.y >= logical.y, `position remains inside DIP work area at scale ${scale}`);
    assert.ok(pos.x + 372 <= logical.x + logical.width && pos.y + 104 <= logical.y + logical.height, `overlay does not clip at scale ${scale}`);
  }
}

{
  const fixture = [
    'const { createSdLinkBackgroundWindowGuard } = require("./src/sdlink-background-window-guard");',
    "function f(childDirectory, app) {",
    "    const coreRuntimePatch = patchIntegratedSdLinkCoreRuntime(childDirectory);",
    "    if (!coreRuntimePatch?.ok) {",
    '      console.warn("SD Link → SD Core 런타임 패치 실패", coreRuntimePatch?.reason || coreRuntimePatch);',
    "    }",
    "}",
  ].join("\n");
  const once = patchMainSource(fixture);
  const twice = patchMainSource(once);
  assert.equal(once, twice, "main patch is idempotent");
  assert.match(once, /patchIntegratedSdLinkAchievementOverlay/);
  assert.match(once, /\{ app \}/);
}

{
  const source = fs.readFileSync(path.join(__dirname, "..", "preview", "v024-core", "sdlink-achievement-overlay.js"), "utf8");
  assert.match(source, /get_sd_achievement_center_v1/);
  assert.doesNotMatch(source, /sync_sd_achievement_progress|current_value\s*>?=|title_owned\s*=|unlocked\s*=/, "overlay runtime never derives/submits achievement authority");
  assert.match(source, /showInactive\(\)/, "background SD Link overlay must bypass manager show guard");
  assert.match(source, /before-quit/);
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /sandbox:\s*true/);
}

console.log("Chapter 3-7 achievement unlock overlay regression PASS");

async function runtimeRegression() {
  const { EventEmitter } = require("node:events");
  const { createOverlayController } = require("../preview/v024-core/sdlink-achievement-overlay");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sd-achievement-overlay-"));
  const windows = [];
  let beeps = 0;
  const opened = [];

  class FakeWebContents extends EventEmitter {
    setWindowOpenHandler(handler) { this.openHandler = handler; }
  }
  class FakeBrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.webContents = new FakeWebContents();
      windows.push(this);
    }
    setAlwaysOnTop() {}
    setMenuBarVisibility() {}
    setPosition(x, y) { this.position = { x, y }; }
    showInactive() { this.shown = true; }
    show() { this.shown = true; }
    isDestroyed() { return this.destroyed; }
    destroy() { if (this.destroyed) return; this.destroyed = true; this.emit("closed"); }
    async loadURL(value) { this.loaded = value; setImmediate(() => this.emit("ready-to-show")); }
  }

  const app = { getPath: () => temp };
  const screen = { getCursorScreenPoint: () => ({ x: 100, y: 100 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 720 } }) };
  const shell = { beep: () => { beeps += 1; }, openExternal: async (url) => { opened.push(url); } };
  let payload = { achievements: [row(A1, "wallet-01")] };
  const engine = {
    auth: {
      requireSession: async () => ({ user: { id: U1 } }),
      rpc: async (name) => {
        assert.equal(name, "get_sd_achievement_center_v1");
        return payload;
      },
    },
  };

  let controller = createOverlayController({ app, BrowserWindow: FakeBrowserWindow, screen, shell });
  let result = await controller.poll(engine);
  assert.equal(result.baseline, true);
  assert.equal(windows.length, 0, "initial historical baseline must not create a window");

  payload = { achievements: [row(A1, "wallet-01"), row(A2, "wallet-02", { name: "새 업적" })] };
  result = await controller.poll(engine);
  assert.equal(result.claimed, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(windows.length, 1);
  assert.equal(windows[0].shown, true, "new unlock becomes a visible overlay");
  assert.equal(beeps, 1, "one unlock produces one sound");

  await controller.poll(engine);
  assert.equal(windows.length, 1, "same server snapshot must not create a duplicate overlay");

  const navigate = windows[0].webContents.listeners("will-navigate")[0];
  assert.equal(typeof navigate, "function");
  navigate({ preventDefault() {} }, "sd-achievement://open?code=wallet-02");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(opened, ["https://sd608.github.io/sd-center/achievements.html?achievement=wallet-02"]);
  controller.dispose();
  assert.equal(windows[0].destroyed, true, "dispose destroys overlay and leaves no child window residue");

  controller = createOverlayController({ app, BrowserWindow: FakeBrowserWindow, screen, shell });
  result = await controller.poll(engine);
  assert.equal(result.claimed, 0);
  assert.equal(windows.length, 1, "restart must not re-show a claimed unlock");
  controller.dispose();

  const failing = { auth: { requireSession: async () => ({ user: { id: U1 } }), rpc: async () => { throw new Error("offline"); } } };
  controller = createOverlayController({ app, BrowserWindow: FakeBrowserWindow, screen, shell });
  result = await controller.poll(failing);
  assert.equal(result.reason, "read-failed");
  assert.equal(windows.length, 1);
  controller.dispose();
  fs.rmSync(temp, { recursive: true, force: true });
}

runtimeRegression().then(() => {
  console.log("Chapter 3-7 runtime window/restart regression PASS");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
