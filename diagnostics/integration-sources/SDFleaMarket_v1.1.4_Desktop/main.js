"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { app, BrowserWindow, ipcMain, safeStorage } = require("electron");
const { SdIntegration } = require("./src/sd-integration");

const BOX_TIERS = [
  { id: "worn", name: "낡은 상자", probability: 55, accent: "#8a725d" },
  { id: "normal", name: "평범한 상자", probability: 29, accent: "#78909c" },
  { id: "fancy", name: "고급진 상자", probability: 11, accent: "#4fc3f7" },
  { id: "premium", name: "최고급 상자", probability: 3, accent: "#ba68c8" },
  { id: "safe", name: "금고", probability: 2, accent: "#ffd54f" },
];

const FARM_LOCATIONS = [
  { id: "alley", name: "길거리", subtitle: "빠른 수량 파밍지", description: "긴 직선형 도로를 따라 이동하며 좌우 벽면의 파밍 포인트를 빠르게 훑는 지역입니다.", foundChance: 78, nodeCount: 6, maxBoxes: 4, specialMinTier: "normal", weights: { worn: 80, normal: 20, fancy: 0, premium: 0, safe: 0 } },
  { id: "abandoned_store", name: "상가", subtitle: "중급 파밍지", description: "입구 근처 벽돌을 주운 뒤 유리문에 던져 깨고 진입해야 하는 상가입니다. 내부 진열대와 캐비닛에서 평범한 상자와 고급 상자를 노릴 수 있습니다.", foundChance: 70, nodeCount: 8, maxBoxes: 3, specialMinTier: "fancy", weights: { worn: 30, normal: 50, fancy: 20, premium: 0, safe: 0 } },
  { id: "logistics", name: "물류센터", subtitle: "S등급 고가 파밍지", description: "회사 등급 S 이상만 출입 가능한 고가 파밍지입니다. 벽면 적재 구역 위주로 최고급 상자를 노릴 수 있습니다.", foundChance: 64, nodeCount: 8, maxBoxes: 2, specialMinTier: "fancy", requiredCompanyGrade: "S", weights: { worn: 8, normal: 35, fancy: 40, premium: 17, safe: 0 } },
  { id: "bank", name: "은행", subtitle: "준비작업형 특수 파밍지", description: "필수 침투 장비 준비작업을 끝내면 피날래에 진입할 수 있으며, 선택 준비작업으로 경비원 체력을 절반으로 낮출 수 있습니다. 피날래에서는 금고가 확정으로 등장하며 기존 금고와 같은 보상 풀을 사용합니다.", foundChance: 0, nodeCount: 7, maxBoxes: 0, specialMinTier: "safe", weights: { worn: 0, normal: 0, fancy: 0, premium: 0, safe: 100 }, specialMission: "bank" },
];

const SEARCH_OBJECTS = {
  alley: [
    { type: "trash", label: "철제 쓰레기통", icon: "🗑️" },
    { type: "bag", label: "버려진 봉투", icon: "🛍️" },
    { type: "vehicle", label: "주차 차량", icon: "🚙" },
    { type: "basket", label: "버려진 바구니", icon: "🧺" },
  ],
  abandoned_store: [
    { type: "cart", label: "쇼핑 카트", icon: "🛒" },
    { type: "cabinet", label: "매장 캐비닛", icon: "🗄️" },
    { type: "counter", label: "계산대", icon: "▤" },
    { type: "stock", label: "창고 적재물", icon: "🧰" },
  ],
  logistics: [
    { type: "cargo", label: "화물 적재물", icon: "🚚" },
    { type: "cart", label: "운송 카트", icon: "🛒" },
    { type: "case", label: "운송 케이스", icon: "🧰" },
    { type: "locker", label: "직원 보관함", icon: "🗄️" },
  ],
  bank_prep: [
    { type: "cabinet", label: "장비 캐비닛", icon: "🗄️" },
    { type: "locker", label: "직원 보관함", icon: "🗃️" },
    { type: "case", label: "장비 케이스", icon: "🧰" },
    { type: "counter", label: "보안 데스크", icon: "▤" },
  ],
};

const BANK_PREP_ORDER = [
  { id: "equipment", name: "침투 장비 확보", color: "#7ce7ff", required: true },
  { id: "guardWeakening", name: "경비원 무장 약화", color: "#ffd36e", required: false },
];
const BANK_GUARD_BASE_HP = 50;
const BANK_GUARD_WEAK_HP = 25;
const BANK_GUARD_BODY_DAMAGE = 10;
const BANK_GUARD_HEAD_DAMAGE = 25;
const BANK_GUARD_ATTACK_DAMAGE = 10;

const ITEMS = {
  worn: [
    ["볼펜", 1000], ["클립 한 통", 2000], ["지우개", 1000], ["15cm 자", 2000],
    ["작은 수첩", 4000], ["열쇠고리", 5000], ["머그컵", 7000], ["USB 케이블", 10000],
  ],
  normal: [
    ["유선 이어폰", 25000], ["휴대폰 충전기", 30000], ["미니 선풍기", 35000],
    ["USB 메모리", 40000], ["무선 마우스", 50000], ["보조배터리", 60000], ["저가형 헤드셋", 75000],
  ],
  fancy: [
    ["게임패드", 90000], ["기계식 키보드", 120000], ["브랜드 운동화", 150000],
    ["블루투스 스피커", 180000], ["무선 이어폰", 200000], ["스마트워치", 240000],
  ],
  premium: [
    ["휴대용 게임기 세트", 250000], ["프리미엄 헤드폰", 300000], ["고급 태블릿", 350000],
    ["미러리스 카메라", 400000], ["플래그십 스마트폰", 450000], ["고성능 그래픽카드", 500000],
  ],
  safe: [
    ["금반지", 220000, 26], ["희귀 주화", 280000, 20], ["금목걸이", 350000, 18], ["금화 세트", 450000, 14],
    ["명품 시계", 600000, 10], ["보석 원석", 850000, 7], ["소형 금괴", 1200000, 4], ["대형 금괴", 2500000, 1],
  ],
};

const MISSION_NODE_POSITIONS = [
  [10, 16], [23, 14], [37, 24], [51, 13], [65, 23], [79, 15],
  [15, 39], [30, 47], [46, 37], [61, 48], [78, 39], [90, 50],
  [12, 68], [27, 79], [43, 66], [58, 78], [73, 67], [87, 80],
];
const STATE_FILE_NAME = "flea-state.json";
const CUTTER_PRICE = 100000;
const STETHOSCOPE_PRICE = 100000;
const QUALITY_MANAGER_PRICE = 1500000;
const BACKPACK_PRICE = 300000;
const BANK_FINALE_COST = 500000;
const QUALITY_MANAGER_DAILY_POWER = 100000;
const ITEM_DAILY_DECAY_RATE = 0.02;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BOXES_PER_MISSION = 3;
const SAFE_JACKPOT_VALUE = Math.max(...ITEMS.safe.map(([, value]) => value));
const RED_DIAMOND_NAME = "레드 다이아몬드";
const RED_DIAMOND_CHANCE_DENOMINATOR = 100000;

let mainWindow;
let state;
let openSessions = new Map();
let integration = null;
let inventorySyncTimer = null;
let inventoryBackgroundInterval = null;
let inventorySyncRunning = false;
let lastInventorySyncAt = 0;
let lastInventorySyncError = "";

function statePath() {
  return path.join(app.getPath("userData"), STATE_FILE_NAME);
}

