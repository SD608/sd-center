"use strict";

const bridge = window.sdOddEven;

const state = {
  settings: null,
  accounts: [],
  account: null,
  transactions: [],

  phase: "ready",
  selectedMultiplier: 1,
  selectedBetKrw: 1000,
  betMode: "fixed",
  roundId: "",
  stake: 0,
  resolving: false,

  toastTimer: null,
};

const elements = {
  settingsButton: document.getElementById(
    "settingsButton",
  ),
  settingsModal: document.getElementById(
    "settingsModal",
  ),
  closeSettingsButton: document.getElementById(
    "closeSettingsButton",
  ),

  gameStage: document.getElementById("gameStage"),
  roundStatus: document.getElementById(
    "roundStatus",
  ),
  dieOne: document.getElementById("dieOne"),
  dieTwo: document.getElementById("dieTwo"),
  resultOverlay: document.getElementById(
    "resultOverlay",
  ),
  resultBadge: document.getElementById(
    "resultBadge",
  ),
  resultText: document.getElementById(
    "resultText",
  ),
  resultAmount: document.getElementById(
    "resultAmount",
  ),

  betAmountSelector: document.getElementById(
    "betAmountSelector",
  ),
  customBetInput: document.getElementById(
    "customBetInput",
  ),
  applyCustomBetButton: document.getElementById(
    "applyCustomBetButton",
  ),
  multiplierHelp: document.getElementById(
    "multiplierHelp",
  ),
  multiplierSelector: document.getElementById(
    "multiplierSelector",
  ),
  stakeAmount: document.getElementById(
    "stakeAmount",
  ),

  primaryControls: document.getElementById(
    "primaryControls",
  ),
  mainActionButton: document.getElementById(
    "mainActionButton",
  ),
  choiceControls: document.getElementById(
    "choiceControls",
  ),
  oddButton: document.getElementById("oddButton"),
  evenButton: document.getElementById(
    "evenButton",
  ),
  gameMessage: document.getElementById(
    "gameMessage",
  ),

  walletEmpty: document.getElementById(
    "walletEmpty",
  ),
  walletConnected: document.getElementById(
    "walletConnected",
  ),
  connectWalletButton: document.getElementById(
    "connectWalletButton",
  ),
  changeAccountButton: document.getElementById(
    "changeAccountButton",
  ),
  refreshAccountButton: document.getElementById(
    "refreshAccountButton",
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
  accountUpdatedAt: document.getElementById(
    "accountUpdatedAt",
  ),
  transactionList: document.getElementById(
    "transactionList",
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
  }, 2800);
}

function parseMoneyInput(value) {
  const digits = String(value || "").replace(/[^0-9]/g, "");

  if (!digits) {
    return 0;
  }

  const numeric = Number(digits);

  return Number.isSafeInteger(numeric) ? numeric : 0;
}

function formatMoneyInput(value) {
  const numeric = Math.max(0, Math.trunc(Number(value) || 0));
  return numeric.toLocaleString("ko-KR");
}

function currentStake() {
  if (state.betMode === "all-in") {
    return Math.max(0, Math.trunc(Number(state.account?.balance || 0)));
  }

  return state.selectedBetKrw * state.selectedMultiplier;
}

function controlsEditable() {
  return ["ready", "result"].includes(state.phase);
}

function updateStakeDisplay() {
  const stake = currentStake();
  const balance = Number(state.account?.balance || 0);
  const editable = controlsEditable();
  const allIn = state.betMode === "all-in";

  elements.stakeAmount.textContent = formatMoney(stake);
  elements.stakeAmount.classList.toggle(
    "insufficient",
    Boolean(state.account) && stake > balance,
  );

  for (const button of elements.betAmountSelector.querySelectorAll(
    "button",
  )) {
    const fixedAmount = Number(button.dataset.betAmount);
    const isAllInButton = button.dataset.betMode === "all-in";

    button.classList.toggle(
      "active",
      isAllInButton
        ? allIn
        : !allIn && fixedAmount === state.selectedBetKrw,
    );
    button.disabled = !editable;
  }

  elements.customBetInput.disabled = !editable;
  elements.applyCustomBetButton.disabled = !editable;
  elements.customBetInput.value = formatMoneyInput(
    state.selectedBetKrw,
  );

  elements.multiplierHelp.textContent = allIn
    ? "올인은 배수를 적용하지 않습니다"
    : "선택 금액 × 배수";

  for (const button of elements.multiplierSelector.querySelectorAll(
    "button[data-multiplier]",
  )) {
    button.classList.toggle(
      "active",
      Number(button.dataset.multiplier) ===
        state.selectedMultiplier,
    );

    button.disabled = !editable || allIn;
  }
}

