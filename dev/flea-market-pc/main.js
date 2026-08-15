"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { app, BrowserWindow, ipcMain } = require("electron");

const BOX_TIERS = [
  { id: "worn", name: "낡은 상자", probability: 55, accent: "#8a725d" },
  { id: "normal", name: "평범한 상자", probability: 29, accent: "#78909c" },
  { id: "fancy", name: "고급진 상자", probability: 11, accent: "#4fc3f7" },
  { id: "premium", name: "최고급 상자", probability: 3, accent: "#ba68c8" },
  { id: "safe", name: "금고", probability: 2, accent: "#ffd54f" },
];

const ITEMS = {
  worn: [
    ["볼펜", 800], ["클립 한 통", 1200], ["지우개", 600], ["15cm 자", 1500],
    ["작은 수첩", 2500], ["열쇠고리", 3000], ["머그컵", 4500], ["USB 케이블", 7000],
  ],
  normal: [
    ["휴대폰 충전기", 25000], ["보조배터리", 49000], ["유선 이어폰", 19000],
    ["무선 마우스", 39000], ["USB 메모리", 32000], ["미니 선풍기", 27000], ["저가형 헤드셋", 69000],
  ],
  fancy: [
    ["블루투스 스피커", 289000], ["기계식 키보드", 219000], ["무선 이어폰", 329000],
    ["스마트워치", 389000], ["게임패드", 169000], ["브랜드 운동화", 249000],
  ],
  premium: [
    ["플래그십 스마트폰", 1490000], ["휴대용 게임기 세트", 890000], ["고급 태블릿", 1290000],
    ["고성능 그래픽카드", 1500000], ["미러리스 카메라", 1450000], ["프리미엄 헤드폰", 990000],
  ],
  safe: [
    ["금반지", 850000], ["금목걸이", 1550000], ["명품 시계", 2800000], ["보석 원석", 3200000],
    ["희귀 주화", 1200000], ["금화 세트", 2100000], ["소형 금괴", 5000000], ["대형 금괴", 15000000],
  ],
};

const MISSION_NODE_POSITIONS = [
  [12, 18], [31, 24], [55, 15], [76, 27], [20, 68], [47, 61], [72, 72], [86, 52],
];
const STATE_FILE_NAME = "flea-state.json";
const CUTTER_PRICE = 100000;
const LOCKPICK_PRICE = 10000;
const MISSION_DURATION_MS = 75 * 1000;
const MAX_BOXES_PER_MISSION = 3;

let mainWindow;
let state;
let openSessions = new Map();

function statePath() {
  return path.join(app.getPath("userData"), STATE_FILE_NAME);
}

function newState() {
  return {
    schemaVersion: 1,
    devBalance: 500000,
    cutterOwned: false,
    lockpicks: 0,
    boxes: [],
    items: [],
    activeMission: null,
    history: [],
  };
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), "utf8"));
    return { ...newState(), ...parsed, activeMission: null };
  } catch {
    return newState();
  }
}

function saveState() {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  const temp = `${statePath()}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(temp, statePath());
}

function randomInt(max) {
  return crypto.randomInt(0, max);
}

function weightedTier() {
  const roll = randomInt(100) + 1;
  let cumulative = 0;
  for (const tier of BOX_TIERS) {
    cumulative += tier.probability;
    if (roll <= cumulative) return tier;
  }
  return BOX_TIERS[BOX_TIERS.length - 1];
}

function makeBox(tier, source = "폐창고 회수") {
  return {
    id: `BOX-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    tier: tier.id,
    tierName: tier.name,
    accent: tier.accent,
    source,
    acquiredAt: new Date().toISOString(),
    openedAt: "",
  };
}

