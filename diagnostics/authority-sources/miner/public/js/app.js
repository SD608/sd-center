"use strict";

const bridge = window.sdMiner;

const state = {
  settings: null,
  config: {
    ores: [],
    cooldownMs: 300,
    autoMiningUpgradePrice: 500000,
  },

  accounts: [],
  account: null,
  inventory: null,
  upgrade: {
    autoMiningUnlocked: false,
  },
  history: [],
  salesHistory: [],
  statistics: null,

  insideMine: false,
  minePending: false,
  autoMining: false,
  autoMiningTimer: null,
  oreDropTimer: null,
  toastTimer: null,
};

const elements = {
  refreshButton: document.getElementById(
    "refreshButton",
  ),
  settingsButton: document.getElementById(
    "settingsButton",
  ),

  entranceView: document.getElementById(
    "entranceView",
  ),
  mineView: document.getElementById("mineView"),

  entranceAccountName: document.getElementById(
    "entranceAccountName",
  ),
  entranceBalance: document.getElementById(
    "entranceBalance",
  ),
  enterMineButton: document.getElementById(
    "enterMineButton",
  ),
  leaveMineButton: document.getElementById(
    "leaveMineButton",
  ),

  autoMiningStatus: document.getElementById(
    "autoMiningStatus",
  ),
  rockWall: document.getElementById("rockWall"),
  pickaxe: document.getElementById("pickaxe"),

  oreDrop: document.getElementById("oreDrop"),
  oreDropIcon: document.getElementById(
    "oreDropIcon",
  ),
  oreDropName: document.getElementById(
    "oreDropName",
  ),
  oreDropChance: document.getElementById(
    "oreDropChance",
  ),

  totalMined: document.getElementById(
    "totalMined",
  ),
  lastOre: document.getElementById("lastOre"),

  accountUsername: document.getElementById(
    "accountUsername",
  ),
  accountBank: document.getElementById(
    "accountBank",
  ),
  accountNumber: document.getElementById(
    "accountNumber",
  ),
  accountOwner: document.getElementById(
    "accountOwner",
  ),
  accountBalance: document.getElementById(
    "accountBalance",
  ),

  inventoryValue: document.getElementById(
    "inventoryValue",
  ),
  inventoryList: document.getElementById(
    "inventoryList",
  ),
  autoMiningUpgradeCard:
    document.getElementById(
      "autoMiningUpgradeCard",
    ),
  autoMiningUpgradeDescription:
    document.getElementById(
      "autoMiningUpgradeDescription",
    ),
  autoMiningUpgradePrice:
    document.getElementById(
      "autoMiningUpgradePrice",
    ),
  buyAutoMiningUpgradeButton:
    document.getElementById(
      "buyAutoMiningUpgradeButton",
    ),

  shopGrid: document.getElementById("shopGrid"),
  sellAllButton: document.getElementById(
    "sellAllButton",
  ),
  historyList: document.getElementById(
    "historyList",
  ),
  salesHistoryList: document.getElementById(
    "salesHistoryList",
  ),
  statsTotalMined: document.getElementById(
    "statsTotalMined",
  ),
  statsInventoryQuantity: document.getElementById(
    "statsInventoryQuantity",
  ),
  statsSoldQuantity: document.getElementById(
    "statsSoldQuantity",
  ),
  statsSalesRevenue: document.getElementById(
    "statsSalesRevenue",
  ),
  statsSaleCount: document.getElementById(
    "statsSaleCount",
  ),

  settingsModal: document.getElementById(
    "settingsModal",
  ),
  closeSettingsButton: document.getElementById(
    "closeSettingsButton",
  ),
  autoDetectWalletButton: document.getElementById(
    "autoDetectWalletButton",
  ),
  chooseWalletDatabaseButton:
    document.getElementById(
      "chooseWalletDatabaseButton",
    ),
  walletPathText: document.getElementById(
    "walletPathText",
  ),
  accountSelect: document.getElementById(
    "accountSelect",
  ),
  saveSettingsButton: document.getElementById(
    "saveSettingsButton",
  ),

  toast: document.getElementById("toast"),
};

function formatMoney(value) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR").format(
    Number(value || 0),
  );
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

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

function maskAccountNumber(value) {
  const text = String(value || "");

  if (text.length <= 7) {
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
  }, 2600);
}

function oreByKey(key) {
  return state.config.ores.find(
    (ore) => ore.key === key,
  );
}

