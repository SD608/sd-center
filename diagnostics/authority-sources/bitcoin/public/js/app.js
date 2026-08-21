"use strict";

const bridge = window.sdBitcoinMiner;

const state = {
  settings: null,
  config: null,
  accounts: [],
  account: null,
  rooms: [],
  stats: null,
  electricity: null,
  history: [],
  selectedRoomKey: "A",
  pendingPurchaseRoomKey: "",
  activeView: "map",
  toastTimer: null,
};

const elements = {
  refreshButton: document.getElementById("refreshButton"),
  settingsButton: document.getElementById("settingsButton"),

  accountLabel: document.getElementById("accountLabel"),
  accountBalance: document.getElementById("accountBalance"),
  topBtcBalance: document.getElementById("topBtcBalance"),
  topBtcValue: document.getElementById("topBtcValue"),

  electricityPanel: document.getElementById("electricityPanel"),
  electricityDescription: document.getElementById("electricityDescription"),
  electricityStatus: document.getElementById("electricityStatus"),
  electricityDailyFee: document.getElementById("electricityDailyFee"),
  electricityNextBilling: document.getElementById("electricityNextBilling"),
  electricityDebt: document.getElementById("electricityDebt"),
  reactivateElectricityButton: document.getElementById("reactivateElectricityButton"),

  viewTabs: document.querySelector(".view-tabs"),
  views: {
    map: document.getElementById("mapView"),
    room: document.getElementById("roomView"),
    vault: document.getElementById("vaultView"),
    history: document.getElementById("historyView"),
  },

  roomGrid: document.getElementById("roomGrid"),
  backToMapButton: document.getElementById("backToMapButton"),
  roomTitle: document.getElementById("roomTitle"),
  roomSubtitle: document.getElementById("roomSubtitle"),
  roomScene: document.getElementById("roomScene"),
  rackArea: document.getElementById("rackArea"),
  roomGpuCount: document.getElementById("roomGpuCount"),
  roomMinedBtc: document.getElementById("roomMinedBtc"),
  framePrice: document.getElementById("framePrice"),
  gpuPrice: document.getElementById("gpuPrice"),
  buyFrameButton: document.getElementById("buyFrameButton"),
  buyGpuButton: document.getElementById("buyGpuButton"),
  wallThemeSelect: document.getElementById("wallThemeSelect"),
  floorThemeSelect: document.getElementById("floorThemeSelect"),
  saveDecorationButton: document.getElementById("saveDecorationButton"),

  vaultBtcBalance: document.getElementById("vaultBtcBalance"),
  vaultBtcValue: document.getElementById("vaultBtcValue"),
  totalSoldBtc: document.getElementById("totalSoldBtc"),
  totalSalesKrw: document.getElementById("totalSalesKrw"),
  quickSellButtons: document.getElementById("quickSellButtons"),
  sellAmountInput: document.getElementById("sellAmountInput"),
  salePreview: document.getElementById("salePreview"),
  sellBitcoinButton: document.getElementById("sellBitcoinButton"),

  historyList: document.getElementById("historyList"),

  purchaseModal: document.getElementById("purchaseModal"),
  purchaseRoomTitle: document.getElementById("purchaseRoomTitle"),
  purchaseRoomPrice: document.getElementById("purchaseRoomPrice"),
  closePurchaseButton: document.getElementById("closePurchaseButton"),
  confirmRoomPurchaseButton: document.getElementById("confirmRoomPurchaseButton"),

  settingsModal: document.getElementById("settingsModal"),
  closeSettingsButton: document.getElementById("closeSettingsButton"),
  autoDetectButton: document.getElementById("autoDetectButton"),
  chooseDatabaseButton: document.getElementById("chooseDatabaseButton"),
  walletPathText: document.getElementById("walletPathText"),
  accountSelect: document.getElementById("accountSelect"),
  saveSettingsButton: document.getElementById("saveSettingsButton"),

  toast: document.getElementById("toast"),
};

function formatMoney(value) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatBtc(value, digits = 2) {
  return `${Number(value || 0).toFixed(digits)} BTC`;
}

function formatDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatUtcDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function renderElectricity() {
  const electricity = state.electricity;

  elements.electricityDailyFee.textContent = formatMoney(
    electricity?.dailyFeeKrw ?? 0,
  );

  if (!state.account || !electricity) {
    elements.electricityPanel.classList.remove("suspended", "active");
    elements.electricityStatus.textContent = "계좌 연결 필요";
    elements.electricityNextBilling.textContent = "-";
    elements.electricityDebt.textContent = formatMoney(0);
    elements.electricityDescription.textContent =
      "계좌를 연결하고 GPU를 설치하면 UTC 날짜 기준 일일 전기세가 적용됩니다.";
    elements.reactivateElectricityButton.classList.add("hidden");
    return;
  }

  if (!electricity.hasActiveGpus) {
    elements.electricityPanel.classList.remove("suspended");
    elements.electricityPanel.classList.add("active");
    elements.electricityStatus.textContent = "대기 · 전기세 없음";
    elements.electricityNextBilling.textContent = "GPU 설치 후 시작";
    elements.electricityDebt.textContent = formatMoney(electricity.debtKrw);
    elements.electricityDescription.textContent =
      "가동 중인 GPU가 없어 전기세가 청구되지 않습니다.";
    elements.reactivateElectricityButton.classList.add("hidden");
    return;
  }

  if (electricity.suspended) {
    elements.electricityPanel.classList.remove("active");
    elements.electricityPanel.classList.add("suspended");
    elements.electricityStatus.textContent = "가동 중지";
    elements.electricityNextBilling.textContent = "재가동 후 갱신";
    elements.electricityDebt.textContent = formatMoney(electricity.debtKrw);
    elements.electricityDescription.textContent =
      `UTC ${electricity.unpaidUtcDate || "결제일"} 전기세가 미납되어 모든 채굴이 중지되었습니다.`;
    elements.reactivateElectricityButton.classList.remove("hidden");
    elements.reactivateElectricityButton.disabled = false;
    return;
  }

  elements.electricityPanel.classList.remove("suspended");
  elements.electricityPanel.classList.add("active");
  elements.electricityStatus.textContent = "정상 가동";
  elements.electricityNextBilling.textContent =
    formatUtcDateTime(electricity.nextBillingAt);
  elements.electricityDebt.textContent = formatMoney(0);
  const feePerGpu = electricity.feePerGpuKrw ?? state.config?.electricityFeePerGpuKrw ?? 100000;
  elements.electricityDescription.textContent =
    `GPU ${electricity.activeGpuCount}개 × ${formatMoney(feePerGpu)} = 하루 ${formatMoney(electricity.dailyFeeKrw)}이 UTC 날짜 기준으로 자동 결제됩니다.`;
  elements.reactivateElectricityButton.classList.add("hidden");
}

function maskAccountNumber(value) {
  const text = String(value || "");

  if (text.length <= 8) {
    return text;
  }

  return `${text.slice(0, 4)}••••${text.slice(-4)}`;
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");

  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 2800);
}

function roomByKey(roomKey) {
  return state.rooms.find((room) => room.roomKey === roomKey) || null;
}

function switchView(viewName) {
  state.activeView = viewName;

  for (const [name, view] of Object.entries(elements.views)) {
    view.classList.toggle("hidden", name !== viewName);
  }

  for (const button of elements.viewTabs.querySelectorAll("button[data-view]")) {
    button.classList.toggle("active", button.dataset.view === viewName);
  }

  if (viewName === "room") {
    renderSelectedRoom();
  }

  if (viewName === "vault") {
    renderVault();
  }
}

function renderTop() {
  if (!state.account) {
    elements.accountLabel.textContent = "연결되지 않음";
    elements.accountBalance.textContent = formatMoney(0);
    elements.topBtcBalance.textContent = formatBtc(0);
    elements.topBtcValue.textContent = formatMoney(0);
    return;
  }

  elements.accountLabel.textContent =
    `${state.account.bankName} · ${state.account.ownerName} · ${maskAccountNumber(state.account.accountNumber)}`;
  elements.accountBalance.textContent = formatMoney(state.account.balance);
  elements.topBtcBalance.textContent = formatBtc(state.stats?.btcBalance || 0);
  elements.topBtcValue.textContent = formatMoney(
    Number(state.stats?.btcBalance || 0) * state.config.btcPriceKrw,
  );
}