function rollItem(tierId, boxId) {
  const pool = ITEMS[tierId] || ITEMS.worn;
  const [name, originalValue] = pool[randomInt(pool.length)];
  return {
    id: `ITEM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    boxId,
    name,
    tier: tierId,
    originalValue,
    currentValue: originalValue,
    conditionPercent: 100,
    acquiredAt: new Date().toISOString(),
    source: "상자 개봉",
    syncStatus: "local-prototype",
  };
}

function publicState() {
  const mission = state.activeMission && state.activeMission.endsAt > Date.now()
    ? state.activeMission
    : null;
  if (!mission && state.activeMission) {
    state.activeMission = null;
    saveState();
  }
  return {
    devMode: !app.isPackaged,
    balance: state.devBalance,
    cutterOwned: state.cutterOwned,
    lockpicks: state.lockpicks,
    boxes: state.boxes,
    items: state.items,
    mission,
    prices: { cutter: CUTTER_PRICE, lockpick: LOCKPICK_PRICE },
    boxTiers: BOX_TIERS,
  };
}

function startMission() {
  if (state.activeMission && state.activeMission.endsAt > Date.now()) {
    return { ok: false, error: "이미 진행 중인 임무가 있습니다.", state: publicState() };
  }
  const positions = [...MISSION_NODE_POSITIONS].sort(() => Math.random() - 0.5).slice(0, 6);
  state.activeMission = {
    id: `MISSION-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    name: "폐창고 회수",
    startedAt: Date.now(),
    endsAt: Date.now() + MISSION_DURATION_MS,
    foundCount: 0,
    maxBoxes: MAX_BOXES_PER_MISSION,
    nodes: positions.map(([x, y], index) => ({ id: `NODE-${index + 1}`, x, y, searched: false })),
  };
  saveState();
  return { ok: true, mission: state.activeMission, state: publicState() };
}

function searchMissionNode(nodeId) {
  const mission = state.activeMission;
  if (!mission || mission.endsAt <= Date.now()) {
    state.activeMission = null;
    saveState();
    return { ok: false, error: "임무가 종료되었습니다.", state: publicState() };
  }
  const node = mission.nodes.find((entry) => entry.id === nodeId);
  if (!node) return { ok: false, error: "수색 지점을 찾지 못했습니다." };
  if (node.searched) return { ok: false, error: "이미 수색한 위치입니다." };
  node.searched = true;

  let box = null;
  if (mission.foundCount < mission.maxBoxes && randomInt(100) < 62) {
    const tier = weightedTier();
    box = makeBox(tier);
    mission.foundCount += 1;
    state.boxes.push(box);
    state.history.unshift({ type: "box", at: Date.now(), text: `${tier.name} 획득` });
  }

  const allSearched = mission.nodes.every((entry) => entry.searched);
  if (mission.foundCount >= mission.maxBoxes || allSearched) {
    state.activeMission = null;
  }
  saveState();
  return { ok: true, found: Boolean(box), box, mission: state.activeMission, state: publicState() };
}

function finishMission() {
  state.activeMission = null;
  saveState();
  return { ok: true, state: publicState() };
}

function buyCutter() {
  if (state.cutterOwned) return { ok: true, alreadyOwned: true, state: publicState() };
  if (state.devBalance < CUTTER_PRICE) return { ok: false, error: "잔액이 부족합니다." };
  state.devBalance -= CUTTER_PRICE;
  state.cutterOwned = true;
  saveState();
  return { ok: true, state: publicState() };
}

function buyLockpicks(quantity) {
  const count = Math.max(1, Math.min(100, Number(quantity) || 1));
  const cost = count * LOCKPICK_PRICE;
  if (state.devBalance < cost) return { ok: false, error: "잔액이 부족합니다." };
  state.devBalance -= cost;
  state.lockpicks += count;
  saveState();
  return { ok: true, quantity: count, cost, state: publicState() };
}

function boxById(id) {
  return state.boxes.find((box) => box.id === id && !box.openedAt);
}

function completeOpen(box) {
  const item = rollItem(box.tier, box.id);
  box.openedAt = new Date().toISOString();
  state.boxes = state.boxes.filter((entry) => entry.id !== box.id);
  state.items.unshift(item);
  state.history.unshift({ type: "item", at: Date.now(), text: `${item.name} 획득` });
  openSessions.delete(box.id);
  saveState();
  return item;
}