function inventoryQuantity(key) {
  return Number(state.inventory?.[key] || 0);
}

function inventoryTotalValue() {
  return state.config.ores.reduce(
    (total, ore) =>
      total +
      inventoryQuantity(ore.key) *
        Number(ore.price),
    0,
  );
}

function inventoryTotalQuantity() {
  return state.config.ores.reduce(
    (total, ore) =>
      total + inventoryQuantity(ore.key),
    0,
  );
}

function renderEntrance() {
  if (!state.account) {
    elements.entranceAccountName.textContent =
      "계좌를 연결하세요";
    elements.entranceBalance.textContent =
      formatMoney(0);
    elements.enterMineButton.disabled = true;
    return;
  }

  elements.entranceAccountName.textContent =
    `${state.account.bankName} · ${state.account.ownerName}`;
  elements.entranceBalance.textContent =
    formatMoney(state.account.balance);
  elements.enterMineButton.disabled = false;
}

function renderAccount() {
  if (!state.account) {
    elements.accountUsername.textContent = "-";
    elements.accountBank.textContent = "-";
    elements.accountNumber.textContent = "-";
    elements.accountOwner.textContent = "-";
    elements.accountBalance.textContent =
      formatMoney(0);
    renderEntrance();
    return;
  }

  elements.accountUsername.textContent =
    state.account.username;
  elements.accountBank.textContent =
    state.account.bankName;
  elements.accountNumber.textContent =
    maskAccountNumber(
      state.account.accountNumber,
    );
  elements.accountOwner.textContent =
    state.account.ownerName;
  elements.accountBalance.textContent =
    formatMoney(state.account.balance);

  renderEntrance();
}

function createOreIcon(oreKey) {
  const icon = document.createElement("div");
  icon.className = `ore-icon ${oreKey}`;
  return icon;
}

function renderInventory() {
  elements.inventoryList.replaceChildren();

  if (!state.inventory) {
    elements.inventoryValue.textContent =
      formatMoney(0);
    elements.totalMined.textContent = "0회";
    return;
  }

  elements.inventoryValue.textContent =
    formatMoney(inventoryTotalValue());

  elements.totalMined.textContent =
    `${formatNumber(
      state.inventory.totalMined,
    )}회`;

  for (const ore of state.config.ores) {
    const row = document.createElement("article");
    row.className = "inventory-row";

    const icon = createOreIcon(ore.key);
    const detail = document.createElement("div");
    const name = document.createElement("strong");
    const value = document.createElement("span");
    const quantity = document.createElement("strong");

    name.textContent = ore.name;
    value.textContent =
      `개당 ${formatMoney(ore.price)} · ${ore.probability}%`;
    quantity.textContent =
      `${formatNumber(
        inventoryQuantity(ore.key),
      )}개`;

    detail.append(name, value);
    row.append(icon, detail, quantity);
    elements.inventoryList.appendChild(row);
  }
}

function renderAutoMiningUpgrade() {
  const unlocked = Boolean(
    state.upgrade?.autoMiningUnlocked,
  );

  elements.autoMiningUpgradeCard
    .classList.toggle(
      "unlocked",
      unlocked,
    );

  if (!state.account) {
    elements.autoMiningUpgradePrice.textContent =
      formatMoney(
        state.config.autoMiningUpgradePrice,
      );

    elements.autoMiningUpgradeDescription.textContent =
      "계좌를 연결하면 자동 채굴 업그레이드를 구매할 수 있습니다.";

    elements.buyAutoMiningUpgradeButton.textContent =
      "계좌 연결 필요";

    elements.buyAutoMiningUpgradeButton.disabled =
      true;

    elements.autoMiningStatus.textContent =
      "자동 채굴 잠김";
    elements.autoMiningStatus.classList.remove(
      "active",
    );
    return;
  }

  if (unlocked) {
    elements.autoMiningUpgradePrice.textContent =
      "구매 완료";

    elements.autoMiningUpgradeDescription.textContent =
      "숫자 0을 한 번 누르면 자동 채굴이 켜지고, 다시 누르면 꺼집니다.";

    elements.buyAutoMiningUpgradeButton.textContent =
      "업그레이드 완료";

    elements.buyAutoMiningUpgradeButton.disabled =
      true;

    if (state.autoMining) {
      elements.autoMiningStatus.textContent =
        "자동 채굴 중 · 0으로 끄기";

      elements.autoMiningStatus.classList.add(
        "active",
      );
    } else {
      elements.autoMiningStatus.textContent =
        "자동 채굴 준비 · 0으로 켜기";

      elements.autoMiningStatus.classList.remove(
        "active",
      );
    }

    return;
  }

  elements.autoMiningUpgradePrice.textContent =
    formatMoney(
      state.config.autoMiningUpgradePrice,
    );

  elements.autoMiningUpgradeDescription.textContent =
    "구매 후 숫자 0을 누를 때마다 자동 채굴을 켜고 끌 수 있습니다.";

  elements.buyAutoMiningUpgradeButton.textContent =
    "업그레이드 구매";

  elements.buyAutoMiningUpgradeButton.disabled =
    false;

  elements.autoMiningStatus.textContent =
    "자동 채굴 잠김 · 업그레이드 필요";

  elements.autoMiningStatus.classList.remove(
    "active",
  );
}