function createMiniRack(index, frames, gpus) {
  const rack = document.createElement("div");
  rack.className = "mini-rack";
  rack.style.opacity = index < frames ? "1" : "0.16";

  const installedInRack = Math.max(
    0,
    Math.min(state.config.gpusPerFrame, gpus - index * state.config.gpusPerFrame),
  );

  rack.title = `틀 ${index + 1}: GPU ${installedInRack}개`;
  return rack;
}

function renderMap() {
  elements.roomGrid.replaceChildren();

  for (const room of state.rooms) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `room-card ${room.owned ? "owned" : ""}`;

    const header = document.createElement("div");
    const letter = document.createElement("strong");
    const ownership = document.createElement("span");
    const price = document.createElement("span");

    letter.className = "room-letter";
    letter.textContent = room.roomKey;

    ownership.className = "ownership";
    ownership.textContent = room.owned ? "내 소유" : "미구매";

    price.className = "room-price";
    price.textContent = formatMoney(room.price);

    header.append(letter, ownership, price);

    const mini = document.createElement("div");
    mini.className = "room-mini";

    for (let index = 0; index < 3; index += 1) {
      mini.appendChild(createMiniRack(index, room.frames, room.gpus));
    }

    const stats = document.createElement("div");
    stats.className = "room-stats";
    stats.innerHTML = `
      <span>그래픽카드 <strong>${room.gpus}개</strong></span>
      <span>현재 BTC <strong>${Number(room.currentBtc || 0).toFixed(2)} BTC</strong></span>
      <span class="expected-sale">
        예상 판매금액
        <strong>${formatMoney(
          Number(room.currentBtc || 0) *
            state.config.btcPriceKrw,
        )}</strong>
      </span>
      <span>채굴 틀 <strong>${room.frames} / 3</strong></span>
    `;

    card.append(header, mini, stats);

    card.addEventListener("click", () => {
      state.selectedRoomKey = room.roomKey;
      bridge.saveSettings({ selectedRoomKey: room.roomKey });

      if (room.owned) {
        switchView("room");
      } else {
        openPurchaseModal(room.roomKey);
      }
    });

    elements.roomGrid.appendChild(card);
  }
}

function renderRackArea(room) {
  elements.rackArea.replaceChildren();
  const gpuBySlot = new Map(
    (Array.isArray(room.gpuUnits) ? room.gpuUnits : []).map((unit) => [Number(unit.slotIndex), unit]),
  );

  for (let rackIndex = 0; rackIndex < state.config.maxFramesPerRoom; rackIndex += 1) {
    const rack = document.createElement("div");
    rack.className = "mining-rack";

    if (rackIndex >= room.frames) {
      rack.style.opacity = "0.15";
    }

    for (let slotIndex = 0; slotIndex < state.config.gpusPerFrame; slotIndex += 1) {
      const globalIndex = rackIndex * state.config.gpusPerFrame + slotIndex;
      const slot = document.createElement("div");
      const unit = gpuBySlot.get(globalIndex);
      const durability = Math.max(0, Math.min(100, Number(unit?.durability || 0)));
      const installed = Boolean(unit) && durability > 0;
      const broken = Boolean(unit) && durability <= 0;

      slot.className = `gpu-slot ${installed ? "installed" : ""} ${broken ? "broken" : ""}`.trim();

      const fan = document.createElement("span");
      fan.className = "gpu-fan";

      const label = document.createElement("span");
      label.textContent = installed
        ? `GPU ${globalIndex + 1} · 내구도 ${durability}%`
        : broken
          ? `GPU ${globalIndex + 1} · 파손`
          : "빈 슬롯";

      const light = document.createElement("span");
      light.className = "gpu-light";

      slot.append(fan, label, light);
      rack.appendChild(slot);
    }

    elements.rackArea.appendChild(rack);
  }
}

