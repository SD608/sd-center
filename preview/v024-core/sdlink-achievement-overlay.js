"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PATCH_MARK = Symbol.for("sdcenter.sdlink.achievement-overlay.v1");
const STATE_VERSION = 1;
const STATE_FILENAME = "achievement-overlay-state-v1.json";
const OVERLAY_WIDTH = 372;
const OVERLAY_HEIGHT = 104;
const OVERLAY_MARGIN = 18;
const DISPLAY_MS = 5600;
const ACHIEVEMENTS_URL = "https://sd608.github.io/sd-center/achievements.html";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function unwrapRpc(value) {
  if (Array.isArray(value) && value.length === 1 && value[0] && typeof value[0] === "object") return value[0];
  return value;
}

function safeText(value, max = 160) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function validCode(value) {
  return /^[a-z0-9][a-z0-9_-]{0,79}$/.test(String(value || ""));
}

function validId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function normalizeAchievementRows(payload) {
  const source = Array.isArray(payload?.achievements) ? payload.achievements : [];
  const rows = [];
  for (const raw of source) {
    if (!raw || raw.unlocked !== true || !validId(raw.id) || !validCode(raw.code)) continue;
    const name = safeText(raw.name, 120);
    if (!name || name === "???") continue;
    rows.push({
      id: String(raw.id).toLowerCase(),
      code: String(raw.code),
      name,
      description: safeText(raw.description, 220),
      icon: safeText(raw.icon || "🏆", 8) || "🏆",
      titleReward: safeText(raw.title_reward, 100),
      unlockedAt: safeText(raw.unlocked_at, 64),
    });
  }
  return rows;
}

function emptyState() {
  return { version: STATE_VERSION, users: {} };
}

function sanitizeState(value) {
  const input = asObject(value);
  const output = emptyState();
  for (const [userId, rawUser] of Object.entries(asObject(input.users))) {
    if (!validId(userId)) continue;
    const user = asObject(rawUser);
    const seen = {};
    for (const [achievementId, at] of Object.entries(asObject(user.seen))) {
      if (validId(achievementId)) seen[achievementId.toLowerCase()] = safeText(at, 64) || "seen";
    }
    output.users[userId.toLowerCase()] = {
      initialized: user.initialized === true,
      seen,
    };
  }
  return output;
}