function setDice(first, second) {
  elements.dieOne.dataset.value = String(first);
  elements.dieTwo.dataset.value = String(second);
  elements.dieOne.setAttribute(
    "aria-label",
    `첫 번째 주사위 ${first}`,
  );
  elements.dieTwo.setAttribute(
    "aria-label",
    `두 번째 주사위 ${second}`,
  );
}

function setPhase(phase, options = {}) {
  state.phase = phase;

  elements.gameStage.className =
    `game-stage state-${
      phase === "result" ? "revealed" : phase
    }`;

  elements.primaryControls.classList.toggle(
    "hidden",
    phase === "choosing",
  );
  elements.choiceControls.classList.toggle(
    "hidden",
    phase !== "choosing",
  );

  const phaseConfig = {
    ready: {
      status: "준비",
      statusClass: "ready",
      buttonText: "시작",
      buttonHint: "SPACE",
      buttonClass: "start",
      message:
        "시작 버튼이나 스페이스바를 누르세요.",
    },

    shaking: {
      status: "섞는 중",
      statusClass: "shaking",
      buttonText: "멈춤",
      buttonHint: "SPACE",
      buttonClass: "stop",
      message:
        "컵이 움직이는 중입니다. 멈춤을 누르세요.",
    },

    covered: {
      status: "정지 중",
      statusClass: "shaking",
      buttonText: "처리 중",
      buttonHint: "",
      buttonClass: "stop",
      message: "주사위 결과를 고정하고 있습니다.",
    },

    choosing: {
      status: "선택",
      statusClass: "choosing",
      buttonText: "",
      buttonHint: "",
      buttonClass: "",
      message:
        "홀은 키보드 1, 짝은 키보드 2 또는 버튼으로 선택하세요.",
    },

    result: {
      status: options.won ? "적중" : "실패",
      statusClass: options.won ? "won" : "lost",
      buttonText: "다시 게임",
      buttonHint: "SPACE",
      buttonClass: "reset",
      message:
        "결과가 계좌와 입출금 내역에 반영되었습니다.",
    },
  };

  const config = phaseConfig[phase];

  elements.roundStatus.textContent = config.status;
  elements.roundStatus.className =
    `round-status ${config.statusClass}`;

  if (phase !== "choosing") {
    elements.mainActionButton.innerHTML =
      `${config.buttonText}${
        config.buttonHint
          ? `<span>${config.buttonHint}</span>`
          : ""
      }`;

    elements.mainActionButton.className =
      `main-action ${config.buttonClass}`;
  }

  elements.gameMessage.textContent =
    config.message;

  elements.resultOverlay.classList.toggle(
    "hidden",
    phase !== "result",
  );

  updateStakeDisplay();
}

function renderAccount() {
  const connected = Boolean(state.account);

  elements.walletEmpty.classList.toggle(
    "hidden",
    connected,
  );
  elements.walletConnected.classList.toggle(
    "hidden",
    !connected,
  );

  if (!connected) {
    elements.accountBank.textContent = "-";
    elements.accountNumber.textContent = "-";
    elements.accountOwner.textContent = "-";
    elements.accountBalance.textContent =
      formatMoney(0);
    elements.accountUpdatedAt.textContent = "-";
    return;
  }

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
  elements.accountUpdatedAt.textContent =
    `갱신: ${formatDate(
      state.account.updatedAt,
    )}`;

  updateStakeDisplay();
}

function renderTransactions() {
  elements.transactionList.replaceChildren();

  if (state.transactions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-history";
    empty.textContent = "거래내역이 없습니다.";
    elements.transactionList.appendChild(empty);
    return;
  }

  for (const transaction of state.transactions) {
    const item = document.createElement("article");
    item.className =
      `transaction-item ${
        transaction.type === "withdraw"
          ? "withdraw"
          : "deposit"
      }`;

    const detail = document.createElement("div");
    const memo = document.createElement("strong");
    const time = document.createElement("time");
    const amount = document.createElement("strong");

    memo.textContent =
      transaction.memo || "거래";
    time.textContent =
      formatDate(transaction.createdAt);

    amount.className = "amount";
    amount.textContent =
      `${
        transaction.type === "withdraw"
          ? "-"
          : "+"
      }${formatMoney(transaction.amount)}`;

    detail.append(memo, time);
    item.append(detail, amount);
    elements.transactionList.appendChild(item);
  }
}