function newState() {
  return {
    schemaVersion: 3,
    cutterOwned: false,
    stethoscopeOwned: false,
    uvLightOwned: false,
    gunOwned: false,
    qualityManagerOwned: false,
    backpackOwned: false,
    bankPrep: { equipment: false, guardWeakening: false },
    companyGrade: "",
    lastEconomyTickAt: Date.now(),
    selectedLocationId: "alley",
    boxes: [],
    items: [],
    activeMission: null,
    history: [],
  };
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), "utf8"));
    const merged = { ...newState(), ...parsed, activeMission: null };
    if (parsed?.cartOwned && !merged.backpackOwned) merged.backpackOwned = true;
    merged.gunOwned = Boolean(parsed?.gunOwned || parsed?.bankPrep?.equipment);
    const legacyPrep = parsed?.bankPrep || {};
    merged.bankPrep = {
      equipment: Boolean(legacyPrep.equipment || (legacyPrep.stethoscope && legacyPrep.uvLight)),
      guardWeakening: Boolean(legacyPrep.guardWeakening),
    };
    merged.items = (merged.items || []).map((item) => ({
      ...item,
      currentValue: Number(item.currentValue ?? item.originalValue ?? 0),
      conditionPercent: Number(item.conditionPercent ?? 100),
      syncStatus: String(item.syncStatus || "pending"),
    }));
    return merged;
  } catch {
    return newState();
  }
}

function writeStateFile() {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  const temp = `${statePath()}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(temp, statePath());
}

function scheduleInventorySync(delayMs = 450) {
  if (!state || !integration) return;
  if (inventorySyncTimer) clearTimeout(inventorySyncTimer);
  inventorySyncTimer = setTimeout(() => {
    inventorySyncTimer = null;
    void syncInventoryNow(false);
  }, Math.max(50, Number(delayMs || 0)));
}

function startInventoryBackgroundSync() {
  if (inventoryBackgroundInterval) clearInterval(inventoryBackgroundInterval);

  const tick = async () => {
    if (!integration || !state) return;
    try {
      const company = integration.companyState?.() || {};
      await integration.refreshCompany(!company.onlineLinked);
    } catch {
      // SD Link가 아직 로그인되지 않았거나 네트워크가 끊겨도 다음 주기에 다시 시도합니다.
    }
    await syncInventoryNow(false);
  };

  setTimeout(() => void tick(), 1200);
  inventoryBackgroundInterval = setInterval(() => void tick(), 5000);
}

async function syncInventoryNow(force = false) {
  if (!state || !integration || inventorySyncRunning) return { ok: false, skipped: true };
  if (!force && Date.now() - lastInventorySyncAt < 2500) return { ok: false, skipped: true };

  inventorySyncRunning = true;
  try {
    const localItems = Array.isArray(state.items) ? state.items.map((item) => ({ ...item })) : [];
    const result = await integration.syncFleaInventory(localItems);
    const ownedIds = new Set(Array.isArray(result?.owned_local_item_ids) ? result.owned_local_item_ids.map(String) : []);
    const nextItems = [];
    let removed = 0;
    let changed = false;

    for (const item of state.items || []) {
      const localId = String(item?.id || "");
      if (!ownedIds.has(localId)) {
        removed += 1;
        changed = true;
        state.history.unshift({
          type: "online-sync",
          at: Date.now(),
          text: `${item?.name || "아이템"} · 모바일 판매 반영`,
        });
        continue;
      }
      if (item.syncStatus !== "online") {
        item.syncStatus = "online";
        changed = true;
      }
      nextItems.push(item);
    }

    state.items = nextItems;
    lastInventorySyncAt = Date.now();
    lastInventorySyncError = "";
    if (changed) writeStateFile();
    return { ok: true, removed, synced: Number(result?.synced_count || ownedIds.size) };
  } catch (error) {
    lastInventorySyncError = String(error?.message || error || "온라인 동기화 실패");
    return { ok: false, error: lastInventorySyncError };
  } finally {
    inventorySyncRunning = false;
  }
}

function saveState() {
  writeStateFile();
  scheduleInventorySync();
}

function randomInt(max) {
  return crypto.randomInt(0, max);
}

function farmLocation(locationId) {
  return FARM_LOCATIONS.find((location) => location.id === locationId) || FARM_LOCATIONS[0];
}

function gradeRank(grade) {
  const order = ["F", "E", "D", "C", "B", "A", "S", "SS", "SSS"];
  const normalized = String(grade || "").trim().toUpperCase();
  return order.indexOf(normalized);
}

function resolveCompanyGrade() {
  const onlineGrade = integration?.companyState?.().grade;
  return String(onlineGrade || "F").toUpperCase();
}

function locationUnlocked(location) {
  if (!location?.requiredCompanyGrade) return true;
  return gradeRank(resolveCompanyGrade()) >= gradeRank(location.requiredCompanyGrade);
}

function weightedTier(locationId = "alley", minimumTierId = null) {
  const location = farmLocation(locationId);
  const tierOrder = ["worn", "normal", "fancy", "premium", "safe"];
  const minimumIndex = minimumTierId ? tierOrder.indexOf(minimumTierId) : 0;
  const eligible = BOX_TIERS.filter((tier) => {
    const index = tierOrder.indexOf(tier.id);
    return index >= Math.max(0, minimumIndex) && Number(location.weights[tier.id] || 0) > 0;
  });
  const pool = eligible.length ? eligible : BOX_TIERS.filter((tier) => Number(location.weights[tier.id] || 0) > 0);
  const totalWeight = pool.reduce((sum, tier) => sum + Number(location.weights[tier.id] || 0), 0);
  let roll = randomInt(Math.max(1, totalWeight)) + 1;
  for (const tier of pool) {
    roll -= Number(location.weights[tier.id] || 0);
    if (roll <= 0) return tier;
  }
  return pool[0] || BOX_TIERS[0];
}

function randomSearchObject(locationId) {
  const pool = SEARCH_OBJECTS[locationId] || SEARCH_OBJECTS.alley;
  return pool[randomInt(pool.length)];
}

function makeBox(tier, source = "파밍 회수") {
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

function makeRedDiamond(boxId) {
  const itemId = typeof uid === "function"
    ? uid("ITEM")
    : `ITEM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  return {
    id: itemId,
    boxId,
    name: RED_DIAMOND_NAME,
    tier: "safe",
    originalValue: 1,
    currentValue: 1,
    conditionPercent: 100,
    acquiredAt: new Date().toISOString(),
    source: "금고 한정판",
    syncStatus: "pending",
    limitedEdition: true,
    sellable: false,
    tradeLocked: true,
  };
}

function rollRedDiamond(boxId) {
  return randomInt(RED_DIAMOND_CHANCE_DENOMINATOR) === 0 ? makeRedDiamond(boxId) : null;
}

function isLimitedItem(item) {
  return Boolean(item && (
    item.sellable === false ||
    item.tradeLocked === true ||
    item.name === RED_DIAMOND_NAME
  ));
}

function itemValueDisplay(item) {
  if (isLimitedItem(item)) return "판매 불가 · 한정판 상품";
  return `원본 가치 ${Number(item?.originalValue || 0).toLocaleString("ko-KR")}원`;
}

function rollItem(tierId, boxId, allowLimited = true) {
  if (allowLimited && tierId === "safe") {
    const limited = rollRedDiamond(boxId);
    if (limited) return limited;
  }
  const pool = ITEMS[tierId] || ITEMS.worn;
  let picked;
  if (tierId === "safe") {
    const totalWeight = pool.reduce((sum, entry) => sum + Number(entry[2] || 0), 0);
    let roll = Math.random() * totalWeight;
    picked = pool[pool.length - 1];
    for (const entry of pool) {
      roll -= Number(entry[2] || 0);
      if (roll < 0) { picked = entry; break; }
    }
  } else {
    picked = pool[randomInt(pool.length)];
  }
  const [name, originalValue] = picked;
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
    syncStatus: "pending",
  };
}

function previewGlowForRegularItem(item) {
  const value = Number(item?.originalValue || 0);
  if (value >= 800000) return "high";
  if (value >= 20000) return "normal";
  return "low";
}

