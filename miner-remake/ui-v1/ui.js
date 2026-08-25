"use strict";

(() => {
  const ORES = [
    { key: "stone", name: "돌", className: "stone" },
    { key: "copper", name: "구리", className: "copper" },
    { key: "iron", name: "철", className: "iron" },
    { key: "emerald", name: "에메랄드", className: "emerald" },
    { key: "diamond", name: "다이아", className: "diamond" },
  ];

  const ERROR_TEXT = Object.freeze({
    AUTH_REQUIRED: "로그인이 필요합니다.",
    SESSION_EXPIRED: "세션이 만료되었습니다.",
    DEVICE_REVOKED: "이 기기는 사용할 수 없습니다.",
    MINER_STORAGE_FULL: "보관함이 가득 찼습니다.",
    MINER_JOB_NOT_READY: "아직 채굴 중입니다.",
    MINER_DAILY_LIMIT: "오늘 채굴 한도에 도달했습니다.",
    INSUFFICIENT_FUNDS: "잔액이 부족합니다.",
    NETWORK_UNAVAILABLE: "서버에 연결할 수 없습니다.",
    UNKNOWN: "처리하지 못했습니다.",
  });

  const EMPTY_INVENTORY = Object.freeze({ stone: 0, copper: 0, iron: 0, emerald: 0, diamond: 0 });
  const DEFAULT_STATE = Object.freeze({
    connection: "waiting",
    busy: false,
    totalMined: 0,
    dailyMined: 0,
    dailyLimit: 3600,
    lastOre: null,
    inventory: EMPTY_INVENTORY,
    tool: { level: 1, name: "낡은 곡괭이", cycleMs: 5000, next: null },
    storage: { level: 1, name: "광석 자루", capacity: 500, next: null },
    job: { status: "idle", id: null, readyAt: null },
  });

  const DEMO_STATE = Object.freeze({
    connection: "ready",
    busy: false,
    totalMined: 684,
    dailyMined: 218,
    dailyLimit: 3600,
    lastOre: "iron",
    inventory: { stone: 128, copper: 54, iron: 31, emerald: 9, diamond: 3 },
    tool: { level: 2, name: "보강 곡괭이", cycleMs: 4600, next: { level: 3, name: "강철 곡괭이", cost: 500000, requiredMined: 500 } },
    storage: { level: 2, name: "광석 상자", capacity: 1000, next: { level: 3, name: "광산 수레", cost: 300000, requiredMined: 500 } },
    job: { status: "idle", id: null, readyAt: null },
  });

  const previewMode = new URLSearchParams(location.search).get("demo") === "1";
  let state = normalizeState(previewMode ? DEMO_STATE : DEFAULT_STATE);
  let toastTimer = 0;
  let demoJobTimer = 0;
  let demoOreIndex = 0;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const appRoot = $("#appRoot");
  const previewBadge = $("#previewBadge");
  if (previewMode) previewBadge.hidden = false;

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function integer(value, min = 0) {
    return Math.max(min, Math.trunc(number(value)));
  }

  function text(value, fallback = "-") {
    if (typeof value !== "string") return fallback;
    const trimmed = value.trim();
    return trimmed || fallback;
  }

  function normalizeInventory(value) {
    const source = value && typeof value === "object" ? value : {};
    return Object.fromEntries(ORES.map((ore) => [ore.key, integer(source[ore.key])]));
  }

  function normalizeState(value) {
    const source = value && typeof value === "object" ? value : {};
    const tool = source.tool && typeof source.tool === "object" ? source.tool : {};
    const storage = source.storage && typeof source.storage === "object" ? source.storage : {};
    const job = source.job && typeof source.job === "object" ? source.job : {};
    return {
      connection: ["waiting", "ready", "error"].includes(source.connection) ? source.connection : "waiting",
      busy: Boolean(source.busy),
      totalMined: integer(source.totalMined),
      dailyMined: integer(source.dailyMined),
      dailyLimit: Math.max(1, integer(source.dailyLimit || 3600, 1)),
      lastOre: ORES.some((ore) => ore.key === source.lastOre) ? source.lastOre : null,
      inventory: normalizeInventory(source.inventory),
      tool: {
        level: Math.max(1, integer(tool.level || 1, 1)),
        name: text(tool.name, "낡은 곡괭이"),
        cycleMs: Math.max(300, integer(tool.cycleMs || 5000, 300)),
        next: tool.next && typeof tool.next === "object" ? tool.next : null,
      },
      storage: {
        level: Math.max(1, integer(storage.level || 1, 1)),
        name: text(storage.name, "광석 자루"),
        capacity: Math.max(1, integer(storage.capacity || 500, 1)),
        next: storage.next && typeof storage.next === "object" ? storage.next : null,
      },
      job: {
        status: ["idle", "active", "ready"].includes(job.status) ? job.status : "idle",
        id: typeof job.id === "string" ? job.id : null,
        readyAt: typeof job.readyAt === "string" ? job.readyAt : null,
      },
    };
  }

  function inventoryTotal() {
    return ORES.reduce((sum, ore) => sum + integer(state.inventory[ore.key]), 0);
  }

  function formatInt(value) {
    return integer(value).toLocaleString("ko-KR");
  }

  function formatCycle(ms) {
    return `${(number(ms) / 1000).toFixed(1)}초`;
  }

  function oreName(key) {
    return ORES.find((ore) => ore.key === key)?.name || "없음";
  }

  function renderInventory(container, compact = false) {
    container.replaceChildren();
    ORES.forEach((ore) => {
      const row = document.createElement("div");
      row.className = compact ? "mini-ore" : "ore-row";
      const dot = document.createElement("i");
      dot.className = `ore-dot ${ore.className}`;
      const name = document.createElement("span");
      name.textContent = compact ? ore.name.slice(0, 1) : ore.name;
      const qty = document.createElement("strong");
      qty.textContent = formatInt(state.inventory[ore.key]);
      if (compact) {
        row.append(dot, qty);
        row.title = `${ore.name} ${qty.textContent}개`;
      } else {
        row.append(dot, name, qty);
      }
      container.append(row);
    });
  }

  function nextUpgradeText() {
    const candidates = [
      state.tool.next ? { type: "곡괭이", ...state.tool.next } : null,
      state.storage.next ? { type: "운반", ...state.storage.next } : null,
    ].filter(Boolean);
    if (!candidates.length) return "현재 장비 최고 단계";
    const next = candidates.sort((a, b) => number(a.requiredMined) - number(b.requiredMined))[0];
    const cost = next.cost == null ? "" : ` · ${formatInt(next.cost)} SD`;
    return `${next.type} Lv.${integer(next.level, 1)} · 누적 ${formatInt(next.requiredMined)}회${cost}`;
  }

  function render() {
    const total = inventoryTotal();
    const canWrite = (state.connection === "ready" || previewMode) && !state.busy;
    const storageFull = total >= state.storage.capacity;
    const jobActive = state.job.status === "active";
    const jobReady = state.job.status === "ready";

    appRoot.dataset.connection = state.connection;
    $("#connectionLabel").textContent = state.connection === "ready" ? (previewMode ? "UI 미리보기" : "Core 연결됨") : state.connection === "error" ? "연결 오류" : "Core 연동 대기";
    $("#toolSummary").textContent = `Lv.${state.tool.level}`;
    $("#storageSummary").textContent = `${formatInt(total)} / ${formatInt(state.storage.capacity)}`;
    $("#dailySummary").textContent = `${formatInt(state.dailyMined)} / ${formatInt(state.dailyLimit)}`;
    $("#progressionLabel").textContent = `누적 ${formatInt(state.totalMined)}회`;
    $("#toolName").textContent = state.tool.name;
    $("#toolEffect").textContent = formatCycle(state.tool.cycleMs);
    $("#storageName").textContent = state.storage.name;
    $("#storageEffect").textContent = `${formatInt(state.storage.capacity)}개`;
    $("#nextUpgrade").textContent = nextUpgradeText();
    $("#inventoryCapacityLabel").textContent = `${formatInt(total)} / ${formatInt(state.storage.capacity)}`;
    $("#mineInventoryLabel").textContent = `${formatInt(total)} / ${formatInt(state.storage.capacity)}`;
    $("#cycleLabel").textContent = formatCycle(state.tool.cycleMs);
    $("#totalMinedLabel").textContent = `${formatInt(state.totalMined)}회`;
    $("#dailyMinedLabel").textContent = `${formatInt(state.dailyMined)}회`;
    $("#lastOreLabel").textContent = state.lastOre ? oreName(state.lastOre) : "없음";
    $("#workshopStatus").textContent = state.busy ? "처리 중" : storageFull ? "보관함 가득 참" : "대기";
    $("#jobStatus").textContent = jobActive ? "채굴 중" : jobReady ? "획득 가능" : storageFull ? "보관함 가득 참" : "대기";

    renderInventory($("#inventoryList"));
    renderInventory($("#mineInventoryList"), true);

    $("#upgradeToolButton").disabled = !canWrite || !state.tool.next;
    $("#upgradeStorageButton").disabled = !canWrite || !state.storage.next;
    $("#sellAllButton").disabled = !canWrite || total === 0;
    $("#mineButton").disabled = !canWrite || storageFull || jobActive || jobReady || state.dailyMined >= state.dailyLimit;
    $("#claimButton").disabled = !canWrite || !jobReady;
    $("#busyShield").hidden = !state.busy;

    const mineStage = $("#mineStage");
    mineStage.classList.toggle("is-mining", jobActive);
    mineStage.classList.toggle("is-ready", jobReady);
    mineStage.style.setProperty("--cycle-duration", `${state.tool.cycleMs}ms`);
    if (!jobActive) $("#jobProgressBar").style.removeProperty("animation");
  }

  function setTab(name) {
    const safeName = name === "mine" ? "mine" : "workshop";
    $$(".area-tab").forEach((button) => {
      const selected = button.dataset.tab === safeName;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-selected", String(selected));
    });
    $$(".view").forEach((view) => view.classList.toggle("is-active", view.dataset.view === safeName));
  }

  function showToast(message, isError = false) {
    const toast = $("#toast");
    toast.textContent = text(message, ERROR_TEXT.UNKNOWN);
    toast.classList.toggle("error", isError);
    toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2400);
  }

  function showError(code) {
    showToast(ERROR_TEXT[code] || ERROR_TEXT.UNKNOWN, true);
  }

  function emitAction(action, payload = {}) {
    if (state.busy) return;
    if (!previewMode && state.connection !== "ready") {
      showToast("Core 연동 후 사용할 수 있습니다.", true);
      return;
    }
    if (previewMode) {
      runPreviewAction(action);
      return;
    }
    window.dispatchEvent(new CustomEvent("sd-miner-ui-action", {
      detail: Object.freeze({ action, payload: { ...payload } }),
    }));
  }

  function runPreviewAction(action) {
    if (action === "start") {
      if (state.job.status !== "idle") return;
      state = normalizeState({ ...state, job: { status: "active", id: "preview-job", readyAt: null } });
      render();
      window.clearTimeout(demoJobTimer);
      demoJobTimer = window.setTimeout(() => {
        state = normalizeState({ ...state, job: { status: "ready", id: "preview-job", readyAt: new Date().toISOString() } });
        render();
        showToast("채굴 완료");
      }, Math.min(state.tool.cycleMs, 1800));
      return;
    }
    if (action === "claim" && state.job.status === "ready") {
      const ore = ORES[[1, 2, 0, 3, 0, 4][demoOreIndex++ % 6]];
      const inventory = { ...state.inventory, [ore.key]: state.inventory[ore.key] + 1 };
      state = normalizeState({ ...state, inventory, totalMined: state.totalMined + 1, dailyMined: state.dailyMined + 1, lastOre: ore.key, job: { status: "idle", id: null, readyAt: null } });
      render();
      const result = $("#oreResult");
      result.textContent = `+1 ${ore.name}`;
      result.classList.remove("show");
      void result.offsetWidth;
      result.classList.add("show");
      return;
    }
    if (action === "upgrade-tool" || action === "upgrade-storage" || action === "sell-all") {
      showToast("UI 미리보기에서는 데이터가 변경되지 않습니다.");
    }
  }

  $$(".area-tab").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.tab)));
  $("[data-open-mine]").addEventListener("click", () => setTab("mine"));
  $("[data-open-workshop]").addEventListener("click", () => setTab("workshop"));
  $$('[data-ui-action]').forEach((button) => button.addEventListener("click", () => emitAction(button.dataset.uiAction)));

  window.sdMinerUI = Object.freeze({
    applyState(nextState) {
      state = normalizeState(nextState);
      render();
    },
    setBusy(busy) {
      state = normalizeState({ ...state, busy: Boolean(busy) });
      render();
    },
    showError,
    showToast(message) {
      showToast(message, false);
    },
    openArea(name) {
      setTab(name);
    },
    getContractVersion() {
      return "miner-ui-v1";
    },
  });

  render();
})();
