"use strict";

const api = window.flea || createBrowserFallbackApi();

function createBrowserFallbackApi() {
  const STORAGE_KEY = "sd-flea-market-browser-state-v1";
  const CUTTER_PRICE = 100000;
  const STETHOSCOPE_PRICE = 100000;
  const QUALITY_MANAGER_PRICE = 1500000;
  const BACKPACK_PRICE = 300000;
  const BANK_FINALE_COST = 500000;
  const QUALITY_MANAGER_DAILY_POWER = 100000;
  const ITEM_DAILY_DECAY_RATE = 0.02;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MAX_BOXES_PER_MISSION = 3;

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

  const SAFE_JACKPOT_VALUE = Math.max(...ITEMS.safe.map(([, value]) => value));
  const RED_DIAMOND_NAME = "레드 다이아몬드";
  const RED_DIAMOND_CHANCE_DENOMINATOR = 100000;
  const openSessions = new Map();

  function newState() {
    return {
      schemaVersion: 3,
      walletBalance: 0,
      cutterOwned: false,
      stethoscopeOwned: false,
      uvLightOwned: false,
      gunOwned: false,
      qualityManagerOwned: false,
      backpackOwned: false,
      bankPrep: { equipment: false, guardWeakening: false },
      companyGrade: "F",
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
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      const merged = saved ? { ...newState(), ...saved } : newState();
      if (saved?.cartOwned && !merged.backpackOwned) merged.backpackOwned = true;
      merged.gunOwned = Boolean(saved?.gunOwned || saved?.bankPrep?.equipment);
      const legacyPrep = saved?.bankPrep || {};
      merged.bankPrep = {
        equipment: Boolean(legacyPrep.equipment || (legacyPrep.stethoscope && legacyPrep.uvLight)),
        guardWeakening: Boolean(legacyPrep.guardWeakening),
      };
      return merged;
    } catch {
      return newState();
    }
  }

  let localState = loadState();
  saveState();

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(localState));
    } catch {
      // localStorage가 차단된 환경에서도 현재 세션은 계속 동작하도록 둡니다.
    }
  }

  function uid(prefix) {
    const id = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    return `${prefix}-${id.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
  }

  function randomInt(max) {
    return Math.floor(Math.random() * max);
  }

  function farmLocation(locationId) {
    return FARM_LOCATIONS.find((location) => location.id === locationId) || FARM_LOCATIONS[0];
  }

  function gradeRank(grade) {
    const order = ["F", "E", "D", "C", "B", "A", "S", "SS", "SSS"];
    return order.indexOf(String(grade || "").trim().toUpperCase());
  }

  function resolveCompanyGrade() {
    try {
      return String(localState.companyGrade || "F").toUpperCase();
    } catch {
      return String(localState.companyGrade || "F").toUpperCase();
    }
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
      id: uid("BOX"),
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
      id: uid("ITEM"),
      boxId,
      name,
      tier: tierId,
      originalValue,
      currentValue: originalValue,
      conditionPercent: 100,
      acquiredAt: new Date().toISOString(),
      source: "상자 개봉",
      syncStatus: "browser-prototype",
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
    const last = Number(localState.lastEconomyTickAt || now);
    const elapsedDays = Math.floor((now - last) / DAY_MS);
    if (elapsedDays <= 0) return;

    if (localState.qualityManagerOwned) {
      const bill = elapsedDays * QUALITY_MANAGER_DAILY_POWER;
      localState.walletBalance -= bill;
      localState.history.unshift({ type: "power", at: now, text: `품질 자동 관리기 전기세 ${bill.toLocaleString("ko-KR")}원` });
    } else if (localState.items.length) {
      const valueFactor = Math.pow(1 - ITEM_DAILY_DECAY_RATE, elapsedDays);
      for (const item of localState.items) {
        if (isLimitedItem(item)) continue;
        const baseCurrent = Number(item.currentValue ?? item.originalValue ?? 0);
        item.currentValue = Math.max(1, Math.round(baseCurrent * valueFactor));
        item.conditionPercent = Math.max(1, Number(item.conditionPercent || 100) - elapsedDays);
      }
      localState.history.unshift({ type: "quality", at: now, text: `${elapsedDays}일 경과 · 보관 물품 가치 하락 반영` });
    }

    localState.lastEconomyTickAt = last + elapsedDays * DAY_MS;
    saveState();
  }

  function publicState() {
    applyEconomyTicks();
    return {
      devMode: false,
      balance: localState.walletBalance,
      cutterOwned: localState.cutterOwned,
      stethoscopeOwned: Boolean(localState.stethoscopeOwned),
      uvLightOwned: Boolean(localState.uvLightOwned),
      gunOwned: Boolean(localState.gunOwned),
      qualityManagerOwned: localState.qualityManagerOwned,
      backpackOwned: Boolean(localState.backpackOwned),
      bankPrep: { ...localState.bankPrep },
      companyGrade: resolveCompanyGrade(),
      qualityManagerDailyPower: QUALITY_MANAGER_DAILY_POWER,
      itemDailyDecayRate: ITEM_DAILY_DECAY_RATE,
      selectedLocationId: localState.selectedLocationId || "alley",
      boxes: localState.boxes,
      items: localState.items,
      mission: localState.activeMission,
      prices: { cutter: CUTTER_PRICE, stethoscope: STETHOSCOPE_PRICE, qualityManager: QUALITY_MANAGER_PRICE, backpack: BACKPACK_PRICE, bankFinale: BANK_FINALE_COST },
      boxTiers: BOX_TIERS,
      farmLocations: FARM_LOCATIONS,
    };
  }

  function boxById(id) {
    return localState.boxes.find((box) => box.id === id && !box.openedAt);
  }

  function completeOpen(box, providedItem = null) {
    const item = providedItem || rollItem(box.tier, box.id);
    box.openedAt = new Date().toISOString();
    localState.boxes = localState.boxes.filter((entry) => entry.id !== box.id);
    localState.items.unshift(item);
    localState.history.unshift({ type: "item", at: Date.now(), text: `${item.name} 획득` });
    openSessions.delete(box.id);
    saveState();
    return item;
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


  function nextBankPrepStep() {
    const progress = localState.bankPrep || {};
    return BANK_PREP_ORDER.find((step) => !progress[step.id]) || null;
  }

  function rewardCard(name, accent = "#9aa6b2", kind = "reward") {
    return { id: uid("REWARD"), tier: kind, tierName: name, accent };
  }

  function buildRegularMission(location) {
    const positions = [...MISSION_NODE_POSITIONS].sort(() => Math.random() - 0.5).slice(0, Number(location.nodeCount || 10));
    const specialIndex = positions.length && randomInt(100) < 20 ? randomInt(positions.length) : -1;
    const regularNodes = positions.map(([,], index) => {
      const object = randomSearchObject(location.id);
      return {
        id: `NODE-${index + 1}`,
        searched: false,
        objectType: object.type,
        objectLabel: object.label,
        objectIcon: object.icon,
        special: index === specialIndex,
      };
    });
    const storeGateNodes = location.id === "abandoned_store"
      ? [
          { id: "STORE-BRICK", searched: false, kind: "store-brick", objectType: "brick", objectLabel: "입구 옆 벽돌", objectIcon: "🧱" },
          { id: "STORE-DOOR", searched: false, kind: "store-door", objectType: "glassdoor", objectLabel: "상가 유리문", objectIcon: "▦" },
        ]
      : [];
    return {
      id: uid("MISSION"),
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
      maxBoxes: Number(location.maxBoxes || MAX_BOXES_PER_MISSION) + (localState.backpackOwned ? 3 : 0),
      nodes: [...storeGateNodes, ...regularNodes],
      safe: location.id === "abandoned_store" && randomInt(100) < 5 ? {
        id: uid("SAFE"),
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
      id: uid("MISSION"),
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
    const weak = Boolean(localState.bankPrep?.guardWeakening);
    return {
      id: uid("MISSION"),
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
    return Boolean(mission && (mission.missionType === "bank-finale" || (mission.missionType === "bank-prep" && mission.prepId === "guardWeakening")));
  }

  function removeBankLoot(mission) {
    const ids = new Set(Array.isArray(mission?.bankLootItemIds) ? mission.bankLootItemIds : []);
    if (!ids.size) return 0;
    let lost = 0;
    localState.items = localState.items.filter((item) => {
      if (!ids.has(item.id)) return true;
      lost += Number(item.originalValue || item.currentValue || 0);
      return false;
    });
    return lost;
  }

  function failBankFinale(reason = "경비원에게 제압되었습니다.") {
    const mission = localState.activeMission;
    if (!mission || mission.missionType !== "bank-finale") return 0;
    const lostValue = removeBankLoot(mission);
    localState.history.unshift({ type: "bank-failed", at: Date.now(), text: `${reason} · 습격 획득품 손실 ${lostValue.toLocaleString("ko-KR")}원` });
    localState.bankPrep = { equipment: false, guardWeakening: false };
    localState.activeMission = null;
    saveState();
    return lostValue;
  }

  function missionSafeNode(mission, safeId) {
    return mission?.nodes?.find((node) => node.id === safeId && node.kind === "safe-node") || null;
  }

  return {
    async getState() {
      return publicState();
    },

    async setFullscreen(enabled) {
      try {
        if (enabled && !document.fullscreenElement) await document.documentElement.requestFullscreen?.();
        if (!enabled && document.fullscreenElement) await document.exitFullscreen?.();
        return { ok: true, fullscreen: Boolean(document.fullscreenElement) };
      } catch {
        return { ok: false, fullscreen: Boolean(document.fullscreenElement) };
      }
    },

    async startMission(locationId = "alley", bankMode = "") {
      if (localState.activeMission) {
        return { ok: false, error: "이미 진행 중인 임무가 있습니다.", state: publicState() };
      }
      const location = farmLocation(locationId);
      if (!locationUnlocked(location)) {
        return { ok: false, error: `물류센터는 회사 등급 ${location.requiredCompanyGrade} 이상부터 이용할 수 있습니다.`, state: publicState() };
      }
      localState.selectedLocationId = location.id;

      if (location.id === "bank") {
        const prep = localState.bankPrep || {};
        const mode = String(bankMode || (prep.equipment ? "finale" : "equipment"));
        if (mode === "equipment") {
          if (prep.equipment) return { ok: false, error: "필수 침투 장비 준비작업은 이미 완료했습니다.", state: publicState() };
          localState.activeMission = buildBankPrepMission(BANK_PREP_ORDER[0]);
          saveState();
          return { ok: true, mission: localState.activeMission, state: publicState() };
        }
        if (mode === "guardWeakening") {
          if (!prep.equipment) return { ok: false, error: "필수 침투 장비 준비작업을 먼저 완료해야 합니다.", state: publicState() };
          if (prep.guardWeakening) return { ok: false, error: "경비원 무장 약화 준비작업은 이미 완료했습니다.", state: publicState() };
          localState.activeMission = buildBankPrepMission(BANK_PREP_ORDER[1]);
          saveState();
          return { ok: true, mission: localState.activeMission, state: publicState() };
        }
        if (!prep.equipment) return { ok: false, error: "피날래 전에 침투 장비 확보 준비작업이 필수입니다.", state: publicState() };
        if (!localState.gunOwned) return { ok: false, error: "권총이 준비되지 않았습니다. 침투 장비 확보 준비작업에서 권총까지 확보해 주세요.", state: publicState() };
        if (localState.walletBalance < BANK_FINALE_COST) {
          return { ok: false, error: `은행 피날래 시작 비용 ${BANK_FINALE_COST.toLocaleString("ko-KR")}원이 부족합니다.`, state: publicState() };
        }
        localState.walletBalance -= BANK_FINALE_COST;
        localState.history.unshift({ type: "bank", at: Date.now(), text: `은행 피날래 진입 비용 ${BANK_FINALE_COST.toLocaleString("ko-KR")}원 지출` });
        localState.activeMission = buildBankFinaleMission();
        saveState();
        return { ok: true, mission: localState.activeMission, state: publicState() };
      }

      localState.activeMission = buildRegularMission(location);
      saveState();
      return { ok: true, mission: localState.activeMission, state: publicState() };
    },

    async unlockBankDoor(code) {
      const mission = localState.activeMission;
      if (!mission || mission.missionType !== "bank-finale") return { ok: false, error: "은행 피날래가 진행 중이 아닙니다.", state: publicState() };
      if (!localState.uvLightOwned) return { ok: false, error: "UV 라이트가 준비되지 않았습니다.", state: publicState() };
      if (mission.bankDoorUnlocked) return { ok: true, alreadyUnlocked: true, state: publicState() };
      if (String(code || "").padStart(4, "0") !== String(mission.bankCode || "")) return { ok: false, wrongCode: true, error: "비밀번호가 맞지 않습니다.", state: publicState() };
      mission.bankDoorUnlocked = true;
      const door = mission.nodes.find((node) => node.kind === "door");
      if (door) door.searched = true;
      localState.history.unshift({ type: "bank-door", at: Date.now(), text: "UV 라이트로 은행 출입문 비밀번호 확인 및 잠금 해제" });
      saveState();
      return { ok: true, unlocked: true, rewardCard: rewardCard("은행 문 개방", "#b68cff", "door"), state: publicState() };
    },

    async triggerBankGuardAlert() {
      const mission = localState.activeMission;
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
        localState.history.unshift({ type: "bank-alarm", at: Date.now(), text: "경비원 시야에 발각 · 증원 경비원 3명 출동" });
        saveState();
        return { ok: true, spawned: 3, state: publicState() };
      }
      localState.history.unshift({ type: "bank-prep-alarm", at: Date.now(), text: "경비 약화 준비작업 중 경비원에게 발각" });
      saveState();
      return { ok: true, spawned: 0, prep: true, state: publicState() };
    },

    async shootBankGuard(nodeId, hitZone = "body") {
      const mission = localState.activeMission;
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
    },

    async bankGuardHitPlayer() {
      const mission = localState.activeMission;
      if (!isGuardCombatMission(mission)) return { ok: false, ignored: true, state: publicState() };
      mission.playerHealth = Math.max(0, Number(mission.playerHealth ?? 100) - BANK_GUARD_ATTACK_DAMAGE);
      if (mission.playerHealth <= 0) {
        if (mission.missionType === "bank-finale") {
          const lostValue = failBankFinale("경비원 총격으로 제압됨");
          return { ok: true, failed: true, damage: BANK_GUARD_ATTACK_DAMAGE, playerHealth: 0, lostValue, state: publicState() };
        }
        localState.history.unshift({ type: "bank-prep-failed", at: Date.now(), text: "경비 약화 준비작업 중 경비원 총격으로 제압됨" });
        localState.activeMission = null;
        saveState();
        return { ok: true, failed: true, prepFailed: true, damage: BANK_GUARD_ATTACK_DAMAGE, playerHealth: 0, lostValue: 0, state: publicState() };
      }
      saveState();
      return { ok: true, damage: BANK_GUARD_ATTACK_DAMAGE, playerHealth: mission.playerHealth, state: publicState() };
    },

    async searchMissionNode(nodeId) {
      const mission = localState.activeMission;
      if (!mission) {
        return { ok: false, error: "진행 중인 임무가 없습니다.", state: publicState() };
      }
      if (mission.exhausted) {
        return { ok: false, error: "파밍이 끝났습니다. EXIT로 돌아가세요.", state: publicState() };
      }
      const node = mission.nodes.find((entry) => entry.id === nodeId);
      if (!node) return { ok: false, error: "수색 대상을 찾지 못했습니다." };
      if (node.searched && node.kind !== "safe-node") return { ok: false, error: "이미 수색한 대상입니다." };

      if (mission.missionType === "regular" && mission.locationId === "abandoned_store") {
        if (node.kind === "store-brick") {
          node.searched = true;
          mission.storeBrickOwned = true;
          localState.history.unshift({ type: "store-brick", at: Date.now(), text: "상가 입구 벽돌 확보" });
          saveState();
          return { ok: true, found: true, storeAction: "brick", searchedObject: node.objectLabel, mission: localState.activeMission, exhausted: false, state: publicState() };
        }
        if (node.kind === "store-door") {
          if (mission.storeDoorBroken) return { ok: false, error: "이미 유리문이 깨져 있습니다.", state: publicState() };
          if (!mission.storeBrickOwned) return { ok: false, error: "입구 근처의 벽돌을 먼저 주워야 합니다.", state: publicState() };
          node.searched = true;
          mission.storeBrickOwned = false;
          mission.storeDoorBroken = true;
          localState.history.unshift({ type: "store-door", at: Date.now(), text: "벽돌로 상가 유리문 파손" });
          saveState();
          return { ok: true, found: true, storeAction: "glass-break", searchedObject: node.objectLabel, mission: localState.activeMission, exhausted: false, state: publicState() };
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
          const detail = mission.prepId === "equipment"
            ? `${mission.prepFoundIds.length} / 3 확보`
            : "경비 장비 약화 설정 완료";
          return {
            ok: true,
            found: true,
            prepFound: true,
            prepPartial: !mission.prepComplete,
            rewardCard: rewardCard(`${node.objectLabel} 확보`, mission.prepColor, "gear"),
            searchedObject: node.objectLabel,
            prepDetail: detail,
            mission: localState.activeMission,
            exhausted: mission.exhausted,
            state: publicState(),
          };
        }
        saveState();
        return { ok: true, found: false, searchedObject: node.objectLabel, mission: localState.activeMission, exhausted: false, state: publicState() };
      }

      if (mission.missionType === "bank-finale") {
        if (node.kind === "door") {
          if (mission.bankDoorUnlocked) return { ok: false, error: "이미 은행 문 잠금을 해제했습니다." };
          if (!localState.uvLightOwned) return { ok: false, error: "UV 라이트가 준비되지 않았습니다." };
          return { ok: true, found: false, bankAction: "uv-required", searchedObject: node.objectLabel, mission: localState.activeMission, exhausted: false, state: publicState() };
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
          localState.history.unshift({ type: "bank-safe-carry", at: Date.now(), text: `${node.objectLabel} 통째로 회수 · 현재 ${mission.safeCarried}개 운반 중` });
          saveState();
          return { ok: true, found: true, bankAction: "safe-carried", safeId: node.id, safeCount: Number(mission.safeCarried || 0), searchedObject: node.objectLabel, mission: localState.activeMission, exhausted: Boolean(mission.exhausted), state: publicState() };
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
        localState.boxes.push(box);
        localState.history.unshift({ type: "box", at: Date.now(), text: `${tier.name} 획득` });
      } else {
        mission.missStreak = Number(mission.missStreak || 0) + 1;
      }

      const allSearched = mission.nodes.every((entry) => entry.searched);
      if (mission.foundCount >= mission.maxBoxes) {
        mission.exhausted = true;
        mission.nodes.forEach((entry) => { if (!entry.searched) entry.searched = true; });
      } else if (allSearched) {
        mission.exhausted = true;
      }
      saveState();
      return { ok: true, found: Boolean(box), box, searchedObject: node.objectLabel, special: Boolean(node.special), mission: localState.activeMission, exhausted: Boolean(mission.exhausted), state: publicState() };
    },

    async finishMission() {
      const mission = localState.activeMission;
      if (mission?.missionType === "bank-finale" && Number(mission.safeCarried || 0) < 1) {
        return { ok: false, error: "은행 금고를 최소 1개는 들고 나와야 탈출할 수 있습니다.", state: publicState() };
      }
      if (mission?.missionType === "bank-finale") {
        mission.chasePending = true;
        saveState();
        return {
          ok: true,
          bankChase: true,
          chase: {
            safeCount: Number(mission.safeCarried || 0),
            lootValue: 0,
            lootCount: 0,
          },
          state: publicState(),
        };
      }
      if (mission?.missionType === "bank-prep" && mission.prepComplete && mission.prepId) {
        localState.bankPrep[mission.prepId] = true;
        if (mission.prepId === "equipment") {
          localState.stethoscopeOwned = true;
          localState.uvLightOwned = true;
          localState.gunOwned = true;
        }
        localState.history.unshift({ type: "bank-prep", at: Date.now(), text: `${mission.prepName} 준비 완료` });
      }
      localState.activeMission = null;
      saveState();
      return { ok: true, state: publicState() };
    },

    async finishBankChase(success) {
      const mission = localState.activeMission;
      if (!mission || mission.missionType !== "bank-finale" || !mission.chasePending) {
        return { ok: false, error: "진행 중인 은행 오토바이 추격전이 없습니다.", state: publicState() };
      }
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
            localState.history.unshift({ type: "mission-safe", at: Date.now(), text: `${safe.objectLabel || "은행 금고"} 개봉 · 꽝` });
            continue;
          }
          item.source = `은행 탈출 금고 ${safe.id}`;
          localState.items.unshift(item);
          rewards.push(item);
          securedValue += Number(item.originalValue || item.currentValue || 0);
          localState.history.unshift({ type: "mission-safe", at: Date.now(), text: `${safe.objectLabel || "은행 금고"} 개봉 · ${item.name} 획득` });
        }
        mission.safeOpened = safeCount;
        mission.bankLootItemIds = rewards.map((item) => item.id);
        mission.bankLootValue = securedValue;
      }
      localState.history.unshift({
        type: "bank-chase",
        at: Date.now(),
        text: success
          ? `은행 도주 성공 · 금고 ${safeCount}개 확보 · 물품 ${rewards.length}개 · 가치 ${securedValue.toLocaleString("ko-KR")}원`
          : `은행 도주 실패 · 오토바이 내구도 소진 · 운반 중 금고 ${safeCount}개 전부 분실`,
      });
      localState.bankPrep = { equipment: false, guardWeakening: false };
      localState.activeMission = null;
      saveState();
      return { ok: true, success: Boolean(success), safeCount, securedValue: success ? securedValue : 0, lostValue: 0, lostSafes: success ? 0 : safeCount, emptyCount: success ? emptyCount : 0, rewards: success ? rewards : [], state: publicState() };
    },


    async startMissionSafe(safeId) {
      const mission = localState.activeMission;
      if (!mission) return { ok: false, error: "진행 중인 임무가 없습니다.", state: publicState() };

      if (mission.missionType === "bank-finale") {
        const safeNode = missionSafeNode(mission, safeId);
        if (!safeNode || safeNode.opened) return { ok: false, error: "현장의 금고를 찾지 못했습니다.", state: publicState() };
        if (!localState.stethoscopeOwned) return { ok: false, error: "청진기가 준비되지 않았습니다.", state: publicState() };
        const key = `MISSION-SAFE:${safeId}`;
        if (!openSessions.has(key)) {
          const pendingItem = safeNode.empty ? rollRedDiamond(safeId) : rollItem("safe", safeId);
          if (pendingItem) pendingItem.source = `은행 현장 금고 ${safeId}`;
          openSessions.set(key, { type: "mission-safe-bank", combination: makeSafeCombination(), stage: 0, pendingItem, previewGlow: pendingItem ? previewGlowForSafeItem(pendingItem) : "safe" });
        }
        saveState();
        const session = openSessions.get(key);
        return { ok: true, type: "mission-safe", stage: session.stage, totalLocks: session.combination.length, previewGlow: session.previewGlow, state: publicState() };
      }

      const safe = mission?.safe;
      if (!safe || safe.id !== safeId || safe.opened) return { ok: false, error: "현장의 금고를 찾지 못했습니다.", state: publicState() };
      if (!localState.stethoscopeOwned) return { ok: false, error: "청진기가 필요합니다. 은행 준비작업으로 먼저 확보해 주세요.", state: publicState() };
      const key = `MISSION-SAFE:${safeId}`;
      if (!openSessions.has(key)) {
        const pendingItem = rollItem("safe", safeId);
        pendingItem.source = `${mission.locationName || "파밍지"} 현장 금고`;
        openSessions.set(key, { type: "mission-safe", combination: makeSafeCombination(), stage: 0, pendingItem, previewGlow: previewGlowForSafeItem(pendingItem) });
      }
      safe.discovered = true;
      saveState();
      const session = openSessions.get(key);
      return { ok: true, type: "mission-safe", stage: session.stage, totalLocks: session.combination.length, previewGlow: session.previewGlow, state: publicState() };
    },

    async missionSafeListen(safeId, dialNumber) {
      const mission = localState.activeMission;
      const session = openSessions.get(`MISSION-SAFE:${safeId}`);
      const safeNode = missionSafeNode(mission, safeId);
      if (safeNode) {
        if (safeNode.opened || !session || !String(session.type || "").startsWith("mission-safe")) return { ok: false, error: "현장 금고 개방 세션이 없습니다." };
        const current = safeDialNumber(dialNumber);
        const target = session.combination[session.stage];
        return { ok: true, hit: current === target, stage: session.stage, totalLocks: session.combination.length };
      }
      const safe = mission?.safe;
      if (!safe || safe.id !== safeId || safe.opened || !session || session.type !== "mission-safe") return { ok: false, error: "현장 금고 개방 세션이 없습니다." };
      const current = safeDialNumber(dialNumber);
      const target = session.combination[session.stage];
      return { ok: true, hit: current === target, stage: session.stage, totalLocks: session.combination.length };
    },

    async missionSafeAttempt(safeId, dialNumber) {
      const mission = localState.activeMission;
      const key = `MISSION-SAFE:${safeId}`;
      const session = openSessions.get(key);
      const safeNode = missionSafeNode(mission, safeId);
      if (safeNode) {
        if (!safeNode || safeNode.opened || !session || !String(session.type || "").startsWith("mission-safe")) return { ok: false, error: "현장 금고 개방 세션이 없습니다." };
        if (!localState.stethoscopeOwned) return { ok: false, error: "청진기가 필요합니다." };
        const current = safeDialNumber(dialNumber);
        const target = session.combination[session.stage];
        if (current !== target) return { ok: true, opened: false, correct: false, stage: session.stage, totalLocks: session.combination.length, previewGlow: session.previewGlow };
        session.stage += 1;
        if (session.stage < session.combination.length) return { ok: true, opened: false, correct: true, stage: session.stage, totalLocks: session.combination.length, previewGlow: session.previewGlow };
        const item = session.pendingItem;
        safeNode.opened = true;
        safeNode.searched = true;
        mission.safeOpened = Number(mission.safeOpened || 0) + 1;
        if (item) {
          localState.items.unshift(item);
          mission.bankLootItemIds = Array.isArray(mission.bankLootItemIds) ? mission.bankLootItemIds : [];
          if (!mission.bankLootItemIds.includes(item.id)) mission.bankLootItemIds.push(item.id);
          mission.bankLootValue = Number(mission.bankLootValue || 0) + Number(item.originalValue || 0);
          localState.history.unshift({ type: "mission-safe", at: Date.now(), text: `은행 금고에서 ${item.name} 획득` });
        } else {
          localState.history.unshift({ type: "mission-safe", at: Date.now(), text: `${safeNode.objectLabel} · 꽝` });
        }
        if ((mission.nodes.filter((node) => node.kind === "safe-node" && node.opened).length) >= mission.nodes.filter((node) => node.kind === "safe-node").length) {
          mission.exhausted = true;
        }
        openSessions.delete(key);
        saveState();
        return { ok: true, opened: true, correct: true, stage: session.combination.length, totalLocks: session.combination.length, item, empty: !item, safeLabel: safeNode.objectLabel, state: publicState(), previewGlow: session.previewGlow };
      }

      const safe = mission?.safe;
      if (!safe || safe.id !== safeId || safe.opened || !session || session.type !== "mission-safe") return { ok: false, error: "현장 금고 개방 세션이 없습니다." };
      if (!localState.stethoscopeOwned) return { ok: false, error: "청진기가 필요합니다." };
      const current = safeDialNumber(dialNumber);
      const target = session.combination[session.stage];
      if (current !== target) return { ok: true, opened: false, correct: false, stage: session.stage, totalLocks: session.combination.length, previewGlow: session.previewGlow };
      session.stage += 1;
      if (session.stage < session.combination.length) return { ok: true, opened: false, correct: true, stage: session.stage, totalLocks: session.combination.length, previewGlow: session.previewGlow };
      const item = session.pendingItem;
      safe.opened = true;
      safe.openedAt = new Date().toISOString();
      localState.items.unshift(item);
      localState.history.unshift({ type: "mission-safe", at: Date.now(), text: `${mission.locationName || "파밍지"} 현장 금고에서 ${item.name} 획득` });
      openSessions.delete(key);
      saveState();
      return { ok: true, opened: true, correct: true, stage: session.combination.length, totalLocks: session.combination.length, item, state: publicState(), previewGlow: session.previewGlow };
    },

    async buyCutter() {
      if (localState.cutterOwned) return { ok: true, alreadyOwned: true, state: publicState() };
      if (localState.walletBalance < CUTTER_PRICE) return { ok: false, error: "잔액이 부족합니다." };
      localState.walletBalance -= CUTTER_PRICE;
      localState.cutterOwned = true;
      saveState();
      return { ok: true, state: publicState() };
    },

    async buyStethoscope() {
      return { ok: false, error: "청진기는 상점에서 판매하지 않습니다. 침투 장비 확보 준비작업에서 확보해야 합니다.", state: publicState() };
    },

    async buyQualityManager() {
      if (localState.qualityManagerOwned) return { ok: true, alreadyOwned: true, state: publicState() };
      if (localState.walletBalance < QUALITY_MANAGER_PRICE) return { ok: false, error: "잔액이 부족합니다." };
      localState.walletBalance -= QUALITY_MANAGER_PRICE;
      localState.qualityManagerOwned = true;
      localState.lastEconomyTickAt = Date.now();
      localState.history.unshift({ type: "gear", at: Date.now(), text: "품질 자동 관리기 구매" });
      saveState();
      return { ok: true, state: publicState() };
    },

    async buyCart() {
      if (localState.backpackOwned) return { ok: true, alreadyOwned: true, state: publicState() };
      if (localState.walletBalance < BACKPACK_PRICE) return { ok: false, error: "잔액이 부족합니다." };
      localState.walletBalance -= BACKPACK_PRICE;
      localState.backpackOwned = true;
      localState.history.unshift({ type: "gear", at: Date.now(), text: "백팩 구매" });
      saveState();
      return { ok: true, state: publicState() };
    },

    async startBoxOpen(boxId) {
      const box = boxById(boxId);
      if (!box) return { ok: false, error: "상자를 찾지 못했습니다." };
      if (box.tier === "safe") {
        if (!localState.stethoscopeOwned) return { ok: false, error: "청진기가 없습니다. 침투 장비 준비작업에서 먼저 확보해 주세요." };
        if (!openSessions.has(box.id) || openSessions.get(box.id)?.type !== "safe") {
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
        return {
          ok: true,
          type: "safe",
          stage: session.stage,
          totalLocks: session.combination.length,
          previewGlow: session.previewGlow,
        };
      }
      if (!localState.cutterOwned) return { ok: false, error: "커터칼이 없습니다. 상점에서 먼저 구매해 주세요." };
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
    },

    async completeCut(boxId, step) {
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
    },

    async safeListen(boxId, dialNumber) {
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
    },

    async safeAttempt(boxId, dialNumber) {
      const box = boxById(boxId);
      const session = openSessions.get(boxId);
      if (!box || box.tier !== "safe" || !session || session.type !== "safe") {
        return { ok: false, error: "금고 개봉 세션이 없습니다." };
      }
      if (!localState.stethoscopeOwned) return { ok: false, error: "청진기가 필요합니다." };

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
    },

    async devReset() {
      localState = newState();
      openSessions.clear();
      saveState();
      return { ok: true, state: publicState() };
    },
  };
}

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const money = (value) => `₩${Number(value || 0).toLocaleString("ko-KR")}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const makeMissionRecord = (name, accent = "#9aa6b2", kind = "reward") => ({
  id: `MISSION-RECORD-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  tier: kind,
  tierName: name,
  accent,
});

let audioContext = null;

function getAudioContext() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  if (!audioContext) audioContext = new AudioCtor();
  if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
  return audioContext;
}

function playTone(frequency, duration = 0.18, type = "sine", volume = 0.08, delay = 0) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.04);
}

function playNoiseBurst(duration = 0.22, volume = 0.055, delay = 0) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    const fade = 1 - i / length;
    channel[i] = (Math.random() * 2 - 1) * fade;
  }
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  filter.type = "bandpass";
  filter.frequency.value = 850;
  filter.Q.value = 0.7;
  gain.gain.value = volume;
  source.buffer = buffer;
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(ctx.currentTime + delay);
}

function playGuardGunshotSound() {
  const ctx = getAudioContext();
  if (!ctx) return;

  // 짧고 강한 총구 폭발음 + 고역 크랙 + 실내 잔향을 겹친다.
  playTone(118, .065, "square", .095, 0);
  playTone(235, .042, "sawtooth", .07, .004);
  playNoiseBurst(.085, .13, 0);
  playNoiseBurst(.11, .055, .045);

  const length = Math.max(1, Math.floor(ctx.sampleRate * .095));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    const t = i / length;
    const envelope = Math.pow(1 - t, 3.1);
    channel[i] = (Math.random() * 2 - 1) * envelope;
  }
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  filter.type = "highpass";
  filter.frequency.value = 1700;
  filter.Q.value = .35;
  gain.gain.setValueAtTime(.105, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .095);
  source.buffer = buffer;
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start();
}

function playGlassShatterSound() {
  const ctx = getAudioContext();
  if (!ctx) return;

  // 벽돌이 유리를 때리는 첫 충격음.
  playTone(118, 0.10, "square", 0.085, 0);
  playTone(72, 0.16, "triangle", 0.065, 0.018);

  // 큰 유리판이 한 번에 갈라지는 "와장" 소리.
  const makeShatterNoise = (duration, volume, frequency, delay, q = 0.55) => {
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      const t = i / length;
      const envelope = Math.pow(1 - t, 1.65);
      const crackle = Math.random() < 0.07 ? 2.3 : 1;
      data[i] = (Math.random() * 2 - 1) * envelope * crackle;
    }
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    filter.type = "highpass";
    filter.frequency.value = frequency;
    filter.Q.value = q;
    gain.gain.setValueAtTime(Math.max(0.0001, volume), ctx.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + duration);
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(ctx.currentTime + delay);
  };

  makeShatterNoise(0.34, 0.11, 1200, 0.035, 0.45);
  makeShatterNoise(0.27, 0.075, 2600, 0.075, 0.65);
  makeShatterNoise(0.20, 0.050, 4300, 0.12, 0.8);

  // 깨진 조각이 바닥으로 쏟아지는 "창창창" 잔향.
  const shardFreqs = [2100, 2860, 3540, 4380, 5120, 3280, 4700, 2480, 3900, 5480];
  shardFreqs.forEach((frequency, index) => {
    const delay = 0.09 + index * 0.032 + Math.random() * 0.026;
    const duration = 0.055 + Math.random() * 0.065;
    playTone(frequency + (Math.random() - 0.5) * 260, duration, index % 2 ? "triangle" : "sine", 0.022 + Math.random() * 0.018, delay);
  });

  // 큰 파편 두세 개가 뒤늦게 떨어지는 묵직한 소리.
  playTone(520, 0.10, "triangle", 0.035, 0.25);
  playTone(390, 0.12, "triangle", 0.030, 0.34);
}

function playBoxOpeningSound() {
  playNoiseBurst(0.28, 0.075, 0);
  playNoiseBurst(0.18, 0.045, 0.12);
  playTone(118, 0.24, "triangle", 0.075, 0.04);
  playTone(82, 0.18, "sine", 0.055, 0.16);
}

function playSafeOpeningSound() {
  playTone(145, 0.16, "square", 0.045, 0);
  playTone(92, 0.34, "triangle", 0.07, 0.08);
  playNoiseBurst(0.14, 0.03, 0.12);
}

function playSafeDialRattle() {
  // 넓은 대역 노이즈 대신 짧은 금속성 톱니 맞물림을 겹쳐서 기어 회전음을 만듭니다.
  // A/D를 길게 누르면 이 펄스가 연속 재생되어 "철컥철컥" 굴러가는 기계음을 냅니다.
  const jitter = (Math.random() - 0.5) * 18;
  playTone(126 + jitter, 0.060, "sawtooth", 0.020, 0);
  playTone(252 + jitter * 1.4, 0.038, "triangle", 0.018, 0.006);
  playTone(610 + jitter * 3.2, 0.024, "square", 0.010, 0.010);
  playTone(1120 + jitter * 4.0, 0.016, "sine", 0.006, 0.016);
}

function playSafeContactSound() {
  playTone(680, 0.045, "square", 0.085, 0);
  playTone(320, 0.075, "triangle", 0.06, 0.012);
}

function playSafeLatchSound() {
  playTone(190, 0.07, "square", 0.07, 0);
  playTone(118, 0.14, "triangle", 0.075, 0.05);
  playNoiseBurst(0.08, 0.025, 0.02);
}

function playSafeRejectSound() {
  playTone(88, 0.13, "triangle", 0.055, 0);
  playNoiseBurst(0.055, 0.018, 0);
}

function playGlowSound(kind) {
  const presets = {
    low: [[420, .20, "sine", .045, 0], [560, .26, "sine", .035, .07]],
    normal: [[520, .18, "sine", .055, 0], [760, .24, "triangle", .06, .07], [980, .28, "sine", .04, .14]],
    high: [[520, .18, "triangle", .055, 0], [820, .26, "sine", .07, .06], [1240, .34, "sine", .065, .13], [1640, .28, "sine", .035, .22]],
    safe: [[392, .23, "triangle", .055, 0], [659, .30, "sine", .065, .08], [988, .40, "sine", .06, .16]],
    ruby: [[330, .18, "sawtooth", .045, 0], [660, .26, "triangle", .07, .06], [990, .34, "sine", .075, .12], [1480, .46, "sine", .075, .18]],
  };
  for (const [frequency, duration, type, volume, delay] of (presets[kind] || presets.normal)) {
    playTone(frequency, duration, type, volume, delay);
  }
}

function playMissionWarningSound(urgent = false) {
  if (urgent) {
    playTone(760, 0.08, "square", 0.045, 0);
    playTone(520, 0.10, "square", 0.04, 0.11);
  } else {
    playTone(620, 0.09, "triangle", 0.035, 0);
  }
}

function playItemPickupSound(value = 0, kind = "item") {
  // 실제 획득이 확정되는 순간에만 재생하는 짧은 픽업 효과음.
  // 값이 큰 아이템은 마지막 고음을 한 단계 더 올려 희귀 보상 느낌을 줍니다.
  getAudioContext();
  const amount = Math.max(0, Number(value || 0));
  const highValue = amount >= 1000000;
  const gear = kind === "gear";
  const box = kind === "box";

  playTone(box ? 240 : 300, 0.045, "triangle", 0.038, 0);
  playTone(gear ? 620 : 660, 0.085, "sine", 0.055, 0.018);
  playTone(gear ? 830 : 880, 0.105, "triangle", 0.060, 0.075);
  playTone(highValue ? 1540 : 1180, 0.16, "sine", highValue ? 0.070 : 0.052, 0.145);
  if (highValue) playTone(1980, 0.20, "sine", 0.042, 0.235);
}

function playFilteredNoise(duration = 1, volume = 0.02, frequency = 500, type = "bandpass") {
  const ctx = getAudioContext();
  if (!ctx) return;
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * 0.65;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = 0.7;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(Math.max(.0002, volume), ctx.currentTime + .08);
  gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + duration);
  source.buffer = buffer;
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start();
}

function playFootstepEntrySound() {
  for (let i = 0; i < 5; i += 1) {
    const delay = i * .23;
    playTone(76 + (i % 2) * 12, .09, "triangle", .055, delay);
    playTone(145, .045, "square", .018, delay + .018);
  }
}

function play3DFootstep(sprinting = false) {
  const locationId = state?.mission?.locationId || selectedFarmLocationId || "alley";
  const base = locationId === "logistics" ? 68 : locationId === "abandoned_store" ? 82 : locationId === "bank" ? 64 : locationId === "bank_prep" ? 70 : 74;
  const volume = sprinting ? 0.042 : 0.032;
  playTone(base, sprinting ? 0.085 : 0.105, "triangle", volume, 0);
  playTone(base * 2.08, 0.032, "square", volume * 0.34, 0.012);
  if (locationId === "alley") playNoiseBurst(0.028, 0.008, 0.006);
}

function playCrowdEntrySound() {
  playFilteredNoise(1.35, .028, 620, "bandpass");
  const voices = [210, 245, 310, 370, 430, 285];
  voices.forEach((freq, index) => playTone(freq, .28 + (index % 2) * .12, "sine", .010, index * .16));
}

function playLogisticsDoorEntrySound() {
  playFilteredNoise(1.45, .035, 190, "lowpass");
  for (let i = 0; i < 8; i += 1) {
    playTone(92 + (i % 3) * 14, .10, "sawtooth", .032, i * .13);
    playTone(410 + (i % 2) * 90, .045, "square", .012, i * .13 + .03);
  }
  playTone(58, .42, "triangle", .06, .86);
}

function updatePhoneClock() {
  const now = new Date();
  const el = $("#phoneClock");
  if (el) el.textContent = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function missionTravelPresentation(location, bankMode = "") {
  if (location?.id !== "bank") {
    return { entryMapId: location?.id || "alley", displayName: location?.name || "파밍지" };
  }
  const mode = String(bankMode || "");
  if (mode === "equipment") return { entryMapId: "bank_prep", displayName: "준비작업 1/2" };
  if (mode === "guardWeakening") return { entryMapId: "bank_prep", displayName: "준비작업 2/2 · 선택" };
  return { entryMapId: "bank", displayName: "은행 피날래" };
}

async function showTravelLoading(location, overrideName = "") {
  const overlay = $("#travelLoading");
  const displayName = overrideName || location.name;
  $("#travelLoadingTitle").textContent = `${displayName} 이동 준비`;
  $("#travelLoadingSub").textContent = "경로 확인 · 장비 적재 · 현장 연결 중";
  overlay.classList.remove("hidden");
  await sleep(2000);
  overlay.classList.add("hidden");
}

async function playLogisticsManualDoorEntry(locationName) {
  const overlay = $("#missionEntry");
  const backdrop = $("#entryBackdrop");
  const caption = $("#entryCaption");
  const left = backdrop.querySelector(".entry-door-left");
  const right = backdrop.querySelector(".entry-door-right");
  if (!left || !right) return;

  if (document.pointerLockElement) document.exitPointerLock?.();
  backdrop.className = "entry-backdrop entry-logistics manual";
  caption.textContent = `${locationName} · 두 문을 하나씩 바깥쪽으로 드래그해서 여세요`;
  for (const door of [left, right]) {
    door.classList.remove("opened", "dragging");
    door.style.transform = "translateX(0%)";
  }
  overlay.classList.remove("hidden");
  playTone(72, .16, "triangle", .04, 0);

  await new Promise((resolve) => {
    const opened = { left: false, right: false };
    let activeDoor = null;
    let startX = 0;
    let progress = 0;
    const threshold = 0.72;

    const setProgress = (side, value) => {
      const door = side === "left" ? left : right;
      const pct = Math.max(0, Math.min(1, value)) * 104;
      door.style.transform = `translateX(${side === "left" ? -pct : pct}%)`;
    };

    const cleanup = () => {
      for (const door of [left, right]) {
        door.removeEventListener("pointerdown", onDown);
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    const finishIfReady = () => {
      if (!opened.left || !opened.right) return;
      caption.textContent = "출입문 개방 완료";
      playLogisticsDoorEntrySound();
      cleanup();
      setTimeout(resolve, 520);
    };

    const onDown = (event) => {
      const door = event.currentTarget;
      const side = door === left ? "left" : "right";
      if (opened[side]) return;
      activeDoor = side;
      startX = event.clientX;
      progress = 0;
      door.classList.add("dragging");
      door.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    };
    const onMove = (event) => {
      if (!activeDoor) return;
      const span = Math.max(180, window.innerWidth * .42);
      const delta = activeDoor === "left" ? startX - event.clientX : event.clientX - startX;
      progress = Math.max(0, Math.min(1, delta / span));
      setProgress(activeDoor, progress);
    };
    const onUp = () => {
      if (!activeDoor) return;
      const side = activeDoor;
      const door = side === "left" ? left : right;
      door.classList.remove("dragging");
      if (progress >= threshold) {
        opened[side] = true;
        door.classList.add("opened");
        setProgress(side, 1);
        playTone(92, .12, "sawtooth", .035, 0);
      } else {
        setProgress(side, 0);
      }
      activeDoor = null;
      progress = 0;
      finishIfReady();
    };

    left.addEventListener("pointerdown", onDown);
    right.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });
  overlay.classList.add("hidden");
  backdrop.classList.remove("manual");
}

async function playMissionEntry(locationId, locationName) {
  if (locationId === "alley") {
    playFootstepEntrySound();
    await sleep(120);
    return;
  }
  if (locationId === "abandoned_store") {
    playCrowdEntrySound();
    await sleep(120);
    return;
  }
  if (locationId === "logistics") {
    await playLogisticsManualDoorEntry(locationName);
    return;
  }

  const overlay = $("#missionEntry");
  const backdrop = $("#entryBackdrop");
  const caption = $("#entryCaption");
  backdrop.className = `entry-backdrop entry-${locationId}`;
  caption.textContent = locationName;
  overlay.classList.remove("hidden");
  requestAnimationFrame(() => backdrop.classList.add("playing"));
  if (locationId === "bank" || locationId === "bank_prep") playLogisticsDoorEntrySound();
  await sleep(2100);
  overlay.classList.add("hidden");
  backdrop.classList.remove("playing");
}

const GLOW_THEMES = {
  low: { color: "#f0f3f7", soft: "rgba(240,243,247,.88)", deep: "rgba(240,243,247,.42)" },
  normal: { color: "#55b6ff", soft: "rgba(85,182,255,.90)", deep: "rgba(85,182,255,.46)" },
  high: { color: "#c06cff", soft: "rgba(192,108,255,.92)", deep: "rgba(192,108,255,.50)" },
  safe: { color: "#ffd966", soft: "rgba(255,217,102,.94)", deep: "rgba(255,217,102,.52)" },
  ruby: { color: "#ff174d", soft: "rgba(255,23,77,.96)", deep: "rgba(255,23,77,.58)" },
};

let state = null;
let player = { x: 50, y: 48, speed: 0.065 };
let keys = new Set();
let lastFrame = performance.now();
let missionSearchBusy = false;
let toastTimer;
let activeBox = null;
let activeMissionSafe = null;
let activePreviewGlow = "normal";
let cutStep = 0;
let cutBusy = false;
let safeDialPosition = 0;
let safeDialStage = 0;
let safeDialTotal = 1;
let safeHoldStartedAt = { a: 0, d: 0 };
let safeLastDialInteger = null;
let safeContactLatched = false;
let safeLastContactStage = -1;
let safeLastContactValue = null;
let safeRattleAt = 0;
let safeDialDrag = null;
let selectedRegularBoxes = new Set();
let bulkOpenBusy = false;
let bulkQueue = [];
let bulkQueueIndex = 0;
let bulkOpenedItems = [];
let bulkFailedCount = 0;
let bulkRequestedCount = 0;
let selectedFarmLocationId = "alley";
let currentPhoneApp = null;
let travelBusy = false;
let currentMissionLoot = [];
let revealGateBusy = false;
let modalSpaceAction = null;
let skipBusy = false;
let lastMissionWarningSecond = -1;
let missionTimeoutHandled = false;
let missionResultVisible = false;
let missionResultContext = null;
let mission3D = null;
let mission3DMissionId = null;
let lastExitNear = false;
let lastSafeNear = false;
let bankUvActive = false;
let bankUvX = 0.5;
let bankUvCode = "";
let bankUvRevealed = [false, false, false, false];
let bankChaseActive = false;
let bankChaseGame = null;
let bankChaseImpactTimer = null;
let bankChaseLootValue = 0;
let bankChaseSafeCount = 0;
let bankGuardAlertBusy = false;
let bankGuardHitBusy = false;
const BANK_UV_TRACE_X = [0.18, 0.38, 0.62, 0.82];
const BANK_UV_TRACE_Y = [0.34, 0.68, 0.42, 0.72];

function toast(message) {
  const text = String(message || "");
  // 구버전의 "준비작업 n/n 도착 · ... EXIT..." 도착 토스트만 숨긴다.
  // 실시간 임무 목표 HUD(#missionHint)는 그대로 유지한다.
  if (/^은행 준비작업\s*\d+\/\d+\s*도착\s*·/.test(text)) return;
  clearTimeout(toastTimer);
  const el = $("#toast");
  el.textContent = text;
  el.classList.add("show");
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

function glowTheme(kind) {
  return GLOW_THEMES[kind] || GLOW_THEMES.normal;
}

async function setMissionFullscreen(enabled) {
  document.body.classList.toggle("mission-immersive", Boolean(enabled));
  try {
    if (typeof api.setFullscreen === "function") await api.setFullscreen(Boolean(enabled));
    else if (enabled && !document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    else if (!enabled && document.fullscreenElement) await document.exitFullscreen?.();
  } catch {
    // 브라우저가 전체화면 요청을 거부해도 CSS 임무 화면은 계속 전체 뷰포트를 사용합니다.
  }
  requestAnimationFrame(() => mission3D?.resize?.());
}

async function refresh() {
  state = await api.getState();
  render();
}

async function refreshCompanyNow() {
  const button = $("#refreshCompany");
  if (button?.disabled) return;
  const oldLabel = button?.textContent || "새로고침";
  if (button) {
    button.disabled = true;
    button.textContent = "확인 중...";
  }
  try {
    const result = await api.refreshCompany?.();
    state = result?.state || await api.getState();
    render();
    if (!result?.ok) {
      toast(result?.error || "회사 등급을 새로고침하지 못했습니다.");
      return;
    }
    toast(`회사 등급 ${state.companyGrade || "-"} · 평판 ${Number(state.companyRep || 0).toLocaleString("ko-KR")} 새로고침 완료`);
  } catch (error) {
    toast(error?.message || "회사 등급 새로고침에 실패했습니다.");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = oldLabel;
    }
  }
}

async function refreshOnlineInventoryNow() {
  const button = $("#refreshInventory");
  if (button?.disabled) return;
  const oldLabel = button?.textContent || "온라인 물품 새로고침";
  if (button) {
    button.disabled = true;
    button.textContent = "동기화 중...";
  }
  try {
    const result = await api.refreshInventory?.();
    state = result?.state || await api.getState();
    render();
    if (!result?.ok) {
      toast(result?.error || state.onlineInventorySync?.lastError || "온라인 물품 새로고침에 실패했습니다.");
      return;
    }
    const removed = Number(result?.sync?.removed || 0);
    toast(removed > 0 ? `온라인 물품 새로고침 완료 · 모바일 판매 ${removed}개 반영` : "온라인 물품 새로고침 완료");
  } catch (error) {
    toast(error?.message || "온라인 물품 새로고침에 실패했습니다.");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = oldLabel;
    }
  }
}

function render() {
  $("#balance").textContent = money(state.balance);
  $("#phoneBoxCount").textContent = state.boxes.length;
  $("#phoneItemCount").textContent = state.items.length;
  $("#phoneCompanyGrade").textContent = state.companyGrade || "-";
  $("#phoneCompanyNote").textContent = state.devMode
    ? "개발 테스트 등급"
    : state.companyOnlineLinked
      ? `평판 ${Number(state.companyRep || 0).toLocaleString("ko-KR")} · SD Link 실시간 연동`
      : "SD Link 온라인 연결 필요";
  const onlineSync = state.onlineInventorySync || {};
  const onlineStatus = $("#onlineInventoryStatus");
  if (onlineStatus) {
    if (onlineSync.syncing) onlineStatus.textContent = "온라인 동기화 중...";
    else if (!onlineSync.linked) onlineStatus.textContent = "SD Link 온라인 연결 필요";
    else if (onlineSync.lastError) onlineStatus.textContent = `최근 동기화 오류 · ${onlineSync.lastError}`;
    else if (Number(onlineSync.lastSyncedAt || 0) > 0) {
      onlineStatus.textContent = `마지막 동기화 ${new Date(Number(onlineSync.lastSyncedAt)).toLocaleTimeString("ko-KR")}`;
    } else onlineStatus.textContent = "온라인 보관함 동기화 대기 중";
  }
  $("#buyCutter").textContent = state.cutterOwned ? "구매 완료" : "구매";
  $("#buyCutter").disabled = state.cutterOwned;
  if ($("#buyStethoscope")) {
    $("#buyStethoscope").textContent = "준비작업 해금";
    $("#buyStethoscope").disabled = true;
  }
  $("#stethoscopeState").textContent = state.stethoscopeOwned ? "보유 중 · 금고 청음 가능" : "침투 장비 준비작업 필요";
  $("#stethoscopeCard")?.classList.toggle("owned", Boolean(state.stethoscopeOwned));
  $("#buyQualityManager").textContent = state.qualityManagerOwned ? "보유 중" : "구매";
  $("#buyQualityManager").disabled = state.qualityManagerOwned;
  $("#qualityManagerState").textContent = state.qualityManagerOwned
    ? `작동 중 · 하루 ${money(state.qualityManagerDailyPower)} 전기세`
    : `미보유 · 보관 물품 가치 하루 ${Math.round((state.itemDailyDecayRate || 0) * 100)}% 하락`;
  $("#qualityManagerCard").classList.toggle("owned", Boolean(state.qualityManagerOwned));
  $("#buyCart").textContent = state.backpackOwned ? "보유 중" : "구매";
  $("#buyCart").disabled = state.backpackOwned;
  $("#cartState").textContent = state.backpackOwned ? "보유 중 · 모든 파밍 최대 회수 +3" : "미보유";
  $("#cartCard").classList.toggle("owned", Boolean(state.backpackOwned));
  $("#devReset").classList.toggle("hidden", !state.devMode);
  renderMission();
  renderBoxes();
  renderItems();
}

function selectTab(name) {
  const titles = { mission: "이동하기", boxes: "상자 보관함", shop: "상점", items: "물건 보관함" };
  currentPhoneApp = name;
  $("#phoneHome").classList.add("hidden");
  $("#appWorkspace").classList.remove("hidden");
  $$(".panel").forEach((panel) => panel.classList.remove("active"));
  $(`#${name}Panel`)?.classList.add("active");
  $("#currentAppTitle").textContent = titles[name] || "플리마켓";
}

function goPhoneHome() {
  if (missionResultVisible) return;
  if (travelBusy) {
    toast("이동 중에는 화면을 나갈 수 없습니다.");
    return;
  }
  if (state?.mission) {
    toast("임무 중에는 초록색 EXIT 지점으로 돌아가야 합니다.");
    return;
  }
  currentPhoneApp = null;
  $("#appWorkspace").classList.add("hidden");
  $("#phoneHome").classList.remove("hidden");
  $$(".panel").forEach((panel) => panel.classList.remove("active"));
}


async function handleBankGuardAlert() {
  const mission = state?.mission;
  const combatMission = mission?.missionType === "bank-finale" || (mission?.missionType === "bank-prep" && mission?.prepId === "guardWeakening");
  if (bankGuardAlertBusy || !combatMission || mission.guardAlarmTriggered) return;
  bankGuardAlertBusy = true;
  try {
    const result = await api.triggerBankGuardAlert?.();
    if (!result?.ok) return;
    state = result.state;
    playTone(880, .09, "square", .04, 0);
    playTone(660, .11, "square", .035, .08);
    toast(result.spawned ? "경비원에게 발각되었습니다. 증원 경비원 3명이 출동합니다." : "경비원에게 발각되었습니다. 경비가 사격을 시작합니다.");
    render();
  } finally {
    bankGuardAlertBusy = false;
  }
}

async function handleBankGuardAttack() {
  const mission = state?.mission;
  const combatMission = mission?.missionType === "bank-finale" || (mission?.missionType === "bank-prep" && mission?.prepId === "guardWeakening");
  if (bankGuardHitBusy || !combatMission) return;
  bankGuardHitBusy = true;
  try {
    playGuardGunshotSound();
    mission3D?.playerHitFx?.();
    const result = await api.bankGuardHitPlayer?.();
    if (!result?.ok) return;
    state = result.state;
    if (result.failed) {
      render();
      if (result.prepFailed) showMissionResult([], "경비원 무장 약화", "경비원 총격으로 제압되어 준비작업에 실패했습니다.");
      else showMissionResult([], "은행 피날래", "경비원 총격으로 제압되었습니다. 습격 획득품을 잃었습니다.");
      return;
    }
    render();
  } finally {
    bankGuardHitBusy = false;
  }
}

function ensureMission3D() {
  if (mission3D || !window.Mission3D) return mission3D;
  const container = $("#warehouse");
  const canvas = $("#mission3DCanvas");
  if (!container || !canvas) return null;
  mission3D = window.Mission3D.create({
    container,
    canvas,
    onNearestChange: () => updateMissionHint(),
    onExitChange: (info) => {
      const near = Boolean(info?.near);
      if (near !== lastExitNear) {
        lastExitNear = near;
        updateMissionHint();
      }
    },
    onSafeChange: (info) => {
      const near = Boolean(info?.near);
      if (near !== lastSafeNear) {
        lastSafeNear = near;
        updateMissionHint();
      }
    },
    onStep: (sprinting) => play3DFootstep(sprinting),
    onPrimaryAction: () => handleMissionPrimaryAction(),
    onGuardAlert: () => handleBankGuardAlert(),
    onGuardAttack: () => handleBankGuardAttack(),
    onPointerLockChange: (locked) => {
      const hint = $("#mission3DPointer");
      if (hint) hint.textContent = locked
        ? ""
        : "화면을 클릭하면 마우스 시점이 고정됩니다.";
    },
  });
  return mission3D;
}

function syncMission3D(mission) {
  const engine = ensureMission3D();
  if (!engine) return;
  if (!mission) {
    if (engine.isActive()) engine.unmount();
    mission3DMissionId = null;
    lastExitNear = false;
    lastSafeNear = false;
    return;
  }
  if (!engine.isActive() || mission3DMissionId !== mission.id) {
    mission3DMissionId = mission.id;
    engine.mount(mission.locationId || "alley", mission.nodes || [], mission.safe || null, true);
    engine.syncMissionState?.(mission);
  } else {
    engine.syncNodes(mission.nodes || []);
    engine.syncSafe?.(mission.safe || null);
    engine.syncMissionState?.(mission);
  }
}

function mapSceneMarkup(locationId) {
  const scenes = {
    alley: ``,
    abandoned_store: ``,
    logistics: ``,
    bank_prep: ``,
    bank: ``,
  };
  return scenes[locationId] || scenes.alley;
}

function gradeRank(grade) {
  return ["F", "E", "D", "C", "B", "A", "S", "SS", "SSS"].indexOf(String(grade || "").toUpperCase());
}

function isLocationUnlocked(location) {
  if (!location?.requiredCompanyGrade) return true;
  return gradeRank(state.companyGrade) >= gradeRank(location.requiredCompanyGrade);
}

function effectiveLocationMax(location) {
  return Number(location?.maxBoxes || 3) + (state?.backpackOwned ? 3 : 0);
}


function selectedMissionLocation() {
  const missionLocationId = state?.mission?.locationId === "bank_prep" ? "bank" : (state?.mission?.locationId || selectedFarmLocationId);
  return state.farmLocations.find((entry) => entry.id === missionLocationId) || state.farmLocations[0];
}

function missionMaxBoxes() {
  if (state?.mission?.missionType === "bank-prep") return state.mission.prepId === "equipment" ? 3 : 1;
  if (state?.mission?.missionType === "bank-finale") return state.mission.nodes.filter((node) => node.kind === "safe-node").length;
  return Number(state?.mission?.maxBoxes || effectiveLocationMax(selectedMissionLocation()));
}

function missionLootFromState() {
  if (!state?.mission) return currentMissionLoot;
  if (state.mission.missionType && state.mission.missionType !== "regular") return currentMissionLoot;
  const startedAt = Number(state.mission.startedAt || 0);
  const locationName = state.mission.locationName || "";
  return state.boxes
    .filter((box) => {
      const acquiredAt = new Date(box.acquiredAt || 0).getTime();
      const sameRunTime = acquiredAt >= startedAt;
      const sameLocation = !locationName || String(box.source || "").includes(locationName);
      return sameRunTime && sameLocation;
    })
    .sort((a, b) => new Date(a.acquiredAt) - new Date(b.acquiredAt))
    .slice(-missionMaxBoxes());
}

function rewardIconFor(entry) {
  if (!entry) return "◆";
  if (entry.tier === "safe") return "🔐";
  if (entry.tier === "gear") return "🧰";
  if (entry.tier === "door") return "🔦";
  if (entry.tier === "guard") return "⚡";
  if (entry.tier === "empty") return "∅";
  return "📦";
}

function renderMissionLoot() {
  const lootTitle = document.querySelector(".mission-loot-head span");
  if (lootTitle) lootTitle.textContent = state?.mission?.missionType === "bank-finale" ? "은행 금고 기록" : "이번 임무 획득";
  const list = currentMissionLoot.length ? currentMissionLoot : missionLootFromState();
  if (!currentMissionLoot.length && list.length) currentMissionLoot = [...list];
  const maxBoxes = missionMaxBoxes();
  $("#missionLootCount").textContent = `${currentMissionLoot.length} / ${maxBoxes}`;
  $("#missionLootList").innerHTML = currentMissionLoot.length
    ? currentMissionLoot.map((box, index) => `
        <div class="mission-loot-item" style="--loot-accent:${box.accent || "#9aa6b2"}">
          <span class="loot-index">${index + 1}</span>
          <span class="loot-icon">${rewardIconFor(box)}</span>
          <span class="loot-name">${box.tierName || box.name || "결과"}</span>
        </div>`).join("")
    : `<div class="mission-loot-empty">아직 획득한 결과가 없습니다.</div>`;
}

function showMissionResult(loot, locationName = "파밍지", reason = "파밍을 마쳤습니다.", options = {}) {
  const boxes = Array.isArray(loot) ? [...loot] : [];
  missionResultVisible = true;
  missionResultContext = {
    allowPrepShortcut: Boolean(options.allowPrepShortcut),
    prepLocationId: options.prepLocationId || "bank",
  };
  $("#missionResultTitle").textContent = `${locationName} 임무 완료`;
  $("#missionResultSub").textContent = `${reason} · 결과 ${boxes.length}개`;
  $("#missionResultLoot").innerHTML = boxes.length
    ? boxes.map((box, index) => `
        <div class="mission-result-box" style="--result-accent:${box.accent || "#9aa6b2"}">
          <span class="result-box-number">${String(index + 1).padStart(2, "0")}</span>
          <span class="result-box-icon">${rewardIconFor(box)}</span>
          <strong>${box.tierName || box.name || "결과"}</strong>
        </div>`).join("")
    : `<div class="mission-result-empty">이번 임무에서 획득한 결과가 없습니다.</div>`;
  $("#missionResultContinuePrep").classList.toggle("hidden", !missionResultContext.allowPrepShortcut);
  $("#missionResultHint").textContent = missionResultContext.allowPrepShortcut
    ? "SPACE 또는 화면 클릭은 휴대폰으로 복귀 · 버튼으로 준비작업 계속 가능"
    : "SPACE 또는 화면 클릭";
  $("#missionResult").classList.remove("hidden");
  setTimeout(() => $("#missionResultReturn")?.focus(), 40);
}

async function finishMissionResult(target = "phone") {
  if (!missionResultVisible) return;
  const context = missionResultContext || {};
  missionResultVisible = false;
  missionResultContext = null;
  $("#missionResult").classList.add("hidden");
  currentMissionLoot = [];
  await setMissionFullscreen(false);
  goPhoneHome();
  if (target === "prep" && context.allowPrepShortcut) {
    selectedFarmLocationId = context.prepLocationId || "bank";
    selectTab("mission");
    render();
  }
}

function applyMapTheme(locationId) {
  const warehouse = $("#warehouse");
  const keepThreeD = warehouse.classList.contains("three-d-active");
  const keepPointer = warehouse.classList.contains("pointer-locked");
  warehouse.className = `warehouse map-${locationId}`;
  if (keepThreeD) warehouse.classList.add("three-d-active");
  if (keepPointer) warehouse.classList.add("pointer-locked");
  $("#mapScene").innerHTML = mapSceneMarkup(locationId);
}

function renderMission() {
  const mission = state.mission;
  if (!mission) {
    selectedFarmLocationId = selectedFarmLocationId || state.selectedLocationId || "alley";
    if (selectedFarmLocationId === "bank_prep") selectedFarmLocationId = "bank";
  } else {
    selectedFarmLocationId = mission.locationId === "bank_prep" ? "bank" : (mission.locationId || "alley");
  }

  renderFarmLocations();
  const location = state.farmLocations.find((entry) => entry.id === (selectedFarmLocationId === "bank_prep" ? "bank" : selectedFarmLocationId)) || state.farmLocations[0];
  const selectView = $("#travelSelectView");
  const activeView = $("#activeMissionView");
  const warehouse = $("#warehouse");

  if (!mission) {
    syncMission3D(null);
    selectView.classList.remove("hidden");
    activeView.classList.add("hidden");
    $("#missionLocationName").textContent = "목적지 선택";
    $("#missionLocationDesc").textContent = "이동할 파밍지를 선택하세요. 출발하기 전에는 현장 맵과 수색 포인트가 표시되지 않습니다.";
    $("#selectedDestinationName").textContent = location.name;
    $("#selectedDestinationMeta").textContent = location.id === "bank"
      ? `필수 준비작업 1개 완료 후 피날래 진입 · 선택 작업으로 경비원 약화 · 시작 비용 ${money(state.prices.bankFinale)}`
      : `${location.subtitle} · 탐색 ${Number(location.nodeCount || 10)}개 · 최대 회수 ${effectiveLocationMax(location)}개${state.backpackOwned ? " (백팩 +3)" : ""}`;
    $("#missionButton").textContent = travelBusy ? "이동 중..." : "출발하기";
    $("#missionButton").disabled = travelBusy || !isLocationUnlocked(location);
    renderBankOperationPanel();
    $("#foundBoxes").textContent = `0 / ${effectiveLocationMax(location)}`;
    $("#locationRates").textContent = formatLocationRates(location);
    $("#missionTimer").textContent = "NO LIMIT";
    $("#missionTimer").classList.remove("warning", "danger");
    warehouse.classList.remove("mission-urgent");
    $("#bankCombatHud")?.classList.add("hidden");
    $$(".search-node").forEach((node) => node.remove());
    lastMissionWarningSecond = -1;
    return;
  }

  $("#bankOperationPanel").classList.add("hidden");
  $("#travelDepartBar").classList.remove("hidden");
  selectView.classList.add("hidden");
  activeView.classList.remove("hidden");
  applyMapTheme(mission.locationId || location.id);
  syncMission3D(mission);
  renderMissionLoot();
  $("#activeMissionName").textContent = mission.locationName || location.name;
  const guardTotal = mission.nodes.filter((node) => node.kind === "guard").length;
  $("#locationRates").textContent = mission.missionType === "bank-prep"
    ? (mission.prepId === "equipment" ? `침투 장비 · ${mission.prepFoundIds?.length || 0}/3 확보` : `선택 작업 · 경비 ${mission.guardsNeutralized || 0}/${mission.nodes.filter((node) => node.kind === "guard").length} · HP ${mission.playerHealth ?? 100}`)
    : mission.missionType === "bank-finale"
      ? `문 해제 ${mission.bankDoorUnlocked ? "완료" : "대기"} · 경비원 ${mission.guardsNeutralized || 0}/${guardTotal} · HP ${mission.playerHealth ?? 100} · 운반 금고 ${mission.safeCarried || 0}/${mission.nodes.filter((node) => node.kind === "safe-node").length}`
      : formatLocationRates(location);
  $("#foundBoxes").textContent = mission.missionType === "bank-prep"
    ? (mission.prepId === "equipment" ? `${mission.prepFoundIds?.length || 0} / 3` : `${mission.prepComplete ? 1 : 0} / 1`)
    : mission.missionType === "bank-finale"
      ? `${mission.safeCarried || 0} / ${mission.nodes.filter((node) => node.kind === "safe-node").length}`
      : `${mission.foundCount} / ${mission.maxBoxes}`;
  const combatHud = $("#bankCombatHud");
  const prepGuardCombat = mission.missionType === "bank-prep" && mission.prepId === "guardWeakening";
  const guardCombat = mission.missionType === "bank-finale" || prepGuardCombat;
  combatHud?.classList.toggle("hidden", !guardCombat);
  if (guardCombat) {
    const playerHp = Math.max(0, Math.min(100, Number(mission.playerHealth ?? 100)));
    $("#bankPlayerHp").textContent = String(playerHp);
    $("#bankPlayerHpBar").style.width = `${playerHp}%`;
    $("#bankPlayerHpBar").classList.toggle("critical", playerHp <= 30);
    $("#bankGuardCount").textContent = `${mission.guardsNeutralized || 0} / ${guardTotal}`;
    const alarm = $("#bankAlarmState");
    alarm.className = `bank-alarm-state${mission.guardAlarmTriggered ? " alert" : mission.guardWeakening ? " weak" : ""}`;
    if (prepGuardCombat) alarm.textContent = mission.guardAlarmTriggered ? "발각 · 경비 사격" : "준비작업 경비 · 시야 경계 중";
    else alarm.textContent = mission.guardAlarmTriggered ? "발각 · 증원 출동" : mission.guardWeakening ? "경비 약화 적용" : "시야 경계 중";
  }
  $("#missionReturnButton").disabled = true;
  $("#missionTimer").textContent = "NO LIMIT";
  $("#missionTimer").classList.remove("warning", "danger");
  warehouse.classList.remove("mission-urgent");

  $$(".search-node").forEach((node) => node.remove());
  for (const node of mission.nodes) {
    const el = document.createElement("div");
    const type = node.objectType || "crate";
    el.className = `search-node search-object object-${type}${node.searched ? " searched" : ""}${node.special ? " special" : ""}`;
    el.dataset.id = node.id;
    el.style.left = `${node.x}%`;
    el.style.top = `${node.y}%`;
    el.innerHTML = `<span class="search-object-icon">${node.objectIcon || "▣"}</span>`;
    el.setAttribute("aria-label", node.objectLabel || "수색 대상");
    warehouse.appendChild(el);
  }
  updateMissionHint();
}

function formatLocationRates(location) {
  const labels = { worn: "낡은", normal: "보통", fancy: "고급", premium: "최고급", safe: "금고" };
  return Object.entries(location.weights)
    .filter(([, value]) => Number(value) > 0)
    .map(([tier, value]) => `${labels[tier]} ${value}%`)
    .join(" · ");
}

function renderBankOperationPanel() {
  const panel = $("#bankOperationPanel");
  const departBar = $("#travelDepartBar");
  const bankSelected = selectedFarmLocationId === "bank" && !state?.mission;
  panel.classList.toggle("hidden", !bankSelected);
  departBar.classList.toggle("hidden", bankSelected);
  if (!bankSelected) return;

  const prep = state.bankPrep || {};
  const steps = [
    { id: "equipment", name: "침투 장비 확보", accent: "#7ce7ff", required: true },
    { id: "guardWeakening", name: "경비원 무장 약화", accent: "#ffd36e", required: false },
  ];
  const equipmentDone = Boolean(prep.equipment);
  const weakeningDone = Boolean(prep.guardWeakening);

  $("#bankPrepProgress").textContent = `필수 ${equipmentDone ? 1 : 0}/1 · 선택 ${weakeningDone ? 1 : 0}/1`;
  $("#bankFinaleCost").textContent = money(state.prices.bankFinale);
  $("#bankPrepSteps").innerHTML = steps.map((step, index) => {
    const done = Boolean(prep[step.id]);
    const available = step.required ? !done : equipmentDone && !done;
    return `<article class="bank-prep-step ${step.required ? "required" : "optional"} ${done ? "done" : ""} ${available ? "active" : ""}" style="--prep-accent:${step.accent}">
      <span class="step-number">PREP ${index + 1}</span>
      <strong>${step.name}</strong>
      <span class="step-state">${done ? "✓ 완료" : step.required ? "필수" : equipmentDone ? "선택 가능" : "필수 작업 완료 후 가능"}</span>
    </article>`;
  }).join("");

  const prepButton = $("#bankMissionButton");
  const finaleButton = $("#bankFinaleButton");
  prepButton.disabled = travelBusy || (equipmentDone && weakeningDone);
  finaleButton.disabled = travelBusy || !equipmentDone;

  if (!equipmentDone) {
    prepButton.textContent = travelBusy ? "이동 중..." : "침투 장비 확보 시작";
    $("#bankOperationStatus").textContent = "청진기 · UV 라이트 · 권총 3종 확보는 피날래 전에 반드시 완료해야 합니다.";
  } else if (!weakeningDone) {
    prepButton.textContent = travelBusy ? "이동 중..." : "경비원 무장 약화 · 선택";
    $("#bankOperationStatus").textContent = "피날래 진입 가능 · 선택 작업을 하면 경비원 체력이 50 → 25로 감소합니다.";
  } else {
    prepButton.textContent = "선택 준비작업 완료";
    $("#bankOperationStatus").textContent = "준비 완료 · 경비원 체력 25 적용 · 피날래 진입 가능";
  }
  finaleButton.textContent = travelBusy ? "진입 중..." : `피날래 시작 · ${money(state.prices.bankFinale)}`;
}

function renderFarmLocations() {
  const missionLocked = Boolean(state.mission) || travelBusy;
  $("#farmLocations").innerHTML = state.farmLocations.map((location) => {
    const selected = location.id === selectedFarmLocationId;
    const unlocked = isLocationUnlocked(location);
    const rates = formatLocationRates(location);
    const requirement = location.requiredCompanyGrade
      ? `<span class="farm-card-lock ${unlocked ? "ok" : "locked"}">${unlocked ? `회사 ${state.companyGrade}등급 · 출입 가능` : `🔒 회사 ${location.requiredCompanyGrade}등급 이상 필요`}</span>`
      : "";
    return `<button class="farm-card ${selected ? "selected" : ""} ${unlocked ? "" : "locked"}" data-location-id="${location.id}" ${(missionLocked || !unlocked) ? "disabled" : ""}>
      <span class="farm-card-top"><strong>${location.name}</strong><small>${location.subtitle}</small></span>
      <span class="farm-card-desc">${location.description}</span>
      <span class="farm-card-rates">${rates}</span>
      <span class="farm-card-points">${location.id === "bank" ? `필수 준비작업 1개 · 선택 준비작업 1개 · 시작 비용 ${money(state.prices.bankFinale)}` : `탐색 ${Number(location.nodeCount || 10)}개 · 최대 회수 ${effectiveLocationMax(location)}개${state.backpackOwned ? " · 백팩 적용" : ""}`}</span>
      ${requirement}
    </button>`;
  }).join("");
}


function selectFarmLocation(locationId) {
  if (state.mission) return;
  const location = state.farmLocations.find((entry) => entry.id === locationId);
  if (!location || !isLocationUnlocked(location)) return;
  if (selectedFarmLocationId !== locationId) currentMissionLoot = [];
  selectedFarmLocationId = locationId;
  renderMission();
}

function nearestNode() {
  if (!state?.mission) return null;
  const engine = ensureMission3D();
  if (engine?.isActive()) return engine.nearestNode();
  let best = null;
  let bestDistance = Infinity;
  for (const node of state.mission.nodes) {
    if (node.searched) continue;
    const dx = node.x - player.x;
    const dy = node.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist < bestDistance) {
      best = node;
      bestDistance = dist;
    }
  }
  return bestDistance <= 7 ? best : null;
}

function updateMissionHint() {
  $$(".search-node").forEach((el) => el.classList.remove("near"));
  if (!state?.mission) return;

  const safeInfo = mission3D?.isActive() ? mission3D.safeInfo?.() : null;
  if (safeInfo?.near && state.mission.safe && !state.mission.safe.opened) {
    $("#missionHint").innerHTML = state.stethoscopeOwned
      ? `<span class="safe-hint">금고 · <kbd>E</kbd> 청진기로 해제</span>`
      : `<span class="safe-hint">금고 · 청진기 필요</span>`;
    return;
  }

  const exit = mission3D?.isActive() ? mission3D.exitInfo?.() : null;
  if (exit?.near) {
    $("#missionHint").innerHTML = `<span class="exit-hint">EXIT · <kbd>E</kbd> 탈출</span>`;
    return;
  }

  if (state.mission.exhausted) {
    $("#missionHint").innerHTML = `<span class="exit-hint">임무 완료 · 초록색 EXIT 웨이포인트로 돌아가세요.</span>`;
    return;
  }

  const node = nearestNode();
  if (state.mission.missionType === "regular" && state.mission.locationId === "abandoned_store" && !state.mission.storeDoorBroken) {
    if (!state.mission.storeBrickOwned) {
      if (node?.kind === "store-brick") $("#missionHint").innerHTML = `<span class="safe-hint">${node.objectLabel} · <kbd>E</kbd> 줍기</span>`;
      else $("#missionHint").textContent = "입구 근처에 놓인 벽돌을 먼저 찾으세요.";
      return;
    }
    const aimedDoor = mission3D?.aimedStoreDoor?.();
    $("#missionHint").innerHTML = aimedDoor
      ? `<span class="safe-hint">상가 유리문 조준 · <kbd>좌클릭</kbd> 벽돌 던지기</span>`
      : `벽돌 보유 · 상가 유리문을 화면 중앙에 조준하세요.`;
    return;
  }
  if (state.mission.missionType === "bank-finale") {
    if (!state.mission.bankDoorUnlocked) {
      if (node?.kind === "door") $("#missionHint").innerHTML = `<span class="safe-hint">은행 보안문 · <kbd>E</kbd> UV 라이트로 비밀번호 찾기</span>`;
      else $("#missionHint").textContent = "은행 보안문을 먼저 찾아 UV 라이트로 비밀번호를 확인하세요.";
      return;
    }
    const totalGuards = state.mission.nodes.filter((entry) => entry.kind === "guard").length;
    if ((state.mission.guardsNeutralized || 0) < totalGuards) {
      const aimed = mission3D?.aimedGuard?.();
      $("#missionHint").innerHTML = aimed
        ? `<span class="safe-hint">${aimed.objectLabel || "경비원"} · ${aimed.hitZone === "head" ? "헤드샷 25" : "몸통 10"} · HP ${aimed.hp ?? "?"}/${aimed.maxHp ?? "?"} · <kbd>좌클릭</kbd> 발사</span>`
        : `경비원 제압 ${state.mission.guardsNeutralized || 0} / ${totalGuards} · 좁은 시야에 발각되면 증원 3명 출동`;
      return;
    }
    if (node?.kind === "safe-node") {
      $("#missionHint").innerHTML = `<span class="safe-hint">${node.objectLabel} · <kbd>E</kbd> 금고 들고 가기</span>`;
    } else {
      const totalSafes = state.mission.nodes.filter((entry) => entry.kind === "safe-node").length;
      $("#missionHint").textContent = `금고 운반 ${state.mission.safeCarried || 0} / ${totalSafes} · 원하는 만큼 챙긴 뒤 EXIT`;
    }
    return;
  } else if (state.mission.missionType === "bank-prep") {
    if (!node) {
      if (state.mission.prepId === "equipment") {
        $("#missionHint").textContent = `청진기 · UV 라이트 · 권총을 모두 찾으세요 · ${state.mission.prepFoundIds?.length || 0}/3`;
      } else {
        $("#missionHint").textContent = "경비원 3명이 순찰 중입니다. 피하거나 제압하면서 경비 장비 제어 단말기를 찾아 무장 약화를 적용하세요.";
      }
      return;
    }
  }

  if (node) {
    document.querySelector(`.search-node[data-id="${node.id}"]`)?.classList.add("near");
    const label = node.objectLabel || "수색 대상";
    $("#missionHint").innerHTML = `${label} · <kbd>E</kbd> 수색`;
  } else {
    $("#missionHint").textContent = mission3D?.isActive()
      ? "WASD로 이동 · 초록색 EXIT는 출발 지점입니다 · 주변 물체를 직접 찾아보세요."
      : "주변의 수색 가능한 물체 가까이 이동하세요.";
  }
}

function renderBoxes() {
  const counts = Object.fromEntries(state.boxTiers.map((tier) => [tier.id, 0]));
  state.boxes.forEach((box) => counts[box.tier] = (counts[box.tier] || 0) + 1);
  $("#boxSummary").innerHTML = state.boxTiers.map((tier) => `<div class="summary"><strong>${counts[tier.id] || 0}</strong><span>${tier.name}</span></div>`).join("");

  const validRegularIds = new Set(state.boxes.filter((box) => box.tier !== "safe").map((box) => box.id));
  selectedRegularBoxes = new Set([...selectedRegularBoxes].filter((id) => validRegularIds.has(id)));
  const regularBoxes = state.boxes.filter((box) => box.tier !== "safe");
  const bulkBar = $("#boxBulkBar");
  bulkBar.classList.toggle("hidden", regularBoxes.length === 0);
  $("#bulkSelectedCount").textContent = `${selectedRegularBoxes.size}개 선택`;
  const tierLabels = { worn: "낡은", normal: "평범한", fancy: "고급진", premium: "최고급" };
  $("#tierSelectButtons").innerHTML = ["worn", "normal", "fancy", "premium"].map((tierId) => {
    const tierBoxes = regularBoxes.filter((box) => box.tier === tierId);
    const selectedTierCount = tierBoxes.filter((box) => selectedRegularBoxes.has(box.id)).length;
    const allSelected = tierBoxes.length > 0 && selectedTierCount === tierBoxes.length;
    return `<button class="tier-select-button ${allSelected ? "selected" : ""}" data-tier-select="${tierId}" ${bulkOpenBusy || !tierBoxes.length ? "disabled" : ""}>${tierLabels[tierId]} 전체 <b>${tierBoxes.length}</b></button>`;
  }).join("");

  const selectedCount = selectedRegularBoxes.size;
  let eventLabel = "선택 상자 연속 개봉 시작";
  if (selectedCount === 1) eventLabel = "1회 개봉 시작";
  else if (selectedCount === 10) eventLabel = "10연 개봉 시작";
  else if (selectedCount > 1) eventLabel = `${selectedCount}연 개봉 시작`;

  $("#bulkOpenBoxes").disabled = selectedCount === 0 || bulkOpenBusy;
  $("#bulkOpenBoxes").textContent = bulkOpenBusy
    ? "개봉 이벤트 진행 중..."
    : `${eventLabel}${selectedCount ? ` (${selectedCount})` : ""}`;
  $("#selectAllRegular").disabled = bulkOpenBusy || regularBoxes.length === 0 || selectedRegularBoxes.size === regularBoxes.length;
  $("#clearBoxSelection").disabled = bulkOpenBusy || selectedRegularBoxes.size === 0;

  $("#boxList").innerHTML = state.boxes.map((box) => {
    const isSafe = box.tier === "safe";
    const ready = isSafe ? state.stethoscopeOwned : state.cutterOwned;
    const selected = !isSafe && selectedRegularBoxes.has(box.id);
    const requirement = isSafe
      ? (ready ? "청진기 보유 · 금고 청음 가능" : "청진기 필요 · 장비 상점에서 구매")
      : (ready ? "커터칼 보유 · 개봉 가능" : "커터칼 필요 · 장비 상점에서 구매");
    const buttonText = isSafe
      ? (ready ? "🔐 금고 열기" : "🛒 청진기가 필요합니다")
      : (ready ? "📦 상자 열기" : "🛒 커터칼이 필요합니다");
    const selector = isSafe
      ? `<div class="bulk-excluded">🔒 금고 · 다중 개봉 불가</div>`
      : `<label class="box-select ${selected ? "checked" : ""}"><input class="box-select-input" type="checkbox" data-id="${box.id}" ${selected ? "checked" : ""}><span>${selected ? "✓ 선택됨" : "다중 개봉 선택"}</span></label>`;
    return `
      <article class="box-card ${ready ? "ready" : "needs-tool"} ${selected ? "selected" : ""}" style="--accent:${box.accent}">
        ${selector}
        <div class="box-art">${isSafe ? "🔐" : "📦"}</div>
        <h3>${box.tierName}</h3>
        <div class="box-ready ${ready ? "ok" : "warn"}">${ready ? "● 개봉 준비 완료" : "● 장비 필요"}</div>
        <div class="meta">${box.id}<br>${box.source}<br>${new Date(box.acquiredAt).toLocaleString("ko-KR")}</div>
        <div class="tool-hint">${requirement}</div>
        <button class="open-box primary-open" data-id="${box.id}">${buttonText}</button>
      </article>`;
  }).join("");
  $("#boxEmpty").classList.toggle("hidden", state.boxes.length > 0);
}

function toggleRegularBoxSelection(boxId, checked) {
  const box = state.boxes.find((entry) => entry.id === boxId);
  if (!box || box.tier === "safe" || bulkOpenBusy) return;
  if (checked) selectedRegularBoxes.add(boxId);
  else selectedRegularBoxes.delete(boxId);
  renderBoxes();
}

function toggleTierSelection(tierId) {
  if (bulkOpenBusy) return;
  const boxes = state.boxes.filter((box) => box.tier === tierId && box.tier !== "safe");
  if (!boxes.length) return;
  const allSelected = boxes.every((box) => selectedRegularBoxes.has(box.id));
  for (const box of boxes) {
    if (allSelected) selectedRegularBoxes.delete(box.id);
    else selectedRegularBoxes.add(box.id);
  }
  renderBoxes();
}

function selectAllRegularBoxes() {
  if (bulkOpenBusy) return;
  selectedRegularBoxes = new Set(state.boxes.filter((box) => box.tier !== "safe").map((box) => box.id));
  renderBoxes();
}

function clearRegularBoxSelection() {
  if (bulkOpenBusy) return;
  selectedRegularBoxes.clear();
  renderBoxes();
}

function renderStepRow(step) {
  const labels = ["앞면", "옆면", "상단"];
  return labels.map((label, index) => `<div class="open-step ${index < step ? "done" : index === step ? "active" : ""}"><span>${index < step ? "✓" : index + 1}</span><b>${label}</b></div>`).join("");
}

function renderQueueDots(total, activeIndex) {
  return Array.from({ length: total }, (_, index) => {
    const stateClass = index < activeIndex ? "done" : index === activeIndex ? "active" : "pending";
    return `<span class="queue-dot ${stateClass}"></span>`;
  }).join("");
}

function quickBoxMarkup(step, glowKind, icon = "📦", extraClass = "", stepLabel = `${step + 1} / 3`) {
  const theme = glowTheme(glowKind);
  return `
    <button id="quickBox" class="quick-box ${extraClass} step-${Math.min(step, 2)}" type="button" style="--leak-color:${theme.color};--leak-soft:${theme.soft};--leak-deep:${theme.deep};" aria-label="현재 단계 절단">
      <div class="quick-box-aura"></div>
      <div class="quick-box-lid"></div>
      <div class="quick-box-seam seam-v"></div>
      <div class="quick-box-seam seam-h"></div>
      <div class="quick-box-tape ${step === 2 ? "top" : "vertical"}"><span></span></div>
      <div class="quick-box-icon">${icon}</div>
      <div class="quick-box-step">${stepLabel}</div>
    </button>`;
}

function bulkEventTitle(total) {
  if (total === 10) return "10연 개봉";
  if (total === 1) return "1회 개봉";
  return `${total}연 개봉`;
}

async function startBulkQueueItem() {
  if (!bulkOpenBusy) return;
  while (bulkQueueIndex < bulkQueue.length) {
    const queued = bulkQueue[bulkQueueIndex];
    const box = state.boxes.find((entry) => entry.id === queued.id && entry.tier !== "safe");
    if (!box) {
      bulkQueueIndex += 1;
      continue;
    }

    const startResult = await api.startBoxOpen(box.id);
    if (!startResult.ok || startResult.type === "safe") {
      bulkFailedCount += 1;
      bulkQueueIndex += 1;
      continue;
    }

    activeBox = box;
    activePreviewGlow = startResult.previewGlow || "normal";
    cutStep = 0;
    renderRegularOpen();
    return;
  }

  await finishBulkQueue();
}

function revealBulkReward(item, nextState) {
  state = nextState;
  playItemPickupSound(item?.originalValue || item?.currentValue || 0, "item");
  bulkOpenedItems.push(item);
  activeBox = null;
  render();

  const isLast = bulkQueueIndex >= bulkQueue.length - 1;
  const total = bulkRequestedCount || bulkQueue.length;
  const nextText = isLast ? "전체 결과 보기" : "다음 상자 직접 개봉";
  $("#openStage").innerHTML = `
    <div class="reward-card bulk-moment-card">
      <div class="reward-icon">🎁</div>
      <p class="eyebrow">REVEAL</p>
      <h2>${item.name}</h2>
      <div class="reward-value">${itemValueDisplay(item)}</div>
      <div class="bulk-moment-meta">${Math.min(bulkQueueIndex + 1, total)} / ${total}</div>
      <p class="meta">다음 상자도 자동으로 열리지 않습니다. 버튼 클릭 또는 SPACE로 진행하세요.</p>
      <button id="bulkNextBox" class="primary">${nextText}</button>
      <div class="keyboard-hint">SPACE 키로도 진행할 수 있습니다.</div>
    </div>`;

  let moving = false;
  const next = async () => {
    if (moving) return;
    moving = true;
    modalSpaceAction = null;
    bulkQueueIndex += 1;
    if (bulkQueueIndex >= bulkQueue.length) await finishBulkQueue();
    else await startBulkQueueItem();
  };
  modalSpaceAction = next;
  $("#bulkNextBox").addEventListener("click", next);
}

async function finishBulkQueue() {
  const items = [...bulkOpenedItems];
  const failed = bulkFailedCount;
  const requested = bulkRequestedCount || bulkQueue.length;

  bulkOpenBusy = false;
  revealGateBusy = false;
  modalSpaceAction = null;
  activeBox = null;
  cutBusy = false;
  selectedRegularBoxes.clear();
  bulkQueue = [];
  bulkQueueIndex = 0;
  bulkOpenedItems = [];
  bulkFailedCount = 0;
  bulkRequestedCount = 0;
  state = await api.getState();
  render();
  showBulkRewards(items, failed, requested);
}

function cancelBulkQueue() {
  if (!bulkOpenBusy) return;
  bulkOpenBusy = false;
  revealGateBusy = false;
  modalSpaceAction = null;
  activeBox = null;
  cutBusy = false;
  bulkQueue = [];
  bulkQueueIndex = 0;
  bulkOpenedItems = [];
  bulkFailedCount = 0;
  bulkRequestedCount = 0;
  $("#openModal").classList.add("hidden");
  render();
  toast("연속 개봉을 중단했습니다. 아직 열지 않은 상자는 그대로 보관됩니다.");
}

async function bulkOpenSelectedBoxes() {
  if (bulkOpenBusy) return;
  const selected = state.boxes.filter((box) => box.tier !== "safe" && selectedRegularBoxes.has(box.id));
  if (!selected.length) return toast("연속 개봉할 일반 상자를 선택해 주세요.");
  if (!state.cutterOwned) {
    toast("연속 개봉에는 커터칼이 필요합니다. 장비 상점으로 이동했습니다.");
    selectTab("shop");
    $("#buyCutter")?.focus();
    return;
  }

  bulkOpenBusy = true;
  bulkQueue = [...selected];
  bulkQueueIndex = 0;
  bulkOpenedItems = [];
  bulkFailedCount = 0;
  bulkRequestedCount = selected.length;
  $("#openModal").classList.remove("hidden");
  renderBoxes();
  await startBulkQueueItem();
}

function showBulkRewards(items, failedCount = 0, requestedCount = items.length + failedCount) {
  activeBox = null;
  modalSpaceAction = null;
  const sortedItems = [...items].sort((a, b) => Number(b.originalValue || 0) - Number(a.originalValue || 0));
  const totalValue = sortedItems.reduce((sum, item) => sum + Number(item.originalValue || 0), 0);
  const title = requestedCount === 10 ? "10연 개봉 완료" : requestedCount === 1 ? "1회 개봉 완료" : `${requestedCount}연 개봉 완료`;
  $("#openModal").classList.remove("hidden");
  $("#openStage").innerHTML = `
    <div class="bulk-reward-card">
      <div class="reward-icon">🎁</div>
      <p class="eyebrow">OPEN RESULT</p>
      <h2>${title}</h2>
      <div class="bulk-reward-summary"><strong>총 원본 가치 ${money(totalValue)}</strong><span>높은 가치 순으로 정렬</span>${failedCount ? `<span>${failedCount}개는 개봉하지 못했습니다.</span>` : ""}</div>
      <div class="bulk-reward-list">${sortedItems.map((item, index) => `<div><span><b class="result-rank">#${index + 1}</b> ${item.name}</span><strong>${money(item.originalValue)}</strong></div>`).join("")}</div>
      <div class="bulk-reward-actions"><button id="bulkRewardClose" class="ghost">닫기</button><button id="bulkRewardItems" class="primary">아이템 보관함 보기</button></div>
    </div>`;
  const goItems = () => {
    modalSpaceAction = null;
    closeModal();
    selectTab("items");
    render();
  };
  modalSpaceAction = goItems;
  $("#bulkRewardClose").addEventListener("click", closeModal);
  $("#bulkRewardItems").addEventListener("click", goItems);
}

function renderItems() {
  $("#itemList").innerHTML = state.items.map((item) => {
    const currentValue = Number(item.currentValue ?? item.originalValue ?? 0);
    const dropped = currentValue < Number(item.originalValue || 0);
    return `
      <article class="item-card"><div class="box-art">🎁</div><h3>${item.name}</h3>
      <div class="item-current-value ${dropped && !isLimitedItem(item) ? "degraded" : ""}">${isLimitedItem(item) ? "<strong>한정판 · 판매 불가</strong>" : `현재 가치 <strong>${money(currentValue)}</strong>`}</div>
      <div class="meta">${itemValueDisplay(item)}<br>상태 ${item.conditionPercent}%<br>${item.id}</div></article>`;
  }).join("");
  $("#itemEmpty").classList.toggle("hidden", state.items.length > 0);
  $("#itemProtectionStatus").textContent = state.qualityManagerOwned
    ? `품질 자동 관리기 작동 중 · 가치 하락 방지 · 전기세 하루 ${money(state.qualityManagerDailyPower)}`
    : `자동 관리기 미보유 · 보관 물품은 하루 ${Math.round((state.itemDailyDecayRate || 0) * 100)}%씩 가치가 하락합니다.`;
  $("#itemProtectionStatus").classList.toggle("protected", Boolean(state.qualityManagerOwned));
}

function bankChaseDifficultyLabel(value) {
  const count = Math.max(1, Math.min(6, Math.trunc(Number(value || 1))));
  if (count <= 1) return "낮음";
  if (count === 2) return "보통";
  if (count === 3) return "높음";
  if (count === 4) return "매우 높음";
  if (count === 5) return "극한";
  return "최고 경계";
}

function updateBankChaseDurability(value) {
  const durability = Math.max(0, Math.min(100, Number(value || 0)));
  $("#bankChaseDurability").textContent = `${Math.round(durability)}%`;
  $("#bankChaseDurabilityBar").style.transform = `scaleX(${durability / 100})`;
}

function updateBankChaseDistance(distance, targetDistance = 1000) {
  const current = Math.min(Number(distance || 0), Number(targetDistance || 1000));
  $("#bankChaseDistance").textContent = `${Math.round(current).toLocaleString("ko-KR")} / ${Math.round(targetDistance).toLocaleString("ko-KR")}m`;
}

function flashBankChaseImpact(info = {}) {
  const labels = { police: "경찰차 충돌", rock: "돌더미 충돌", bus: "버스 충돌" };
  const el = $("#bankChaseImpact");
  el.textContent = `${labels[info.type] || "충돌"} · -${Number(info.damage || 0)} 내구도`;
  el.classList.remove("hidden");
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "bankImpact .48s ease both";
  clearTimeout(bankChaseImpactTimer);
  bankChaseImpactTimer = setTimeout(() => el.classList.add("hidden"), 500);
  playTone(62, .16, "sawtooth", .08, 0);
  playNoiseBurst(.12, .05, 0);
}

async function finalizeBankChase(outcome) {
  let result;
  try {
    result = await api.finishBankChase(Boolean(outcome?.success));
  } catch (error) {
    result = { ok: false, error: error?.message || "은행 도주 결과 저장에 실패했습니다." };
  }
  bankChaseActive = false;
  if (!result?.ok) {
    $("#bankChaseResult").classList.remove("hidden");
    $("#bankChaseResultTitle").textContent = "도주 결과 처리 오류";
    $("#bankChaseResultText").textContent = result?.error || "은행 도주 결과를 저장하지 못했습니다.";
    $("#bankChaseResultValue").textContent = "확인 필요";
    return;
  }
  state = result.state;
  render();
  const success = Boolean(result.success);
  const rewards = Array.isArray(result.rewards) ? result.rewards : [];
  const redDiamond = rewards.find((item) => item?.name === "레드 다이아몬드");
  $("#bankChaseResult").classList.remove("hidden");
  $("#bankChaseResultTitle").textContent = success ? (redDiamond ? "도주 성공 · 레드 다이아몬드!" : "도주 성공") : "오토바이 파손 · 습격 실패";
  $("#bankChaseResultText").textContent = success
    ? `금고 ${result.safeCount || bankChaseSafeCount}개를 무사히 가져왔습니다. 은신처에서 개봉해 물품 ${rewards.length}개를 확보했습니다${Number(result.emptyCount || 0) ? ` · 빈 금고 ${result.emptyCount}개` : ""}.${redDiamond ? " 판매 불가 한정판 레드 다이아몬드를 획득했습니다!" : ""}`
    : `오토바이 내구도가 0이 되어 도주에 실패했습니다. 들고 나오던 금고 ${result.lostSafes || bankChaseSafeCount}개를 전부 잃었습니다.`;
  $("#bankChaseResultValue").textContent = success
    ? `확보 가치 ${money(result.securedValue || 0)} · 금고 ${result.safeCount || bankChaseSafeCount}개`
    : `분실 금고 ${result.lostSafes || bankChaseSafeCount}개`;
}

async function startBankChase(chase = {}) {
  bankChaseSafeCount = Math.max(1, Math.min(6, Math.trunc(Number(chase.safeCount ?? state?.mission?.safeCarried ?? 1))));
  bankChaseLootValue = 0;
  currentMissionLoot = [...currentMissionLoot];
  bankChaseActive = true;
  document.exitPointerLock?.();
  syncMission3D(null);
  await setMissionFullscreen(true);
  $("#bankChaseLootValue").textContent = `${bankChaseSafeCount}개`;
  $("#bankChaseDifficulty").textContent = `추격 강도 · ${bankChaseDifficultyLabel(bankChaseSafeCount)}`;
  $("#bankChaseResult").classList.add("hidden");
  $("#bankChaseImpact").classList.add("hidden");
  $("#bankChase").classList.remove("hidden");
  updateBankChaseDurability(100);
  bankChaseGame?.stop?.();
  bankChaseGame = window.BankChaseGame?.create({
    canvas: $("#bankChaseCanvas"),
    safeCount: bankChaseSafeCount,
    audioContext: getAudioContext(),
    onDurability: updateBankChaseDurability,
    onDistance: updateBankChaseDistance,
    onImpact: flashBankChaseImpact,
    onFinish: finalizeBankChase,
  });
  if (!bankChaseGame) {
    bankChaseActive = false;
    return toast("오토바이 추격전 모듈을 불러오지 못했습니다.");
  }
  updateBankChaseDistance(0, bankChaseGame.getState?.().targetDistance || 850);
  bankChaseGame.start();
}

async function closeBankChaseResult() {
  if (bankChaseActive) return;
  bankChaseGame?.stop?.();
  $("#bankChase").classList.add("hidden");
  $("#bankChaseResult").classList.add("hidden");
  currentMissionLoot = [];
  bankChaseLootValue = 0;
  bankChaseSafeCount = 0;
  await setMissionFullscreen(false);
  goPhoneHome();
  render();
}

async function exitMissionAtWaypoint() {
  if (!state?.mission || missionSearchBusy) return;
  const engine = ensureMission3D();
  if (!engine?.isActive() || !engine.isExitNearby?.()) {
    toast("초록색 EXIT 웨이포인트까지 돌아가야 탈출할 수 있습니다.");
    return;
  }
  if (state.mission.missionType === "bank-finale" && Number(state.mission.safeOpened || 0) < 1) {
    toast("은행 금고를 최소 1개는 턴 뒤에 탈출할 수 있습니다.");
    return;
  }

  missionSearchBusy = true;
  engine.setSearching(true);
  const missionSnapshot = { ...(state.mission || {}) };
  const missionName = missionSnapshot.locationName || selectedMissionLocation()?.name || "파밍지";
  const lootSnapshot = currentMissionLoot.length ? [...currentMissionLoot] : [...missionLootFromState()];
  const result = await api.finishMission();
  missionSearchBusy = false;
  engine.setSearching(false);
  if (!result.ok) return toast(result.error || "탈출 처리에 실패했습니다.");
  state = result.state;
  if (result.bankChase) {
    currentMissionLoot = lootSnapshot;
    await startBankChase(result.chase || {});
    return;
  }
  render();
  showMissionResult(
    lootSnapshot,
    missionName,
    missionSnapshot.missionType === "bank-prep" ? "준비작업을 마치고 현장에서 복귀했습니다." : "EXIT를 통해 현장에서 복귀했습니다.",
    { allowPrepShortcut: missionSnapshot.missionType === "bank-prep", prepLocationId: "bank" }
  );
}

function handleMissionInteract() {
  if (!state?.mission) return;
  const engine = ensureMission3D();
  if (engine?.isActive() && engine.isSafeNearby?.() && state.mission.safe && !state.mission.safe.opened) {
    openMissionSafe();
    return;
  }
  if (engine?.isActive() && engine.isExitNearby?.()) {
    exitMissionAtWaypoint();
    return;
  }
  searchNode();
}

async function toggleMission(bankMode = "") {
  if (travelBusy) return;
  $("#missionButton")?.blur();
  if (state.mission) {
    return exitMissionAtWaypoint();
  }

  const location = state.farmLocations.find((entry) => entry.id === selectedFarmLocationId) || state.farmLocations[0];
  if (!isLocationUnlocked(location)) {
    return toast(`물류센터는 회사 등급 ${location.requiredCompanyGrade} 이상부터 이용할 수 있습니다.`);
  }

  travelBusy = true;
  getAudioContext();
  // 출발 버튼 클릭 제스처를 이용해 포인터 잠금을 미리 예약합니다.
  ensureMission3D()?.requestPointer?.();
  await setMissionFullscreen(true);
  renderMission();
  try {
    const travelView = missionTravelPresentation(location, bankMode);
    await showTravelLoading(location, travelView.displayName);
    await playMissionEntry(travelView.entryMapId, travelView.displayName);
    const result = await api.startMission(selectedFarmLocationId, bankMode);
    if (!result.ok) {
      await setMissionFullscreen(false);
      return toast(result.error);
    }
    state = result.state;
    currentMissionLoot = [];
    player = { x: 50, y: 48, speed: 0.065 };
    missionTimeoutHandled = false;
  } finally {
    travelBusy = false;
    $("#travelLoading").classList.add("hidden");
    $("#missionEntry").classList.add("hidden");
    render();
    requestAnimationFrame(() => {
      mission3D?.resize?.();
      mission3D?.requestPointer?.();
    });
  }
}


function updateBankUvUi() {
  if (!bankUvActive) return;
  const beam = $("#bankUvBeam");
  if (beam) beam.style.left = `${bankUvX * 100}%`;
  BANK_UV_TRACE_X.forEach((traceX, index) => {
    if (Math.abs(bankUvX - traceX) <= 0.075) bankUvRevealed[index] = true;
  });
  $$(".bank-uv-trace").forEach((el, index) => el.classList.toggle("revealed", Boolean(bankUvRevealed[index])));
  $("#bankUvDigits").innerHTML = bankUvRevealed.map((seen, index) => `<b>${seen ? bankUvCode[index] : "?"}</b>`).join("");
  const complete = bankUvRevealed.every(Boolean);
  const input = $("#bankUvCodeInput");
  const button = $("#bankUvConfirm");
  if (input) input.disabled = !complete;
  if (button) button.disabled = !complete || String(input?.value || "").length !== 4;
  const status = $("#bankUvStatus");
  if (status) {
    status.classList.toggle("complete", complete);
    if (complete) status.textContent = "숫자 4개 확인 완료 · 바로 비밀번호를 입력하세요.";
    else status.textContent = `UV 흔적 ${bankUvRevealed.filter(Boolean).length} / 4 발견 · 문 표면을 계속 훑어보세요.`;
  }
  if (complete && input && document.activeElement !== input && !input.dataset.autoFocused) {
    input.dataset.autoFocused = "1";
    requestAnimationFrame(() => input.focus());
  }
}

function setBankUvPosition(value) {
  bankUvX = Math.max(0.05, Math.min(0.95, Number(value) || 0.5));
  updateBankUvUi();
}

function openBankUvPuzzle() {
  if (!state?.mission || state.mission.missionType !== "bank-finale" || state.mission.bankDoorUnlocked) return;
  if (!state.uvLightOwned) return toast("UV 라이트가 준비되지 않았습니다.");
  if (document.pointerLockElement) document.exitPointerLock?.();
  bankUvActive = true;
  bankUvX = 0.5;
  bankUvCode = String(state.mission.bankCode || "0000").padStart(4, "0").slice(-4);
  bankUvRevealed = [false, false, false, false];
  $("#bankUvTraces").innerHTML = bankUvCode.split("").map((digit, index) => `<span class="bank-uv-trace" style="left:${BANK_UV_TRACE_X[index] * 100}%;top:${BANK_UV_TRACE_Y[index] * 100}%">${digit}</span>`).join("");
  $("#bankUvCodeInput").value = "";
  $("#bankUvCodeInput").disabled = true;
  delete $("#bankUvCodeInput").dataset.autoFocused;
  $("#bankUvStatus").className = "bank-uv-status";
  $("#bankUvModal").classList.remove("hidden");
  setBankUvPosition(0.5);
}

function closeBankUvPuzzle(relock = true) {
  bankUvActive = false;
  $("#bankUvModal").classList.add("hidden");
  if (relock && state?.mission) requestAnimationFrame(() => mission3D?.requestPointer?.());
}

async function confirmBankUvCode() {
  if (!bankUvActive || !bankUvRevealed.every(Boolean)) return;
  const code = String($("#bankUvCodeInput")?.value || "").replace(/\D/g, "").slice(0, 4);
  if (code.length !== 4) return;
  const button = $("#bankUvConfirm");
  if (button) button.disabled = true;
  const result = await api.unlockBankDoor(code);
  if (!result?.ok) {
    const status = $("#bankUvStatus");
    if (status) {
      status.className = "bank-uv-status error";
      status.textContent = result?.error || "비밀번호가 맞지 않습니다.";
    }
    playSafeRejectSound();
    if (button) button.disabled = false;
    return;
  }
  state = result.state;
  if (result.rewardCard && state?.mission?.missionType !== "bank-finale") currentMissionLoot.push(result.rewardCard);
  playTone(520, .13, "triangle", .065, 0);
  playTone(820, .22, "sine", .06, .08);
  closeBankUvPuzzle(false);
  render();
  toast("UV 라이트로 비밀번호를 확인했습니다. 은행 보안문이 열렸습니다.");
  requestAnimationFrame(() => mission3D?.requestPointer?.());
}

function handleMissionPrimaryAction() {
  if (state?.mission?.missionType === "regular" && state.mission.locationId === "abandoned_store" && !state.mission.storeDoorBroken) {
    throwBrickAtStoreDoor();
    return;
  }
  fireGunAtGuard();
}

async function throwBrickAtStoreDoor() {
  if (!state?.mission || state.mission.locationId !== "abandoned_store" || state.mission.storeDoorBroken || missionSearchBusy) return;
  if (!state.mission.storeBrickOwned) return;
  const engine = ensureMission3D();
  const door = engine?.aimedStoreDoor?.();
  if (!door) return;
  missionSearchBusy = true;
  engine?.setSearching(true);
  engine?.throwBrickFx?.(true);
  getAudioContext();
  playTone(190, .08, "square", .055, 0);
  await sleep(150);
  playGlassShatterSound();
  const result = await api.searchMissionNode(door.id);
  missionSearchBusy = false;
  engine?.setSearching(false);
  if (!result?.ok) return toast(result?.error || "유리문을 깨지 못했습니다.");
  state = result.state;
  render();
  toast("벽돌로 유리문을 깼습니다. 상가 내부로 진입할 수 있습니다.");
  requestAnimationFrame(() => mission3D?.requestPointer?.());
}

async function fireGunAtGuard() {
  const mission = state?.mission;
  const prepCombat = mission?.missionType === "bank-prep" && mission?.prepId === "guardWeakening";
  const finaleCombat = mission?.missionType === "bank-finale";
  if (!mission || (!prepCombat && !finaleCombat) || bankUvActive || missionSearchBusy) return;
  const total = mission.nodes.filter((node) => node.kind === "guard").length;
  if ((finaleCombat && !mission.bankDoorUnlocked) || Number(mission.guardsNeutralized || 0) >= total) return;
  const engine = ensureMission3D();
  const guard = engine?.aimedGuard?.();
  engine?.fireGunFx?.(Boolean(guard));
  getAudioContext();
  playTone(160, .045, "square", .05, 0);
  playTone(870, .08, "sawtooth", .045, .018);
  if (!guard) return;
  missionSearchBusy = true;
  engine?.setSearching(true);
  await sleep(110);
  const result = await api.shootBankGuard?.(guard.id, guard.hitZone || "body");
  missionSearchBusy = false;
  engine?.setSearching(false);
  if (!result?.ok) return toast(result?.error || "권총 사격 처리에 실패했습니다.");
  state = result.state;
  if (result.killed) {
    playTone(410, .08, "square", .06, 0);
    playTone(210, .13, "triangle", .055, .04);
  }
  render();
  const zoneName = result.hitZone === "head" ? "헤드샷" : "몸통";
  const status = result.killed ? "제압" : `HP ${result.guardHp}/${result.guardMaxHp}`;
  toast(`${zoneName} ${result.damage} 피해 · ${status} · 경비원 ${result.guardsNeutralized}/${result.guardTotal}`);
}

function beginMissionSearchPopup(label = "수색 대상") {
  const popup = $("#searchPopup");
  if (!popup) return;
  popup.className = "mission-search-popup loading";
  $("#searchPopupIcon").textContent = "⌕";
  // 파밍지 이름 대신 지금 직접 뒤지고 있는 오브젝트 이름을 중앙 팝업의 제목으로 표시합니다.
  $("#searchPopupTitle").textContent = label;
  $("#searchPopupDetail").textContent = "탐색 중...";
  const bar = $("#searchPopupBar");
  if (bar) {
    bar.style.animation = "none";
    void bar.offsetWidth;
    bar.style.animation = "";
  }
}

function missionSearchResultText(result, node) {
  const objectName = result?.searchedObject || node?.objectLabel || "수색 대상";
  if (!result?.ok) return { kind: "error", icon: "!", title: objectName, detail: result?.error || "탐색을 완료하지 못했습니다." };
  if (result.prepFound) return { kind: "found", icon: "✓", title: objectName, detail: result.prepDetail || result.rewardCard?.tierName || "목표 장비 확보" };
  if (result.storeAction === "brick") return { kind: "found", icon: "🧱", title: objectName, detail: "벽돌 획득 · 상가 유리문을 조준하고 좌클릭하세요." };
  if (result.storeAction === "glass-break") return { kind: "action", icon: "✦", title: objectName, detail: "유리문 파손 · 상가 내부로 진입할 수 있습니다." };
  if (result.bankAction === "door") return { kind: "action", icon: "UV", title: objectName, detail: "UV 라이트로 은행 출입문 비밀번호를 확인했습니다." };
  if (result.bankAction === "guard") return { kind: "action", icon: "🔫", title: objectName, detail: "권총 사격으로 제압했습니다." };
  if (result.bankAction === "safe-carried") return { kind: "found", icon: "🔐", title: objectName, detail: `금고 통째로 회수 · 현재 ${result.safeCount || 0}개 운반 중` };
  if (result.bankAction === "safe") return { kind: "action", icon: "🔐", title: objectName, detail: "청진기로 금고를 개방합니다." };
  if (result.box) return { kind: "found", icon: "📦", title: objectName, detail: `${result.box.tierName} 획득 · 상자 보관함에 저장` };
  return { kind: "empty", icon: "∅", title: objectName, detail: "아무것도 찾지 못했습니다." };
}

async function finishMissionSearchPopup(info, holdMs = 900) {
  const popup = $("#searchPopup");
  if (!popup) return;
  popup.className = `mission-search-popup result ${info.kind || "found"}`;
  $("#searchPopupIcon").textContent = info.icon || "✓";
  $("#searchPopupTitle").textContent = info.title || "탐색 완료";
  $("#searchPopupDetail").textContent = info.detail || "탐색이 완료되었습니다.";
  await sleep(holdMs);
  popup.classList.add("hidden");
}

async function searchNode() {
  if (missionSearchBusy || !state?.mission) return;
  const node = nearestNode();
  if (!node) return;
  if (state.mission.missionType === "regular" && state.mission.locationId === "abandoned_store" && node.kind === "store-door") {
    if (!state.mission.storeBrickOwned) toast("입구 근처 벽돌을 먼저 주우세요.");
    else toast("유리문을 화면 중앙에 조준하고 좌클릭으로 벽돌을 던지세요.");
    return;
  }
  if (state.mission.missionType === "bank-finale" && node.kind === "door") {
    openBankUvPuzzle();
    return;
  }
  if (state.mission.missionType === "bank-finale" && node.kind === "guard") {
    toast("경비원은 화면 중앙에 조준한 뒤 좌클릭으로 권총을 발사하세요.");
    return;
  }

  missionSearchBusy = true;
  mission3D?.setSearching(true);
  beginMissionSearchPopup(node.objectLabel || "수색 대상");
  $("#missionHint").textContent = "탐색 중...";

  await sleep(1250);
  const result = await api.searchMissionNode(node.id);
  const resultInfo = missionSearchResultText(result, node);
  await finishMissionSearchPopup(resultInfo, (result?.bankAction === "safe" || result?.bankAction === "safe-carried") ? 650 : 900);

  missionSearchBusy = false;
  mission3D?.setSearching(false);

  if (!result?.ok) {
    toast(result?.error || "탐색에 실패했습니다.");
    return refresh();
  }

  state = result.state;

  if (result.prepFound) playItemPickupSound(0, "gear");
  else if (result.box) playItemPickupSound(0, "box");
  else if (result.storeAction === "brick") playItemPickupSound(0, "gear");

  if (result.rewardCard && state?.mission?.missionType !== "bank-finale") currentMissionLoot.push(result.rewardCard);
  if (result.box) {
    currentMissionLoot.push(result.box);
    currentMissionLoot = currentMissionLoot.slice(-missionMaxBoxes());
  }

  if (result.bankAction === "safe-carried" && result.safeId) {
    currentMissionLoot.push({ id: result.safeId, tier: "safe", tierName: result.searchedObject || "은행 금고", name: result.searchedObject || "은행 금고", accent: "#ffd36e", carriedSafe: true });
    currentMissionLoot = currentMissionLoot.slice(-missionMaxBoxes());
  }

  if (result.bankAction === "safe" && result.safeId) {
    render();
    return openBankSafe(result.safeId);
  }

  if (result.exhausted || state.mission?.exhausted) {
    // 임무 진행/획득 결과는 중앙 탐색 팝업과 하단 임무 목표 HUD에서만 보여준다.
    // 구형 하단 토스트(예: "장비 확보 · 남은 목표...")는 중복 표시하지 않는다.
    render();
    return;
  }

  // 성공/진행 알림용 하단 토스트는 제거했다. 탐색 결과는 중앙 팝업,
  // 다음 행동은 임무 목표 HUD가 담당한다. 오류/조건 안내용 토스트만 유지한다.
  render();
}

function updatePlayer(dt) {
  const modalOpen = !$("#openModal").classList.contains("hidden");
  const engine = ensureMission3D();
  if (engine?.isActive()) {
    engine.setSearching(missionSearchBusy || modalOpen || missionResultVisible);
    engine.update(dt, keys);
    return;
  }
  if (!state?.mission || missionSearchBusy || modalOpen) return;
  let dx = 0, dy = 0;
  if (keys.has("w") || keys.has("arrowup")) dy -= 1;
  if (keys.has("s") || keys.has("arrowdown")) dy += 1;
  if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
  if (keys.has("d") || keys.has("arrowright")) dx += 1;
  if (dx || dy) {
    const length = Math.hypot(dx, dy) || 1;
    player.x = Math.max(3, Math.min(97, player.x + dx / length * player.speed * dt));
    player.y = Math.max(5, Math.min(94, player.y + dy / length * player.speed * dt));
    const el = $("#player");
    el.style.left = `${player.x}%`;
    el.style.top = `${player.y}%`;
    updateMissionHint();
  }
}

function animationLoop(now) {
  const dt = Math.min(40, now - lastFrame);
  lastFrame = now;
  updatePlayer(dt);
  updateSafeDial(dt, now);
  requestAnimationFrame(animationLoop);
}


async function buyCutter() {
  const result = await api.buyCutter();
  if (!result.ok) return toast(result.error);
  state = result.state;
  toast(result.alreadyOwned ? "이미 커터칼을 보유 중입니다." : "커터칼을 구매했습니다. 영구 사용 가능합니다.");
  render();
}

async function buyStethoscope() {
  const result = await api.buyStethoscope();
  if (!result.ok) return toast(result.error);
  state = result.state;
  toast(result.alreadyOwned ? "이미 청진기를 보유 중입니다." : "청진기를 구매했습니다. 금고에서 영구 사용 가능합니다.");
  render();
}

async function buyQualityManager() {
  const result = await api.buyQualityManager();
  if (!result.ok) return toast(result.error);
  state = result.state;
  toast(result.alreadyOwned ? "이미 품질 자동 관리기를 보유 중입니다." : "품질 자동 관리기를 구매했습니다. 보관 물품 가치가 보호됩니다.");
  render();
}

async function buyCart() {
  const result = await api.buyCart();
  if (!result.ok) return toast(result.error);
  state = result.state;
  toast(result.alreadyOwned ? "이미 리어카를 보유 중입니다." : "리어카를 구매했습니다. 모든 파밍지의 최대 회수량이 2칸 늘어납니다.");
  render();
}

async function openBox(boxId) {
  const box = state.boxes.find((entry) => entry.id === boxId);
  if (!box) return;

  if (box.tier !== "safe" && !state.cutterOwned) {
    toast("커터칼이 필요합니다. 장비 상점으로 이동했습니다.");
    selectTab("shop");
    $("#buyCutter")?.focus();
    return;
  }
  if (box.tier === "safe" && !state.stethoscopeOwned) {
    toast("청진기가 필요합니다. 장비 상점으로 이동했습니다.");
    selectTab("shop");
    $("#buyStethoscope")?.focus();
    return;
  }

  const result = await api.startBoxOpen(boxId);
  if (!result.ok) return toast(result.error);
  revealGateBusy = false;
  activeBox = box;
  activePreviewGlow = result.previewGlow || (box.tier === "safe" ? "safe" : "normal");
  $("#openModal").classList.remove("hidden");
  if (box.tier === "safe") renderSafe(result);
  else {
    cutStep = 0;
    renderRegularOpen();
  }
}

function regularInstruction() {
  const messages = [
    "1단계 · 앞면 테이프를 자릅니다.",
    "2단계 · 반대편 옆면 테이프를 자릅니다.",
    "3단계 · 상단 테이프를 자르면 상자가 열립니다.",
  ];
  return messages[Math.min(cutStep, 2)];
}

function renderRegularOpen() {
  cutBusy = false;
  skipBusy = false;
  const step = Math.min(cutStep, 2);
  const buttonLabels = [
    "🔪 1단계 테이프 자르기",
    "🔪 2단계 테이프 자르기",
    "📦 마지막 테이프 개방하기",
  ];
  const progress = [0, 33, 66][step];
  const queueTitle = bulkOpenBusy ? `${bulkEventTitle(bulkRequestedCount)} · ${bulkQueueIndex + 1} / ${bulkRequestedCount}` : activeBox.tierName;
  const queueSub = bulkOpenBusy
    ? `${activeBox.tierName} · 선택했더라도 이 상자는 직접 진행합니다.`
    : "3단계를 직접 진행하세요. 빛은 마지막 테이프를 개방하는 순간에만 나타납니다.";
  const queueDots = bulkOpenBusy ? `<div class="queue-dots">${renderQueueDots(bulkRequestedCount, bulkQueueIndex)}</div>` : "";

  $("#openStage").innerHTML = `
    <div class="opening-title intuitive-title">
      <div class="opening-title-row"><div><p class="eyebrow">OPEN EVENT</p><h2>${queueTitle}</h2></div><button id="skipCurrentBox" class="ghost open-skip-button" type="button">${bulkOpenBusy ? "⏭ 남은 연출 스킵" : "⏭ 스킵"}</button></div>
      <p>${queueSub}</p>
    </div>
    <div class="quick-open-wrap">
      ${quickBoxMarkup(step, activePreviewGlow)}
      <div class="step-row">${renderStepRow(step)}</div>
      <div class="open-progress"><span style="width:${progress}%"></span></div>
      <div id="openInstruction" class="open-instruction"><strong>${regularInstruction()}</strong><br><span>상자 그림, 큰 버튼 또는 SPACE로 직접 진행하세요.</span></div>
      <button id="cutButton" class="primary quick-cut-button" type="button">${buttonLabels[step]}</button>
      <div class="keyboard-hint">SPACE · 진행 &nbsp; | &nbsp; ${bulkOpenBusy ? "스킵 · 남은 상자 연출 전체 생략" : "스킵 · 현재 상자 연출 생략"}</div>
      ${queueDots}
    </div>`;
  modalSpaceAction = performQuickCut;
  $("#cutButton").addEventListener("click", performQuickCut);
  $("#quickBox").addEventListener("click", performQuickCut);
  $("#skipCurrentBox").addEventListener("click", skipCurrentBoxOpen);
}

function showRegularRevealGate(item, nextState) {
  state = nextState;
  activeBox = null;
  cutBusy = false;
  revealGateBusy = true;
  render();

  const total = bulkRequestedCount || bulkQueue.length;
  const queueTitle = bulkOpenBusy
    ? `${bulkEventTitle(total)} · ${bulkQueueIndex + 1} / ${total}`
    : "상자 개봉 완료";
  const queueDots = bulkOpenBusy ? `<div class="queue-dots">${renderQueueDots(total, bulkQueueIndex)}</div>` : "";

  $("#openStage").innerHTML = `
    <div class="opening-title intuitive-title final-gate-title">
      <p class="eyebrow">OPEN COMPLETE</p>
      <h2>${queueTitle}</h2>
      <p>빛을 확인한 뒤 클릭하거나 SPACE를 눌러 결과를 확인하세요.</p>
    </div>
    <div class="quick-open-wrap final-gate-wrap">
      ${quickBoxMarkup(2, activePreviewGlow, "📦", "final-reveal reveal-hold", "OPEN")}
      <button id="finalRevealContinue" class="primary reveal-continue-button" type="button">결과 확인 (SPACE)</button>
      ${queueDots}
    </div>`;

  let handled = false;
  const proceed = () => {
    if (handled) return;
    handled = true;
    modalSpaceAction = null;
    revealGateBusy = false;
    if (bulkOpenBusy) revealBulkReward(item, nextState);
    else revealReward(item, nextState);
  };
  modalSpaceAction = proceed;
  $("#finalRevealContinue").addEventListener("click", proceed);
  $("#quickBox").addEventListener("click", proceed);
}

async function performQuickCut() {
  if (!activeBox || cutBusy || revealGateBusy || skipBusy) return;
  getAudioContext();
  cutBusy = true;
  modalSpaceAction = null;
  const boxId = activeBox.id;
  const currentStep = cutStep;
  const cutButton = $("#cutButton");
  const quickBox = $("#quickBox");
  if (cutButton) {
    cutButton.disabled = true;
    cutButton.textContent = currentStep >= 2 ? "마지막 테이프 개방 중..." : "테이프 자르는 중...";
  }
  quickBox?.classList.add("cutting");

  if (currentStep >= 2) {
    playBoxOpeningSound();
    await sleep(260);
    quickBox?.classList.add("final-reveal");
    playGlowSound(activePreviewGlow);
    await sleep(520);
  } else {
    playNoiseBurst(0.12, 0.026, 0);
    await sleep(340);
  }

  if (!activeBox || activeBox.id !== boxId) {
    cutBusy = false;
    return;
  }

  const result = await api.completeCut(boxId, currentStep);
  if (!result.ok) {
    cutBusy = false;
    toast(result.error);
    return renderRegularOpen();
  }
  if (result.opened) {
    return showRegularRevealGate(result.item, result.state);
  }
  cutStep = result.cutStep;
  renderRegularOpen();
}

async function skipCurrentBoxOpen() {
  if (!activeBox || activeBox.tier === "safe" || cutBusy || revealGateBusy || skipBusy) return;
  skipBusy = true;
  cutBusy = true;
  modalSpaceAction = null;
  const currentBoxId = activeBox.id;
  const skipButton = $("#skipCurrentBox");
  if (skipButton) {
    skipButton.disabled = true;
    skipButton.textContent = bulkOpenBusy ? "남은 상자 정리 중..." : "스킵 중...";
  }

  const finishStartedBoxSilently = async (boxId, startStep) => {
    let finalResult = null;
    for (let step = startStep; step < 3; step += 1) {
      finalResult = await api.completeCut(boxId, step);
      if (!finalResult.ok) break;
    }
    return finalResult;
  };

  let result = await finishStartedBoxSilently(currentBoxId, cutStep);
  if (!result?.ok) {
    cutBusy = false;
    skipBusy = false;
    toast(result?.error || "개봉 스킵에 실패했습니다.");
    return refresh();
  }

  if (!bulkOpenBusy) {
    cutBusy = false;
    skipBusy = false;
    if (result.opened) revealReward(result.item, result.state);
    else refresh();
    return;
  }

  if (result.opened) {
    bulkOpenedItems.push(result.item);
    state = result.state;
  } else {
    bulkFailedCount += 1;
  }
  bulkQueueIndex += 1;

  while (bulkQueueIndex < bulkQueue.length) {
    const queued = bulkQueue[bulkQueueIndex];
    const box = state.boxes.find((entry) => entry.id === queued.id && entry.tier !== "safe");
    if (!box) {
      bulkQueueIndex += 1;
      continue;
    }
    const startResult = await api.startBoxOpen(box.id);
    if (!startResult.ok || startResult.type === "safe") {
      bulkFailedCount += 1;
      bulkQueueIndex += 1;
      continue;
    }
    result = await finishStartedBoxSilently(box.id, 0);
    if (result?.ok && result.opened) {
      bulkOpenedItems.push(result.item);
      state = result.state;
    } else {
      bulkFailedCount += 1;
    }
    bulkQueueIndex += 1;
  }

  cutBusy = false;
  skipBusy = false;
  if (bulkOpenedItems.length) {
    const bestValue = Math.max(...bulkOpenedItems.map((item) => Number(item?.originalValue || item?.currentValue || 0)));
    playItemPickupSound(bestValue, "item");
  }
  await finishBulkQueue();
}

function currentSafeTarget() {
  if (activeMissionSafe) return { id: activeMissionSafe.id, mission: true };
  if (activeBox?.tier === "safe") return { id: activeBox.id, mission: false };
  return null;
}

function safeMinigameActive() {
  return Boolean(currentSafeTarget()) && !revealGateBusy && !$("#openModal").classList.contains("hidden");
}

async function openMissionSafe() {
  if (!state?.mission?.safe || state.mission.safe.opened || missionSearchBusy) return;
  if (!state.stethoscopeOwned) {
    toast("이 금고를 열려면 청진기가 필요합니다.");
    return;
  }
  const safeId = state.mission.safe.id;
  missionSearchBusy = true;
  mission3D?.setSearching(true);
  const result = await api.startMissionSafe(safeId);
  missionSearchBusy = false;
  mission3D?.setSearching(false);
  if (!result?.ok) return toast(result?.error || "금고를 조사하지 못했습니다.");
  if (document.pointerLockElement) document.exitPointerLock?.();
  activeBox = null;
  activeMissionSafe = { ...state.mission.safe, id: safeId };
  activePreviewGlow = result.previewGlow || "safe";
  if (result.state) state = result.state;
  $("#openModal").classList.remove("hidden");
  renderSafe(result);
}

async function openBankSafe(safeId) {
  if (!state?.mission || missionSearchBusy) return;
  missionSearchBusy = true;
  mission3D?.setSearching(true);
  const result = await api.startMissionSafe(safeId);
  missionSearchBusy = false;
  mission3D?.setSearching(false);
  if (!result?.ok) return toast(result?.error || "은행 금고를 조사하지 못했습니다.");
  if (document.pointerLockElement) document.exitPointerLock?.();
  activeBox = null;
  activeMissionSafe = { id: safeId, opened: false };
  activePreviewGlow = result.previewGlow || "safe";
  if (result.state) state = result.state;
  $("#openModal").classList.remove("hidden");
  renderSafe(result);
}

function resumeMissionAfterSafe() {
  revealGateBusy = false;
  modalSpaceAction = null;
  safeHoldStartedAt = { a: 0, d: 0 };
  keys.delete("a");
  keys.delete("d");
  activeMissionSafe = null;
  activeBox = null;
  $("#openModal").classList.add("hidden");
  render();
  requestAnimationFrame(() => mission3D?.requestPointer?.());
}

function showMissionSafeReward(item, nextState) {
  state = nextState;
  activeMissionSafe = null;
  revealGateBusy = false;
  if (item) {
    playItemPickupSound(item.originalValue || item.currentValue || 0, "item");
    currentMissionLoot.push(makeMissionRecord(`${item.name} · ${isLimitedItem(item) ? "한정판 · 판매 불가" : money(item.originalValue)}`, "#ffd966", "safe"));
  }
  else currentMissionLoot.push(makeMissionRecord("꽝 · 빈 금고", "#6f7882", "empty"));
  render();
  $("#openStage").innerHTML = item ? `
      <div class="reward-card mission-safe-reward safe-opened-result">
        <div class="reward-icon">💎</div>
        <p class="eyebrow">BANK SAFE OPEN</p>
        <h2>${item.name}</h2>
        <div class="reward-value">${itemValueDisplay(item)}</div>
        <p class="meta">금고 문이 열렸습니다. 획득 기록은 왼쪽 임무 사이드바에도 추가되었습니다.</p>
        <button id="missionSafeContinue" class="primary">임무 계속하기 (SPACE)</button>
      </div>` : `
      <div class="reward-card mission-safe-reward safe-opened-result empty-safe-result">
        <div class="reward-icon">∅</div>
        <p class="eyebrow">BANK SAFE OPEN</p>
        <h2>꽝</h2>
        <div class="reward-value">금고 안이 비어 있습니다.</div>
        <p class="meta">빈 금고도 개방 횟수에 포함됩니다. 결과는 왼쪽 임무 사이드바에 기록되었습니다.</p>
        <button id="missionSafeContinue" class="primary">임무 계속하기 (SPACE)</button>
      </div>`;
  modalSpaceAction = resumeMissionAfterSafe;
  $("#missionSafeContinue").addEventListener("click", resumeMissionAfterSafe);
}

function normalizeSafeDial(value) {
  const n = Number(value) || 0;
  return ((n % 100) + 100) % 100;
}

function currentSafeDialInteger() {
  return Math.round(normalizeSafeDial(safeDialPosition)) % 100;
}

function renderSafePins() {
  const row = $("#safeLockPins");
  if (!row) return;
  row.innerHTML = Array.from({ length: safeDialTotal }, (_, index) => {
    const cls = index < safeDialStage ? "done" : index === safeDialStage ? "active" : "pending";
    return `<span class="safe-lock-pin ${cls}">${index < safeDialStage ? "✓" : index + 1}</span>`;
  }).join("");
  const progress = $("#safeLockProgress");
  if (progress) progress.textContent = `${Math.min(safeDialStage + 1, safeDialTotal)} / ${safeDialTotal}`;
}

function updateSafeDialDom() {
  const number = currentSafeDialInteger();
  const wheel = $("#safeDialWheel");
  const readout = $("#safeDialNumber");
  if (wheel) wheel.style.transform = `rotate(${-safeDialPosition * 3.6}deg)`;
  if (readout) readout.textContent = String(number).padStart(2, "0");
}

async function checkSafeDialContact(dialNumber) {
  const target = currentSafeTarget();
  if (!target || revealGateBusy) return;
  const targetId = target.id;
  try {
    const result = target.mission
      ? await api.missionSafeListen(targetId, dialNumber)
      : await api.safeListen(targetId, dialNumber);
    const currentTarget = currentSafeTarget();
    if (!result?.ok || !currentTarget || currentTarget.id !== targetId || result.stage !== safeDialStage) return;
    if (result.hit) {
      if (!safeContactLatched || safeLastContactStage !== result.stage || safeLastContactValue !== dialNumber) {
        safeContactLatched = true;
        safeLastContactStage = result.stage;
        safeLastContactValue = dialNumber;
        playSafeContactSound();
        const wheel = $("#safeDialAssembly");
        wheel?.classList.remove("contact-hit");
        void wheel?.offsetWidth;
        wheel?.classList.add("contact-hit");
      }
    } else if (dialNumber === currentSafeDialInteger()) {
      safeContactLatched = false;
    }
  } catch {
    // 청음 피드백 실패는 다이얼 조작 자체를 막지 않습니다.
  }
}

function setSafeDialPosition(value, listen = true) {
  safeDialPosition = Number(value) || 0;
  updateSafeDialDom();
  const current = currentSafeDialInteger();
  if (listen && current !== safeLastDialInteger) {
    safeLastDialInteger = current;
    checkSafeDialContact(current);
  }
}

function safeDialKeyDown(key) {
  if (!safeMinigameActive()) return;
  if (key !== "a" && key !== "d") return;
  getAudioContext();
  if (!safeHoldStartedAt[key]) safeHoldStartedAt[key] = performance.now();
  const direction = key === "a" ? -1 : 1;
  setSafeDialPosition(safeDialPosition + direction, true);
  playSafeDialRattle();
  safeRattleAt = performance.now();
}

function safeDialKeyUp(key) {
  if (key === "a" || key === "d") safeHoldStartedAt[key] = 0;
}

function updateSafeDial(dt, now) {
  if (!safeMinigameActive()) return;
  const aHeld = keys.has("a") && safeHoldStartedAt.a > 0;
  const dHeld = keys.has("d") && safeHoldStartedAt.d > 0;
  if (aHeld === dHeld) return;

  const key = aHeld ? "a" : "d";
  const direction = aHeld ? -1 : 1;
  const heldFor = now - safeHoldStartedAt[key];
  if (heldFor < 180) return;

  const speed = heldFor < 450 ? 7 : 20;
  setSafeDialPosition(safeDialPosition + direction * speed * (dt / 1000), true);
  if (now - safeRattleAt >= 72) {
    playSafeDialRattle();
    safeRattleAt = now;
  }
}

// SD_SAFE_MOUSE_DIAL_V1
function safeDialPointerAngle(event, element) {
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  return Math.atan2(event.clientY - centerY, event.clientX - centerX);
}

function startSafeDialDrag(event) {
  if (!safeMinigameActive()) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const surface = event.currentTarget;
  if (!surface) return;

  event.preventDefault();
  getAudioContext();
  safeDialDrag = {
    pointerId: event.pointerId,
    lastAngle: safeDialPointerAngle(event, surface),
  };
  surface.setPointerCapture?.(event.pointerId);
  surface.classList.add("dragging");
  surface.style.cursor = "grabbing";
}

function moveSafeDialDrag(event) {
  const drag = safeDialDrag;
  if (!drag || drag.pointerId !== event.pointerId || !safeMinigameActive()) return;
  const surface = event.currentTarget;
  if (!surface) return;

  event.preventDefault();
  const angle = safeDialPointerAngle(event, surface);
  let delta = angle - drag.lastAngle;
  if (delta > Math.PI) delta -= Math.PI * 2;
  else if (delta < -Math.PI) delta += Math.PI * 2;
  drag.lastAngle = angle;

  if (Math.abs(delta) < 0.0001) return;
  const dialDelta = -(delta / (Math.PI * 2)) * 100;
  setSafeDialPosition(safeDialPosition + dialDelta, true);

  const now = performance.now();
  if (now - safeRattleAt >= 72) {
    playSafeDialRattle();
    safeRattleAt = now;
  }
}

function stopSafeDialDrag(event) {
  const drag = safeDialDrag;
  if (!drag) return;
  if (event?.pointerId != null && drag.pointerId !== event.pointerId) return;

  safeDialDrag = null;
  const surface = event?.currentTarget || document.querySelector("#safeDialAssembly .safe-dial-shell");
  if (!surface) return;
  surface.classList.remove("dragging");
  surface.style.cursor = "grab";
  try {
    if (surface.hasPointerCapture?.(drag.pointerId)) {
      surface.releasePointerCapture(drag.pointerId);
    }
  } catch {
    // DOM 교체가 먼저 포인터 캡처를 해제한 경우입니다.
  }
}

function bindSafeDialPointerControls() {
  const surface = document.querySelector("#safeDialAssembly .safe-dial-shell");
  if (!surface) return;
  surface.style.touchAction = "none";
  surface.style.userSelect = "none";
  surface.style.cursor = "grab";
  surface.addEventListener("pointerdown", startSafeDialDrag);
  surface.addEventListener("pointermove", moveSafeDialDrag);
  surface.addEventListener("pointerup", stopSafeDialDrag);
  surface.addEventListener("pointercancel", stopSafeDialDrag);
  surface.addEventListener("lostpointercapture", stopSafeDialDrag);
}

function renderSafe(session) {
  safeDialPosition = 0;
  safeDialStage = Number(session.stage || 0);
  safeDialTotal = Number(session.totalLocks || 1);
  safeHoldStartedAt = { a: 0, d: 0 };
  safeLastDialInteger = null;
  safeContactLatched = false;
  safeLastContactStage = -1;
  safeLastContactValue = null;
  safeRattleAt = 0;
  safeDialDrag = null;
  modalSpaceAction = confirmSafeDial;

  const theme = glowTheme(activePreviewGlow || session.previewGlow || "safe");
  $("#openStage").innerHTML = `
    <div class="opening-title"><p class="eyebrow">STETHOSCOPE</p><h2>금고 다이얼 청음</h2><p>A / D 또는 마우스로 다이얼을 직접 잡아 돌리고, 걸리는 소리를 기억한 뒤 SPACE로 현재 번호를 확정하세요.</p></div>
    <div class="safe-stage safe-preview safe-dial-stage" style="--safe-glow:${theme.color};--safe-soft:${theme.soft};--safe-deep:${theme.deep};">
      <div id="safeDialAssembly" class="safe-dial-assembly">
        <div class="safe-dial-pointer"></div>
        <div class="safe-dial-shell">
          <div id="safeDialWheel" class="safe-dial-wheel">
            ${Array.from({ length: 10 }, (_, index) => `<span class="safe-dial-label" style="--i:${index}">${index * 10}</span>`).join("")}
          </div>
          <div class="safe-dial-hub"><span>🩺</span><strong id="safeDialNumber">00</strong></div>
        </div>
      </div>
      <div class="safe-help safe-dial-help">
        <div class="safe-lock-header"><h3>소리를 듣고 찾으세요</h3><b id="safeLockProgress">1 / ${safeDialTotal}</b></div>
        <p>다이얼을 돌리면 금속 마찰음이 이어집니다. 정확한 위치를 지날 때만 짧게 <strong>탁</strong> 하고 걸립니다. 자동 성공은 아니며, 그 번호에 맞춘 뒤 직접 SPACE를 눌러야 합니다.</p>
        <div id="safeLockPins" class="safe-lock-pins"></div>
        <div class="safe-control-grid"><span><kbd>A</kbd> 왼쪽</span><span><kbd>D</kbd> 오른쪽</span><span><kbd>🖱</kbd> 잡고 회전</span><span><kbd>SPACE</kbd> 확정</span></div>
        <p class="safe-no-limit">A/D를 짧게 누르면 1칸, 꾹 누르면 연속 회전합니다. 마우스는 다이얼을 잡은 채 원을 그리듯 돌리면 됩니다. 확정 횟수 제한은 없습니다.</p>
        <div id="safeDialStatus" class="safe-dial-status">청진기에 집중해서 걸림 위치를 찾으세요.</div>
        <button id="safeConfirmButton" class="torque-button">현재 위치 확정 (SPACE)</button>
      </div>
    </div>`;
  updateSafeDialDom();
  renderSafePins();
  bindSafeDialPointerControls();
  $("#safeConfirmButton").addEventListener("click", confirmSafeDial);
}

function showSafeRevealGate(item, nextState, options = {}) {
  const missionSafe = Boolean(options.missionSafe);
  state = nextState;
  activeBox = null;
  revealGateBusy = true;
  safeHoldStartedAt = { a: 0, d: 0 };
  keys.delete("a");
  keys.delete("d");
  render();
  const theme = glowTheme(activePreviewGlow || "safe");
  $("#openStage").innerHTML = `
    <div class="opening-title final-gate-title"><p class="eyebrow">SAFE OPEN</p><h2>금고 개방 완료</h2><p>빛을 확인한 뒤 클릭하거나 SPACE를 눌러 결과를 확인하세요.</p></div>
    <div class="safe-stage safe-preview revealing reveal-hold" style="--safe-glow:${theme.color};--safe-soft:${theme.soft};--safe-deep:${theme.deep};">
      <button id="safeRevealDoor" class="safe-door preview-glow safe-reveal-door" type="button" aria-label="결과 확인"><div class="lock-cylinder opened-cylinder"></div></button>
      <div class="safe-help safe-finish-help"><h3>개방 완료</h3><p>빛을 확인한 뒤 진행하세요.</p><button id="safeRevealContinue" class="primary reveal-continue-button" type="button">결과 확인 (SPACE)</button></div>
    </div>`;

  let handled = false;
  const proceed = () => {
    if (handled) return;
    handled = true;
    modalSpaceAction = null;
    revealGateBusy = false;
    if (missionSafe) showMissionSafeReward(item, nextState);
    else revealReward(item, nextState);
  };
  modalSpaceAction = proceed;
  $("#safeRevealContinue").addEventListener("click", proceed);
  $("#safeRevealDoor").addEventListener("click", proceed);
}

async function confirmSafeDial() {
  const target = currentSafeTarget();
  if (!target || revealGateBusy) return;
  getAudioContext();
  const button = $("#safeConfirmButton");
  if (button) button.disabled = true;
  const result = target.mission
    ? await api.missionSafeAttempt(target.id, currentSafeDialInteger())
    : await api.safeAttempt(target.id, currentSafeDialInteger());
  if (button) button.disabled = false;
  if (!result.ok) return toast(result.error);

  const status = $("#safeDialStatus");
  if (!result.correct) {
    playSafeRejectSound();
    status && (status.textContent = "잠금이 걸리지 않았습니다. 계속 돌려서 걸림음을 다시 찾으세요.");
    const assembly = $("#safeDialAssembly");
    assembly?.classList.remove("wrong-confirm");
    void assembly?.offsetWidth;
    assembly?.classList.add("wrong-confirm");
    return;
  }

  playSafeLatchSound();
  safeDialStage = Number(result.stage || 0);
  safeContactLatched = false;
  safeLastContactStage = -1;
  safeLastContactValue = null;
  safeLastDialInteger = currentSafeDialInteger();
  renderSafePins();

  if (result.opened) {
    modalSpaceAction = null;
    safeHoldStartedAt = { a: 0, d: 0 };
    keys.delete("a");
    keys.delete("d");
    const confirmButton = $("#safeConfirmButton");
    if (confirmButton) {
      confirmButton.disabled = true;
      confirmButton.textContent = "금고 잠금 해제";
    }
    status && (status.textContent = "잠금이 풀렸습니다. 금고 문이 열립니다.");
    playSafeOpeningSound();
    const safeStage = document.querySelector(".safe-preview");
    await sleep(180);
    safeStage?.classList.add("revealing");
    playGlowSound(activePreviewGlow);
    await sleep(520);
    if (target.mission) return showMissionSafeReward(result.item || null, result.state);
    return showSafeRevealGate(result.item, result.state, { missionSafe: false });
  }

  status && (status.textContent = `철컥. 다음 걸림 위치를 찾으세요. (${safeDialStage + 1}/${safeDialTotal})`);
}

function revealReward(item, nextState) {
  revealGateBusy = false;
  modalSpaceAction = null;
  state = nextState;
  playItemPickupSound(item?.originalValue || item?.currentValue || 0, "item");
  activeBox = null;
  render();
  $("#openStage").innerHTML = `<div class="reward-card"><div class="reward-icon">🎁</div><p class="eyebrow">ITEM FOUND</p><h2>${item.name}</h2><div class="reward-value">${itemValueDisplay(item)}</div><p class="meta">아이템은 이미 보관함에 저장됐고, 개봉한 상자는 즉시 상자 보관함에서 제거됩니다.</p><button id="rewardClose" class="primary">아이템 보관함 보기</button></div>`;
  const goItems = () => {
    modalSpaceAction = null;
    closeModal();
    selectTab("items");
    render();
  };
  modalSpaceAction = goItems;
  $("#rewardClose").addEventListener("click", goItems);
}

function closeModal() {
  if (activeMissionSafe) {
    resumeMissionAfterSafe();
    return;
  }
  revealGateBusy = false;
  modalSpaceAction = null;
  skipBusy = false;
  safeHoldStartedAt = { a: 0, d: 0 };
  keys.delete("a");
  keys.delete("d");
  if (bulkOpenBusy) {
    cancelBulkQueue();
    return;
  }
  cutBusy = false;
  $("#openModal").classList.add("hidden");
  activeBox = null;
  render();
}

function bindEvents() {
  $$(".phone-app").forEach((btn) => btn.addEventListener("click", () => selectTab(btn.dataset.app)));
  $("#homeButton").addEventListener("click", goPhoneHome);
  $("#refreshCompany")?.addEventListener("click", refreshCompanyNow);
  $("#refreshInventory")?.addEventListener("click", refreshOnlineInventoryNow);
  $("#missionButton").addEventListener("click", () => toggleMission(""));
  $("#bankMissionButton").addEventListener("click", () => {
    const prep = state?.bankPrep || {};
    toggleMission(prep.equipment ? "guardWeakening" : "equipment");
  });
  $("#bankFinaleButton").addEventListener("click", () => toggleMission("finale"));
  $("#missionReturnButton").addEventListener("click", () => toast("초록색 EXIT 웨이포인트로 돌아가 E를 눌러 탈출하세요."));
  $("#missionResult").addEventListener("click", (event) => {
    if (event.target.closest("#missionResultContinuePrep")) return;
    finishMissionResult();
  });
  $("#missionResultReturn").addEventListener("click", () => finishMissionResult("phone"));
  $("#missionResultContinuePrep").addEventListener("click", (event) => {
    event.stopPropagation();
    finishMissionResult("prep");
  });
  $("#buyCutter").addEventListener("click", buyCutter);
  $("#buyStethoscope").addEventListener("click", buyStethoscope);
  $("#buyQualityManager").addEventListener("click", buyQualityManager);
  $("#buyCart").addEventListener("click", buyCart);
  $("#farmLocations").addEventListener("click", (event) => {
    const card = event.target.closest("[data-location-id]");
    if (card) selectFarmLocation(card.dataset.locationId);
  });
  $("#boxList").addEventListener("click", (event) => {
    const checkbox = event.target.closest(".box-select-input");
    if (checkbox) {
      toggleRegularBoxSelection(checkbox.dataset.id, checkbox.checked);
      return;
    }
    const btn = event.target.closest(".open-box");
    if (btn) openBox(btn.dataset.id);
  });
  $("#tierSelectButtons").addEventListener("click", (event) => {
    const button = event.target.closest("[data-tier-select]");
    if (button) toggleTierSelection(button.dataset.tierSelect);
  });
  $("#selectAllRegular").addEventListener("click", selectAllRegularBoxes);
  $("#clearBoxSelection").addEventListener("click", clearRegularBoxSelection);
  $("#bulkOpenBoxes").addEventListener("click", bulkOpenSelectedBoxes);
  $("#closeModal").addEventListener("click", closeModal);
  $("#openModal").addEventListener("click", (event) => {
    if (event.target.id === "openModal") closeModal();
  });
  $("#bankUvClose").addEventListener("click", () => closeBankUvPuzzle());
  $("#bankUvSurface").addEventListener("mousemove", (event) => {
    if (!bankUvActive) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setBankUvPosition((event.clientX - rect.left) / Math.max(1, rect.width));
  });
  $("#bankUvCodeInput").addEventListener("input", (event) => {
    event.target.value = String(event.target.value || "").replace(/\D/g, "").slice(0, 4);
    updateBankUvUi();
  });
  $("#bankUvConfirm").addEventListener("click", confirmBankUvCode);
  $("#bankChaseReturn").addEventListener("click", closeBankChaseResult);

  $("#devReset").addEventListener("click", async () => {
    const result = await api.devReset();
    if (result.ok) {
      state = result.state;
      currentMissionLoot = [];
      revealGateBusy = false;
      render();
      toast("개발 데이터를 초기화했습니다.");
    }
  });
  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (bankChaseActive) {
      const handled = bankChaseGame?.handleKey?.(event);
      if (handled) event.preventDefault();
      return;
    }
    if (bankUvActive) {
      event.preventDefault();
      if (event.key === "Escape") return closeBankUvPuzzle();
      if (key === "a") return setBankUvPosition(bankUvX - (event.repeat ? 0.025 : 0.04));
      if (key === "d") return setBankUvPosition(bankUvX + (event.repeat ? 0.025 : 0.04));
      const uvInput = $("#bankUvCodeInput");
      const uvComplete = bankUvRevealed.every(Boolean);
      if (uvComplete && /^\d$/.test(event.key) && !event.repeat) {
        uvInput.value = `${uvInput.value || ""}${event.key}`.slice(0, 4);
        return updateBankUvUi();
      }
      if (uvComplete && event.key === "Backspace" && !event.repeat) {
        uvInput.value = String(uvInput.value || "").slice(0, -1);
        return updateBankUvUi();
      }
      if (uvComplete && event.key === "Enter" && !event.repeat) return confirmBankUvCode();
      return;
    }
    keys.add(key);
    const modalOpen = !$("#openModal").classList.contains("hidden");
    if (mission3D?.isActive() && ["w", "a", "s", "d", "shift", "arrowup", "arrowdown", "arrowleft", "arrowright", "e"].includes(key)) {
      event.preventDefault();
      getAudioContext();
    }

    if (missionResultVisible) {
      event.preventDefault();
      if (event.code === "Space" && !event.repeat) finishMissionResult();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      if (modalOpen) closeModal();
      else if (state?.mission) toast("임무 중에는 초록색 EXIT 웨이포인트로 돌아가야 합니다.");
      else if (currentPhoneApp) goPhoneHome();
      return;
    }

    if (event.code === "Space" && state?.mission && !modalOpen) {
      event.preventDefault();
      return;
    }
    const safeActive = modalOpen && Boolean(currentSafeTarget()) && !revealGateBusy;

    if ((key === "a" || key === "d") && safeActive) {
      event.preventDefault();
      if (!event.repeat) safeDialKeyDown(key);
    } else if (key === "e" && !modalOpen) {
      handleMissionInteract();
    }

    if (event.code === "Space" && modalOpen) {
      event.preventDefault();
      if (event.repeat) return;
      getAudioContext();
      if (typeof modalSpaceAction === "function") modalSpaceAction();
      else if (activeBox) performQuickCut();
    }
  });
  window.addEventListener("keyup", (event) => {
    const key = event.key.toLowerCase();
    if (bankChaseActive) {
      const handled = bankChaseGame?.handleKeyUp?.(event);
      if (handled) event.preventDefault();
      return;
    }
    keys.delete(key);
    safeDialKeyUp(key);
  });
}

window.addEventListener("resize", () => bankChaseGame?.resize?.());

(async function init() {
  state = await api.getState();
  const savedLocation = state.farmLocations.find((entry) => entry.id === state.selectedLocationId);
  selectedFarmLocationId = savedLocation && isLocationUnlocked(savedLocation) ? savedLocation.id : "alley";
  bindEvents();
  render();
  if (state.mission?.missionType === "bank-finale" && state.mission.chasePending) {
    await startBankChase({ lootValue: state.mission.bankLootValue || 0, safeOpened: state.mission.safeOpened || 0 });
  } else if (state.mission) {
    selectTab("mission");
    setMissionFullscreen(true);
  } else goPhoneHome();
  updatePhoneClock();
  setInterval(updatePhoneClock, 30000);
  requestAnimationFrame(animationLoop);
})().catch((error) => toast(error.message));
