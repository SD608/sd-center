"use strict";

const api = window.sdMukjippa;
const state = {
  settings: null,
  moves: [],
  maxStreak: 8,
  multipliers: [],
  accounts: [],
  account: null,
  session: null,
  hands: [],
  history: [],
  stats: null,
  busy: false,
  audioContext: null,
  musicTimer: null,
  lastEnd: null,
};

const elements = {
  accountSelect: document.querySelector("#accountSelect"),
  arena: document.querySelector("#arena"),
  attackerBadge: document.querySelector("#attackerBadge"),
  autoDetectButton: document.querySelector("#autoDetectButton"),
  balanceText: document.querySelector("#balanceText"),
  betButtons: document.querySelector("#betButtons"),
  betInput: document.querySelector("#betInput"),
  callText: document.querySelector("#callText"),
  cashoutButton: document.querySelector("#cashoutButton"),
  centerButton: document.querySelector("#centerButton"),
  chooseDbButton: document.querySelector("#chooseDbButton"),
  computerFighter: document.querySelector("#computerFighter"),
  computerHand: document.querySelector("#computerHand"),
  confetti: document.querySelector("#confetti"),
  continueButton: document.querySelector("#continueButton"),
  decisionPanel: document.querySelector("#decisionPanel"),
  decisionText: document.querySelector("#decisionText"),
  decisionTitle: document.querySelector("#decisionTitle"),
  endPanel: document.querySelector("#endPanel"),
  endText: document.querySelector("#endText"),
  endTitle: document.querySelector("#endTitle"),
  fairnessCode: document.querySelector("#fairnessCode"),
  gameHistory: document.querySelector("#gameHistory"),
  handGuideText: document.querySelector("#handGuideText"),
  handGuideTitle: document.querySelector("#handGuideTitle"),
  handLog: document.querySelector("#handLog"),
  handPanel: document.querySelector("#handPanel"),
  musicButton: document.querySelector("#musicButton"),
  newGameButton: document.querySelector("#newGameButton"),
  playerFighter: document.querySelector("#playerFighter"),
  playerHand: document.querySelector("#playerHand"),
  potentialPayout: document.querySelector("#potentialPayout"),
  refreshButton: document.querySelector("#refreshButton"),
  rewardTable: document.querySelector("#rewardTable"),
  soundButton: document.querySelector("#soundButton"),
  startButton: document.querySelector("#startButton"),
  startPanel: document.querySelector("#startPanel"),
  statBest: document.querySelector("#statBest"),
  statGames: document.querySelector("#statGames"),
  statPayout: document.querySelector("#statPayout"),
  statStake: document.querySelector("#statStake"),
  statusText: document.querySelector("#statusText"),
  streakTitle: document.querySelector("#streakTitle"),
  streakTrack: document.querySelector("#streakTrack"),
  transactionList: document.querySelector("#transactionList"),
  volumeInput: document.querySelector("#volumeInput"),
  volumeText: document.querySelector("#volumeText"),
  walletMessage: document.querySelector("#walletMessage"),
};

elements.handButtons = [...document.querySelectorAll("[data-move]")];

function formatKrw(value) {
  return `${Math.trunc(Number(value) || 0).toLocaleString("ko-KR")}원`;
}