async function loadSelectedAccount() {
  const accountId =
    state.settings?.selectedAccountId;

  if (!accountId) {
    state.account = null;
    state.transactions = [];
    renderAccount();
    renderTransactions();
    return;
  }

  const result =
    await bridge.getWalletAccount(accountId);

  if (!result.connected) {
    state.account = null;
    state.transactions = [];
    renderAccount();
    renderTransactions();

    if (result.error) {
      showToast(result.error);
    }

    return;
  }

  state.account = result.account;
  state.transactions = result.transactions || [];
  renderAccount();
  renderTransactions();
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
    state.transactions = [];
    renderAccount();
    renderTransactions();
    return;
  }

  elements.walletPathText.textContent =
    result.databasePath;

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
      `${account.bankName} · ${account.accountNumber} · ${formatMoney(
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
  updateStakeDisplay();
  closeSettings();
  showToast("설정이 저장되었습니다.");
}

async function startRound() {
  if (!state.account) {
    showToast("먼저 게임 계좌를 연결하세요.");
    openSettings();
    return;
  }

  const result = await bridge.startGame({
    accountId: state.account.id,
    betAmountKrw: state.selectedBetKrw,
    multiplier: state.selectedMultiplier,
    allIn: state.betMode === "all-in",
  });

  if (!result.ok) {
    showToast(result.error);
    return;
  }

  state.roundId = result.roundId;
  state.stake = result.stake;

  elements.resultOverlay.className =
    "result-overlay hidden";
  setDice(1, 1);
  setPhase("shaking");
}

async function stopRound() {
  if (
    state.phase !== "shaking" ||
    !state.roundId
  ) {
    return;
  }

  setPhase("covered");

  const result = await bridge.stopGame(
    state.roundId,
  );

  if (!result.ok) {
    showToast(result.error);
    resetRound();
    return;
  }

  setPhase("choosing");
}

async function resolveRound(choice) {
  if (
    state.phase !== "choosing" ||
    !state.roundId ||
    state.resolving
  ) {
    return;
  }

  state.resolving = true;
  elements.oddButton.disabled = true;
  elements.evenButton.disabled = true;

  const result = await bridge.resolveGame({
    roundId: state.roundId,
    choice,
  });

  if (!result.ok) {
    state.resolving = false;
    elements.oddButton.disabled = false;
    elements.evenButton.disabled = false;
    showToast(result.error);
    resetRound();
    await loadSelectedAccount();
    return;
  }

  setDice(result.dice[0], result.dice[1]);

  elements.resultOverlay.className =
    `result-overlay ${
      result.won ? "win" : "lose"
    }`;

  elements.resultBadge.textContent =
    result.won ? "적중" : "실패";

  const parityText =
    result.parity === "odd" ? "홀" : "짝";

  elements.resultText.textContent =
    `${result.dice[0]} + ${result.dice[1]} = ${result.sum} · ${parityText}`;

  elements.resultAmount.textContent =
    `${result.won ? "입금" : "출금"} ${formatMoney(
      result.stake,
    )} · 메모: 홀짝 게임`;

  state.account.balance = result.balance;
  state.account.updatedAt =
    result.transaction.createdAt;

  state.transactions.unshift(
    result.transaction,
  );
  state.transactions =
    state.transactions.slice(0, 12);

  renderAccount();
  renderTransactions();
  setPhase("result", {
    won: result.won,
  });

  state.resolving = false;
  elements.oddButton.disabled = false;
  elements.evenButton.disabled = false;
}

function resetRound() {
  state.roundId = "";
  state.stake = 0;
  state.resolving = false;
  elements.resultOverlay.className =
    "result-overlay hidden";
  setDice(1, 1);
  setPhase("ready");
}

async function handleMainAction() {
  if (state.phase === "ready") {
    await startRound();
    return;
  }

  if (state.phase === "shaking") {
    await stopRound();
    return;
  }

  if (state.phase === "result") {
    resetRound();
  }
}

function bindEvents() {
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

  elements.connectWalletButton.addEventListener(
    "click",
    openSettings,
  );

  elements.changeAccountButton.addEventListener(
    "click",
    openSettings,
  );

  elements.refreshAccountButton.addEventListener(
    "click",
    loadSelectedAccount,
  );

  elements.autoDetectWalletButton.addEventListener(
    "click",
    autoDetectWallet,
  );

  elements.chooseWalletDatabaseButton.addEventListener(
    "click",
    chooseWalletDatabase,
  );

  elements.accountSelect.addEventListener(
    "change",
    async () => {
      state.settings = await bridge.saveSettings({
        selectedAccountId:
          elements.accountSelect.value,
      });

      await loadSelectedAccount();
    },
  );


  elements.saveSettingsButton.addEventListener(
    "click",
    saveSettings,
  );

  elements.betAmountSelector.addEventListener(
    "click",
    async (event) => {
      const button = event.target.closest("button");

      if (!button || !controlsEditable()) {
        return;
      }

      if (button.dataset.betMode === "all-in") {
        if (!state.account || Number(state.account.balance) <= 0) {
          showToast("올인할 수 있는 계좌 잔액이 없습니다.");
          return;
        }

        state.betMode = "all-in";
      } else {
        const amount = Number(button.dataset.betAmount);

        if (!Number.isSafeInteger(amount) || amount < 100) {
          return;
        }

        state.selectedBetKrw = amount;
        state.betMode = "fixed";
      }

      state.settings = await bridge.saveSettings({
        selectedBetKrw: state.selectedBetKrw,
        betMode: state.betMode,
      });

      updateStakeDisplay();
    },
  );

  async function applyCustomBet() {
    if (!controlsEditable()) {
      return;
    }

    const amount = parseMoneyInput(
      elements.customBetInput.value,
    );

    if (amount < 100) {
      showToast("직접 입력 배팅금은 100원 이상이어야 합니다.");
      elements.customBetInput.value = formatMoneyInput(
        state.selectedBetKrw,
      );
      return;
    }

    state.selectedBetKrw = amount;
    state.betMode = "fixed";
    state.settings = await bridge.saveSettings({
      selectedBetKrw: amount,
      betMode: "fixed",
    });

    updateStakeDisplay();
    showToast(`${formatMoney(amount)}을 기본 배팅금으로 적용했습니다.`);
  }

  elements.customBetInput.addEventListener(
    "input",
    () => {
      const amount = parseMoneyInput(
        elements.customBetInput.value,
      );
      elements.customBetInput.value = amount
        ? formatMoneyInput(amount)
        : "";
    },
  );

  elements.customBetInput.addEventListener(
    "keydown",
    async (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        await applyCustomBet();
      }
    },
  );

  elements.customBetInput.addEventListener(
    "blur",
    () => {
      if (!elements.customBetInput.value) {
        elements.customBetInput.value = formatMoneyInput(
          state.selectedBetKrw,
        );
      }
    },
  );

  elements.applyCustomBetButton.addEventListener(
    "click",
    applyCustomBet,
  );

  elements.multiplierSelector.addEventListener(
    "click",
    async (event) => {
      const button = event.target.closest(
        "button[data-multiplier]",
      );

      if (
        !button ||
        !["ready", "result"].includes(
          state.phase,
        )
      ) {
        return;
      }

      state.selectedMultiplier =
        Number(button.dataset.multiplier);

      state.settings = await bridge.saveSettings({
        selectedMultiplier:
          state.selectedMultiplier,
      });

      updateStakeDisplay();
    },
  );

  elements.mainActionButton.addEventListener(
    "click",
    handleMainAction,
  );

  elements.oddButton.addEventListener(
    "click",
    () => resolveRound("odd"),
  );

  elements.evenButton.addEventListener(
    "click",
    () => resolveRound("even"),
  );

  document.addEventListener(
    "keydown",
    async (event) => {
      const target = event.target;
      const isTyping = target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;

      if (isTyping) {
        if (event.key === "Escape") {
          target.blur();
        }
        return;
      }

      if (
        event.code === "Space" &&
        elements.settingsModal.classList.contains(
          "hidden",
        )
      ) {
        event.preventDefault();

        if (
          ["ready", "shaking", "result"].includes(
            state.phase,
          )
        ) {
          await handleMainAction();
        }

        return;
      }

      if (
        state.phase === "choosing" &&
        elements.settingsModal.classList.contains("hidden")
      ) {
        if (event.code === "Digit1" || event.code === "Numpad1") {
          event.preventDefault();
          await resolveRound("odd");
          return;
        }

        if (event.code === "Digit2" || event.code === "Numpad2") {
          event.preventDefault();
          await resolveRound("even");
          return;
        }
      }

      if (event.key === "Escape") {
        closeSettings();
      }
    },
  );
}

async function initialize() {
  bindEvents();

  state.settings = await bridge.getSettings();
  state.selectedMultiplier =
    state.settings.selectedMultiplier || 1;
  state.selectedBetKrw =
    state.settings.selectedBetKrw ||
    state.settings.baseBetKrw ||
    1000;
  state.betMode =
    state.settings.betMode === "all-in"
      ? "all-in"
      : "fixed";

  setDice(1, 1);
  updateStakeDisplay();
  setPhase("ready");

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
}

initialize().catch((error) => {
  console.error(error);
  showToast(`초기화 오류: ${error.message}`);
});