function renderShop() {
  elements.shopGrid.replaceChildren();

  for (const ore of state.config.ores) {
    const item = document.createElement("article");
    item.className = "shop-item";

    const icon = createOreIcon(ore.key);
    const name = document.createElement("h3");
    const price = document.createElement("p");
    const stock = document.createElement("span");
    const actions = document.createElement("div");

    const sellOne = document.createElement("button");
    const sellAll = document.createElement("button");

    name.textContent = ore.name;
    price.textContent =
      `${formatMoney(ore.price)} / 1개`;

    stock.className = "shop-stock";
    stock.textContent =
      `보유 ${formatNumber(
        inventoryQuantity(ore.key),
      )}개`;

    actions.className = "shop-actions";

    sellOne.type = "button";
    sellOne.textContent = "1개 판매";
    sellOne.disabled =
      inventoryQuantity(ore.key) < 1;
    sellOne.addEventListener("click", () => {
      sellOre(ore.key, 1);
    });

    sellAll.type = "button";
    sellAll.className = "sell-all";
    sellAll.textContent = "전부 판매";
    sellAll.disabled =
      inventoryQuantity(ore.key) < 1;
    sellAll.addEventListener("click", () => {
      sellOre(
        ore.key,
        inventoryQuantity(ore.key),
      );
    });

    actions.append(sellOne, sellAll);
    item.append(
      icon,
      name,
      price,
      stock,
      actions,
    );

    elements.shopGrid.appendChild(item);
  }

  elements.sellAllButton.disabled =
    inventoryTotalQuantity() <= 0;
}

function renderStatistics() {
  const statistics = state.statistics || {};
  const totalMined = Number(
    state.inventory?.totalMined ?? statistics.totalMined ?? 0,
  );
  const currentInventoryQuantity = state.inventory
    ? inventoryTotalQuantity()
    : Number(statistics.currentInventoryQuantity || 0);

  elements.statsTotalMined.textContent =
    `${formatNumber(totalMined)}개`;
  elements.statsInventoryQuantity.textContent =
    `${formatNumber(currentInventoryQuantity)}개`;
  elements.statsSoldQuantity.textContent =
    `${formatNumber(statistics.totalSoldQuantity || 0)}개`;
  elements.statsSalesRevenue.textContent =
    formatMoney(statistics.totalSalesRevenue || 0);
  elements.statsSaleCount.textContent =
    `${formatNumber(statistics.saleCount || 0)}회`;
}

function renderSalesHistory() {
  elements.salesHistoryList.replaceChildren();

  if (state.salesHistory.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "판매 기록이 없습니다.";
    elements.salesHistoryList.appendChild(empty);
    return;
  }

  for (const entry of state.salesHistory) {
    const item = document.createElement("article");
    item.className = "history-item sale-record-item";

    const detail = document.createElement("div");
    const title = document.createElement("strong");
    const time = document.createElement("time");
    const summary = document.createElement("div");
    const quantity = document.createElement("span");
    const amount = document.createElement("strong");

    title.textContent = `${entry.oreName} 판매`;
    time.textContent = formatDate(entry.createdAt);
    quantity.textContent = `${formatNumber(entry.quantity)}개`;
    amount.className = "history-amount";
    amount.textContent = `+${formatMoney(entry.amount)}`;

    detail.append(title, time);
    summary.append(quantity, amount);
    item.append(detail, summary);
    elements.salesHistoryList.appendChild(item);
  }
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
    const title = document.createElement("strong");
    const time = document.createElement("time");
    const summary = document.createElement("div");
    const quantity = document.createElement("span");
    const amount = document.createElement("strong");

    const isSale =
      entry.actionType === "sell";

    title.textContent = isSale
      ? `${entry.oreName} 판매`
      : `${entry.oreName} 채굴`;

    time.textContent = formatDate(
      entry.createdAt,
    );

    quantity.textContent =
      `${formatNumber(entry.quantity)}개`;

    amount.className = "history-amount";
    amount.textContent = isSale
      ? `+${formatMoney(entry.amount)}`
      : "보관함 적재";

    detail.append(title, time);
    summary.append(quantity, amount);
    item.append(detail, summary);
    elements.historyList.appendChild(item);
  }
}