function formatMultiplier(value) {
  return `x${Number(value || 0).toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function sleep(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function moveInfo(key) {
  return state.moves.find((move) => move.key === key) || { key, label: "?", name: "?", emoji: "?" };
}

function parseBet() {
  const raw = elements.betInput.value.replace(/[^0-9]/g, "");
  return raw ? Math.trunc(Number(raw)) : 0;
}

function setBet(value) {
  const amount = Math.max(0, Math.min(1_000_000_000, Math.trunc(Number(value) || 0)));
  elements.betInput.value = amount.toLocaleString("ko-KR");
  renderRewardTable();
}

function currentStreak() {
  return Number(state.session?.streak || 0);
}

function payoutForPreview(streak, stake = parseBet()) {
  if (!streak || !stake) return 0;
  return Math.floor(stake * 1.9 * (1.5 ** (streak - 1)));
}

function showOnly(panel) {
  for (const candidate of [elements.startPanel, elements.handPanel, elements.decisionPanel, elements.endPanel]) {
    candidate.classList.toggle("hidden", candidate !== panel);
  }
}

function renderAudioButtons() {
  elements.soundButton.classList.toggle("off", !state.settings.soundEnabled);
  elements.musicButton.classList.toggle("off", !state.settings.musicEnabled);
  elements.soundButton.textContent = state.settings.soundEnabled ? "🔊 효과음" : "🔇 효과음";
  elements.musicButton.textContent = state.settings.musicEnabled ? "🎵 배경음" : "🚫 배경음";
  elements.volumeInput.value = String(state.settings.masterVolume);
  elements.volumeText.textContent = `${state.settings.masterVolume}%`;
}

function renderRewardTable() {
  if (!state.multipliers.length) return;
  const stake = parseBet();
  elements.rewardTable.innerHTML = state.multipliers.map((multiplier, index) => {
    const streak = index + 1;
    const payout = stake ? Math.floor(stake * multiplier) : 0;
    return `
      <div class="reward-row ${streak === state.maxStreak ? "max" : ""}">
        <span>${streak}연승${streak === state.maxStreak ? " · 자동정산" : ""}</span>
        <span>${formatMultiplier(multiplier)}</span>
        <span>${formatKrw(payout)}</span>
      </div>
    `;
  }).join("");
}

function renderStreak() {
  const streak = currentStreak();
  elements.streakTrack.innerHTML = state.multipliers.map((multiplier, index) => {
    const step = index + 1;
    const className = step <= streak ? "done" : (step === streak + 1 && state.session ? "current" : "");
    return `<div class="streak-step ${className}"><strong>${step}연승</strong><span>${formatMultiplier(multiplier)}</span></div>`;
  }).join("");

  if (!state.session) {
    elements.streakTitle.textContent = "도전을 시작하세요";
    elements.potentialPayout.textContent = "0원";
    return;
  }
  elements.streakTitle.textContent = streak > 0 ? `${streak}연승 진행 중` : "첫 승리를 노리는 중";
  elements.potentialPayout.textContent = formatKrw(state.session.potentialPayout);
}

function renderAccounts() {
  const selected = state.settings?.selectedAccountId || "";
  elements.accountSelect.innerHTML = state.accounts.length
    ? state.accounts.map((account) => `
      <option value="${escapeHtml(account.id)}" ${account.id === selected ? "selected" : ""}>
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
    const deposit = item.type === "deposit";
    return `
      <div class="transaction-row">
        <div><strong>${escapeHtml(item.memo)}</strong><small>${new Date(item.createdAt).toLocaleString("ko-KR")}</small></div>
        <span class="amount ${item.type}">${deposit ? "+" : "−"}${formatKrw(item.amount)}</span>
      </div>
    `;
  }).join("");
}

function renderHandLog() {
  if (!state.hands.length) {
    elements.handLog.innerHTML = '<p class="empty">아직 진행 기록이 없습니다.</p>';
    return;
  }
  elements.handLog.innerHTML = state.hands.map((hand) => {
    const player = moveInfo(hand.playerMove);
    const computer = moveInfo(hand.computerMove);
    let result = hand.comparison === "tie" ? "같은 손" : (hand.comparison === "player" ? "플레이어 우세" : "컴퓨터 우세");
    if (hand.matchResult === "player_win") result = "플레이어 승리";
    if (hand.matchResult === "computer_win") result = "컴퓨터 승리";
    return `
      <div class="log-row">
        <span class="hands">${player.emoji} : ${computer.emoji}</span>
        <div><strong>${hand.phaseBefore === "rps" ? "공격권 결정" : "묵찌빠"}</strong><span class="detail">#${hand.handNumber} · 검증 ${hand.commitment.slice(0, 8)}</span></div>
        <span class="result">${result}</span>
      </div>
    `;
  }).join("");
}

function renderHistory() {
  if (!state.history.length) {
    elements.gameHistory.innerHTML = '<p class="empty">완료된 도전이 없습니다.</p>';
    return;
  }
  elements.gameHistory.innerHTML = state.history.map((item) => {
    const win = item.status === "cashed_out";
    return `
      <div class="history-row">
        <div><strong>${win ? `${item.streak}연승 정산` : `${item.streak}연승에서 실패`}</strong><small>도전금 ${formatKrw(item.stake)}</small></div>
        <span class="amount ${win ? "win" : "loss"}">${win ? `+${formatKrw(item.payout)}` : "0원"}</span>
      </div>
    `;
  }).join("");
}