function renderSelectedRoom() {
  const room = roomByKey(state.selectedRoomKey);

  if (!room || !room.owned) {
    switchView("map");
    return;
  }

  elements.roomTitle.textContent = `${room.roomKey} 원룸`;
  elements.roomSubtitle.textContent =
    `틀 ${room.frames}/3 · GPU ${room.gpus}/${room.frames * state.config.gpusPerFrame} · 누적 ${room.minedBtc.toFixed(2)} BTC`;

  elements.roomGpuCount.textContent =
    `${room.gpus} / ${room.frames * state.config.gpusPerFrame}`;
  elements.roomMinedBtc.textContent = formatBtc(room.minedBtc);
  elements.framePrice.textContent = formatMoney(state.config.framePrice);
  elements.gpuPrice.textContent = formatMoney(state.config.gpuPrice);

  elements.wallThemeSelect.value = room.wallTheme;
  elements.floorThemeSelect.value = room.floorTheme;

  elements.roomScene.className =
    `room-scene wall-${room.wallTheme} floor-${room.floorTheme}`;

  elements.buyFrameButton.disabled =
    room.frames >= state.config.maxFramesPerRoom;

  elements.buyGpuButton.disabled =
    room.frames <= 0 ||
    room.gpus >= room.frames * state.config.gpusPerFrame;

  renderRackArea(room);
}

function renderVault() {
  const btc = Number(state.stats?.btcBalance || 0);
  const value = btc * state.config.btcPriceKrw;

  elements.vaultBtcBalance.textContent = formatBtc(btc);
  elements.vaultBtcValue.textContent = formatMoney(value);
  elements.totalSoldBtc.textContent = formatBtc(state.stats?.totalSoldBtc || 0);
  elements.totalSalesKrw.textContent = formatMoney(state.stats?.totalSalesKrw || 0);
  updateSalePreview();
}

function renderHistory() {
  elements.historyList.replaceChildren();

  if (state.history.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "기록이 없습니다.";
    elements.historyList.appendChild(empty);
    return;
  }

  for (const entry of state.history) {
    const item = document.createElement("article");
    item.className = "history-item";

    const detail = document.createElement("div");
    const memo = document.createElement("strong");
    const time = document.createElement("time");
    const summary = document.createElement("div");
    const quantity = document.createElement("span");
    const amount = document.createElement("strong");

    memo.textContent = entry.memo;
    time.textContent = formatDate(entry.createdAt);

    quantity.textContent = entry.quantity > 0
      ? `${entry.quantity.toFixed(entry.actionType === "mine" || entry.actionType === "sell" ? 2 : 0)}`
      : "-";

    amount.className = "amount";
    amount.textContent = entry.amount > 0
      ? formatMoney(entry.amount)
      : entry.actionType === "mine"
        ? `+${entry.quantity.toFixed(2)} BTC`
        : "-";

    detail.append(memo, time);
    summary.append(quantity, amount);
    item.append(detail, summary);
    elements.historyList.appendChild(item);
  }
}

function renderAll() {
  renderTop();
  renderElectricity();
  renderMap();
  renderVault();
  renderHistory();

  if (state.activeView === "room") {
    renderSelectedRoom();
  }
}

async function loadAccounts() {
  const result = await bridge.listAccounts();
  state.accounts = result.accounts || [];
  elements.accountSelect.replaceChildren();

  if (!result.connected) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "계좌를 먼저 불러오세요";
    elements.accountSelect.appendChild(option);

    elements.walletPathText.textContent =
      result.error || "연결된 SD지갑 DB 없음";

    state.account = null;
    state.rooms = [];
    state.stats = null;
    state.electricity = null;
    state.history = [];
    renderAll();
    return;
  }

  elements.walletPathText.textContent = result.databasePath;

  if (state.accounts.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "SD지갑에 계좌가 없습니다";
    elements.accountSelect.appendChild(option);
    return;
  }

  for (const account of state.accounts) {
    const option = document.createElement("option");
    option.value = account.id;
    option.textContent =
      `${account.username} · ${account.bankName} · ${account.accountNumber} · ${formatMoney(account.balance)}`;
    elements.accountSelect.appendChild(option);
  }

  const selectedExists = state.accounts.some(
    (account) => account.id === state.settings.selectedAccountId,
  );

  const selectedAccountId = selectedExists
    ? state.settings.selectedAccountId
    : state.accounts[0].id;

  elements.accountSelect.value = selectedAccountId;
  state.settings = await bridge.saveSettings({ selectedAccountId });
  await loadSelectedState();
}