function renderAll() {
  renderAccount();
  renderInventory();
  renderAutoMiningUpgrade();
  renderShop();
  renderStatistics();
  renderSalesHistory();
  renderHistory();
}

async function loadSelectedAccount() {
  const accountId =
    state.settings?.selectedAccountId;

  if (!accountId) {
    state.account = null;
    state.inventory = null;
    state.upgrade = {
      autoMiningUnlocked: false,
    };
    state.history = [];
    state.salesHistory = [];
    state.statistics = null;
    renderAll();
    return;
  }

  const result =
    await bridge.getAccountState(accountId);

  if (!result.connected) {
    state.account = null;
    state.inventory = null;
    state.upgrade = {
      autoMiningUnlocked: false,
    };
    state.history = [];
    state.salesHistory = [];
    state.statistics = null;
    renderAll();

    if (result.error) {
      showToast(result.error);
    }

    return;
  }

  state.account = result.account;
  state.inventory = result.inventory;
  state.upgrade = result.upgrade || {
    autoMiningUnlocked: false,
  };
  state.history = result.history || [];
  state.salesHistory = result.salesHistory || [];
  state.statistics = result.statistics || null;
  renderAll();
}

async function loadAccounts() {
  const result =
    await bridge.listWalletAccounts();

  state.accounts = result.accounts || [];
  elements.accountSelect.replaceChildren();

  if (!result.connected) {
    elements.walletPathText.textContent =
      result.error || "연결된 SD지갑 DB 없음";

    const option = document.createElement("option");
    option.value = "";
    option.textContent = "계좌를 먼저 불러오세요";
    elements.accountSelect.appendChild(option);

    state.account = null;
    state.inventory = null;
    state.upgrade = {
      autoMiningUnlocked: false,
    };
    state.history = [];
    state.salesHistory = [];
    state.statistics = null;
    renderAll();
    return;
  }

  elements.walletPathText.textContent =
    result.databasePath;

  if (state.accounts.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "SD지갑에 계좌가 없습니다";
    elements.accountSelect.appendChild(option);
    renderAll();
    return;
  }

  for (const account of state.accounts) {
    const option = document.createElement("option");
    option.value = account.id;
    option.textContent =
      `${account.username} · ${account.bankName} · ${account.accountNumber} · ${formatMoney(
        account.balance,
      )}`;
    elements.accountSelect.appendChild(option);
  }

  const selectedExists = state.accounts.some(
    (account) =>
      account.id ===
      state.settings.selectedAccountId,
  );

  const selectedAccountId = selectedExists
    ? state.settings.selectedAccountId
    : state.accounts[0].id;

  elements.accountSelect.value =
    selectedAccountId;

  state.settings = await bridge.saveSettings({
    selectedAccountId,
  });

  await loadSelectedAccount();
}

function openSettings() {
  stopAutoMining();

  elements.walletPathText.textContent =
    state.settings.walletDatabasePath ||
    "연결된 DB 없음";

  elements.settingsModal.classList.remove(
    "hidden",
  );
}

function closeSettings() {
  elements.settingsModal.classList.add("hidden");
}

async function autoDetectWallet() {
  const result = await bridge.autoDetectWallet();

  if (!result.found) {
    showToast(
      "SD지갑 DB를 자동으로 찾지 못했습니다. 직접 선택하세요.",
    );
    return;
  }

  state.settings = await bridge.getSettings();
  await loadAccounts();
  showToast("SD지갑 데이터베이스를 찾았습니다.");
}

async function chooseWalletDatabase() {
  const result =
    await bridge.chooseWalletDatabase();

  if (result.canceled) {
    return;
  }

  if (!result.ok) {
    showToast(result.error);
    return;
  }

  state.settings = await bridge.getSettings();
  await loadAccounts();
  showToast("SD지갑 DB가 연결되었습니다.");
}