function renderStats() {
  const stats = state.stats || { games: 0, bestStreak: 0, totalStake: 0, totalPayout: 0 };
  elements.statGames.textContent = stats.games.toLocaleString("ko-KR");
  elements.statBest.textContent = `${stats.bestStreak}연승`;
  elements.statStake.textContent = formatKrw(stats.totalStake);
  elements.statPayout.textContent = formatKrw(stats.totalPayout);
}

function updateAttacker(attacker) {
  elements.attackerBadge.className = "attacker-badge";
  if (attacker === "player") {
    elements.attackerBadge.classList.add("player");
    elements.attackerBadge.textContent = "▶ 플레이어 공격";
  } else if (attacker === "computer") {
    elements.attackerBadge.classList.add("computer");
    elements.attackerBadge.textContent = "컴퓨터 공격 ◀";
  } else {
    elements.attackerBadge.classList.add("neutral");
    elements.attackerBadge.textContent = "공격권 결정 전";
  }
}

function setHands(player = "?", computer = "?") {
  elements.playerHand.textContent = player;
  elements.computerHand.textContent = computer;
}

function renderSession() {
  renderStreak();
  elements.arena.classList.remove("win", "lose");
  if (!state.session) {
    updateAttacker(null);
    elements.fairnessCode.textContent = "공정성 코드: -";
    elements.callText.textContent = "READY";
    elements.statusText.textContent = state.account ? "도전금을 정하고 게임을 시작하세요" : "계좌를 연결하고 게임을 시작하세요";
    setHands("?", "?");
    showOnly(elements.startPanel);
    startMusicLoop();
    return;
  }

  updateAttacker(state.session.attacker);
  elements.fairnessCode.textContent = state.session.commitment
    ? `공정성 코드: ${state.session.commitment.slice(0, 18)}…`
    : "공정성 코드: 결과 확정 단계";

  if (state.session.phase === "rps") {
    elements.callText.textContent = "가위바위보";
    elements.statusText.textContent = "첫 공격권을 정합니다. 손을 선택하세요.";
    elements.handGuideTitle.textContent = "공격권 결정";
    elements.handGuideText.textContent = "컴퓨터 손은 입력 전에 이미 확정되어 있습니다.";
    setHands("✊", "✊");
    showOnly(elements.handPanel);
  } else if (state.session.phase === "mjp") {
    elements.callText.textContent = "묵찌빠";
    elements.statusText.textContent = state.session.attacker === "player"
      ? "같은 손을 만들면 플레이어가 승리합니다."
      : "같은 손이 나오면 컴퓨터가 승리합니다.";
    elements.handGuideTitle.textContent = state.session.attacker === "player" ? "공격 중 · 같은 손을 노리세요" : "수비 중 · 같은 손을 피하세요";
    elements.handGuideText.textContent = "다른 손이면 가위바위보 승자가 다음 공격권을 가져갑니다.";
    setHands("✊", "✊");
    showOnly(elements.handPanel);
  } else if (state.session.phase === "decision") {
    elements.callText.textContent = `${state.session.streak}연승!`;
    elements.statusText.textContent = "지금 받을지, 다음 연승에 도전할지 선택하세요.";
    elements.decisionTitle.textContent = `${formatKrw(state.session.potentialPayout)}을 받을까요?`;
    elements.decisionText.textContent = `다음 도전에서 패배하면 ${formatKrw(state.session.potentialPayout)}은 전부 사라집니다.`;
    elements.cashoutButton.textContent = `${formatKrw(state.session.potentialPayout)} 받기`;
    elements.continueButton.textContent = `${state.session.streak + 1}연승 도전`;
    setHands("🏆", "⚡");
    showOnly(elements.decisionPanel);
  }
  startMusicLoop();
}

function renderAll() {
  renderSession();
  renderHandLog();
  renderHistory();
  renderStats();
  renderRewardTable();
}

function audioVolume(scale = 1) {
  return Math.max(.0001, (Number(state.settings?.masterVolume || 0) / 100) * scale);
}

