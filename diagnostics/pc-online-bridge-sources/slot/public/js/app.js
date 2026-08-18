"use strict";

const api = window.sdSlot;
const state = {
  settings: null,
  symbols: [],
  accounts: [],
  account: null,
  spinning: false,
  soundEnabled: true,
  audioContext: null,
};

const elements = {
  accountSelect: document.getElementById("accountSelect"),
  balanceText: document.getElementById("balanceText"),
  walletMessage: document.getElementById("walletMessage"),
  autoDetectButton: document.getElementById("autoDetectButton"),
  chooseDbButton: document.getElementById("chooseDbButton"),
  refreshButton: document.getElementById("refreshButton"),
  betInput: document.getElementById("betInput"),
  presetRow: document.getElementById("presetRow"),
  spinButton: document.getElementById("spinButton"),
  lever: document.getElementById("lever"),
  resultBoard: document.getElementById("resultBoard"),
  resultText: document.getElementById("resultText"),
  payoutText: document.getElementById("payoutText"),
  paytable: document.getElementById("paytable"),
  transactionList: document.getElementById("transactionList"),
  soundButton: document.getElementById("soundButton"),
  centerButton: document.getElementById("centerButton"),
  fireworks: document.getElementById("fireworks"),
  reels: [...document.querySelectorAll(".reel")],
};

const visualSymbols = [
  { key: "stone", name: "돌", art: "◆" },
  { key: "coal", name: "석탄", art: "●" },
  { key: "copper", name: "구리", art: "⬢" },
  { key: "iron", name: "철", art: "⬡" },
  { key: "gold", name: "금", art: "◆" },
  { key: "emerald", name: "에메랄드", art: "◆" },
  { key: "diamond", name: "다이아", art: "◇" },
  { key: "seven", name: "7", art: "7" },
  { key: "red-seven", name: "빨간 7", art: "7" },
  { key: "gold-seven", name: "황금색 7", art: "7" },
];
const visualByKey = new Map(visualSymbols.map((symbol) => [symbol.key, symbol]));
const REEL_STOP_INTERVAL_MS = 800;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("\'", "&#039;");
}

function formatKrw(value) {
  return `${Math.trunc(Number(value) || 0).toLocaleString("ko-KR")}원`;
}

function parseBet() {
  const digits = elements.betInput.value.replace(/[^0-9]/g, "");
  return digits ? Number(digits) : 0;
}

function setBet(value) {
  const amount = Math.min(1_000_000_000, Math.max(0, Math.trunc(Number(value) || 0)));
  elements.betInput.value = amount.toLocaleString("ko-KR");
}

function setSymbol(reel, key) {
  const symbol = visualByKey.get(key) || visualSymbols[0];
  reel.innerHTML = `
    <div class="symbol symbol-${symbol.key}" aria-label="${symbol.name}">
      <span class="symbol-art" aria-hidden="true">${symbol.art}</span>
    </div>
  `;
}

function renderPaytable() {
  elements.paytable.innerHTML = state.symbols.map((symbol) => {
    const label = symbol.key === "miss" ? "꽝 (불일치)" : `${symbol.name} 3개 일치`;
    return `
      <div class="pay-row ${symbol.key === "gold-seven" ? "jackpot-row" : ""}">
        <span>${label}</span>
        <span>x${symbol.multiplier}</span>
        <span>${symbol.probability}</span>
      </div>
    `;
  }).join("");
}

function renderAccounts() {
  const selected = state.settings?.selectedAccountId || "";
  elements.accountSelect.innerHTML = state.accounts.length
    ? state.accounts.map((account) => `
        <option value="${account.id}" ${account.id === selected ? "selected" : ""}>
          ${escapeHtml(account.bankName)} · ${escapeHtml(account.accountNumber)} · ${escapeHtml(account.ownerName)}
        </option>
      `).join("")
    : '<option value="">연결 가능한 계좌가 없습니다</option>';
}