async function loadSelectedState() {
  const accountId = state.settings?.selectedAccountId;

  if (!accountId) {
    state.account = null;
    state.rooms = [];
    state.stats = null;
    state.electricity = null;
    state.history = [];
    renderAll();
    return;
  }

  const result = await bridge.getState(accountId);

  if (!result.connected) {
    state.account = null;
    state.rooms = [];
    state.stats = null;
    state.electricity = null;
    state.history = [];
    renderAll();

    if (result.error) {
      showToast(result.error);
    }
    return;
  }

  state.account = result.account;
  state.rooms = result.rooms;
  state.stats = result.stats;
  state.electricity = result.electricity || null;
  state.history = result.history || [];
  renderAll();
}

function openSettings() {
  elements.walletPathText.textContent =
    state.settings.walletDatabasePath || "연결된 DB 없음";
  elements.settingsModal.classList.remove("hidden");
}

function closeSettings() {
  elements.settingsModal.classList.add("hidden");
}

function openPurchaseModal(roomKey) {
  const room = roomByKey(roomKey);

  if (!room) {
    return;
  }

  state.pendingPurchaseRoomKey = roomKey;
  elements.purchaseRoomTitle.textContent = `${roomKey} 원룸 구매`;
  elements.purchaseRoomPrice.textContent = formatMoney(room.price);
  elements.purchaseModal.classList.remove("hidden");
}

function closePurchaseModal() {
  elements.purchaseModal.classList.add("hidden");
  state.pendingPurchaseRoomKey = "";
}

async function refreshAll(showMessage = true) {
  state.settings = await bridge.getSettings();
  state.selectedRoomKey = state.settings.selectedRoomKey || "A";
  await loadAccounts();

  if (showMessage) {
    showToast("원룸·채굴·비트코인 정보를 새로고침했습니다.");
  }
}

async function buySelectedRoom() {
  if (!state.account || !state.pendingPurchaseRoomKey) {
    return;
  }

  const result = await bridge.buyRoom({
    accountId: state.account.id,
    roomKey: state.pendingPurchaseRoomKey,
  });

  if (!result.ok) {
    showToast(result.error);
    return;
  }

  const purchasedRoom = state.pendingPurchaseRoomKey;
  closePurchaseModal();
  await loadSelectedState();

  state.selectedRoomKey = purchasedRoom;
  await bridge.saveSettings({ selectedRoomKey: purchasedRoom });

  showToast(`${purchasedRoom} 원룸을 구매했습니다.`);
  switchView("room");
}

async function buyFrame() {
  const result = await bridge.buyFrame({
    accountId: state.account?.id,
    roomKey: state.selectedRoomKey,
  });

  if (!result.ok) {
    showToast(result.error);
    return;
  }

  await loadSelectedState();
  showToast("채굴 틀 1개를 설치했습니다.");
}

async function buyGpu() {
  const result = await bridge.buyGpu({
    accountId: state.account?.id,
    roomKey: state.selectedRoomKey,
  });

  if (!result.ok) {
    showToast(result.error);
    return;
  }

  await loadSelectedState();
  showToast("그래픽카드 1개를 설치했습니다.");
}

async function saveDecoration() {
  const result = await bridge.decorateRoom({
    accountId: state.account?.id,
    roomKey: state.selectedRoomKey,
    wallTheme: elements.wallThemeSelect.value,
    floorTheme: elements.floorThemeSelect.value,
  });

  if (!result.ok) {
    showToast(result.error);
    return;
  }

  await loadSelectedState();
  showToast("원룸 인테리어를 저장했습니다.");
}