function ensureAudio() {
  if (!state.audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) state.audioContext = new AudioContextClass();
  }
  if (state.audioContext?.state === "suspended") state.audioContext.resume();
  return state.audioContext;
}

function tone(frequency, delay = 0, duration = .12, type = "sine", volume = .05) {
  if (!state.settings.soundEnabled) return;
  const context = ensureAudio();
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const start = context.currentTime + delay;
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(.0001, start);
  gain.gain.exponentialRampToValueAtTime(audioVolume(volume), start + .012);
  gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + .03);
}

function musicTone(frequency, duration = .22, volume = .016) {
  if (!state.settings.musicEnabled || !state.session) return;
  const context = ensureAudio();
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(audioVolume(volume), context.currentTime + .02);
  gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + duration + .03);
}

function playClick() { tone(540, 0, .06, "square", .025); }
function playPrepay() { tone(170, 0, .08, "square", .035); tone(110, .07, .14, "triangle", .025); }
function playReveal() { tone(190, 0, .07, "square", .06); tone(420, .035, .1, "triangle", .035); }
function playTie() { tone(350, 0, .1, "sine", .035); tone(350, .13, .1, "sine", .025); }
function playAttack(player) {
  if (player) { tone(450, 0, .1, "triangle", .04); tone(690, .1, .16, "triangle", .05); }
  else { tone(160, 0, .14, "sawtooth", .035); tone(105, .1, .2, "sawtooth", .03); }
}
function playWin(streak) {
  const count = Math.min(7, 3 + streak);
  for (let index = 0; index < count; index += 1) tone(440 * (2 ** ([0,4,7,12,16,19,24][index] / 12)), index * .08, .2, "triangle", .04 + streak * .002);
}
function playLose() { tone(230, 0, .18, "sawtooth", .045); tone(175, .16, .22, "sawtooth", .04); tone(110, .35, .35, "triangle", .035); }
function playCashout() { [660, 880, 1100, 1320].forEach((note, index) => tone(note, index * .09, .24, "sine", .045)); }
function playMaxWin() {
  [0,4,7,12,16,19,24,28].forEach((step, index) => tone(420 * (2 ** (step / 12)), index * .08, .3, "triangle", .06));
}

function startMusicLoop() {
  if (state.musicTimer) window.clearInterval(state.musicTimer);
  state.musicTimer = null;
  if (!state.settings.musicEnabled || !state.session || state.session.phase === "decision") return;
  const streak = Math.max(0, currentStreak());
  const interval = Math.max(420, 900 - streak * 65);
  let beat = 0;
  state.musicTimer = window.setInterval(() => {
    const root = 92 + streak * 7;
    musicTone(beat % 4 === 0 ? root * 1.5 : root, .16 + streak * .01, .012 + streak * .0015);
    beat += 1;
  }, interval);
}

function runConfetti(big = false) {
  elements.confetti.replaceChildren();
  const count = big ? 130 : 55;
  for (let index = 0; index < count; index += 1) {
    const item = document.createElement("i");
    item.style.setProperty("--x", `${Math.random() * 100}%`);
    item.style.setProperty("--hue", `${Math.floor(Math.random() * 360)}`);
    item.style.setProperty("--duration", `${1.6 + Math.random() * 1.8}s`);
    item.style.setProperty("--rotation", `${Math.random() * 180}deg`);
    item.style.setProperty("--drift", `${-140 + Math.random() * 280}px`);
    item.style.animationDelay = `${Math.random() * .4}s`;
    elements.confetti.appendChild(item);
  }
  window.setTimeout(() => elements.confetti.replaceChildren(), 3800);
}

function animateCallWord(word) {
  elements.callText.textContent = word;
  elements.callText.classList.remove("pop");
  void elements.callText.offsetWidth;
  elements.callText.classList.add("pop");
  tone(390 + Math.random() * 80, 0, .1, "square", .025);
}