function claimNewUnlocks(stateInput, userIdInput, unlockedRows, now = new Date().toISOString()) {
  const state = sanitizeState(stateInput);
  const userId = String(userIdInput || "").toLowerCase();
  if (!validId(userId)) return { state, initializedNow: false, claimed: [] };
  const rows = Array.isArray(unlockedRows) ? unlockedRows.filter((row) => validId(row?.id)) : [];
  let user = state.users[userId];
  if (!user) {
    user = { initialized: false, seen: {} };
    state.users[userId] = user;
  }

  if (!user.initialized) {
    for (const row of rows) user.seen[String(row.id).toLowerCase()] = row.unlockedAt || now;
    user.initialized = true;
    return { state, initializedNow: true, claimed: [] };
  }

  const claimed = [];
  for (const row of rows) {
    const id = String(row.id).toLowerCase();
    if (user.seen[id]) continue;
    // Durable claim is written before presentation. This makes crash/retry behavior duplicate-safe.
    user.seen[id] = row.unlockedAt || now;
    claimed.push(row);
  }
  return { state, initializedNow: false, claimed };
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function achievementUrl(code) {
  if (!validCode(code)) return ACHIEVEMENTS_URL;
  return `${ACHIEVEMENTS_URL}?achievement=${encodeURIComponent(code)}`;
}

function computeOverlayPosition(workArea, width = OVERLAY_WIDTH, height = OVERLAY_HEIGHT, margin = OVERLAY_MARGIN) {
  const area = asObject(workArea);
  const x = Number(area.x || 0);
  const y = Number(area.y || 0);
  const w = Math.max(width, Number(area.width || width));
  const h = Math.max(height, Number(area.height || height));
  return {
    x: Math.round(x + w - width - margin),
    y: Math.round(y + h - height - margin),
  };
}

function overlayHtml(item) {
  const title = escapeHtml(item.name);
  const description = escapeHtml(item.description || "업적을 달성했습니다.");
  const icon = escapeHtml(item.icon || "🏆");
  const reward = item.titleReward ? `<span class="reward">칭호 · ${escapeHtml(item.titleReward)}</span>` : "";
  const href = `sd-achievement://open?code=${encodeURIComponent(item.code)}`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:"Malgun Gothic","Segoe UI",sans-serif}a{color:inherit;text-decoration:none}.card{height:100%;display:grid;grid-template-columns:56px 1fr 22px;align-items:center;gap:12px;padding:14px 15px;border:1px solid rgba(255,255,255,.16);border-radius:14px;background:rgba(9,18,31,.96);color:#f7fbff;box-shadow:0 14px 38px rgba(0,0,0,.38)}.icon{width:52px;height:52px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:29px;background:rgba(255,255,255,.08)}.eyebrow{font-size:11px;letter-spacing:.08em;font-weight:800;opacity:.66}.name{margin-top:3px;font-size:16px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.desc{margin-top:3px;font-size:11px;opacity:.76;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.reward{display:block;margin-top:4px;font-size:10px;font-weight:700;opacity:.9}.arrow{font-size:20px;opacity:.65}</style></head><body><a class="card" href="${href}" aria-label="업적 보기: ${title}"><div class="icon">${icon}</div><div><div class="eyebrow">ACHIEVEMENT UNLOCKED</div><div class="name">${title}</div><div class="desc">${description}</div>${reward}</div><div class="arrow">›</div></a></body></html>`;
}

function atomicWriteJson(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

function loadState(filePath) {
  try { return sanitizeState(JSON.parse(fs.readFileSync(filePath, "utf8"))); }
  catch { return emptyState(); }
}

function createOverlayController({ app, BrowserWindow, screen, shell, fsImpl = fs } = {}) {
  if (!app || !BrowserWindow || !screen || !shell) throw new Error("achievement overlay requires Electron app/BrowserWindow/screen/shell");
  const statePath = path.join(app.getPath("userData"), STATE_FILENAME);
  let state = loadState(statePath);
  let queue = [];
  let currentWindow = null;
  let closeTimer = null;
  let pollPending = null;
  let disposed = false;

  const persist = () => {
    const writer = fsImpl === fs ? atomicWriteJson : (target, value) => {
      const tmp = `${target}.tmp`;
      fsImpl.mkdirSync(path.dirname(target), { recursive: true });
      fsImpl.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      fsImpl.renameSync(tmp, target);
    };
    writer(statePath, state);
  };

  function clearCurrent() {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = null;
    if (currentWindow && !currentWindow.isDestroyed()) {
      try { currentWindow.destroy(); } catch {}
    }
    currentWindow = null;
  }

  function pump() {
    if (disposed || currentWindow || queue.length === 0) return;
    const item = queue.shift();
    const win = new BrowserWindow({
      width: OVERLAY_WIDTH,
      height: OVERLAY_HEIGHT,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      focusable: true,
      alwaysOnTop: true,
      backgroundColor: "#00000000",
      title: "SD Achievement Unlock",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });
    currentWindow = win;
    try { win.setAlwaysOnTop(true, "pop-up-menu"); } catch {}
    try { win.setMenuBarVisibility(false); } catch {}
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event, target) => {
      event.preventDefault();
      try {
        const url = new URL(target);
        const code = String(url.searchParams.get("code") || "");
        if (url.protocol !== "sd-achievement:" || url.hostname !== "open" || !validCode(code)) return;
        void Promise.resolve(shell.openExternal(achievementUrl(code))).catch(() => {});
        clearCurrent();
        setImmediate(pump);
      } catch {}
    });
    win.once("ready-to-show", () => {
      if (disposed || win.isDestroyed()) return;
      try {
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
        const pos = computeOverlayPosition(display?.workArea, OVERLAY_WIDTH, OVERLAY_HEIGHT, OVERLAY_MARGIN);
        win.setPosition(pos.x, pos.y, false);
      } catch {}
      try { shell.beep(); } catch {}
      // showInactive intentionally bypasses the SD Link background manager-window guard.
      try { win.showInactive(); } catch { try { win.show(); } catch {} }
      closeTimer = setTimeout(() => {
        if (currentWindow === win) clearCurrent();
        setImmediate(pump);
      }, DISPLAY_MS);
    });
    win.on("closed", () => {
      if (currentWindow === win) currentWindow = null;
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = null;
      if (!disposed) setImmediate(pump);
    });
    const html = overlayHtml(item);
    void win.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`).catch(() => {
      if (currentWindow === win) clearCurrent();
      setImmediate(pump);
    });
  }

  async function poll(engine) {
    if (disposed || pollPending) return pollPending || { skipped: true };
    pollPending = (async () => {
      const auth = engine?.auth;
      if (!auth || typeof auth.requireSession !== "function" || typeof auth.rpc !== "function") return { skipped: true, reason: "auth-unavailable" };
      const session = await auth.requireSession();
      const userId = String(session?.user?.id || "").toLowerCase();
      if (!validId(userId)) return { skipped: true, reason: "user-unavailable" };
      const payload = unwrapRpc(await auth.rpc("get_sd_achievement_center_v1", {}));
      const unlockedRows = normalizeAchievementRows(payload);
      const claimed = claimNewUnlocks(state, userId, unlockedRows);
      state = claimed.state;
      if (claimed.initializedNow || claimed.claimed.length) persist();
      if (claimed.claimed.length) {
        queue.push(...claimed.claimed);
        pump();
      }
      return { baseline: claimed.initializedNow, claimed: claimed.claimed.length, unlocked: unlockedRows.length };
    })().catch((error) => ({ skipped: true, reason: "read-failed", error: String(error?.message || error) }))
      .finally(() => { pollPending = null; });
    return pollPending;
  }

  function schedule(engine) {
    if (disposed) return;
    setTimeout(() => { void poll(engine); }, 120);
  }

  function dispose() {
    disposed = true;
    queue = [];
    clearCurrent();
  }

  return {
    poll,
    schedule,
    dispose,
    getState: () => sanitizeState(state),
    getQueueLength: () => queue.length,
  };
}

function patchIntegratedSdLinkAchievementOverlay(childDirectory, injected = {}) {
  if (process.env.SD_CENTER_LINK_INTEGRATED !== "1") return { ok: true, skipped: true, reason: "standalone" };
  try {
    const electron = injected.electron || require("electron");
    const app = injected.app || electron.app;
    const modulePath = path.join(childDirectory, "src", "sync-engine.js");
    const loaded = require(modulePath);
    const SyncEngine = loaded?.SyncEngine;
    const proto = SyncEngine?.prototype;
    if (!proto || typeof proto.syncOnce !== "function") return { ok: false, reason: "SyncEngine.syncOnce not found" };
    if (proto[PATCH_MARK]) return { ok: true, patched: false, reason: "already-patched" };

    const controller = createOverlayController({
      app,
      BrowserWindow: electron.BrowserWindow,
      screen: electron.screen,
      shell: electron.shell,
    });
    const original = proto.syncOnce;
    proto.syncOnce = async function sdAchievementOverlaySyncOnce(...args) {
      try {
        return await original.apply(this, args);
      } finally {
        // Notification refresh is isolated: it can never fail or delay wallet synchronization.
        controller.schedule(this);
      }
    };
    Object.defineProperty(proto, PATCH_MARK, { value: true, enumerable: false, configurable: false, writable: false });
    app.once("before-quit", () => controller.dispose());
    return { ok: true, patched: true, controller };
  } catch (error) {
    return { ok: false, reason: String(error?.message || error) };
  }
}

module.exports = {
  ACHIEVEMENTS_URL,
  DISPLAY_MS,
  OVERLAY_HEIGHT,
  OVERLAY_MARGIN,
  OVERLAY_WIDTH,
  STATE_FILENAME,
  achievementUrl,
  claimNewUnlocks,
  computeOverlayPosition,
  createOverlayController,
  escapeHtml,
  normalizeAchievementRows,
  overlayHtml,
  patchIntegratedSdLinkAchievementOverlay,
  sanitizeState,
};