function renderTransactions(transactions = []) {
  if (!transactions.length) {
    elements.transactionList.innerHTML = '<p class="empty">최근 거래가 없습니다.</p>';
    return;
  }
  elements.transactionList.innerHTML = transactions.map((item) => {
    const sign = item.type === "deposit" ? "+" : "−";
    return `
      <div class="transaction">
        <strong>${escapeHtml(item.memo)}</strong>
        <span class="amount ${item.type}">${sign}${formatKrw(item.amount)}</span>
        <time>${new Date(item.createdAt).toLocaleString("ko-KR")}</time>
      </div>
    `;
  }).join("");
}

async function loadAccounts({ autoSelect = true } = {}) {
  const result = await api.listWalletAccounts();
  if (!result.connected) {
    state.accounts = [];
    state.account = null;
    renderAccounts();
    elements.balanceText.textContent = "-";
    elements.walletMessage.textContent = result.error || "SD지갑을 한 번 실행한 뒤 자동 연결을 누르세요.";
    renderTransactions([]);
    return false;
  }

  state.accounts = result.accounts;
  if (autoSelect && state.accounts.length) {
    const exists = state.accounts.some((account) => account.id === state.settings.selectedAccountId);
    if (!exists) state.settings.selectedAccountId = state.accounts[0].id;
  }
  renderAccounts();
  elements.walletMessage.textContent = result.databasePath;
  await loadSelectedAccount();
  return true;
}

async function loadSelectedAccount() {
  const accountId = elements.accountSelect.value || state.settings?.selectedAccountId || "";
  if (!accountId) {
    state.account = null;
    elements.balanceText.textContent = "-";
    renderTransactions([]);
    return;
  }

  state.settings.selectedAccountId = accountId;
  await api.saveSettings({ selectedAccountId: accountId });
  const result = await api.getWalletAccount(accountId);
  if (!result.connected) {
    state.account = null;
    elements.balanceText.textContent = "-";
    elements.walletMessage.textContent = result.error || "계좌를 불러오지 못했습니다.";
    renderTransactions([]);
    return;
  }
  state.account = result.account;
  elements.balanceText.textContent = formatKrw(result.account.balance);
  renderTransactions(result.transactions);
}

function ensureAudio() {
  if (!state.soundEnabled) return null;
  if (!state.audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) state.audioContext = new AudioContextClass();
  }
  if (state.audioContext?.state === "suspended") state.audioContext.resume();
  return state.audioContext;
}