function previewGlowForSafeItem(item) {
  if (isLimitedItem(item)) return "ruby";
  return Number(item?.originalValue || 0) >= SAFE_JACKPOT_VALUE ? "ruby" : "safe";
}

function applyEconomyTicks() {
  const now = Date.now();
  const last = Number(state.lastEconomyTickAt || now);
  const elapsedDays = Math.floor((now - last) / DAY_MS);
  if (elapsedDays <= 0) return;

  if (state.qualityManagerOwned) {
    const bill = elapsedDays * QUALITY_MANAGER_DAILY_POWER;
    const wallet = integration?.walletState?.() || { connected: false, balance: 0 };
    if (wallet.connected && Number(wallet.balance || 0) >= bill) {
      integration.adjustWallet(-bill, `SD 플리마켓 · 품질 자동 관리기 전기세 ${elapsedDays}일`);
      state.history.unshift({ type: "power", at: now, text: `품질 자동 관리기 전기세 ${bill.toLocaleString("ko-KR")}원` });
    } else if (state.items.length) {
      const valueFactor = Math.pow(1 - ITEM_DAILY_DECAY_RATE, elapsedDays);
      for (const item of state.items) {
        if (isLimitedItem(item)) continue;
        const baseCurrent = Number(item.currentValue ?? item.originalValue ?? 0);
        item.currentValue = Math.max(1, Math.round(baseCurrent * valueFactor));
        item.conditionPercent = Math.max(1, Number(item.conditionPercent || 100) - elapsedDays);
      }
      state.history.unshift({ type: "power-missed", at: now, text: `품질 자동 관리기 전기세 미납 · ${elapsedDays}일 가치 하락 반영` });
    }
  } else if (state.items.length) {
    const valueFactor = Math.pow(1 - ITEM_DAILY_DECAY_RATE, elapsedDays);
    for (const item of state.items) {
      if (isLimitedItem(item)) continue;
      const baseCurrent = Number(item.currentValue ?? item.originalValue ?? 0);
      item.currentValue = Math.max(1, Math.round(baseCurrent * valueFactor));
      item.conditionPercent = Math.max(1, Number(item.conditionPercent || 100) - elapsedDays);
    }
    state.history.unshift({ type: "quality", at: now, text: `${elapsedDays}일 경과 · 보관 물품 가치 하락 반영` });
  }

  state.lastEconomyTickAt = last + elapsedDays * DAY_MS;
  saveState();
}

function publicState() {
  applyEconomyTicks();
  const mission = state.activeMission || null;
  const wallet = integration?.walletState?.() || { connected: false, balance: 0, account: null };
  const company = integration?.companyState?.() || { grade: "F", rep: 0, onlineLinked: false, requiredRep: 2200 };
  return {
    devMode: false,
    walletConnected: Boolean(wallet.connected),
    walletAccountNumber: wallet.account?.accountNumber || "",
    balance: Number(wallet.balance || 0),
    cutterOwned: state.cutterOwned,
    stethoscopeOwned: Boolean(state.stethoscopeOwned),
    uvLightOwned: Boolean(state.uvLightOwned),
    gunOwned: Boolean(state.gunOwned),
    qualityManagerOwned: state.qualityManagerOwned,
    backpackOwned: Boolean(state.backpackOwned),
    bankPrep: { ...state.bankPrep },
    companyGrade: resolveCompanyGrade(),
    companyRep: Number(company.rep || 0),
    companyOnlineLinked: Boolean(company.onlineLinked),
    companyRequiredRep: Number(company.requiredRep || 2200),
    onlineInventorySync: {
      linked: Boolean(company.onlineLinked),
      syncing: Boolean(inventorySyncRunning),
      lastSyncedAt: Number(lastInventorySyncAt || 0),
      lastError: String(lastInventorySyncError || ""),
    },
    qualityManagerDailyPower: QUALITY_MANAGER_DAILY_POWER,
    itemDailyDecayRate: ITEM_DAILY_DECAY_RATE,
    selectedLocationId: state.selectedLocationId || "alley",
    boxes: state.boxes,
    items: state.items,
    mission,
    prices: { cutter: CUTTER_PRICE, stethoscope: STETHOSCOPE_PRICE, qualityManager: QUALITY_MANAGER_PRICE, backpack: BACKPACK_PRICE, bankFinale: BANK_FINALE_COST },
    boxTiers: BOX_TIERS,
    farmLocations: FARM_LOCATIONS,
  };
}


function nextBankPrepStep() {
  const progress = state.bankPrep || {};
  return BANK_PREP_ORDER.find((step) => !progress[step.id]) || null;
}