async function saveSettings() {
  state.settings = await bridge.saveSettings({
    selectedAccountId:
      elements.accountSelect.value,
  });

  await loadSelectedAccount();
  closeSettings();
  showToast("광부 계좌가 연결되었습니다.");
}

function enterMine() {
  if (!state.account) {
    showToast("먼저 SD지갑 계좌를 연결하세요.");
    openSettings();
    return;
  }

  state.insideMine = true;
  elements.entranceView.classList.add("hidden");
  elements.mineView.classList.remove("hidden");
}

function leaveMine() {
  stopAutoMining();
  state.insideMine = false;
  elements.mineView.classList.add("hidden");
  elements.entranceView.classList.remove(
    "hidden",
  );
}

function animateMining() {
  elements.rockWall.classList.remove("hit");
  elements.pickaxe.classList.remove("swing");

  void elements.rockWall.offsetWidth;
  void elements.pickaxe.offsetWidth;

  elements.rockWall.classList.add("hit");
  elements.pickaxe.classList.add("swing");
}

function showOreDrop(ore) {
  window.clearTimeout(state.oreDropTimer);

  elements.oreDrop.classList.add("hidden");
  void elements.oreDrop.offsetWidth;

  elements.oreDropIcon.className =
    `ore-icon ${ore.key}`;
  elements.oreDropName.textContent = ore.name;
  elements.oreDropChance.textContent =
    `출현 확률 ${ore.probability}%`;

  elements.oreDrop.classList.remove("hidden");

  state.oreDropTimer = window.setTimeout(() => {
    elements.oreDrop.classList.add("hidden");
  }, 760);
}

async function mineOnce() {
  if (
    !state.insideMine ||
    !state.account ||
    state.minePending
  ) {
    return;
  }

  state.minePending = true;
  animateMining();

  try {
    const result = await bridge.mine(
      state.account.id,
    );

    if (!result.ok) {
      if (!result.cooldown && result.error) {
        showToast(result.error);
      }
      return;
    }

    state.inventory = result.inventory;

    if (state.statistics) {
      state.statistics.totalMined =
        result.inventory.totalMined;
      state.statistics.currentInventoryQuantity =
        inventoryTotalQuantity();
    }

    elements.lastOre.textContent =
      result.ore.name;

    showOreDrop(result.ore);

    state.history.unshift({
      id: `${Date.now()}-${Math.random()}`,
      oreKey: result.ore.key,
      oreName: result.ore.name,
      actionType: "mine",
      quantity: 1,
      amount: 0,
      createdAt: result.minedAt,
    });

    state.history = state.history.slice(0, 14);

    renderInventory();
    renderShop();
    renderStatistics();
    renderHistory();
  } finally {
    window.setTimeout(() => {
      state.minePending = false;
    }, Math.max(0, state.config.cooldownMs - 30));
  }
}

function startAutoMining() {
  if (
    !state.upgrade?.autoMiningUnlocked
  ) {
    showToast(
      `자동 채굴 업그레이드를 ${formatMoney(
        state.config.autoMiningUpgradePrice,
      )}에 먼저 구매하세요.`,
    );
    return;
  }

  if (
    state.autoMining ||
    !state.insideMine ||
    elements.settingsModal.classList.contains(
      "hidden",
    ) === false
  ) {
    return;
  }

  state.autoMining = true;
  renderAutoMiningUpgrade();

  mineOnce();

  state.autoMiningTimer = window.setInterval(
    mineOnce,
    state.config.cooldownMs,
  );
}

function stopAutoMining() {
  if (state.autoMiningTimer) {
    window.clearInterval(state.autoMiningTimer);
    state.autoMiningTimer = null;
  }

  state.autoMining = false;
  renderAutoMiningUpgrade();
}

function toggleAutoMining() {
  if (!state.insideMine) {
    return;
  }

  if (state.autoMining) {
    stopAutoMining();
    showToast("자동 채굴을 껐습니다.");
    return;
  }

  startAutoMining();

  if (
    state.upgrade?.autoMiningUnlocked
  ) {
    showToast("자동 채굴을 켰습니다.");
  }
}