function startBoxOpen(boxId) {
  const box = boxById(boxId);
  if (!box) return { ok: false, error: "상자를 찾지 못했습니다." };
  if (box.tier === "safe") {
    if (state.lockpicks <= 0) return { ok: false, error: "락픽이 없습니다. 상점에서 구매해 주세요." };
    const existing = openSessions.get(box.id);
    if (!existing) {
      openSessions.set(box.id, {
        type: "safe",
        secretAngle: randomInt(141) - 70,
        pickHealth: 100,
      });
    }
    return { ok: true, type: "safe", pickHealth: openSessions.get(box.id).pickHealth, lockpicks: state.lockpicks };
  }
  if (!state.cutterOwned) return { ok: false, error: "커터칼이 없습니다. 상점에서 먼저 구매해 주세요." };
  openSessions.set(box.id, { type: "box", cutStep: 0, lastCutAt: 0 });
  return { ok: true, type: "box", cutStep: 0 };
}

function completeCut(boxId, step) {
  const box = boxById(boxId);
  const session = openSessions.get(boxId);
  if (!box || !session || session.type !== "box") return { ok: false, error: "개봉 세션이 없습니다." };
  if (Number(step) !== session.cutStep) return { ok: false, error: "절단 순서가 올바르지 않습니다." };
  const now = Date.now();
  if (session.lastCutAt && now - session.lastCutAt < 350) return { ok: false, error: "너무 빠르게 절단했습니다." };
  session.lastCutAt = now;
  session.cutStep += 1;
  if (session.cutStep >= 3) {
    const item = completeOpen(box);
    return { ok: true, opened: true, item, state: publicState() };
  }
  return { ok: true, opened: false, cutStep: session.cutStep };
}

function safeAttempt(boxId, angle, pressure) {
  const box = boxById(boxId);
  const session = openSessions.get(boxId);
  if (!box || box.tier !== "safe" || !session || session.type !== "safe") {
    return { ok: false, error: "금고 개봉 세션이 없습니다." };
  }
  if (state.lockpicks <= 0) return { ok: false, error: "락픽이 모두 소진되었습니다.", lockpicks: 0 };

  const normalizedAngle = Math.max(-80, Math.min(80, Number(angle) || 0));
  const normalizedPressure = Math.max(0.1, Math.min(1, Number(pressure) || 0.35));
  const diff = Math.abs(normalizedAngle - session.secretAngle);
  const tolerance = 7;
  const rotation = Math.max(0.05, Math.min(1, 1 - diff / 82));

  if (diff <= tolerance) {
    const item = completeOpen(box);
    return { ok: true, opened: true, item, rotation: 1, pickHealth: session.pickHealth, lockpicks: state.lockpicks, state: publicState() };
  }

  const danger = Math.max(0, (diff - 10) / 70);
  const damage = Math.max(2, Math.round((4 + danger * 24) * normalizedPressure));
  session.pickHealth -= damage;
  let broke = false;
  if (session.pickHealth <= 0) {
    broke = true;
    state.lockpicks -= 1;
    session.pickHealth = 100;
    saveState();
  }
  return {
    ok: true,
    opened: false,
    rotation,
    vibration: danger,
    pickHealth: session.pickHealth,
    broke,
    lockpicks: state.lockpicks,
    exhausted: state.lockpicks <= 0,
  };
}

function devReset() {
  if (app.isPackaged) return { ok: false, error: "개발 빌드에서만 사용할 수 있습니다." };
  state = newState();
  openSessions.clear();
  saveState();
  return { ok: true, state: publicState() };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    title: "SD 플리마켓 - PC Prototype",
    backgroundColor: "#0a0d12",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "public", "index.html"));
}

app.whenReady().then(() => {
  state = loadState();
  ipcMain.handle("flea:get-state", () => publicState());
  ipcMain.handle("flea:start-mission", () => startMission());
  ipcMain.handle("flea:search-node", (_event, id) => searchMissionNode(id));
  ipcMain.handle("flea:finish-mission", () => finishMission());
  ipcMain.handle("flea:buy-cutter", () => buyCutter());
  ipcMain.handle("flea:buy-lockpicks", (_event, quantity) => buyLockpicks(quantity));
  ipcMain.handle("flea:start-box-open", (_event, id) => startBoxOpen(id));
  ipcMain.handle("flea:complete-cut", (_event, id, step) => completeCut(id, step));
  ipcMain.handle("flea:safe-attempt", (_event, id, angle, pressure) => safeAttempt(id, angle, pressure));
  ipcMain.handle("flea:dev-reset", () => devReset());
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