function tone(frequency, delay, duration, type = "sine", volume = 0.05) {
  const context = ensureAudio();
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const start = context.currentTime + delay;
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

function playLeverSound() {
  tone(130, 0, .07, "square", .035);
  tone(90, .06, .11, "square", .025);
}

function playSpinSound() {
  const notes = [520, 660, 780, 610, 720, 870];
  for (let index = 0; index < 24; index += 1) {
    tone(notes[index % notes.length], index * .065, .075, "triangle", .025);
  }
}

function playStopSound(index) {
  tone(180 + index * 45, 0, .06, "square", .045);
  tone(90, .035, .08, "square", .02);
}

function playWinSound(multiplier) {
  const base = multiplier >= 100 ? 620 : 440;
  [0, 4, 7, 12].forEach((step, index) => tone(base * (2 ** (step / 12)), index * .11, .22, "sine", .055));
}

function playJackpotSound() {
  const pattern = [0, 4, 7, 12, 7, 12, 16, 19];
  pattern.forEach((step, index) => tone(420 * (2 ** (step / 12)), index * .095, .28, "triangle", .065));
}

function runFireworks() {
  elements.fireworks.replaceChildren();
  const bursts = [
    { x: 22, y: 30 }, { x: 50, y: 18 }, { x: 78, y: 32 },
    { x: 35, y: 55 }, { x: 67, y: 52 },
  ];
  for (const burst of bursts) {
    for (let index = 0; index < 34; index += 1) {
      const angle = (Math.PI * 2 * index) / 34 + Math.random() * .18;
      const distance = 80 + Math.random() * 190;
      const spark = document.createElement("i");
      spark.className = "spark";
      spark.style.setProperty("--x", `${burst.x}%`);
      spark.style.setProperty("--y", `${burst.y}%`);
      spark.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
      spark.style.setProperty("--dy", `${Math.sin(angle) * distance + 90}px`);
      spark.style.setProperty("--hue", `${Math.floor(Math.random() * 360)}`);
      spark.style.setProperty("--duration", `${1.1 + Math.random() * .8}s`);
      elements.fireworks.appendChild(spark);
    }
  }
  window.setTimeout(() => elements.fireworks.replaceChildren(), 2600);
}

function sleep(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function animateReels(targets) {
  const timers = elements.reels.map((reel, reelIndex) => {
    reel.classList.add("spinning");
    let offset = reelIndex * 3;
    return window.setInterval(() => {
      const symbol = visualSymbols[offset % visualSymbols.length];
      setSymbol(reel, symbol.key);
      offset += 1;
    }, 72);
  });

  await sleep(1100);
  for (let index = 0; index < elements.reels.length; index += 1) {
    window.clearInterval(timers[index]);
    const reel = elements.reels[index];
    reel.classList.remove("spinning");
    reel.classList.add("stopping");
    setSymbol(reel, targets[index]);
    playStopSound(index);
    window.setTimeout(() => reel.classList.remove("stopping"), 260);
    if (index < elements.reels.length - 1) await sleep(REEL_STOP_INTERVAL_MS);
  }
}

function setBusy(busy) {
  state.spinning = busy;
  elements.spinButton.disabled = busy;
  elements.lever.disabled = busy;
  elements.betInput.disabled = busy;
  elements.accountSelect.disabled = busy;
  for (const button of elements.presetRow.querySelectorAll("button")) button.disabled = busy;
}

async function spin() {
  if (state.spinning) return;
  if (!state.account) {
    elements.resultText.textContent = "먼저 SD지갑 계좌를 연결하세요";
    return;
  }

  const betAmount = parseBet();
  if (!Number.isSafeInteger(betAmount) || betAmount < 100) {
    elements.resultText.textContent = "베팅금은 100원 이상의 정수로 입력하세요";
    return;
  }

  ensureAudio();
  setBusy(true);
  elements.resultBoard.className = "result-board";
  elements.resultText.textContent = "베팅금을 선결제하는 중...";
  elements.payoutText.textContent = formatKrw(betAmount);
  elements.lever.classList.remove("pulling");
  void elements.lever.offsetWidth;
  elements.lever.classList.add("pulling");
  playLeverSound();

  let started;
  try {
    started = await api.startSpin({
      accountId: state.account.id,
      betAmount,
    });
    if (!started.ok) throw new Error(started.error);

    state.account.balance = started.balanceAfterBet;
    elements.balanceText.textContent = formatKrw(started.balanceAfterBet);
    elements.resultText.textContent = "슬롯 회전 중...";
    elements.payoutText.textContent = `−${formatKrw(started.stake)} 선결제 완료`;
    playSpinSound();

    await animateReels(started.reels);

    const settlement = await api.settleSpin(started.roundId);
    if (!settlement.ok) throw new Error(settlement.error);

    state.account.balance = settlement.balance;
    elements.balanceText.textContent = formatKrw(settlement.balance);

    if (started.won) {
      elements.resultBoard.classList.add("win");
      elements.resultText.textContent = `${started.resultName} 3개 일치 · x${started.multiplier}`;
      elements.payoutText.textContent = `+${formatKrw(started.payout)} 입금 완료`;
      if (started.jackpot) {
        elements.resultBoard.classList.add("jackpot");
        elements.resultText.textContent = "황금색 777 JACKPOT!";
        playJackpotSound();
        runFireworks();
      } else {
        playWinSound(started.multiplier);
      }
    } else {
      elements.resultText.textContent = "꽝 · 세 릴이 일치하지 않았습니다";
      elements.payoutText.textContent = "당첨금 없음";
    }

    await loadSelectedAccount();
  } catch (error) {
    elements.resultBoard.className = "result-board";
    elements.resultText.textContent = error.message || "슬롯 처리 중 오류가 발생했습니다.";
    elements.payoutText.textContent = started?.roundId
      ? "미정산 당첨금은 다음 실행 시 자동 복구됩니다"
      : "베팅이 처리되지 않았습니다";
    await loadSelectedAccount();
  } finally {
    window.setTimeout(() => elements.lever.classList.remove("pulling"), 1650);
    setBusy(false);
  }
}

async function initialize() {
  const bootstrap = await api.getBootstrap();
  state.settings = bootstrap.settings;
  state.symbols = bootstrap.symbols;
  state.soundEnabled = bootstrap.settings.soundEnabled !== false;
  setBet(1000);
  elements.soundButton.textContent = state.soundEnabled ? "🔊 소리 켬" : "🔇 소리 끔";
  renderPaytable();

  const connected = await loadAccounts();
  if (!connected) {
    const detected = await api.autoDetectWallet();
    if (detected.found) {
      state.settings.walletDatabasePath = detected.path;
      await loadAccounts();
    }
  }
}

elements.presetRow.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  if (button.dataset.action === "reset") {
    setBet(1000);
    return;
  }

  if (button.dataset.bet) {
    const increment = Math.max(0, Math.trunc(Number(button.dataset.bet) || 0));
    const nextBet = parseBet() + increment;

    if (increment === 1_000_000 && state.account && nextBet > state.account.balance) {
      setBet(state.account.balance);
      elements.resultText.textContent = "계좌 잔액에 맞춰 베팅금을 자동 조정했습니다";
      elements.payoutText.textContent = `현재 잔액 ${formatKrw(state.account.balance)}`;
      return;
    }

    setBet(nextBet);
  }
});