function normalizedSellAmount() {
  const raw = elements.sellAmountInput.value
    .replace(/[^0-9.]/g, "");
  const firstDot = raw.indexOf(".");
  const normalized = firstDot >= 0
    ? raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, "")
    : raw;

  elements.sellAmountInput.value = normalized;
  return Number(normalized || 0);
}

function updateSalePreview() {
  const btcAmount = normalizedSellAmount();
  elements.salePreview.textContent = formatMoney(
    btcAmount * state.config.btcPriceKrw,
  );
}

async function sellBitcoin() {
  const btcAmount = normalizedSellAmount();

  const result = await bridge.sellBitcoin({
    accountId: state.account?.id,
    btcAmount,
  });

  if (!result.ok) {
    showToast(result.error);
    return;
  }

  await loadSelectedState();
  showToast(
    `${result.soldBtc.toFixed(2)} BTC를 ${formatMoney(result.saleKrw)}에 판매했습니다.`,
  );
}

async function reactivateElectricity() {
  if (!state.account) {
    return;
  }

  const result = await bridge.reactivateElectricity(state.account.id);

  if (!result.ok) {
    showToast(result.error);
    return;
  }

  await loadSelectedState();
  showToast(`${formatMoney(result.paidAmount)}을 납부하고 채굴장을 재가동했습니다.`);
}

function bindEvents() {
  elements.refreshButton.addEventListener("click", () => refreshAll());
  elements.settingsButton.addEventListener("click", openSettings);
  elements.closeSettingsButton.addEventListener("click", closeSettings);
  elements.autoDetectButton.addEventListener("click", async () => {
    const result = await bridge.autoDetectWallet();

    if (!result.found) {
      showToast("SD지갑 DB를 자동으로 찾지 못했습니다.");
      return;
    }

    state.settings = await bridge.getSettings();
    await loadAccounts();
    showToast("SD지갑 데이터베이스를 찾았습니다.");
  });

  elements.chooseDatabaseButton.addEventListener("click", async () => {
    const result = await bridge.chooseWalletDatabase();

    if (result.canceled) {
      return;
    }

    if (!result.ok) {
      showToast(result.error);
      return;
    }

    state.settings = await bridge.getSettings();
    await loadAccounts();
    showToast("SD지갑 DB를 연결했습니다.");
  });

  elements.saveSettingsButton.addEventListener("click", async () => {
    state.settings = await bridge.saveSettings({
      selectedAccountId: elements.accountSelect.value,
    });

    await loadSelectedState();
    closeSettings();
    showToast("사용 계좌를 저장했습니다.");
  });

  elements.viewTabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-view]");

    if (!button) {
      return;
    }

    if (button.dataset.view === "room") {
      const room = roomByKey(state.selectedRoomKey);

      if (!room?.owned) {
        showToast("맵에서 소유한 원룸을 선택하세요.");
        switchView("map");
        return;
      }
    }

    switchView(button.dataset.view);
  });

  elements.backToMapButton.addEventListener("click", () => switchView("map"));
  elements.closePurchaseButton.addEventListener("click", closePurchaseModal);
  elements.confirmRoomPurchaseButton.addEventListener("click", buySelectedRoom);
  elements.buyFrameButton.addEventListener("click", buyFrame);
  elements.buyGpuButton.addEventListener("click", buyGpu);
  elements.saveDecorationButton.addEventListener("click", saveDecoration);

  elements.wallThemeSelect.addEventListener("change", () => {
    const room = roomByKey(state.selectedRoomKey);

    if (!room) {
      return;
    }

    elements.roomScene.className =
      `room-scene wall-${elements.wallThemeSelect.value} floor-${elements.floorThemeSelect.value}`;
  });

  elements.floorThemeSelect.addEventListener("change", () => {
    const room = roomByKey(state.selectedRoomKey);

    if (!room) {
      return;
    }

    elements.roomScene.className =
      `room-scene wall-${elements.wallThemeSelect.value} floor-${elements.floorThemeSelect.value}`;
  });

  elements.quickSellButtons.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-amount]");

    if (!button) {
      return;
    }

    const amount = button.dataset.amount === "all"
      ? Number(state.stats?.btcBalance || 0)
      : Number(button.dataset.amount);

    elements.sellAmountInput.value = amount.toFixed(2);
    updateSalePreview();

    for (const item of elements.quickSellButtons.querySelectorAll("button")) {
      item.classList.toggle("active", item === button);
    }
  });

  elements.sellAmountInput.addEventListener("input", updateSalePreview);
  elements.sellBitcoinButton.addEventListener("click", sellBitcoin);
  elements.reactivateElectricityButton.addEventListener(
    "click", reactivateElectricity,
  );

  document.addEventListener("keydown", (event) => {
    if (event.key === "F5") {
      event.preventDefault();
      refreshAll();
    }

    if (event.key === "Escape") {
      closeSettings();
      closePurchaseModal();
    }
  });

  elements.settingsModal.addEventListener("click", (event) => {
    if (event.target === elements.settingsModal) {
      closeSettings();
    }
  });

  elements.purchaseModal.addEventListener("click", (event) => {
    if (event.target === elements.purchaseModal) {
      closePurchaseModal();
    }
  });