async function animateReveal(reveal) {
  elements.playerFighter.classList.add("shaking");
  elements.computerFighter.classList.add("shaking");
  setHands("✊", "✊");
  const words = reveal.phaseBefore === "rps" ? ["가위", "바위", "보"] : ["묵", "찌", "빠"];
  for (const word of words) {
    animateCallWord(word);
    await sleep(300);
  }
  elements.playerFighter.classList.remove("shaking");
  elements.computerFighter.classList.remove("shaking");
  const player = moveInfo(reveal.playerMove);
  const computer = moveInfo(reveal.computerMove);
  setHands(player.emoji, computer.emoji);
  elements.playerFighter.classList.add("reveal");
  elements.computerFighter.classList.add("reveal");
  playReveal();
  await sleep(480);
  elements.playerFighter.classList.remove("reveal");
  elements.computerFighter.classList.remove("reveal");
  elements.fairnessCode.textContent = reveal.verified
    ? `✓ 검증 완료 · ${reveal.commitment.slice(0, 12)}…`
    : "검증 실패";
}

function resultMessage(reveal) {
  if (reveal.matchResult === "player_win") return "같은 손! 플레이어가 이번 묵찌빠에서 승리했습니다.";
  if (reveal.matchResult === "computer_win") return "같은 손! 컴퓨터가 이번 묵찌빠에서 승리했습니다.";
  if (reveal.phaseBefore === "rps" && reveal.comparison === "tie") return "비겼습니다. 공격권을 다시 정합니다.";
  if (reveal.comparison === "player") return reveal.phaseBefore === "rps" ? "플레이어가 첫 공격권을 가져갑니다." : "플레이어가 다음 공격권을 가져갑니다.";
  return reveal.phaseBefore === "rps" ? "컴퓨터가 첫 공격권을 가져갑니다." : "컴퓨터가 다음 공격권을 가져갑니다.";
}

function setBusy(busy) {
  state.busy = busy;
  for (const button of [elements.startButton, elements.cashoutButton, elements.continueButton, elements.newGameButton, ...elements.handButtons]) button.disabled = busy;
  elements.betInput.disabled = busy || Boolean(state.session);
  for (const button of elements.betButtons.querySelectorAll("button")) button.disabled = busy || Boolean(state.session);
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
  elements.walletMessage.textContent = `${result.databasePath} · F5로 새로고침`;
  await loadSelectedAccount();
  return true;
}

async function loadSelectedAccount() {
  const accountId = elements.accountSelect.value || state.settings.selectedAccountId || "";
  state.session = null;
  state.hands = [];
  state.history = [];
  state.stats = null;
  if (!accountId) {
    state.account = null;
    elements.balanceText.textContent = "-";
    renderTransactions([]);
    renderAll();
    return;
  }
  state.settings.selectedAccountId = accountId;
  await api.saveSettings({ selectedAccountId: accountId });
  const accountResult = await api.getWalletAccount(accountId);
  if (!accountResult.connected) {
    state.account = null;
    elements.balanceText.textContent = "-";
    elements.walletMessage.textContent = accountResult.error || "계좌를 불러오지 못했습니다.";
    renderTransactions([]);
    renderAll();
    return;
  }
  state.account = accountResult.account;
  elements.balanceText.textContent = formatKrw(state.account.balance);
  renderTransactions(accountResult.transactions);

  const gameResult = await api.getGameState(accountId);
  if (gameResult.ok) {
    state.session = gameResult.session;
    state.hands = gameResult.hands;
    state.history = gameResult.history;
    state.stats = gameResult.stats;
  } else {
    elements.statusText.textContent = gameResult.error || "게임 상태를 불러오지 못했습니다.";
  }
  renderAll();
  setBusy(false);
}

async function refreshAll() {
  if (state.busy) return;
  elements.refreshButton.textContent = "…";
  try { await loadAccounts({ autoSelect: false }); }
  finally { elements.refreshButton.textContent = "↻"; }
}

async function startGame() {
  if (state.busy) return;
  if (!state.account) {
    elements.statusText.textContent = "먼저 SD지갑 계좌를 연결하세요.";
    return;
  }
  const betAmount = parseBet();
  if (!Number.isSafeInteger(betAmount) || betAmount < 100) {
    elements.statusText.textContent = "도전금은 100원 이상의 정수로 입력하세요.";
    return;
  }
  ensureAudio();
  setBusy(true);
  elements.statusText.textContent = "도전금을 선결제하는 중입니다…";
  playPrepay();
  const result = await api.startGame({ accountId: state.account.id, betAmount });
  if (!result.ok) {
    elements.statusText.textContent = result.error || "게임을 시작하지 못했습니다.";
    setBusy(false);
    return;
  }
  state.session = result.session;
  state.settings.betAmount = betAmount;
  state.account.balance = result.balance;
  elements.balanceText.textContent = formatKrw(result.balance);
  state.hands = [];
  state.lastEnd = null;
  renderAll();
  elements.statusText.textContent = `${formatKrw(betAmount)} 선결제 완료. 첫 공격권을 정하세요.`;
  setBusy(false);
}