elements.betInput.addEventListener("input", () => setBet(parseBet()));
elements.betInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") spin();
});
elements.spinButton.addEventListener("click", spin);
elements.lever.addEventListener("click", spin);
elements.accountSelect.addEventListener("change", loadSelectedAccount);
elements.refreshButton.addEventListener("click", () => loadAccounts({ autoSelect: false }));

document.addEventListener("keydown", async (event) => {
  if (event.key !== "F5") return;
  event.preventDefault();
  if (state.spinning) return;

  elements.walletMessage.textContent = "F5로 계좌 목록과 잔액을 새로고침하는 중...";
  await loadAccounts({ autoSelect: false });
});

elements.autoDetectButton.addEventListener("click", async () => {
  const result = await api.autoDetectWallet();
  elements.walletMessage.textContent = result.found ? result.path : "SD지갑 데이터베이스를 자동으로 찾지 못했습니다.";
  if (result.found) {
    state.settings.walletDatabasePath = result.path;
    state.settings.selectedAccountId = "";
    await loadAccounts();
  }
});

elements.chooseDbButton.addEventListener("click", async () => {
  const result = await api.chooseWalletDatabase();
  if (result.canceled) return;
  elements.walletMessage.textContent = result.ok ? result.path : result.error;
  if (result.ok) {
    state.settings.walletDatabasePath = result.path;
    state.settings.selectedAccountId = "";
    await loadAccounts();
  }
});

elements.soundButton.addEventListener("click", async () => {
  state.soundEnabled = !state.soundEnabled;
  elements.soundButton.textContent = state.soundEnabled ? "🔊 소리 켬" : "🔇 소리 끔";
  await api.saveSettings({ soundEnabled: state.soundEnabled });
  if (state.soundEnabled) {
    ensureAudio();
    tone(660, 0, .12, "sine", .04);
  }
});

elements.centerButton.addEventListener("click", async () => {
  const result = await api.openCenter();
  if (!result.ok) elements.walletMessage.textContent = result.error;
});

initialize().catch((error) => {
  elements.resultText.textContent = error.message || "앱 초기화에 실패했습니다.";
});