async function buyAutoMiningUpgrade() {
  if (!state.account) {
    openSettings();
    return;
  }

  stopAutoMining();

  const result =
    await bridge.buyAutoMiningUpgrade(
      state.account.id,
    );

  if (!result.ok) {
    showToast(result.error);
    return;
  }

  state.account.balance = result.balance;
  state.account.updatedAt =
    result.transaction.createdAt;

  state.upgrade = result.upgrade;

  renderAll();

  showToast(
    "자동 채굴 업그레이드를 구매했습니다. 광산에서 숫자 0으로 켜고 끌 수 있습니다.",
  );
}

async function sellOre(oreKey, quantity) {
  if (!state.account) {
    return;
  }

  stopAutoMining();

  const result = await bridge.sellOre({
    accountId: state.account.id,
    oreKey,
    quantity,
  });

  if (!result.ok) {
    showToast(result.error);
    return;
  }

  state.inventory = result.inventory;
  state.account.balance = result.balance;
  state.account.updatedAt =
    result.transaction.createdAt;

  await reloadHistoryOnly();
  renderAll();

  const ore = oreByKey(oreKey);
  showToast(
    `${ore?.name || "광석"} ${formatNumber(
      quantity,
    )}개를 ${formatMoney(
      result.transaction.amount,
    )}에 판매했습니다.`,
  );
}

async function sellAllOre() {
  if (!state.account) {
    return;
  }

  stopAutoMining();

  const result = await bridge.sellAllOre(
    state.account.id,
  );

  if (!result.ok) {
    showToast(result.error);
    return;
  }

  state.inventory = result.inventory;
  state.account.balance = result.balance;
  state.account.updatedAt =
    result.transaction.createdAt;

  await reloadHistoryOnly();
  renderAll();

  showToast(
    `광석 전체를 ${formatMoney(
      result.transaction.amount,
    )}에 판매했습니다.`,
  );
}

async function reloadHistoryOnly() {
  const result =
    await bridge.getAccountState(
      state.account.id,
    );

  if (!result.connected) {
    return;
  }

  state.account = result.account;
  state.inventory = result.inventory;
  state.upgrade = result.upgrade || {
    autoMiningUnlocked: false,
  };
  state.history = result.history || [];
  state.salesHistory = result.salesHistory || [];
  state.statistics = result.statistics || null;
}

async function refreshAll() {
  stopAutoMining();

  state.settings = await bridge.getSettings();
  await loadAccounts();
  showToast("계좌와 보관함을 새로고침했습니다.");
}

function bindEvents() {
  elements.refreshButton.addEventListener(
    "click",
    refreshAll,
  );

  elements.settingsButton.addEventListener(
    "click",
    openSettings,
  );

  elements.closeSettingsButton.addEventListener(
    "click",
    closeSettings,
  );

  elements.settingsModal.addEventListener(
    "click",
    (event) => {
      if (event.target === elements.settingsModal) {
        closeSettings();
      }
    },
  );

  elements.autoDetectWalletButton.addEventListener(
    "click",
    autoDetectWallet,
  );

  elements.chooseWalletDatabaseButton.addEventListener(
    "click",
    chooseWalletDatabase,
  );

  elements.saveSettingsButton.addEventListener(
    "click",
    saveSettings,
  );

  elements.enterMineButton.addEventListener(
    "click",
    enterMine,
  );

  elements.leaveMineButton.addEventListener(
    "click",
    leaveMine,
  );

  elements.rockWall.addEventListener(
    "click",
    mineOnce,
  );

  elements.buyAutoMiningUpgradeButton
    .addEventListener(
      "click",
      buyAutoMiningUpgrade,
    );

  elements.sellAllButton.addEventListener(
    "click",
    sellAllOre,
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        closeSettings();
        stopAutoMining();
        return;
      }

      if (event.key === "F5") {
        event.preventDefault();
        refreshAll();
        return;
      }

      const isZero =
        event.code === "Digit0" ||
        event.code === "Numpad0";

      if (
        isZero &&
        !event.repeat &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        toggleAutoMining();
      }
    },
  );
}

async function initialize() {
  bindEvents();

  state.config =
    await bridge.getMiningConfig();
  state.settings = await bridge.getSettings();

  await loadAccounts();

  if (
    !state.settings.walletDatabasePath ||
    state.accounts.length === 0
  ) {
    const detected =
      await bridge.autoDetectWallet();

    if (detected.found) {
      state.settings =
        await bridge.getSettings();
      await loadAccounts();
    }
  }

  if (!state.account) {
    openSettings();
  }
}

initialize().catch((error) => {
  console.error(error);
  showToast(`초기화 오류: ${error.message}`);
});