async function chooseHand(move) {
  if (state.busy || !state.session || !["rps", "mjp"].includes(state.session.phase)) return;
  ensureAudio();
  setBusy(true);
  const previousSession = { ...state.session };
  const result = await api.playHand({ accountId: state.account.id, sessionId: state.session.id, playerMove: move });
  if (!result.ok) {
    elements.statusText.textContent = result.error || "손 선택을 처리하지 못했습니다.";
    setBusy(false);
    return;
  }
  await animateReveal(result.reveal);
  state.session = result.session;
  elements.statusText.textContent = resultMessage(result.reveal);
  updateAttacker(result.reveal.attackerAfter);

  if (result.reveal.matchResult === "player_win") {
    elements.arena.classList.add("win");
    if (result.autoCashedOut) {
      state.account.balance = result.balance;
      elements.balanceText.textContent = formatKrw(result.balance);
      playMaxWin();
      runConfetti(true);
      state.lastEnd = {
        title: "8연승 달성! 최대 보상 자동 정산",
        text: `${formatKrw(result.session.potentialPayout)}이 SD지갑에 입금되었습니다.`,
      };
      showEndPanel(state.lastEnd.title, state.lastEnd.text);
    } else {
      playWin(state.session.streak);
      runConfetti(state.session.streak >= 5);
      await sleep(450);
      renderSession();
    }
  } else if (result.reveal.matchResult === "computer_win") {
    elements.arena.classList.add("lose");
    playLose();
    state.lastEnd = {
      title: "연승 도전 실패",
      text: `${previousSession.streak}연승의 정산 예정 금액과 도전금이 모두 소멸했습니다.`,
    };
    showEndPanel(state.lastEnd.title, state.lastEnd.text);
  } else {
    if (result.reveal.comparison === "tie") playTie();
    else playAttack(result.reveal.comparison === "player");
    await sleep(450);
    renderSession();
  }

  await refreshAfterAction({ keepEndPanel: Boolean(state.lastEnd) });
  setBusy(false);
}

function showEndPanel(title, text) {
  elements.endTitle.textContent = title;
  elements.endText.textContent = text;
  showOnly(elements.endPanel);
  renderStreak();
  startMusicLoop();
}

async function refreshAfterAction({ keepEndPanel = false } = {}) {
  const accountResult = await api.getWalletAccount(state.account.id);
  if (accountResult.connected) {
    state.account = accountResult.account;
    elements.balanceText.textContent = formatKrw(state.account.balance);
    renderTransactions(accountResult.transactions);
  }
  const gameResult = await api.getGameState(state.account.id);
  if (gameResult.ok) {
    state.session = gameResult.session;
    state.hands = gameResult.hands;
    state.history = gameResult.history;
    state.stats = gameResult.stats;
  }
  renderHandLog();
  renderHistory();
  renderStats();
  renderStreak();
  if (!keepEndPanel) renderSession();
}

async function cashOut() {
  if (state.busy || !state.session || state.session.phase !== "decision") return;
  ensureAudio();
  setBusy(true);
  const result = await api.cashOut({ accountId: state.account.id, sessionId: state.session.id });
  if (!result.ok) {
    elements.statusText.textContent = result.error || "정산하지 못했습니다.";
    setBusy(false);
    return;
  }
  state.account.balance = result.balance;
  elements.balanceText.textContent = formatKrw(result.balance);
  playCashout();
  runConfetti(state.session.streak >= 4);
  const streak = state.session.streak;
  state.lastEnd = { title: `${streak}연승 보상 정산 완료`, text: `${formatKrw(result.payout)}이 SD지갑에 입금되었습니다.` };
  showEndPanel(state.lastEnd.title, state.lastEnd.text);
  await refreshAfterAction({ keepEndPanel: true });
  setBusy(false);
}