bridge.onOfflineMiningApplied((result) => {
  const seconds = Math.max(
    0,
    Math.trunc(
      Number(result?.elapsedSeconds || 0),
    ),
  );

  const totalBtc = Number(
    result?.totalBtc || 0,
  );

  if (seconds <= 5) {
    return;
  }

  const minutes = Math.floor(
    seconds / 60,
  );
  const secondsRemainder =
    seconds % 60;

  const periodText =
    minutes > 0
      ? `${minutes.toLocaleString(
          "ko-KR",
        )}분 ${secondsRemainder}초`
      : `${secondsRemainder}초`;

  showToast(
    totalBtc > 0
      ? `백그라운드·오프라인 ${periodText} 채굴분 ${totalBtc.toFixed(
          2,
        )} BTC를 반영했습니다.`
      : `백그라운드·오프라인 ${periodText} 채굴 판정을 반영했습니다.`,
  );

  loadSelectedState();
});

  bridge.onElectricityChanged((events) => {
    const relevant = Array.isArray(events) && state.account
      ? events.filter((entry) => entry.accountId === state.account.id)
      : [];

    if (relevant.length === 0) {
      return;
    }

    const suspended = relevant.find((entry) => entry.type === "suspended");
    const lastEvent = relevant[relevant.length - 1];

    showToast(
      suspended
        ? `전기세 ${formatMoney(suspended.amount)} 미납으로 채굴이 중지되었습니다.`
        : `UTC 일일 전기세 ${formatMoney(lastEvent.amount)}이 결제되었습니다.`,
    );
    loadSelectedState();
  });

  bridge.onMiningRewards((rewards) => {
    if (!state.account) {
      return;
    }

    const relevant = rewards.filter(
      (reward) => reward.accountId === state.account.id,
    );

    if (relevant.length === 0) {
      return;
    }

    for (const reward of relevant) {
      const room = roomByKey(reward.roomKey);

      if (room) {
        room.minedBtc += reward.btc;
        room.currentBtc =
          Number(
            room.currentBtc || 0,
          ) + reward.btc;
      }

      state.stats.btcBalance += reward.btc;
    }

    const brokenCount = relevant.reduce(
      (total, reward) => total + Number(reward.brokenGpuCount || 0),
      0,
    );
    if (brokenCount > 0) {
      showToast(`채굴 성공으로 GPU ${brokenCount}개가 내구도 0%가 되어 파손되었습니다.`);
    }

    loadSelectedState();
  });
}

async function initialize() {
  bindEvents();

  state.config = await bridge.getConfig();
  state.settings = await bridge.getSettings();
  state.selectedRoomKey = state.settings.selectedRoomKey || "A";

  await loadAccounts();

  if (!state.settings.walletDatabasePath || state.accounts.length === 0) {
    const detected = await bridge.autoDetectWallet();

    if (detected.found) {
      state.settings = await bridge.getSettings();
      await loadAccounts();
    }
  }

  if (!state.account) {
    openSettings();
  }

  switchView("map");
}

initialize().catch((error) => {
  console.error(error);
  showToast(`초기화 오류: ${error.message}`);
});