function rewardCard(name, accent = "#9aa6b2", kind = "reward") {
  return { id: `REWARD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, tier: kind, tierName: name, accent };
}

function buildRegularMission(location) {
  const positions = [...MISSION_NODE_POSITIONS].sort(() => Math.random() - 0.5).slice(0, Number(location.nodeCount || 10));
  const specialIndex = positions.length && randomInt(100) < 20 ? randomInt(positions.length) : -1;
  const regularNodes = positions.map(([,], index) => {
    const object = randomSearchObject(location.id);
    return { id: `NODE-${index + 1}`, searched: false, objectType: object.type, objectLabel: object.label, objectIcon: object.icon, special: index === specialIndex };
  });
  const storeGateNodes = location.id === "abandoned_store"
    ? [
        { id: "STORE-BRICK", searched: false, kind: "store-brick", objectType: "brick", objectLabel: "입구 옆 벽돌", objectIcon: "🧱" },
        { id: "STORE-DOOR", searched: false, kind: "store-door", objectType: "glassdoor", objectLabel: "상가 유리문", objectIcon: "▦" },
      ]
    : [];
  return {
    id: `MISSION-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    missionType: "regular",
    name: `${location.name} 회수`,
    locationId: location.id,
    locationName: location.name,
    foundChance: location.foundChance,
    startedAt: Date.now(),
    foundCount: 0,
    searchCount: 0,
    missStreak: 0,
    exhausted: false,
    storeBrickOwned: false,
    storeDoorBroken: location.id !== "abandoned_store",
    maxBoxes: Number(location.maxBoxes || MAX_BOXES_PER_MISSION) + (state.backpackOwned ? 3 : 0),
    nodes: [...storeGateNodes, ...regularNodes],
    safe: location.id === "abandoned_store" && randomInt(100) < 5 ? {
      id: `SAFE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      spawnIndex: randomInt(3),
      opened: false,
      discovered: false,
    } : null,
  };
}

function buildBankPrepMission(step) {
  const positions = [...MISSION_NODE_POSITIONS].sort(() => Math.random() - 0.5).slice(0, 6);
  const targetIndexes = step.id === "equipment"
    ? [...Array(positions.length).keys()].sort(() => Math.random() - 0.5).slice(0, 3)
    : [randomInt(positions.length)];
  const equipmentTargets = [
    { id: "stethoscope", label: "청진기 보관함", icon: "🩺" },
    { id: "uvLight", label: "UV 라이트 케이스", icon: "🔦" },
    { id: "gun", label: "권총 보관 케이스", icon: "🔫" },
  ];
  const prepNodes = positions.map(([,], index) => {
    const object = randomSearchObject("bank_prep");
    const targetOrder = targetIndexes.indexOf(index);
    if (step.id === "equipment" && targetOrder >= 0) {
      const target = equipmentTargets[targetOrder];
      return { id: `PREP-${index + 1}`, searched: false, objectType: target.id === "stethoscope" ? "cabinet" : "case", objectLabel: target.label, objectIcon: target.icon, kind: "prep-target", prepTargetId: target.id };
    }
    if (step.id === "guardWeakening" && targetOrder >= 0) {
      return { id: `PREP-${index + 1}`, searched: false, objectType: "counter", objectLabel: "경비 장비 제어 단말기", objectIcon: "⌨️", kind: "prep-target", prepTargetId: "guardWeakening" };
    }
    return { id: `PREP-${index + 1}`, searched: false, objectType: object.type, objectLabel: object.label, objectIcon: object.icon, kind: "prep-empty" };
  });
  const guardNodes = step.id === "guardWeakening"
    ? [
        bankGuardNode(1, 9.4, 11.2, -Math.PI / 2, false),
        bankGuardNode(2, 14.0, 9.4, -Math.PI / 2, false),
        bankGuardNode(3, 18.6, 11.2, -Math.PI / 2, false),
      ]
    : [];
  return {
    id: `MISSION-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    missionType: "bank-prep",
    name: `준비작업 · ${step.name}`,
    locationId: "bank_prep",
    locationName: step.required ? "준비작업 1/2" : "준비작업 2/2 · 선택",
    startedAt: Date.now(),
    exhausted: false,
    prepId: step.id,
    prepName: step.name,
    prepColor: step.color,
    prepRequired: Boolean(step.required),
    prepComplete: false,
    prepFoundIds: [],
    maxBoxes: 0,
    foundCount: 0,
    searchCount: 0,
    guardsNeutralized: 0,
    guardAlarmTriggered: false,
    playerHealth: 100,
    nodes: [...prepNodes, ...guardNodes],
    safe: null,
  };
}

function bankGuardNode(index, x, y, facing, weak = false, extra = false) {
  const maxHp = weak ? BANK_GUARD_WEAK_HP : BANK_GUARD_BASE_HP;
  return {
    id: `BANK-GUARD-${index}`,
    searched: false,
    kind: "guard",
    objectType: "guard",
    objectLabel: extra ? `증원 경비원 ${index - 3}` : `경비원 ${index}`,
    objectIcon: "👤",
    hp: maxHp,
    maxHp,
    facing,
    worldX: x,
    worldY: y,
    extra: Boolean(extra),
  };
}

function buildBankFinaleMission() {
  const emptySlots = new Set(Array.from({ length: 6 }, (_, index) => index).sort(() => Math.random() - 0.5).slice(0, 2));
  const safePositions = [[8.65,7.7],[21.35,7.7],[8.65,10.0],[21.35,10.0],[10.15,5.55],[19.85,5.55]];
  const safeNodes = Array.from({ length: 6 }, (_, index) => ({
    id: `BANK-SAFE-${index + 1}`,
    searched: false,
    opened: false,
    carried: false,
    kind: "safe-node",
    objectType: "safe",
    objectLabel: `은행 금고 ${index + 1}`,
    objectIcon: "🔐",
    empty: emptySlots.has(index),
    worldX: safePositions[index][0],
    worldY: safePositions[index][1],
  }));
  const weak = Boolean(state.bankPrep?.guardWeakening);
  return {
    id: `MISSION-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    missionType: "bank-finale",
    name: "은행 피날래",
    locationId: "bank",
    locationName: "은행",
    startedAt: Date.now(),
    exhausted: false,
    maxBoxes: 0,
    foundCount: 0,
    searchCount: 0,
    bankDoorUnlocked: false,
    bankCode: makeBankDoorCode(),
    guardsNeutralized: 0,
    guardAlarmTriggered: false,
    guardWeakening: weak,
    playerHealth: 100,
    safeOpened: 0,
    safeCarried: 0,
    bankLootItemIds: [],
    bankLootValue: 0,
    chasePending: false,
    nodes: [
      { id: "BANK-DOOR", searched: false, kind: "door", objectType: "panel", objectLabel: "은행 출입문 패널", objectIcon: "⌘", worldX: 15.0, worldY: 16.35 },
      bankGuardNode(1, 9.8, 12.25, -Math.PI / 2, weak),
      bankGuardNode(2, 15.0, 11.15, -Math.PI / 2, weak),
      bankGuardNode(3, 20.2, 12.25, -Math.PI / 2, weak),
      ...safeNodes,
    ],
    safe: null,
  };
}

function bankGuardTotal(mission) {
  return mission?.nodes?.filter((node) => node.kind === "guard").length || 0;
}

function isGuardCombatMission(mission) {
  return Boolean(
    mission && (
      mission.missionType === "bank-finale" ||
      (mission.missionType === "bank-prep" && mission.prepId === "guardWeakening")
    )
  );
}

function removeBankLoot(mission) {
  const ids = new Set(Array.isArray(mission?.bankLootItemIds) ? mission.bankLootItemIds : []);
  if (!ids.size) return 0;
  let lost = 0;
  state.items = state.items.filter((item) => {
    if (!ids.has(item.id)) return true;
    lost += Number(item.originalValue || item.currentValue || 0);
    return false;
  });
  return lost;
}

function failBankFinale(reason = "경비원에게 제압되었습니다.") {
  const mission = state.activeMission;
  if (!mission || mission.missionType !== "bank-finale") return 0;
  const lostValue = removeBankLoot(mission);
  state.history.unshift({ type: "bank-failed", at: Date.now(), text: `${reason} · 습격 획득품 손실 ${lostValue.toLocaleString("ko-KR")}원` });
  state.bankPrep = { equipment: false, guardWeakening: false };
  state.activeMission = null;
  saveState();
  return lostValue;
}

function missionSafeNode(mission, safeId) {
  return mission?.nodes?.find((node) => node.id === safeId && node.kind === "safe-node") || null;
}

function startMission(locationId = "alley", bankMode = "") {
  if (state.activeMission) return { ok: false, error: "이미 진행 중인 임무가 있습니다.", state: publicState() };
  const location = farmLocation(locationId);
  if (!locationUnlocked(location)) return { ok: false, error: `물류센터는 회사 등급 ${location.requiredCompanyGrade} 이상부터 이용할 수 있습니다.`, state: publicState() };
  state.selectedLocationId = location.id;

  if (location.id === "bank") {
    const prep = state.bankPrep || {};
    const mode = String(bankMode || (prep.equipment ? "finale" : "equipment"));
    if (mode === "equipment") {
      if (prep.equipment) return { ok: false, error: "필수 침투 장비 준비작업은 이미 완료했습니다.", state: publicState() };
      state.activeMission = buildBankPrepMission(BANK_PREP_ORDER[0]);
      saveState();
      return { ok: true, mission: state.activeMission, state: publicState() };
    }
    if (mode === "guardWeakening") {
      if (!prep.equipment) return { ok: false, error: "필수 침투 장비 준비작업을 먼저 완료해야 합니다.", state: publicState() };
      if (prep.guardWeakening) return { ok: false, error: "경비원 무장 약화 준비작업은 이미 완료했습니다.", state: publicState() };
      state.activeMission = buildBankPrepMission(BANK_PREP_ORDER[1]);
      saveState();
      return { ok: true, mission: state.activeMission, state: publicState() };
    }
    if (!prep.equipment) return { ok: false, error: "피날래 전에 침투 장비 확보 준비작업이 필수입니다.", state: publicState() };
    if (!state.gunOwned) return { ok: false, error: "권총이 준비되지 않았습니다. 침투 장비 확보 준비작업에서 권총까지 확보해 주세요.", state: publicState() };
    const wallet = integration?.walletState?.() || { connected: false, balance: 0 };
    if (!wallet.connected) return { ok: false, error: "SD지갑 가상계좌를 찾지 못했습니다. SD Link에서 지갑을 먼저 연결하세요.", state: publicState() };
    if (Number(wallet.balance || 0) < BANK_FINALE_COST) return { ok: false, error: `은행 피날래 시작 비용 ${BANK_FINALE_COST.toLocaleString("ko-KR")}원이 부족합니다.`, state: publicState() };
    integration.adjustWallet(-BANK_FINALE_COST, "SD 플리마켓 · 은행 피날래 진입 비용");
    state.history.unshift({ type: "bank", at: Date.now(), text: `은행 피날래 진입 비용 ${BANK_FINALE_COST.toLocaleString("ko-KR")}원 지출` });
    state.activeMission = buildBankFinaleMission();
    saveState();
    return { ok: true, mission: state.activeMission, state: publicState() };
  }

  state.activeMission = buildRegularMission(location);
  saveState();
  return { ok: true, mission: state.activeMission, state: publicState() };
}

function unlockBankDoor(code) {
  const mission = state.activeMission;
  if (!mission || mission.missionType !== "bank-finale") return { ok: false, error: "은행 피날래가 진행 중이 아닙니다.", state: publicState() };
  if (!state.uvLightOwned) return { ok: false, error: "UV 라이트가 준비되지 않았습니다.", state: publicState() };
  if (mission.bankDoorUnlocked) return { ok: true, alreadyUnlocked: true, state: publicState() };
  if (String(code || "").padStart(4, "0") !== String(mission.bankCode || "")) return { ok: false, wrongCode: true, error: "비밀번호가 맞지 않습니다.", state: publicState() };
  mission.bankDoorUnlocked = true;
  const door = mission.nodes.find((node) => node.kind === "door");
  if (door) door.searched = true;
  state.history.unshift({ type: "bank-door", at: Date.now(), text: "UV 라이트로 은행 출입문 비밀번호 확인 및 잠금 해제" });
  saveState();
  return { ok: true, unlocked: true, rewardCard: rewardCard("은행 문 개방", "#b68cff", "door"), state: publicState() };
}

function triggerBankGuardAlert() {
  const mission = state.activeMission;
  if (!isGuardCombatMission(mission)) return { ok: false, error: "경비원이 배치된 은행 임무가 진행 중이 아닙니다.", state: publicState() };
  if (mission.guardAlarmTriggered) return { ok: true, alreadyTriggered: true, spawned: 0, state: publicState() };
  mission.guardAlarmTriggered = true;
  if (mission.missionType === "bank-finale") {
    const weak = Boolean(mission.guardWeakening);
    mission.nodes.push(
      bankGuardNode(4, 11.1, 8.8, -Math.PI / 2, weak, true),
      bankGuardNode(5, 15.0, 7.8, -Math.PI / 2, weak, true),
      bankGuardNode(6, 18.9, 8.8, -Math.PI / 2, weak, true),
    );
    state.history.unshift({ type: "bank-alarm", at: Date.now(), text: "경비원 시야에 발각 · 증원 경비원 3명 출동" });
    saveState();
    return { ok: true, spawned: 3, state: publicState() };
  }
  state.history.unshift({ type: "bank-prep-alarm", at: Date.now(), text: "경비 약화 준비작업 중 경비원에게 발각" });
  saveState();
  return { ok: true, spawned: 0, prep: true, state: publicState() };
}

function shootBankGuard(nodeId, hitZone = "body") {
  const mission = state.activeMission;
  if (!isGuardCombatMission(mission)) return { ok: false, error: "사격 가능한 은행 임무가 진행 중이 아닙니다.", state: publicState() };
  if (mission.missionType === "bank-finale" && !mission.bankDoorUnlocked) return { ok: false, error: "먼저 은행 문을 열어야 합니다.", state: publicState() };
  const guard = mission.nodes.find((node) => node.id === nodeId && node.kind === "guard");
  if (!guard || guard.searched) return { ok: false, error: "사격 가능한 경비원이 없습니다.", state: publicState() };
  const zone = hitZone === "head" ? "head" : "body";
  const damage = zone === "head" ? BANK_GUARD_HEAD_DAMAGE : BANK_GUARD_BODY_DAMAGE;
  guard.hp = Math.max(0, Number(guard.hp ?? guard.maxHp ?? BANK_GUARD_BASE_HP) - damage);
  let killed = false;
  if (guard.hp <= 0) {
    killed = true;
    guard.searched = true;
    mission.guardsNeutralized = Number(mission.guardsNeutralized || 0) + 1;
  }
  saveState();
  return { ok: true, hitZone: zone, damage, killed, guardHp: guard.hp, guardMaxHp: guard.maxHp, guardsNeutralized: mission.guardsNeutralized, guardTotal: bankGuardTotal(mission), state: publicState() };
}

function bankGuardHitPlayer() {
  const mission = state.activeMission;
  if (!isGuardCombatMission(mission)) return { ok: false, ignored: true, state: publicState() };
  mission.playerHealth = Math.max(0, Number(mission.playerHealth ?? 100) - BANK_GUARD_ATTACK_DAMAGE);
  if (mission.playerHealth <= 0) {
    if (mission.missionType === "bank-finale") {
      const lostValue = failBankFinale("경비원 총격으로 제압됨");
      return { ok: true, failed: true, damage: BANK_GUARD_ATTACK_DAMAGE, playerHealth: 0, lostValue, state: publicState() };
    }
    state.history.unshift({ type: "bank-prep-failed", at: Date.now(), text: "경비 약화 준비작업 중 경비원 총격으로 제압됨" });
    state.activeMission = null;
    saveState();
    return { ok: true, failed: true, prepFailed: true, damage: BANK_GUARD_ATTACK_DAMAGE, playerHealth: 0, lostValue: 0, state: publicState() };
  }
  saveState();
  return { ok: true, damage: BANK_GUARD_ATTACK_DAMAGE, playerHealth: mission.playerHealth, state: publicState() };
}

function searchMissionNode(nodeId) {
  const mission = state.activeMission;
  if (!mission) return { ok: false, error: "진행 중인 임무가 없습니다.", state: publicState() };
  if (mission.exhausted) return { ok: false, error: "파밍이 끝났습니다. EXIT로 돌아가세요.", state: publicState() };
  const node = mission.nodes.find((entry) => entry.id === nodeId);
  if (!node) return { ok: false, error: "수색 대상을 찾지 못했습니다." };
  if (node.searched && node.kind !== "safe-node") return { ok: false, error: "이미 수색한 대상입니다." };

  if (mission.missionType === "regular" && mission.locationId === "abandoned_store") {
    if (node.kind === "store-brick") {
      node.searched = true;
      mission.storeBrickOwned = true;
      state.history.unshift({ type: "store-brick", at: Date.now(), text: "상가 입구 벽돌 확보" });
      saveState();
      return { ok: true, found: true, storeAction: "brick", searchedObject: node.objectLabel, mission: state.activeMission, exhausted: false, state: publicState() };
    }
    if (node.kind === "store-door") {
      if (mission.storeDoorBroken) return { ok: false, error: "이미 유리문이 깨져 있습니다.", state: publicState() };
      if (!mission.storeBrickOwned) return { ok: false, error: "입구 근처의 벽돌을 먼저 주워야 합니다.", state: publicState() };
      node.searched = true;
      mission.storeBrickOwned = false;
      mission.storeDoorBroken = true;
      state.history.unshift({ type: "store-door", at: Date.now(), text: "벽돌로 상가 유리문 파손" });
      saveState();
      return { ok: true, found: true, storeAction: "glass-break", searchedObject: node.objectLabel, mission: state.activeMission, exhausted: false, state: publicState() };
    }
  }

  mission.searchCount = Number(mission.searchCount || 0) + 1;

  if (mission.missionType === "bank-prep") {
    if (node.kind === "guard") return { ok: false, error: "경비원은 화면 중앙에 조준한 뒤 좌클릭으로 사격하세요.", state: publicState() };
    node.searched = true;
    if (node.kind === "prep-target") {
      const found = new Set(Array.isArray(mission.prepFoundIds) ? mission.prepFoundIds : []);
      found.add(node.prepTargetId || mission.prepId);
      mission.prepFoundIds = [...found];
      const requiredTargets = mission.prepId === "equipment" ? ["stethoscope", "uvLight", "gun"] : ["guardWeakening"];
      mission.prepComplete = requiredTargets.every((id) => found.has(id));
      mission.exhausted = mission.prepComplete;
      saveState();
      const detail = mission.prepId === "equipment" ? `${mission.prepFoundIds.length} / 3 확보` : "경비 장비 약화 설정 완료";
      return { ok: true, found: true, prepFound: true, prepPartial: !mission.prepComplete, rewardCard: rewardCard(`${node.objectLabel} 확보`, mission.prepColor, "gear"), searchedObject: node.objectLabel, prepDetail: detail, mission: state.activeMission, exhausted: mission.exhausted, state: publicState() };
    }
    saveState();
    return { ok: true, found: false, searchedObject: node.objectLabel, mission: state.activeMission, exhausted: false, state: publicState() };
  }

  if (mission.missionType === "bank-finale") {
    if (node.kind === "door") {
      if (mission.bankDoorUnlocked) return { ok: false, error: "이미 은행 문 잠금을 해제했습니다." };
      if (!state.uvLightOwned) return { ok: false, error: "UV 라이트가 준비되지 않았습니다." };
      return { ok: true, found: false, bankAction: "uv-required", searchedObject: node.objectLabel, mission: state.activeMission, exhausted: false, state: publicState() };
    }
    if (node.kind === "guard") {
      return { ok: false, error: "경비원은 화면 중앙에 조준한 뒤 좌클릭으로 사격하세요.", state: publicState() };
    }
    if (node.kind === "safe-node") {
      if (!mission.bankDoorUnlocked) return { ok: false, error: "먼저 은행 문을 열어야 합니다." };
      const totalGuards = bankGuardTotal(mission);
      if (Number(mission.guardsNeutralized || 0) < totalGuards) return { ok: false, error: `경비원을 모두 제압해야 금고를 들고 갈 수 있습니다. (${mission.guardsNeutralized || 0}/${totalGuards})` };
      if (node.carried || node.searched) return { ok: false, error: "이미 챙긴 금고입니다." };
      node.carried = true;
      node.searched = true;
      node.opened = false;
      mission.safeCarried = Number(mission.safeCarried || 0) + 1;
      const totalSafes = mission.nodes.filter((entry) => entry.kind === "safe-node").length;
      if (mission.safeCarried >= totalSafes) mission.exhausted = true;
      state.history.unshift({ type: "bank-safe-carry", at: Date.now(), text: `${node.objectLabel} 통째로 회수 · 현재 ${mission.safeCarried}개 운반 중` });
      saveState();
      return { ok: true, found: true, bankAction: "safe-carried", safeId: node.id, safeCount: Number(mission.safeCarried || 0), searchedObject: node.objectLabel, mission: state.activeMission, exhausted: Boolean(mission.exhausted), state: publicState() };
    }
  }

  node.searched = true;
  const baseChance = Number(mission.foundChance || 62);
  const pityBonus = Math.min(30, Number(mission.missStreak || 0) * 15);
  const forceFirstFind = mission.foundCount === 0 && mission.searchCount >= 2;
  const shouldFind = Boolean(node.special) || forceFirstFind || randomInt(100) < Math.min(96, baseChance + pityBonus);
  let box = null;
  if (mission.foundCount < mission.maxBoxes && shouldFind) {
    const location = farmLocation(mission.locationId);
    const tier = weightedTier(mission.locationId, node.special ? location.specialMinTier : null);
    box = makeBox(tier, `${mission.locationName || "파밍지"} 회수`);
    mission.foundCount += 1;
    mission.missStreak = 0;
    state.boxes.push(box);
    state.history.unshift({ type: "box", at: Date.now(), text: `${tier.name} 획득` });
  } else {
    mission.missStreak = Number(mission.missStreak || 0) + 1;
  }
  const allSearched = mission.nodes.every((entry) => entry.searched);
  if (mission.foundCount >= mission.maxBoxes) { mission.exhausted = true; mission.nodes.forEach((entry) => { if (!entry.searched) entry.searched = true; }); }
  else if (allSearched) mission.exhausted = true;
  saveState();
  return { ok: true, found: Boolean(box), box, searchedObject: node.objectLabel, special: Boolean(node.special), mission: state.activeMission, exhausted: Boolean(mission.exhausted), state: publicState() };
}

function finishMission() {
  const mission = state.activeMission;
  if (mission?.missionType === "bank-finale" && Number(mission.safeCarried || 0) < 1) { return { ok: false, error: "은행 금고를 최소 1개는 들고 나와야 탈출할 수 있습니다.", state: publicState() }; }
  if (mission?.missionType === "bank-finale") {
    mission.chasePending = true;
    saveState();
    return { ok: true, bankChase: true, chase: { safeCount: Number(mission.safeCarried || 0), lootValue: 0, lootCount: 0 }, state: publicState() };
  }
  if (mission?.missionType === "bank-prep" && mission.prepComplete && mission.prepId) {
    state.bankPrep[mission.prepId] = true;
    if (mission.prepId === "equipment") {
      state.stethoscopeOwned = true;
      state.uvLightOwned = true;
      state.gunOwned = true;
    }
    state.history.unshift({ type: "bank-prep", at: Date.now(), text: `${mission.prepName} 준비 완료` });
  }
  state.activeMission = null;
  saveState();
  return { ok: true, state: publicState() };
}

function finishBankChase(success) {
  const mission = state.activeMission;
  if (!mission || mission.missionType !== "bank-finale" || !mission.chasePending) return { ok: false, error: "진행 중인 은행 오토바이 추격전이 없습니다.", state: publicState() };
  const carriedSafes = mission.nodes.filter((node) => node.kind === "safe-node" && node.carried);
  const safeCount = carriedSafes.length;
  const rewards = [];
  let emptyCount = 0;
  let securedValue = 0;
  if (success) {
    for (const safe of carriedSafes) {
      const item = rollRedDiamond(safe.id) || (safe.empty ? null : rollItem("safe", safe.id, false));
      safe.opened = true;
      if (!item) {
        emptyCount += 1;
        state.history.unshift({ type: "mission-safe", at: Date.now(), text: `${safe.objectLabel || "은행 금고"} 개봉 · 꽝` });
        continue;
      }
      item.source = `은행 탈출 금고 ${safe.id}`;
      state.items.unshift(item);
      rewards.push(item);
      securedValue += Number(item.originalValue || item.currentValue || 0);
      state.history.unshift({ type: "mission-safe", at: Date.now(), text: `${safe.objectLabel || "은행 금고"} 개봉 · ${item.name} 획득` });
    }
    mission.safeOpened = safeCount;
    mission.bankLootItemIds = rewards.map((item) => item.id);
    mission.bankLootValue = securedValue;
  }
  state.history.unshift({
    type: "bank-chase",
    at: Date.now(),
    text: success
      ? `은행 도주 성공 · 금고 ${safeCount}개 확보 · 물품 ${rewards.length}개 · 가치 ${securedValue.toLocaleString("ko-KR")}원`
      : `은행 도주 실패 · 오토바이 내구도 소진 · 운반 중 금고 ${safeCount}개 전부 분실`,
  });
  state.bankPrep = { equipment: false, guardWeakening: false };
  state.activeMission = null;
  saveState();
  return { ok: true, success: Boolean(success), safeCount, securedValue: success ? securedValue : 0, lostValue: 0, lostSafes: success ? 0 : safeCount, emptyCount: success ? emptyCount : 0, rewards: success ? rewards : [], state: publicState() };
}

function activeMissionSafe(safeId) {
  const mission = state.activeMission;
  if (missionSafeNode(mission, safeId)) return missionSafeNode(mission, safeId);
  if (!mission?.safe || mission.safe.id !== safeId || mission.safe.opened) return null;
  return mission.safe;
}

function startMissionSafe(safeId) {
  const mission = state.activeMission;
  const safe = activeMissionSafe(safeId);
  if (!safe) return { ok: false, error: "현장의 금고를 찾지 못했습니다.", state: publicState() };
  if (!state.stethoscopeOwned) return { ok: false, error: "청진기가 필요합니다. 침투 장비 확보 준비작업에서 먼저 확보해 주세요.", state: publicState() };
  const key = missionSafeSessionKey(safeId);
  if (!openSessions.has(key)) {
    const pendingItem = safe.kind === "safe-node" && safe.empty ? rollRedDiamond(safeId) : rollItem("safe", safeId);
    if (pendingItem) pendingItem.source = `${mission.locationName || "파밍지"} 현장 금고`;
    openSessions.set(key, { type: safe.kind === "safe-node" ? "mission-safe-bank" : "mission-safe", combination: makeSafeCombination(), stage: 0, pendingItem, previewGlow: pendingItem ? previewGlowForSafeItem(pendingItem) : "safe" });
  }
  if (safe.id && mission?.safe?.id === safe.id) safe.discovered = true;
  const session = openSessions.get(key); saveState();
  return { ok: true, type: "mission-safe", stage: session.stage, totalLocks: session.combination.length, previewGlow: session.previewGlow, state: publicState() };
}

function missionSafeListen(safeId, dialNumber) {
  const safe = activeMissionSafe(safeId);
  const session = openSessions.get(missionSafeSessionKey(safeId));
  if (!safe || !session || !String(session.type || "").startsWith("mission-safe")) return { ok: false, error: "현장 금고 개방 세션이 없습니다." };
  const current = safeDialNumber(dialNumber);
  const target = session.combination[session.stage];
  return { ok: true, hit: current === target, stage: session.stage, totalLocks: session.combination.length };
}

function missionSafeAttempt(safeId, dialNumber) {
  const mission = state.activeMission;
  const safe = activeMissionSafe(safeId);
  const key = missionSafeSessionKey(safeId);
  const session = openSessions.get(key);
  if (!safe || !session || !String(session.type || "").startsWith("mission-safe")) return { ok: false, error: "현장 금고 개방 세션이 없습니다." };
  if (!state.stethoscopeOwned) return { ok: false, error: "청진기가 필요합니다." };
  const current = safeDialNumber(dialNumber);
  const target = session.combination[session.stage];
  if (current !== target) return { ok: true, opened: false, correct: false, stage: session.stage, totalLocks: session.combination.length, previewGlow: session.previewGlow };
  session.stage += 1;
  if (session.stage < session.combination.length) return { ok: true, opened: false, correct: true, stage: session.stage, totalLocks: session.combination.length, previewGlow: session.previewGlow };
  const item = session.pendingItem;
  if (safe.kind === "safe-node") {
    safe.opened = true; safe.searched = true; mission.safeOpened = Number(mission.safeOpened || 0) + 1;
    if (item) {
      state.items.unshift(item);
      mission.bankLootItemIds = Array.isArray(mission.bankLootItemIds) ? mission.bankLootItemIds : [];
      if (!mission.bankLootItemIds.includes(item.id)) mission.bankLootItemIds.push(item.id);
      mission.bankLootValue = Number(mission.bankLootValue || 0) + Number(item.originalValue || 0);
      state.history.unshift({ type: "mission-safe", at: Date.now(), text: `은행 금고에서 ${item.name} 획득` });
    } else {
      state.history.unshift({ type: "mission-safe", at: Date.now(), text: `${safe.objectLabel || "은행 금고"} · 꽝` });
    }
    if (mission.nodes.filter((node) => node.kind === "safe-node" && node.opened).length >= mission.nodes.filter((node) => node.kind === "safe-node").length) mission.exhausted = true;
    openSessions.delete(key); saveState();
    return { ok: true, opened: true, correct: true, stage: session.combination.length, totalLocks: session.combination.length, item, empty: !item, safeLabel: safe.objectLabel, state: publicState(), previewGlow: session.previewGlow };
  }
  safe.opened = true; safe.openedAt = new Date().toISOString(); state.items.unshift(item); state.history.unshift({ type: "mission-safe", at: Date.now(), text: `${mission.locationName || "파밍지"} 현장 금고에서 ${item.name} 획득` }); openSessions.delete(key); saveState();
  return { ok: true, opened: true, correct: true, stage: session.combination.length, totalLocks: session.combination.length, item, state: publicState(), previewGlow: session.previewGlow };
}

function buyCutter() {
  if (state.cutterOwned) return { ok: true, alreadyOwned: true, state: publicState() };
  const wallet = integration?.walletState?.() || { connected: false, balance: 0 };
  if (!wallet.connected) return { ok: false, error: "SD지갑 가상계좌를 먼저 연결하세요." };
  if (Number(wallet.balance || 0) < CUTTER_PRICE) return { ok: false, error: "잔액이 부족합니다." };
  integration.adjustWallet(-CUTTER_PRICE, "SD 플리마켓 · 커터칼 구매");
  state.cutterOwned = true;
  saveState();
  return { ok: true, state: publicState() };
}

function buyStethoscope() {
  return { ok: false, error: "청진기는 상점에서 판매하지 않습니다. 침투 장비 확보 준비작업에서 확보해야 합니다.", state: publicState() };
}

function safeDialNumber(value) {
  const n = Math.round(Number(value) || 0);
  return ((n % 100) + 100) % 100;
}

function makeSafeCombination() {
  const targets = [];
  while (targets.length < 1) {
    const candidate = randomInt(100);
    const farEnough = targets.every((target) => {
      const diff = Math.abs(candidate - target);
      const circular = Math.min(diff, 100 - diff);
      return circular >= 12;
    });
    if (farEnough) targets.push(candidate);
  }
  return targets;
}

function makeBankDoorCode() {
  return String(randomInt(10000)).padStart(4, "0");
}

function buyQualityManager() {
  if (state.qualityManagerOwned) return { ok: true, alreadyOwned: true, state: publicState() };
  const wallet = integration?.walletState?.() || { connected: false, balance: 0 };
  if (!wallet.connected) return { ok: false, error: "SD지갑 가상계좌를 먼저 연결하세요." };
  if (Number(wallet.balance || 0) < QUALITY_MANAGER_PRICE) return { ok: false, error: "잔액이 부족합니다." };
  integration.adjustWallet(-QUALITY_MANAGER_PRICE, "SD 플리마켓 · 품질 자동 관리기 구매");
  state.qualityManagerOwned = true;
  state.lastEconomyTickAt = Date.now();
  state.history.unshift({ type: "gear", at: Date.now(), text: "품질 자동 관리기 구매" });
  saveState();
  return { ok: true, state: publicState() };
}

function buyCart() {
  if (state.backpackOwned) return { ok: true, alreadyOwned: true, state: publicState() };
  const wallet = integration?.walletState?.() || { connected: false, balance: 0 };
  if (!wallet.connected) return { ok: false, error: "SD지갑 가상계좌를 먼저 연결하세요." };
  if (Number(wallet.balance || 0) < BACKPACK_PRICE) return { ok: false, error: "잔액이 부족합니다." };
  integration.adjustWallet(-BACKPACK_PRICE, "SD 플리마켓 · 백팩 구매");
  state.backpackOwned = true;
  state.history.unshift({ type: "gear", at: Date.now(), text: "백팩 구매" });
  saveState();
  return { ok: true, state: publicState() };
}

function boxById(id) {
  return state.boxes.find((box) => box.id === id && !box.openedAt);
}

function completeOpen(box, providedItem = null) {
  const item = providedItem || rollItem(box.tier, box.id);
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
    if (!state.stethoscopeOwned) return { ok: false, error: "청진기가 없습니다. 침투 장비 확보 준비작업에서 먼저 확보해 주세요." };
    const existing = openSessions.get(box.id);
    if (!existing || existing.type !== "safe") {
      const pendingItem = rollItem(box.tier, box.id);
      openSessions.set(box.id, {
        type: "safe",
        combination: makeSafeCombination(),
        stage: 0,
        pendingItem,
        previewGlow: previewGlowForSafeItem(pendingItem),
      });
    }
    const session = openSessions.get(box.id);
    return { ok: true, type: "safe", stage: session.stage, totalLocks: session.combination.length, previewGlow: session.previewGlow };
  }
  if (!state.cutterOwned) return { ok: false, error: "커터칼이 없습니다. 상점에서 먼저 구매해 주세요." };
  const pendingItem = rollItem(box.tier, box.id);
  openSessions.set(box.id, {
    type: "box",
    cutStep: 0,
    lastCutAt: 0,
    pendingItem,
    previewGlow: previewGlowForRegularItem(pendingItem),
  });
  const session = openSessions.get(box.id);
  return { ok: true, type: "box", cutStep: 0, previewGlow: session.previewGlow };
}

function completeCut(boxId, step) {
  const box = boxById(boxId);
  const session = openSessions.get(boxId);
  if (!box || !session || session.type !== "box") return { ok: false, error: "개봉 세션이 없습니다." };
  if (Number(step) !== session.cutStep) return { ok: false, error: "절단 순서가 올바르지 않습니다." };
  session.cutStep += 1;
  if (session.cutStep >= 3) {
    const previewGlow = session.previewGlow;
    const item = completeOpen(box, session.pendingItem);
    return { ok: true, opened: true, item, state: publicState(), previewGlow };
  }
  return { ok: true, opened: false, cutStep: session.cutStep, previewGlow: session.previewGlow };
}

function safeListen(boxId, dialNumber) {
  const box = boxById(boxId);
  const session = openSessions.get(boxId);
  if (!box || box.tier !== "safe" || !session || session.type !== "safe") {
    return { ok: false, error: "금고 개봉 세션이 없습니다." };
  }
  const current = safeDialNumber(dialNumber);
  const target = session.combination[session.stage];
  return {
    ok: true,
    hit: current === target,
    stage: session.stage,
    totalLocks: session.combination.length,
  };
}

function safeAttempt(boxId, dialNumber) {
  const box = boxById(boxId);
  const session = openSessions.get(boxId);
  if (!box || box.tier !== "safe" || !session || session.type !== "safe") {
    return { ok: false, error: "금고 개봉 세션이 없습니다." };
  }
  if (!state.stethoscopeOwned) return { ok: false, error: "청진기가 필요합니다." };

  const current = safeDialNumber(dialNumber);
  const target = session.combination[session.stage];
  if (current !== target) {
    return {
      ok: true,
      opened: false,
      correct: false,
      stage: session.stage,
      totalLocks: session.combination.length,
      previewGlow: session.previewGlow,
    };
  }

  session.stage += 1;
  if (session.stage < session.combination.length) {
    return {
      ok: true,
      opened: false,
      correct: true,
      stage: session.stage,
      totalLocks: session.combination.length,
      previewGlow: session.previewGlow,
    };
  }

  const previewGlow = session.previewGlow;
  const item = completeOpen(box, session.pendingItem);
  return {
    ok: true,
    opened: true,
    correct: true,
    stage: session.combination.length,
    totalLocks: session.combination.length,
    item,
    state: publicState(),
    previewGlow,
  };
}

function devReset() {
  return { ok: false, error: "정식 배포판에서는 개발 데이터 초기화를 사용할 수 없습니다." };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    title: "SD 플리마켓",
    icon: path.join(__dirname, "icon.png"),
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

app.whenReady().then(async () => {
  state = loadState();
  integration = new SdIntegration({ userDataPath: app.getPath("userData"), safeStorage });
  await integration.refreshCompany(true);
  writeStateFile();
  await syncInventoryNow(true);
  startInventoryBackgroundSync();
  ipcMain.handle("flea:get-state", async () => {
    await integration.refreshCompany(false);
    if (Date.now() - lastInventorySyncAt >= 12000) void syncInventoryNow(false);
    return publicState();
  });
  ipcMain.handle("flea:refresh-company", async () => {
    try {
      await integration.refreshCompany(true);
      return { ok: true, state: publicState() };
    } catch (error) {
      return {
        ok: false,
        error: String(error?.message || error || "회사 등급 새로고침 실패"),
        state: publicState(),
      };
    }
  });
  ipcMain.handle("flea:refresh-inventory", async () => {
    try {
      await integration.refreshCompany(true);
      const sync = await syncInventoryNow(true);
      const nextState = publicState();
      if (!sync?.ok && !sync?.skipped) {
        return {
          ok: false,
          error: String(sync?.error || nextState.onlineInventorySync?.lastError || "온라인 물품 새로고침 실패"),
          sync,
          state: nextState,
        };
      }
      return { ok: true, sync, state: nextState };
    } catch (error) {
      return {
        ok: false,
        error: String(error?.message || error || "온라인 물품 새로고침 실패"),
        state: publicState(),
      };
    }
  });
  ipcMain.handle("flea:start-mission", async (_event, locationId, bankMode) => {
    if (String(locationId) === "logistics") await integration.refreshCompany(true);
    return startMission(locationId, bankMode);
  });
  ipcMain.handle("flea:search-node", (_event, id) => searchMissionNode(id));
  ipcMain.handle("flea:bank-guard-alert", () => triggerBankGuardAlert());
  ipcMain.handle("flea:shoot-bank-guard", (_event, id, hitZone) => shootBankGuard(id, hitZone));
  ipcMain.handle("flea:bank-guard-hit-player", () => bankGuardHitPlayer());
  ipcMain.handle("flea:unlock-bank-door", (_event, code) => unlockBankDoor(code));
  ipcMain.handle("flea:finish-mission", () => finishMission());
  ipcMain.handle("flea:finish-bank-chase", (_event, success) => finishBankChase(Boolean(success)));
  ipcMain.handle("flea:start-mission-safe", (_event, safeId) => startMissionSafe(safeId));
  ipcMain.handle("flea:mission-safe-listen", (_event, safeId, dialNumber) => missionSafeListen(safeId, dialNumber));
  ipcMain.handle("flea:mission-safe-attempt", (_event, safeId, dialNumber) => missionSafeAttempt(safeId, dialNumber));
  ipcMain.handle("flea:buy-cutter", () => buyCutter());
  ipcMain.handle("flea:buy-stethoscope", () => buyStethoscope());
  ipcMain.handle("flea:buy-quality-manager", () => buyQualityManager());
  ipcMain.handle("flea:buy-cart", () => buyCart());
  ipcMain.handle("flea:start-box-open", (_event, id) => startBoxOpen(id));
  ipcMain.handle("flea:complete-cut", (_event, id, step) => completeCut(id, step));
  ipcMain.handle("flea:safe-listen", (_event, id, dialNumber) => safeListen(id, dialNumber));
  ipcMain.handle("flea:safe-attempt", (_event, id, dialNumber) => safeAttempt(id, dialNumber));
  ipcMain.handle("flea:set-fullscreen", (_event, enabled) => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, fullscreen: false };
    mainWindow.setFullScreen(Boolean(enabled));
    return { ok: true, fullscreen: mainWindow.isFullScreen() };
  });
  ipcMain.handle("flea:dev-reset", () => devReset());
  createWindow();
});

app.on("window-all-closed", () => {
  if (inventorySyncTimer) clearTimeout(inventorySyncTimer);
  if (inventoryBackgroundInterval) clearInterval(inventoryBackgroundInterval);
  if (process.platform !== "darwin") app.quit();
});