async function continueStreak() {
  if (state.busy || !state.session || state.session.phase !== "decision") return;
  ensureAudio();
  setBusy(true);
  playAttack(true);
  const result = await api.continueStreak({ accountId: state.account.id, sessionId: state.session.id });
  if (!result.ok) {
    elements.statusText.textContent = result.error || "다음 도전을 시작하지 못했습니다.";
    setBusy(false);
    return;
  }
  state.session = result.session;
  state.hands = [];
  state.lastEnd = null;
  renderAll();
  elements.statusText.textContent = `${state.session.streak + 1}연승을 위한 새 묵찌빠를 시작합니다.`;
  setBusy(false);
}

async function toggleSetting(key) {
  state.settings[key] = !state.settings[key];
  await api.saveSettings({ [key]: state.settings[key] });
  renderAudioButtons();
  if (key === "musicEnabled") startMusicLoop();
  playClick();
}

function prepareNewGame() {
  state.lastEnd = null;
  state.session = null;
  renderSession();
}

function addBet(increment) {
  let next = parseBet() + increment;
  if (state.account && next > state.account.balance) next = state.account.balance;
  setBet(next);
}

elements.betButtons.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  playClick();
  if (button.dataset.action === "reset") setBet(state.account && state.account.balance < 1000 ? state.account.balance : 1000);
  else addBet(Number(button.dataset.bet || 0));
});
elements.betInput.addEventListener("input", () => setBet(parseBet()));
elements.startButton.addEventListener("click", startGame);
for (const button of elements.handButtons) button.addEventListener("click", () => chooseHand(button.dataset.move));
elements.cashoutButton.addEventListener("click", cashOut);
elements.continueButton.addEventListener("click", continueStreak);
elements.newGameButton.addEventListener("click", prepareNewGame);
elements.refreshButton.addEventListener("click", refreshAll);
elements.accountSelect.addEventListener("change", loadSelectedAccount);
elements.autoDetectButton.addEventListener("click", async () => {
  const result = await api.autoDetectWallet();
  elements.walletMessage.textContent = result.found ? "SD지갑을 찾았습니다." : "SD지갑 데이터베이스를 자동으로 찾지 못했습니다.";
  if (result.found) { state.settings.walletDatabasePath = result.path; await loadAccounts(); }
});
elements.chooseDbButton.addEventListener("click", async () => {
  const result = await api.chooseWalletDatabase();
  if (result?.ok) { state.settings.walletDatabasePath = result.path; await loadAccounts(); }
  else if (!result?.canceled && result?.error) elements.walletMessage.textContent = result.error;
});
elements.soundButton.addEventListener("click", () => toggleSetting("soundEnabled"));
elements.musicButton.addEventListener("click", () => toggleSetting("musicEnabled"));
elements.volumeInput.addEventListener("input", () => {
  state.settings.masterVolume = Number(elements.volumeInput.value);
  elements.volumeText.textContent = `${state.settings.masterVolume}%`;
});
elements.volumeInput.addEventListener("change", () => api.saveSettings({ masterVolume: state.settings.masterVolume }));
elements.centerButton.addEventListener("click", async () => {
  const result = await api.openCenter();
  if (!result.ok) elements.statusText.textContent = result.error;
});
window.addEventListener("keydown", (event) => {
  if (event.key === "F5") {
    event.preventDefault();
    refreshAll();
    return;
  }
  if (state.busy || !state.session || !["rps", "mjp"].includes(state.session.phase)) return;
  const mapping = { "1": "rock", "2": "scissors", "3": "paper" };
  if (mapping[event.key]) chooseHand(mapping[event.key]);
});

async function initialize() {
  const bootstrap = await api.getBootstrap();
  state.settings = bootstrap.settings;
  state.moves = bootstrap.moves;
  state.maxStreak = bootstrap.maxStreak;
  state.multipliers = bootstrap.multipliers;
  setBet(state.settings.betAmount || 1000);
  renderAudioButtons();
  renderRewardTable();
  renderStreak();
  const connected = await loadAccounts();
  if (!connected) {
    const detected = await api.autoDetectWallet();
    if (detected.found) {
      state.settings.walletDatabasePath = detected.path;
      await loadAccounts();
    }
  }
}

initialize().catch((error) => {
  elements.statusText.textContent = error.message || "앱을 초기화하지 못했습니다.";
});
