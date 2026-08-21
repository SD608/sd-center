"use strict";

(() => {
  const api = window.staApi;
  if (!api) throw new Error("STA API를 불러오지 못했습니다.");

  const $ = (selector) => document.querySelector(selector);
  const scenes = [...document.querySelectorAll(".scene")];
  const state = {
    bootstrap: null,
    settings: null,
    accounts: [],
    account: null,
    transactions: [],
    operation: null,
    lastResult: null,
    operationCooldownUnlockAt: null,
    operationCooldownRemainingMs: 0,
    activeScene: "menuScene",
    modalResolver: null,
    loopCancel: null,
    lootTimer: null,
    audio: null,
    musicTimer: null,
    cooldownTimer: null,
  };

  const elements = {
    accountSelect: $("#accountSelect"), balanceText: $("#balanceText"), refreshButton: $("#refreshButton"),
    autoDetectButton: $("#autoDetectButton"), chooseDbButton: $("#chooseDbButton"), soundButton: $("#soundButton"),
    musicButton: $("#musicButton"), volumeSlider: $("#volumeSlider"), centerButton: $("#centerButton"),
    progressText: $("#progressText"), rawCashText: $("#rawCashText"), projectedPayoutText: $("#projectedPayoutText"),
    operationStatusText: $("#operationStatusText"), hackingCard: $("#hackingCard"), raidCard: $("#raidCard"),
    transportCard: $("#transportCard"), hackingStatus: $("#hackingStatus"), raidStatus: $("#raidStatus"),
    transportStatus: $("#transportStatus"), hackingCanvas: $("#hackingCanvas"), hackingRoundText: $("#hackingRoundText"),
    laserCanvas: $("#laserCanvas"), laserHitText: $("#laserHitText"), vaultArea: $("#vaultArea"),
    vaultRing: $("#vaultRing"), vaultPercent: $("#vaultPercent"), lootArea: $("#lootArea"),
    lootTimerText: $("#lootTimerText"), lootCashText: $("#lootCashText"), transportCanvas: $("#transportCanvas"),
    transportHitText: $("#transportHitText"), transportPayoutText: $("#transportPayoutText"),
    payoutRawText: $("#payoutRawText"), payoutLossText: $("#payoutLossText"), payoutFinalText: $("#payoutFinalText"),
    payoutAccountSelect: $("#payoutAccountSelect"), payoutRefreshButton: $("#payoutRefreshButton"), payoutButton: $("#payoutButton"),
    overlayMessage: $("#overlayMessage"), overlayTitle: $("#overlayTitle"), overlayBody: $("#overlayBody"),
    modal: $("#modal"), modalTitle: $("#modalTitle"), modalBody: $("#modalBody"), modalCancel: $("#modalCancel"),
    modalConfirm: $("#modalConfirm"), toast: $("#toast"),
  };

  const formatMoney = (value) => `${Math.max(0, Math.floor(Number(value) || 0)).toLocaleString("ko-KR")}원`;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 2300);
  }

  function showOverlay(title, body, duration = 1800) {
    elements.overlayTitle.textContent = title;
    elements.overlayBody.textContent = body;
    elements.overlayMessage.classList.add("show");
    return new Promise((resolve) => setTimeout(() => {
      elements.overlayMessage.classList.remove("show");
      resolve();
    }, duration));
  }

  function confirmModal(title, body, confirmText = "확인") {
    elements.modalTitle.textContent = title;
    elements.modalBody.textContent = body;
    elements.modalConfirm.textContent = confirmText;
    elements.modal.classList.add("show");
    elements.modal.setAttribute("aria-hidden", "false");
    return new Promise((resolve) => { state.modalResolver = resolve; });
  }

  function closeModal(value) {
    elements.modal.classList.remove("show");
    elements.modal.setAttribute("aria-hidden", "true");
    if (state.modalResolver) state.modalResolver(value);
    state.modalResolver = null;
  }

  class SoundSystem {
    constructor() { this.context = null; }
    ensure() {
      if (!this.context) this.context = new (window.AudioContext || window.webkitAudioContext)();
      if (this.context.state === "suspended") this.context.resume();
      return this.context;
    }
    enabled() { return state.settings?.soundEnabled !== false && Number(state.settings?.masterVolume || 0) > 0; }
    gainValue(scale = 1) { return Math.max(0, Math.min(1, Number(state.settings?.masterVolume || 70) / 100)) * scale; }
    tone(frequency, duration = .12, type = "sine", volume = .16, delay = 0) {
      if (!this.enabled()) return;
      const ctx = this.ensure();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + delay;
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(.0001, this.gainValue(volume)), start + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + .02);
    }
    click() { this.tone(520, .07, "square", .08); }
    error() { this.tone(150, .22, "sawtooth", .13); this.tone(105, .3, "square", .08, .08); }
    connect() { this.tone(480, .08, "sine", .11); this.tone(780, .14, "sine", .12, .05); }
    success() { [440, 554, 659, 880].forEach((f, i) => this.tone(f, .25, "triangle", .11, i * .08)); }
    warning() { this.tone(220, .13, "square", .12); }
    cash() { this.tone(780, .055, "square", .06); }
    collision() { this.tone(90, .3, "sawtooth", .2); this.tone(55, .4, "square", .12); }
    vault() { this.tone(170 + Math.random() * 35, .05, "square", .06); }
    payout() { [523,659,784,1046].forEach((f,i) => this.tone(f,.35,"sine",.13,i*.1)); }
  }

  function updateMusic() {
    clearInterval(state.musicTimer);
    state.musicTimer = null;
    if (state.settings?.musicEnabled === false || state.activeScene === "menuScene" || !state.audio) return;
    let step = 0;
    state.musicTimer = setInterval(() => {
      if (state.settings?.musicEnabled === false || state.activeScene === "menuScene") return;
      const notes = [82, 98, 110, 98];
      state.audio.tone(notes[step % notes.length], .5, "sine", .035);
      step += 1;
    }, 650);
  }

  function setScene(id) {
    stopGameActivity();
    scenes.forEach((scene) => scene.classList.toggle("active", scene.id === id));
    state.activeScene = id;
    updateMusic();
  }

  function stopGameActivity() {
    if (state.loopCancel) state.loopCancel();
    state.loopCancel = null;
    clearInterval(state.lootTimer);
    state.lootTimer = null;
  }

  async function saveSettings(patch) {
    state.settings = await api.saveSettings(patch);
    renderSettings();
  }

  function renderSettings() {
    elements.soundButton.textContent = state.settings?.soundEnabled === false ? "🔇" : "🔊";
    elements.musicButton.textContent = state.settings?.musicEnabled === false ? "🎵×" : "🎵";
    elements.volumeSlider.value = String(state.settings?.masterVolume ?? 70);
  }

  async function refreshAccounts(showMessage = false) {
    const result = await api.listWalletAccounts();
    state.accounts = result.accounts || [];
    const previous = elements.accountSelect.value || state.settings?.selectedAccountId || "";
    elements.accountSelect.innerHTML = "";
    if (!result.connected) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "SD지갑을 연결하세요";
      elements.accountSelect.append(option);
      state.account = null;
      elements.balanceText.textContent = "연결 안 됨";
      renderPayoutAccounts();
      if (showMessage && result.error) showToast(result.error);
      return;
    }
    if (state.accounts.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "가상계좌가 없습니다";
      elements.accountSelect.append(option);
      state.account = null;
      elements.balanceText.textContent = "계좌 없음";
      renderPayoutAccounts();
      return;
    }
    state.accounts.forEach((account) => {
      const option = document.createElement("option");
      option.value = account.id;
      option.textContent = `${account.bankName} ${account.accountNumber} · ${formatMoney(account.balance)}`;
      elements.accountSelect.append(option);
    });
    const selected = state.accounts.some((account) => account.id === previous) ? previous : state.accounts[0].id;
    elements.accountSelect.value = selected;
    await selectAccount(selected, false);
    renderPayoutAccounts();
    if (showMessage) showToast("계좌와 잔액을 새로고침했습니다.");
  }

  async function selectAccount(accountId, persist = true) {
    if (!accountId) return;
    const result = await api.getWalletAccount(accountId);
    state.account = result.account || null;
    state.transactions = result.transactions || [];
    elements.balanceText.textContent = state.account ? formatMoney(state.account.balance) : "계좌 없음";
    if (persist) await saveSettings({ selectedAccountId: accountId });
  }

  function renderPayoutAccounts() {
    const previous = elements.payoutAccountSelect.value;
    elements.payoutAccountSelect.innerHTML = "";
    state.accounts.forEach((account) => {
      const option = document.createElement("option");
      option.value = account.id;
      option.textContent = `${account.bankName} ${account.accountNumber} · ${account.ownerName} · ${formatMoney(account.balance)}`;
      elements.payoutAccountSelect.append(option);
    });
    if (state.accounts.some((account) => account.id === previous)) elements.payoutAccountSelect.value = previous;
    else if (state.account) elements.payoutAccountSelect.value = state.account.id;
  }

  async function refreshOperation() {
    if (!state.settings?.walletDatabasePath) {
      state.operation = null;
      state.operationCooldownUnlockAt = null;
      state.operationCooldownRemainingMs = 0;
      renderMenu();
      return;
    }
    const result = await api.getState();
    if (!result.ok) {
      state.operation = null;
      state.operationCooldownUnlockAt = null;
      state.operationCooldownRemainingMs = 0;
      if (result.error) showToast(result.error);
    } else {
      state.operation = result.operation || null;
      state.lastResult = result.lastResult || null;
      state.operationCooldownUnlockAt = result.operationCooldownUnlockAt || null;
      state.operationCooldownRemainingMs = Number(result.operationCooldownRemainingMs || 0);
    }
    renderMenu();
  }

  function operationCooldownRemaining() {
    const unlockMs = Date.parse(String(state.operationCooldownUnlockAt || ""));
    if (!Number.isFinite(unlockMs)) return Math.max(0, Number(state.operationCooldownRemainingMs || 0));
    return Math.max(0, unlockMs - Date.now());
  }

  function missionStates() {
    const phase = state.operation?.phase || "none";
    if (!state.operation && operationCooldownRemaining() > 0) {
      return { hacking: "cooldown", raid: "locked", transport: "locked" };
    }
    const hackingDone = ["raid_ready","raid_laser","raid_vault","raid_loot","transport_ready","transport","payout"].includes(phase);
    const raidDone = ["transport_ready","transport","payout"].includes(phase);
    return {
      hacking: phase === "none" ? "open" : phase === "hacking" ? "active" : hackingDone ? "complete" : "open",
      raid: phase === "raid_ready" ? "open" : ["raid_laser","raid_vault","raid_loot"].includes(phase) ? "active" : raidDone ? "complete" : "locked",
      transport: phase === "transport_ready" ? "open" : phase === "transport" ? "active" : phase === "payout" ? "payout" : "locked",
    };
  }

  function applyCard(card, label, mode) {
    card.classList.toggle("locked", mode === "locked" || mode === "cooldown");
    card.classList.toggle("complete", mode === "complete");
    card.classList.toggle("active-card", ["active","open","payout"].includes(mode));
    let lock = card.querySelector(".lock-badge");
    if ((mode === "locked" || mode === "cooldown") && !lock) {
      lock = document.createElement("div"); lock.className = "lock-badge"; lock.textContent = "🔒"; card.prepend(lock);
    } else if (mode !== "locked" && mode !== "cooldown" && lock) lock.remove();
    const map = { locked: "잠김", cooldown: "재정비 중", open: "입장 가능", active: "진행 중 · 이어하기", complete: "완료", payout: "도착 완료 · 보수 받기" };
    label.textContent = map[mode] || mode;
  }

  function formatCooldown(remainingMs) {
    const totalSeconds = Math.max(0, Math.ceil(Number(remainingMs || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function renderMenu() {
    clearInterval(state.cooldownTimer);
    state.cooldownTimer = null;
    const operation = state.operation;
    const phase = operation?.phase || "none";
    const progress = !operation ? 0 : phase === "hacking" ? 0 : ["raid_ready","raid_laser","raid_vault","raid_loot"].includes(phase) ? 1 : ["transport_ready","transport"].includes(phase) ? 2 : phase === "payout" ? 3 : 0;
    elements.progressText.textContent = `${progress} / 3`;
    elements.rawCashText.textContent = formatMoney(operation?.rawCash || 0);
    elements.projectedPayoutText.textContent = formatMoney(operation?.projectedPayout || 0);
    const statusMap = {
      none: state.lastResult?.status === "failed" ? "이전 작전 실패 · 새 작전 가능" : "새 작전 대기",
      hacking: `해킹 ${operation?.hackingRound || 1}라운드 진행 중`, raid_ready: "습격 해금",
      raid_laser: "레이저 보안실 진행 중", raid_vault: "금고 개방 중", raid_loot: "금고 현금 확보 중",
      transport_ready: "운반 해금", transport: "현금 운반 중", payout: "최종 보수 지급 대기",
    };
    elements.operationStatusText.textContent = statusMap[phase] || "작전 진행 중";
    const modes = missionStates();
    applyCard(elements.hackingCard, elements.hackingStatus, modes.hacking);
    applyCard(elements.raidCard, elements.raidStatus, modes.raid);
    applyCard(elements.transportCard, elements.transportStatus, modes.transport);

    if (!operation && operationCooldownRemaining() > 0) {
      const updateCooldown = async () => {
        const remainingMs = operationCooldownRemaining();
        state.operationCooldownRemainingMs = remainingMs;
        elements.hackingStatus.textContent = `쿨타임 ${formatCooldown(remainingMs)}`;
        elements.operationStatusText.textContent = `작전 완료 · 재정비 ${formatCooldown(remainingMs)}`;
        if (remainingMs <= 0) {
          clearInterval(state.cooldownTimer);
          state.cooldownTimer = null;
          await refreshOperation();
        }
      };
      void updateCooldown();
      state.cooldownTimer = setInterval(() => void updateCooldown(), 250);
    }
  }

  async function handleMission(mission) {
    state.audio?.ensure();
    const modes = missionStates();
    const mode = modes[mission];
    if (mode === "locked" || mode === "cooldown" || mode === "complete") {
      if (mode === "locked") { state.audio?.error(); showToast("이전 임무를 먼저 완료해야 합니다."); }
      if (mode === "cooldown") {
        state.audio?.warning();
        showToast(`새 작전 쿨타임 ${formatCooldown(operationCooldownRemaining())} 남음`);
      }
      return;
    }
    if (mission === "hacking") {
      if (!state.operation) {
        if (!state.account) { showToast("작전 참가비를 결제할 계좌를 먼저 선택하세요."); return; }
        const accepted = await confirmModal(
          "STA 작전에 입장하시겠습니까?",
          `입장료 50,000원이 선택한 가상계좌에서 먼저 출금됩니다.\n레이저에 5회 닿으면 전체 작전이 실패하며 참가비는 반환되지 않습니다.`,
          "50,000원 결제 후 입장",
        );
        if (!accepted) return;
        const result = await api.startOperation({ accountId: state.account.id });
        if (!result.ok) { state.audio?.error(); showToast(result.error); return; }
        state.operation = result.operation;
        state.audio?.success();
        await selectAccount(state.account.id, false);
      }
      startHackingScene();
      return;
    }
    if (mission === "raid") {
      if (state.operation.phase === "raid_ready") {
        const accepted = await confirmModal("습격에 입장하시겠습니까?", "레이저 보안실에서 5번째 충돌이 발생하면 전체 작전이 즉시 실패합니다.", "습격 시작");
        if (!accepted) return;
        const result = await api.startRaid({ operationId: state.operation.id });
        if (!result.ok) { showToast(result.error); return; }
        state.operation = result.operation;
      }
      resumeRaidScene();
      return;
    }
    if (mission === "transport") {
      if (state.operation.phase === "transport_ready") {
        const accepted = await confirmModal("현금을 운반하시겠습니까?", "벽에 충돌할 때마다 금고에서 확보한 현금의 5%가 최종 보수에서 차감됩니다.", "운반 시작");
        if (!accepted) return;
        const result = await api.startTransport({ operationId: state.operation.id });
        if (!result.ok) { showToast(result.error); return; }
        state.operation = result.operation;
      }
      if (state.operation.phase === "payout") showPayoutScene();
      else startTransportScene();
    }
  }

  function startHackingScene() {
    setScene("hackingScene");
    renderHackingCanvas();
  }

  function renderHackingCanvas() {
    const canvas = elements.hackingCanvas;
    const ctx = canvas.getContext("2d");
    const colors = { red: "#ff4050", blue: "#3c8dff", yellow: "#ffd447" };
    const left = ["red", "blue", "yellow"];
    const right = state.operation.hackingLayout;
    const connected = new Set(state.operation.hackingConnections);
    const yPositions = [130, 280, 430];
    let dragging = null;
    let pointer = { x: 0, y: 0 };
    let connecting = false;

    elements.hackingRoundText.textContent = `해킹 ${state.operation.hackingRound} / 3`;

    function drawGrid() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#090d13";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "rgba(80,105,130,.13)";
      ctx.lineWidth = 1;
      for (let x = 0; x < canvas.width; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
      }
      ctx.fillStyle = "#9aa8ba";
      ctx.font = "700 17px Malgun Gothic";
      ctx.fillText("입력 단자", 95, 55);
      ctx.fillText("대상 단자", 900, 55);
    }

    function drawWire(x1, y1, x2, y2, color, glow = true) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 9;
      ctx.lineCap = "round";
      if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 16; }
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      const bend = (x2 - x1) * .48;
      ctx.bezierCurveTo(x1 + bend, y1, x2 - bend, y2, x2, y2);
      ctx.stroke();
      ctx.restore();
    }

    function drawSocket(x, y, color) {
      ctx.save();
      ctx.shadowColor = colors[color];
      ctx.shadowBlur = 18;
      ctx.fillStyle = "#131a23";
      ctx.strokeStyle = colors[color];
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(x, y, 25, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = colors[color];
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    function draw() {
      drawGrid();
      left.forEach((color, index) => {
        const targetIndex = right.indexOf(color);
        if (connected.has(color)) drawWire(190, yPositions[index], 910, yPositions[targetIndex], colors[color]);
      });
      if (dragging) drawWire(190, yPositions[dragging.index], pointer.x, pointer.y, colors[dragging.color], false);
      left.forEach((color, index) => drawSocket(190, yPositions[index], color));
      right.forEach((color, index) => drawSocket(910, yPositions[index], color));
      ctx.fillStyle = "#718096";
      ctx.font = "14px Malgun Gothic";
      ctx.textAlign = "center";
      ctx.fillText("같은 색 단자 가까이 가져가면 자동으로 연결됩니다.", canvas.width / 2, 525);
    }

    function point(event) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) * canvas.width / rect.width,
        y: (event.clientY - rect.top) * canvas.height / rect.height,
      };
    }

    function near(x, y, tx, ty, radius = 36) {
      return Math.hypot(x - tx, y - ty) <= radius;
    }

    async function connectDraggedWire() {
      if (!dragging || connecting) return false;
      const targetIndex = right.indexOf(dragging.color);
      if (targetIndex < 0 || !near(pointer.x, pointer.y, 910, yPositions[targetIndex], 68)) return false;

      connecting = true;
      const source = dragging.color;
      dragging = null;
      draw();
      const result = await api.hackingConnect({
        operationId: state.operation.id,
        sourceColor: source,
        targetColor: source,
      });
      connecting = false;

      if (!result.ok || !result.connected) {
        state.audio?.error();
        showToast(result.error || "전선을 연결하지 못했습니다.");
        renderHackingCanvas();
        return true;
      }

      state.operation = result.operation;
      state.audio?.connect();
      if (result.hackingCompleted) {
        state.audio?.success();
        await showOverlay("해킹 성공", "습격이 해금되었습니다.", 2200);
        setScene("menuScene");
        renderMenu();
      } else if (result.roundCompleted) {
        await showOverlay(`해킹 ${state.operation.hackingRound - 1} 완료`, `다음 해킹 ${state.operation.hackingRound}/3을 시작합니다.`, 1000);
        renderHackingCanvas();
      } else {
        renderHackingCanvas();
      }
      return true;
    }

    const down = (event) => {
      if (connecting) return;
      pointer = point(event);
      left.forEach((color, index) => {
        if (!connected.has(color) && near(pointer.x, pointer.y, 190, yPositions[index])) dragging = { color, index };
      });
      if (dragging) {
        canvas.setPointerCapture(event.pointerId);
        state.audio?.click();
        draw();
      }
    };

    const move = (event) => {
      if (!dragging || connecting) return;
      pointer = point(event);
      draw();
      void connectDraggedWire();
    };

    const up = (event) => {
      if (!dragging || connecting) return;
      pointer = point(event);
      void connectDraggedWire().then((connectedNow) => {
        if (!connectedNow) {
          dragging = null;
          draw();
        }
      });
    };

    canvas.onpointerdown = down;
    canvas.onpointermove = move;
    canvas.onpointerup = up;
    canvas.onpointercancel = up;
    draw();
  }

  function resumeRaidScene() {
    const phase = state.operation.phase;
    if (phase === "raid_laser") startLaserScene();
    else if (phase === "raid_vault") startVaultScene();
    else if (phase === "raid_loot") startLootScene();
  }

  function startLaserScene() {
    setScene("laserScene");
    const maxHits = Number(state.bootstrap?.constants?.laserMaxHits || 5);
    elements.laserHitText.textContent = `${state.operation.laserHits} / ${maxHits}`;
    const canvas = elements.laserCanvas;
    const ctx = canvas.getContext("2d");
    const keys = new Set();
    const checkpoints = [{ x: 64, y: 558 }, { x: 382, y: 500 }, { x: 760, y: 190 }];
    const player = { ...checkpoints[state.operation.laserCheckpoint || 0], r: 12 };
    let running = true;
    let lastTime = performance.now();
    let lastHit = 0;
    let finishing = false;

    const keyDown = (event) => {
      if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) {
        keys.add(event.code);
        event.preventDefault();
      }
    };
    const keyUp = (event) => keys.delete(event.code);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);

    function segmentDistance(px, py, x1, y1, x2, y2) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = dx * dx + dy * dy;
      const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / length));
      return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    }

    function rotatingSegment(cx, cy, length, angle, options = {}) {
      const dx = Math.cos(angle) * length;
      const dy = Math.sin(angle) * length;
      return { x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy, active: true, width: 5, ...options };
    }

    function laserSegments(time) {
      const sweepY = 455 + Math.sin(time / 610) * 82;
      const sweepX = 505 + Math.sin(time / 760) * 92;
      const gateA = Math.floor(time / 850) % 2 === 0;
      const gateB = !gateA;
      const angleA = time / 820;
      const angleB = -time / 1050;
      return [
        { x1: 170, y1: 318, x2: 170, y2: 620, active: true, width: 5 },
        { x1: 170, y1: 318, x2: 352, y2: 318, active: true, width: 5 },
        { x1: 352, y1: 0, x2: 352, y2: 208, active: true, width: 5 },
        { x1: 440, y1: 425, x2: 610, y2: 425, active: true, width: 5 },
        { x1: 610, y1: 235, x2: 610, y2: 620, active: true, width: 5 },
        { x1: 735, y1: 270, x2: 950, y2: 270, active: true, width: 5 },
        { x1: 950, y1: 270, x2: 950, y2: 620, active: true, width: 5 },
        { x1: 245, y1: sweepY, x2: 515, y2: sweepY, active: true, width: 6 },
        { x1: sweepX, y1: 72, x2: sweepX, y2: 365, active: true, width: 6 },
        rotatingSegment(700, 410, 132, angleA, { width: 5 }),
        rotatingSegment(700, 410, 132, angleA + Math.PI / 2, { width: 5 }),
        rotatingSegment(835, 125, 104, angleB, { width: 5 }),
        rotatingSegment(835, 125, 104, angleB + Math.PI / 2, { width: 5 }),
        { x1: 1010, y1: 105, x2: 1010, y2: 430, active: gateA, width: 7, pulse: true },
        { x1: 785, y1: 520, x2: 1080, y2: 520, active: gateB, width: 7, pulse: true },
      ];
    }

    async function registerHit() {
      const now = performance.now();
      if (now - lastHit < 900 || finishing) return;
      lastHit = now;
      state.audio?.collision();
      const result = await api.laserHit({ operationId: state.operation.id });
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      if (result.failed) {
        finishing = true;
        running = false;
        state.operation = null;
        state.audio?.error();
        await showOverlay("작전 실패", `레이저 보안에 ${maxHits}회 감지되었습니다.
참가비는 반환되지 않으며 해킹부터 다시 시작해야 합니다.`, 3000);
        await refreshAccounts(false);
        await refreshOperation();
        setScene("menuScene");
        return;
      }
      state.operation = result.operation;
      elements.laserHitText.textContent = `${state.operation.laserHits} / ${maxHits}`;
      Object.assign(player, checkpoints[state.operation.laserCheckpoint || 0]);
    }

    async function reachCheckpoint(index) {
      if (checkpointBusy || index <= state.operation.laserCheckpoint) return;
      checkpointBusy = true;
      const result = await api.laserCheckpoint({ operationId: state.operation.id, checkpoint: index });
      if (result.ok) {
        state.operation = result.operation;
        state.audio?.connect();
        showToast(`보안 체크포인트 ${index} 저장`);
      }
      checkpointBusy = false;
    }

    async function finish() {
      if (finishing) return;
      finishing = true;
      running = false;
      const result = await api.laserPass({ operationId: state.operation.id });
      if (!result.ok) {
        finishing = false;
        running = true;
        showToast(result.error);
        return;
      }
      state.operation = result.operation;
      state.audio?.success();
      await showOverlay("보안실 통과", "금고에 진입했습니다.", 1500);
      startVaultScene();
    }

    function drawEmitter(x, y, active) {
      ctx.save();
      ctx.fillStyle = active ? "#ff3045" : "#40202a";
      ctx.shadowColor = active ? "#ff3045" : "transparent";
      ctx.shadowBlur = active ? 16 : 0;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function draw(time) {
      ctx.fillStyle = "#070a10";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const floorGradient = ctx.createRadialGradient(560, 310, 40, 560, 310, 720);
      floorGradient.addColorStop(0, "rgba(28,45,62,.32)");
      floorGradient.addColorStop(1, "rgba(3,6,10,.1)");
      ctx.fillStyle = floorGradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "rgba(60,80,105,.16)";
      ctx.lineWidth = 1;
      for (let x = 0; x < canvas.width; x += 36) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += 36) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
      }
      ctx.strokeStyle = "#344152";
      ctx.lineWidth = 18;
      ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

      checkpoints.slice(1).forEach((cp, i) => {
        const passed = i < state.operation.laserCheckpoint;
        ctx.fillStyle = passed ? "rgba(67,224,141,.13)" : "rgba(78,96,118,.12)";
        ctx.fillRect(cp.x - 30, cp.y - 30, 60, 60);
        ctx.strokeStyle = passed ? "#43e08d" : "#506076";
        ctx.lineWidth = 3;
        ctx.strokeRect(cp.x - 30, cp.y - 30, 60, 60);
      });

      ctx.fillStyle = "rgba(67,224,141,.18)";
      ctx.fillRect(1005, 20, 75, 85);
      ctx.strokeStyle = "#43e08d";
      ctx.lineWidth = 3;
      ctx.strokeRect(1005, 20, 75, 85);
      ctx.fillStyle = "#43e08d";
      ctx.font = "700 14px Malgun Gothic";
      ctx.textAlign = "center";
      ctx.fillText("금고", 1042, 66);

      const segments = laserSegments(time);
      for (const segment of segments) {
        drawEmitter(segment.x1, segment.y1, segment.active);
        drawEmitter(segment.x2, segment.y2, segment.active);
        if (!segment.active) {
          ctx.save();
          ctx.strokeStyle = "rgba(105,46,58,.35)";
          ctx.lineWidth = 2;
          ctx.setLineDash([7, 10]);
          ctx.beginPath();
          ctx.moveTo(segment.x1, segment.y1);
          ctx.lineTo(segment.x2, segment.y2);
          ctx.stroke();
          ctx.restore();
          continue;
        }
        ctx.save();
        ctx.strokeStyle = segment.pulse ? "#ff6a78" : "#ff3045";
        ctx.lineWidth = segment.width;
        ctx.shadowColor = "#ff3045";
        ctx.shadowBlur = segment.pulse ? 28 : 18;
        ctx.beginPath();
        ctx.moveTo(segment.x1, segment.y1);
        ctx.lineTo(segment.x2, segment.y2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.fillStyle = "#3be3ff";
      ctx.shadowColor = "#3be3ff";
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#c8d3df";
      ctx.font = "13px Malgun Gothic";
      ctx.textAlign = "left";
      ctx.fillText("WASD 이동 · 점멸 레이저는 꺼졌을 때 통과", 28, 34);
    }

    function loop(time) {
      if (!running) return;
      const dt = Math.min(.035, (time - lastTime) / 1000);
      lastTime = time;
      let dx = 0;
      let dy = 0;
      if (keys.has("KeyW")) dy -= 1;
      if (keys.has("KeyS")) dy += 1;
      if (keys.has("KeyA")) dx -= 1;
      if (keys.has("KeyD")) dx += 1;
      if (dx || dy) {
        const length = Math.hypot(dx, dy);
        player.x += dx / length * 225 * dt;
        player.y += dy / length * 225 * dt;
      }
      player.x = Math.max(28, Math.min(canvas.width - 28, player.x));
      player.y = Math.max(28, Math.min(canvas.height - 28, player.y));
      for (const segment of laserSegments(time)) {
        if (segment.active && segmentDistance(player.x, player.y, segment.x1, segment.y1, segment.x2, segment.y2) < player.r + segment.width) {
          registerHit();
          break;
        }
      }
      if (Math.hypot(player.x - checkpoints[1].x, player.y - checkpoints[1].y) < 35) reachCheckpoint(1);
      if (Math.hypot(player.x - checkpoints[2].x, player.y - checkpoints[2].y) < 35) reachCheckpoint(2);
      if (player.x > 995 && player.y < 115) finish();
      draw(time);
      requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);
    state.loopCancel = () => {
      running = false;
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }

  function startVaultScene() {
    setScene("vaultScene");
    let pending = false;
    let decayPending = false;
    let lastInputAt = performance.now();
    const decayIdleMs = Number(state.bootstrap?.constants?.vaultDecayIdleMs || 800);
    const decayIntervalMs = Number(state.bootstrap?.constants?.vaultDecayIntervalMs || 400);

    function render() {
      const progress = Math.min(100, Math.max(0, Number(state.operation?.vaultProgress || 0)));
      elements.vaultPercent.textContent = `${progress}%`;
      elements.vaultRing.style.setProperty("--progress", `${progress * 3.6}deg`);
    }

    async function hit(event) {
      if (event?.type === "keydown" && event.code !== "Space") return;
      if (event?.type === "keydown") event.preventDefault();
      if (pending || state.operation?.phase !== "raid_vault") return;
      lastInputAt = performance.now();
      pending = true;
      state.audio?.vault();
      const result = await api.vaultHit({ operationId: state.operation.id });
      pending = false;
      if (!result.ok) { showToast(result.error); return; }
      state.operation = result.operation;
      render();
      if (result.opened) {
        clearInterval(decayTimer);
        state.audio?.success();
        await showOverlay("금고 개방 성공", "25초 동안 최대한 많은 현금을 확보하세요.", 1300);
        startLootScene();
      }
    }

    const decayTimer = setInterval(async () => {
      if (decayPending || pending || state.operation?.phase !== "raid_vault") return;
      if (performance.now() - lastInputAt < decayIdleMs) return;
      if (Number(state.operation.vaultProgress || 0) <= 0) return;
      decayPending = true;
      const result = await api.vaultDecay({ operationId: state.operation.id });
      decayPending = false;
      if (!result.ok) return;
      state.operation = result.operation;
      render();
    }, decayIntervalMs);

    elements.vaultArea.onclick = hit;
    window.onkeydown = hit;
    render();
    state.loopCancel = () => {
      elements.vaultArea.onclick = null;
      if (window.onkeydown === hit) window.onkeydown = null;
      clearInterval(decayTimer);
    };
  }

  function startLootScene() {
    setScene("lootScene");
    let finalizing = false;
    let displayedCash = Number(state.operation.rawCash || 0);
    let finishRetryTimer = null;
    const parsedLootEndsAt = Date.parse(String(state.operation.lootEndsAt || ""));
    const lootEndsAtMs = Number.isFinite(parsedLootEndsAt) ? parsedLootEndsAt : Date.now();
    elements.lootCashText.textContent = formatMoney(displayedCash);

    function click(event) {
      if (event.button !== 0 || finalizing || state.operation?.phase !== "raid_loot") return;
      const operationId = state.operation.id;
      void api.lootClick({ operationId }).then((result) => {
        if (!result.ok) {
          if (!finalizing) showToast(result.error);
          return;
        }
        if (result.operation) {
          displayedCash = Math.max(displayedCash, Number(result.operation.rawCash || 0));
          // 종료 처리 중 늦게 도착한 raid_loot 응답이 transport_ready 상태를 되돌리지 않게 한다.
          if (!finalizing || result.operation.phase === "transport_ready") state.operation = result.operation;
          elements.lootCashText.textContent = formatMoney(displayedCash);
        }
        if (result.accepted) state.audio?.cash();
        if (result.expired || result.operation?.phase === "transport_ready") void finish(result.operation);
      }).catch((error) => {
        if (!finalizing) showToast(error?.message || "현금 획득 처리 중 오류가 발생했습니다.");
      });
    }

    async function finish(knownOperation = null) {
      if (finalizing) return;
      finalizing = true;
      clearInterval(state.lootTimer);
      state.lootTimer = null;
      clearTimeout(finishRetryTimer);
      finishRetryTimer = null;
      elements.lootArea.onmousedown = null;
      elements.lootTimerText.textContent = "0.0";

      let operation = knownOperation || state.operation;
      const operationId = operation?.id || state.operation?.id;
      if (!operationId) {
        finalizing = false;
        showToast("STA 작전 정보를 다시 불러오지 못했습니다.");
        return;
      }

      // getState()가 DB의 finalizeLootIfExpired()를 거치므로 실제 종료 시각이 된 뒤
      // transport_ready가 될 때까지 재확인한다. 렌더러 타이머가 수 ms 먼저 끝나도
      // 타이머/입력이 영구 정지된 채 loot 화면에 갇히지 않는다.
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (operation?.phase === "transport_ready") break;
        try {
          const refreshed = await api.getState();
          if (refreshed?.operation) operation = refreshed.operation;
        } catch {}
        if (operation?.phase === "transport_ready") break;
        await sleep(100);
      }

      if (operation?.phase !== "transport_ready") {
        state.operation = operation || state.operation;
        finalizing = false;
        finishRetryTimer = setTimeout(() => void finish(state.operation), 300);
        return;
      }

      state.operation = operation;
      state.audio?.success();
      await showOverlay("습격 성공", `미정산 현금 ${formatMoney(state.operation.rawCash)}\n운반이 해금되었습니다.`, 2400);
      setScene("menuScene");
      renderMenu();
    }

    elements.lootArea.onmousedown = click;
    state.lootTimer = setInterval(() => {
      const remaining = Math.max(0, lootEndsAtMs - Date.now());
      elements.lootTimerText.textContent = (remaining / 1000).toFixed(1);
      if (remaining <= 5000 && remaining > 0 && Math.floor(remaining / 1000) !== Math.floor((remaining + 100) / 1000)) state.audio?.warning();
      if (remaining <= 0) void finish();
    }, 50);
    state.loopCancel = () => {
      elements.lootArea.onmousedown = null;
      clearInterval(state.lootTimer);
      state.lootTimer = null;
      clearTimeout(finishRetryTimer);
      finishRetryTimer = null;
    };
  }

  function startTransportScene() {
    setScene("transportScene");
    const canvas = elements.transportCanvas;
    const ctx = canvas.getContext("2d");
    const world = { width: 2700, height: 1700 };
    const roadPoints = [
      { x: 150, y: 1430 }, { x: 520, y: 1430 }, { x: 520, y: 1110 },
      { x: 940, y: 1110 }, { x: 940, y: 1410 }, { x: 1450, y: 1410 },
      { x: 1450, y: 970 }, { x: 1840, y: 970 }, { x: 1840, y: 610 },
      { x: 2260, y: 610 }, { x: 2260, y: 250 }, { x: 2540, y: 250 },
    ];
    const player = {
      x: roadPoints[0].x,
      y: roadPoints[0].y,
      r: 13,
      angle: 0,
      speed: 0,
    };
    const keys = new Set();
    const roadHalfWidth = 68;
    const traffic = [
      { a: 2, b: 3, t: .25, direction: 1, speed: 92, color: "#e4d25c" },
      { a: 8, b: 9, t: .78, direction: -1, speed: 118, color: "#cc6fff" },
    ];
    const buildings = [
      { x: 40, y: 1080, w: 330, h: 230 }, { x: 650, y: 1210, w: 190, h: 155 },
      { x: 650, y: 760, w: 560, h: 230 }, { x: 1010, y: 1150, w: 330, h: 150 },
      { x: 1540, y: 1100, w: 470, h: 220 }, { x: 1160, y: 440, w: 530, h: 330 },
      { x: 1940, y: 760, w: 480, h: 300 }, { x: 1960, y: 70, w: 210, h: 350 },
      { x: 2350, y: 690, w: 260, h: 500 }, { x: 2450, y: 20, w: 190, h: 150 },
      { x: 90, y: 80, w: 710, h: 720 }, { x: 820, y: 90, w: 780, h: 230 },
    ];
    let running = true;
    let lastTime = performance.now();
    let lastCollision = 0;
    let finishing = false;

    const keyDown = (event) => {
      if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) {
        keys.add(event.code);
        event.preventDefault();
      }
    };
    const keyUp = (event) => keys.delete(event.code);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);

    function pointOnSegment(a, b, t) {
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }

    function distanceSegment(px, py, a, b) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = dx * dx + dy * dy;
      const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / length));
      return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
    }

    function distanceRoad(x = player.x, y = player.y) {
      let distance = Infinity;
      for (let index = 0; index < roadPoints.length - 1; index += 1) {
        distance = Math.min(distance, distanceSegment(x, y, roadPoints[index], roadPoints[index + 1]));
      }
      return distance;
    }

    function updateStats() {
      elements.transportHitText.textContent = `${state.operation.transportHits}회`;
      elements.transportPayoutText.textContent = formatMoney(state.operation.projectedPayout);
    }

    async function collision(reason = "벽") {
      const now = performance.now();
      if (now - lastCollision < 1000 || finishing) return;
      lastCollision = now;
      player.speed = 0;
      player.x -= Math.cos(player.angle) * 18;
      player.y -= Math.sin(player.angle) * 18;
      state.audio?.collision();
      const result = await api.transportHit({ operationId: state.operation.id });
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      state.operation = result.operation;
      updateStats();
      showToast(`${reason} 충돌! 1초 보호 · 최종 보수 5% 감소 · ${formatMoney(state.operation.projectedPayout)}`);
    }

    async function arrive() {
      if (finishing) return;
      finishing = true;
      running = false;
      const result = await api.transportArrive({ operationId: state.operation.id });
      if (!result.ok) {
        finishing = false;
        running = true;
        showToast(result.error);
        return;
      }
      state.operation = result.operation;
      state.audio?.success();
      await showOverlay("목적지 도착", "최종 보수를 지급받을 계좌를 선택하세요.", 1600);
      showPayoutScene();
    }

    function updateTraffic(dt) {
      for (const car of traffic) {
        const a = roadPoints[car.a];
        const b = roadPoints[car.b];
        const length = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
        car.t += car.direction * car.speed * dt / length;
        if (car.t > .94) { car.t = .94; car.direction = -1; }
        if (car.t < .06) { car.t = .06; car.direction = 1; }
        const position = pointOnSegment(a, b, car.t);
        car.x = position.x;
        car.y = position.y;
        car.angle = Math.atan2(b.y - a.y, b.x - a.x) + (car.direction < 0 ? Math.PI : 0);
      }
    }

    function drawBuilding(building, index) {
      const gradient = ctx.createLinearGradient(building.x, building.y, building.x, building.y + building.h);
      gradient.addColorStop(0, index % 2 ? "#202a38" : "#252532");
      gradient.addColorStop(1, "#0c1118");
      ctx.fillStyle = gradient;
      ctx.fillRect(building.x, building.y, building.w, building.h);
      ctx.strokeStyle = "#344154";
      ctx.lineWidth = 5;
      ctx.strokeRect(building.x, building.y, building.w, building.h);
      ctx.fillStyle = index % 3 === 0 ? "rgba(255,206,91,.45)" : "rgba(79,180,255,.35)";
      for (let x = building.x + 24; x < building.x + building.w - 12; x += 48) {
        for (let y = building.y + 24; y < building.y + building.h - 12; y += 44) {
          if ((Math.floor(x + y + index) % 5) !== 0) ctx.fillRect(x, y, 14, 8);
        }
      }
    }

    function drawVehicle(x, y, angle, color, isPlayer = false) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      if (isPlayer) {
        const headlight = ctx.createLinearGradient(8, 0, 115, 0);
        headlight.addColorStop(0, "rgba(255,248,192,.45)");
        headlight.addColorStop(1, "rgba(255,248,192,0)");
        ctx.fillStyle = headlight;
        ctx.beginPath();
        ctx.moveTo(8, -7); ctx.lineTo(115, -34); ctx.lineTo(115, 34); ctx.lineTo(8, 7); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#14181e";
        ctx.fillRect(-13, -12, 9, 24);
        ctx.fillRect(8, -12, 9, 24);
        ctx.fillStyle = "#ff3f4f";
        ctx.shadowColor = "#ff3f4f";
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.moveTo(18, 0); ctx.lineTo(-8, -9); ctx.lineTo(-16, 0); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#dce7f2";
        ctx.beginPath(); ctx.arc(2, 0, 5, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.fillRect(-20, -10, 40, 20);
        ctx.fillStyle = "#15191f";
        ctx.fillRect(-11, -8, 19, 16);
        ctx.fillStyle = "#fff3b0";
        ctx.fillRect(17, -7, 4, 5);
        ctx.fillRect(17, 2, 4, 5);
      }
      ctx.restore();
    }

    function drawMiniMap(cameraX, cameraY) {
      const map = { x: canvas.width - 220, y: 20, w: 195, h: 126 };
      ctx.save();
      ctx.fillStyle = "rgba(5,8,12,.82)";
      ctx.fillRect(map.x, map.y, map.w, map.h);
      ctx.strokeStyle = "#52637a";
      ctx.lineWidth = 2;
      ctx.strokeRect(map.x, map.y, map.w, map.h);
      const sx = map.w / world.width;
      const sy = map.h / world.height;
      ctx.translate(map.x, map.y);
      ctx.strokeStyle = "#65768a";
      ctx.lineWidth = 4;
      ctx.beginPath();
      roadPoints.forEach((point, index) => index ? ctx.lineTo(point.x * sx, point.y * sy) : ctx.moveTo(point.x * sx, point.y * sy));
      ctx.stroke();
      const goal = roadPoints.at(-1);
      ctx.fillStyle = "#43e08d";
      ctx.beginPath(); ctx.arc(goal.x * sx, goal.y * sy, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ff3f4f";
      ctx.beginPath(); ctx.arc(player.x * sx, player.y * sy, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(59,227,255,.45)";
      ctx.lineWidth = 1;
      ctx.strokeRect(cameraX * sx, cameraY * sy, canvas.width * sx, canvas.height * sy);
      ctx.restore();
    }

    function draw() {
      const cameraX = Math.max(0, Math.min(world.width - canvas.width, player.x - canvas.width / 2));
      const cameraY = Math.max(0, Math.min(world.height - canvas.height, player.y - canvas.height / 2));
      ctx.fillStyle = "#05080d";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(-cameraX, -cameraY);

      ctx.fillStyle = "#080d13";
      ctx.fillRect(0, 0, world.width, world.height);
      for (let x = 0; x < world.width; x += 150) {
        ctx.strokeStyle = "rgba(26,45,60,.18)";
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, world.height); ctx.stroke();
      }
      for (let y = 0; y < world.height; y += 150) {
        ctx.strokeStyle = "rgba(26,45,60,.18)";
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(world.width, y); ctx.stroke();
      }
      buildings.forEach(drawBuilding);

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#141922";
      ctx.lineWidth = 174;
      ctx.beginPath();
      roadPoints.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.stroke();
      ctx.strokeStyle = "#303844";
      ctx.lineWidth = 148;
      ctx.stroke();
      ctx.strokeStyle = "#68717e";
      ctx.lineWidth = 3;
      ctx.setLineDash([28, 24]);
      ctx.stroke();
      ctx.setLineDash([]);

      for (let index = 0; index < roadPoints.length - 1; index += 1) {
        const a = roadPoints[index];
        const b = roadPoints[index + 1];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const count = Math.floor(length / 120);
        for (let light = 1; light < count; light += 1) {
          const p = pointOnSegment(a, b, light / count);
          ctx.fillStyle = "rgba(255,213,111,.75)";
          ctx.shadowColor = "#ffcc70";
          ctx.shadowBlur = 18;
          ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
        }
      }

      const goal = roadPoints.at(-1);
      ctx.fillStyle = "rgba(67,224,141,.22)";
      ctx.beginPath(); ctx.arc(goal.x, goal.y, 58, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#43e08d";
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(goal.x, goal.y, 58, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#43e08d";
      ctx.font = "800 18px Malgun Gothic";
      ctx.textAlign = "center";
      ctx.fillText("전달 지점", goal.x, goal.y - 72);

      for (const car of traffic) drawVehicle(car.x, car.y, car.angle, car.color, false);
      drawVehicle(player.x, player.y, player.angle, "#ff3f4f", true);
      ctx.restore();

      const speedKmh = Math.round(Math.abs(player.speed) * .32);
      ctx.fillStyle = "rgba(5,8,12,.82)";
      ctx.fillRect(18, canvas.height - 92, 205, 68);
      ctx.strokeStyle = "#435167";
      ctx.strokeRect(18, canvas.height - 92, 205, 68);
      ctx.fillStyle = "#93a1b4";
      ctx.font = "12px Malgun Gothic";
      ctx.textAlign = "left";
      ctx.fillText("STA NIGHT DELIVERY", 32, canvas.height - 67);
      ctx.fillStyle = "#f4f7fb";
      ctx.font = "800 27px Malgun Gothic";
      ctx.fillText(`${speedKmh} km/h`, 32, canvas.height - 36);
      ctx.fillStyle = "#9aa8b9";
      ctx.font = "12px Malgun Gothic";
      ctx.fillText("W 가속 · 키를 놓거나 S를 누르면 즉시 정지 · A/D 조향·제자리 회전", 238, canvas.height - 38);
      drawMiniMap(cameraX, cameraY);
    }

    function loop(time) {
      if (!running) return;
      const dt = Math.min(.035, (time - lastTime) / 1000);
      lastTime = time;
      const accelerating = keys.has("KeyW");
      const braking = keys.has("KeyS");
      if (braking || !accelerating) player.speed = 0;
      else player.speed = Math.min(430, player.speed + 410 * dt);
      const steering = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
      if (steering) {
        const moving = Math.abs(player.speed) > 8;
        const turnStrength = moving ? 1.35 + Math.min(1.1, Math.abs(player.speed) / 250) : 2.35;
        player.angle += steering * turnStrength * dt;
      }
      player.x += Math.cos(player.angle) * player.speed * dt;
      player.y += Math.sin(player.angle) * player.speed * dt;
      player.x = Math.max(20, Math.min(world.width - 20, player.x));
      player.y = Math.max(20, Math.min(world.height - 20, player.y));
      updateTraffic(dt);

      if (distanceRoad() > roadHalfWidth - player.r) collision("도로 이탈");
      for (const car of traffic) {
        if (Math.hypot(player.x - car.x, player.y - car.y) < 30) {
          collision("차량");
          break;
        }
      }
      const goal = roadPoints.at(-1);
      if (Math.hypot(player.x - goal.x, player.y - goal.y) < 58) arrive();
      draw();
      requestAnimationFrame(loop);
    }

    updateStats();
    updateTraffic(0);
    requestAnimationFrame(loop);
    state.loopCancel = () => {
      running = false;
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }

  function showPayoutScene() {
    setScene("payoutScene");renderPayoutAccounts();const raw=state.operation.rawCash,final=state.operation.projectedPayout;
    elements.payoutRawText.textContent=formatMoney(raw);elements.payoutLossText.textContent=`-${formatMoney(raw-final)}`;elements.payoutFinalText.textContent=formatMoney(final);
  }

  async function payOut() {
    const accountId=elements.payoutAccountSelect.value;if(!accountId){showToast("보수를 지급받을 계좌를 선택하세요.");return;}
    const accepted=await confirmModal("최종 보수를 지급하시겠습니까?",`${formatMoney(state.operation.projectedPayout)}을 선택한 SD지갑 가상계좌로 지급합니다.\n지급 후 이번 작전 진행도는 초기화됩니다. 운반 완료 시점부터 5분 쿨타임이 적용됩니다.`,"보수 받기");if(!accepted)return;
    const result=await api.payout({operationId:state.operation.id,accountId});if(!result.ok){state.audio?.error();showToast(result.error);return;}state.audio?.payout();await showOverlay("작전 완료",`${formatMoney(result.amount)}이 선택한 가상계좌에 지급되었습니다.\n운반 완료 후 5분 쿨타임이 적용됩니다.`,2800);state.operation=null;await refreshAccounts(false);await refreshOperation();setScene("menuScene");
  }

  async function goMenu() { await refreshOperation(); setScene("menuScene"); renderMenu(); }

  function bindEvents() {
    elements.modalCancel.addEventListener("click",()=>closeModal(false));elements.modalConfirm.addEventListener("click",()=>closeModal(true));
    elements.accountSelect.addEventListener("change",()=>selectAccount(elements.accountSelect.value,true));
    elements.refreshButton.addEventListener("click",async()=>{await refreshAccounts(true);await refreshOperation();});
    elements.autoDetectButton.addEventListener("click",async()=>{const result=await api.autoDetectWallet();if(!result.found){showToast("SD지갑 데이터베이스를 자동으로 찾지 못했습니다.");return;}state.settings=(await api.getBootstrap()).settings;await refreshAccounts(true);await refreshOperation();});
    elements.chooseDbButton.addEventListener("click",async()=>{const result=await api.chooseWalletDatabase();if(result.canceled)return;if(!result.ok){showToast(result.error);return;}state.settings=(await api.getBootstrap()).settings;await refreshAccounts(true);await refreshOperation();});
    elements.soundButton.addEventListener("click",()=>saveSettings({soundEnabled:state.settings.soundEnabled===false}));
    elements.musicButton.addEventListener("click",async()=>{await saveSettings({musicEnabled:state.settings.musicEnabled===false});updateMusic();});
    elements.volumeSlider.addEventListener("input",()=>saveSettings({masterVolume:Number(elements.volumeSlider.value)}));
    elements.centerButton.addEventListener("click",async()=>{const result=await api.openCenter();if(!result.ok)showToast(result.error);});
    elements.hackingCard.addEventListener("click",()=>handleMission("hacking"));elements.raidCard.addEventListener("click",()=>handleMission("raid"));elements.transportCard.addEventListener("click",()=>handleMission("transport"));
    document.querySelectorAll("[data-back]").forEach(button=>button.addEventListener("click",goMenu));
    elements.payoutRefreshButton.addEventListener("click",()=>refreshAccounts(true));elements.payoutButton.addEventListener("click",payOut);
    window.addEventListener("keydown",async(event)=>{if(event.key==="F5"){event.preventDefault();await refreshAccounts(true);await refreshOperation();if(state.operation?.phase==="payout")showPayoutScene();}});
  }

  async function init() {
    state.bootstrap=await api.getBootstrap();state.settings=state.bootstrap.settings;state.audio=new SoundSystem();renderSettings();bindEvents();
    if(!state.settings.walletDatabasePath){const result=await api.autoDetectWallet();if(result.found){state.bootstrap=await api.getBootstrap();state.settings=state.bootstrap.settings;renderSettings();}}
    await refreshAccounts(false);await refreshOperation();setScene("menuScene");
  }

  init().catch((error)=>{console.error(error);showToast(error.message);});
})();
