"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const mobile = window.SD_MOBILE;
  if (!mobile) return;

  const elements = {
    status: document.getElementById("npcVaultStatus"),
    wallet: document.getElementById("npcWalletBalance"),
    attempts: document.getElementById("npcAttempts"),
    cooldown: document.getElementById("npcCooldown"),
    resetHint: document.getElementById("npcResetHint"),
    difficultyPanel: document.getElementById("difficultyPanel"),
    gamePanel: document.getElementById("gamePanel"),
    resultPanel: document.getElementById("resultPanel"),
    gameDifficulty: document.getElementById("gameDifficulty"),
    gameStep: document.getElementById("gameStep"),
    gameTimer: document.getElementById("gameTimer"),
    dialDirection: document.getElementById("dialDirection"),
    dial: document.getElementById("npcDial"),
    needle: document.getElementById("dialNeedle"),
    dialValue: document.getElementById("dialValue"),
    heatText: document.getElementById("heatText"),
    heatMeter: document.getElementById("heatMeter"),
    entered: document.getElementById("enteredNumbers"),
    dialMessage: document.getElementById("dialMessage"),
    resultTitle: document.getElementById("resultTitle"),
    resultMessage: document.getElementById("resultMessage"),
    resultReward: document.getElementById("resultReward"),
    resultNet: document.getElementById("resultNet"),
    resultClose: document.getElementById("resultClose")
  };

  const difficultyInfo = {
    normal: { name: "일반 금고", fee: 10000, duration: 35, reward: "15,000~40,000원" },
    large: { name: "대형 금고", fee: 50000, duration: 30, reward: "80,000~200,000원" },
    mega: { name: "초대형 금고", fee: 200000, duration: 25, reward: "350,000~1,000,000원" }
  };
  const directions = ["clockwise", "counterclockwise", "clockwise"];
  const directionLabels = ["시계 방향 ↻", "반시계 방향 ↺", "시계 방향 ↻"];

  let serverState = null;
  let activeRun = null;
  let targets = [];
  let guesses = [];
  let currentStep = 0;
  let dialValue = 1;
  let deadlineMs = 0;
  let finalizing = false;
  let dragging = false;
  let pointerId = null;
  let lastAngle = 0;
  let dragStartValue = 1;
  let accumulatedAngle = 0;
  let lastHapticValue = null;
  let lastExactBuzzAt = 0;
  let ticker = null;

  const won = (value) => mobile.auth.formatWon(Number(value || 0));
  const wrapValue = (value) => ((Math.round(value) - 1 + 10000) % 100) + 1;
  const circularDistance = (a, b) => {
    const direct = Math.abs(Number(a) - Number(b));
    return Math.min(direct, 100 - direct);
  };
  const formatClock = (seconds, tenths = false) => {
    const safe = Math.max(0, Number(seconds || 0));
    if (tenths) return safe.toFixed(1).padStart(4, "0");
    const minutes = Math.floor(safe / 60);
    const remain = Math.floor(safe % 60);
    return `${String(minutes).padStart(2, "0")}:${String(remain).padStart(2, "0")}`;
  };
  const friendlyError = (error) => {
    const raw = String(error?.message || error || "오류가 발생했습니다.");
    if (/function|schema cache|PGRST202|npc_vault/i.test(raw)) {
      return "NPC 금고 Supabase SQL이 아직 설치되지 않았습니다.";
    }
    return mobile.auth.messageForError(error);
  };

  const vibrate = (distance, exact = false) => {
    const now = Date.now();
    if (exact && now - lastExactBuzzAt < 480) return;
    if (exact) lastExactBuzzAt = now;

    try {
      if (window.SDAndroid) {
        if (exact && typeof window.SDAndroid.vibrateExact === "function") {
          window.SDAndroid.vibrateExact();
          return;
        }
        if (typeof window.SDAndroid.vibrate === "function") {
          let amplitude = 0;
          let duration = 0;
          if (distance <= 1) { amplitude = 235; duration = 85; }
          else if (distance <= 5) { amplitude = 175; duration = 58; }
          else if (distance <= 10) { amplitude = 110; duration = 40; }
          else if (distance <= 20) { amplitude = 55; duration = 25; }
          if (amplitude > 0) window.SDAndroid.vibrate(amplitude, duration);
          return;
        }
      }
    } catch (_) {
      // 브리지 실패 시 웹 진동으로 이어집니다.
    }

    if (!navigator.vibrate) return;
    if (exact) navigator.vibrate([140, 70, 220]);
    else if (distance <= 1) navigator.vibrate(85);
    else if (distance <= 5) navigator.vibrate(58);
    else if (distance <= 10) navigator.vibrate(40);
    else if (distance <= 20) navigator.vibrate(25);
  };

  const setHeat = (value, allowVibration = true) => {
    if (!targets.length || !activeRun) return;
    const distance = circularDistance(value, targets[currentStep]);
    let text = "진동 없음 · 멀리 있음";
    let width = 0;
    if (distance === 0) { text = "정답 감지 · 손을 떼세요"; width = 100; }
    else if (distance === 1) { text = "매우 강한 진동 · 거의 정답"; width = 90; }
    else if (distance <= 5) { text = "강한 진동 · 매우 가까움"; width = 75; }
    else if (distance <= 10) { text = "보통 진동 · 가까워짐"; width = 55; }
    else if (distance <= 20) { text = "약한 진동 · 범위 진입"; width = 30; }
    elements.heatText.textContent = text;
    elements.heatMeter.style.width = `${width}%`;

    if (allowVibration && lastHapticValue !== value) {
      lastHapticValue = value;
      vibrate(distance, distance === 0);
    }
  };

  const setDialValue = (value, allowVibration = true) => {
    dialValue = wrapValue(value);
    elements.dialValue.textContent = String(dialValue);
    elements.dial.setAttribute("aria-valuenow", String(dialValue));
    elements.needle.style.transform = `rotate(${(dialValue - 1) * 3.6}deg)`;
    setHeat(dialValue, allowVibration);
  };

  const renderEntered = () => {
    const display = [0, 1, 2].map((index) => guesses[index] ?? "-");
    elements.entered.textContent = display.join(" · ");
  };

  const renderStep = () => {
    elements.gameStep.textContent = `${Math.min(currentStep + 1, 3)} / 3`;
    elements.dialDirection.textContent = directionLabels[Math.min(currentStep, 2)];
    document.querySelectorAll(".npc-step-track span").forEach((node, index) => {
      node.classList.toggle("active", index === currentStep);
      node.classList.toggle("done", index < currentStep);
    });
    document.querySelectorAll(".npc-step-track i").forEach((node, index) => {
      node.classList.toggle("done", index < currentStep);
    });
    elements.dialMessage.textContent = `${Math.min(currentStep + 1, 3)}차 번호를 찾으세요.`;
    lastHapticValue = null;
    renderEntered();
    setHeat(dialValue, false);
  };

  const storageKey = (runId) => `sd-npc-vault-${runId}`;
  const saveProgress = () => {
    if (!activeRun) return;
    sessionStorage.setItem(storageKey(activeRun.id), JSON.stringify({ guesses, currentStep, dialValue }));
  };
  const restoreProgress = (runId) => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey(runId)) || "null");
      if (!saved || !Array.isArray(saved.guesses)) return;
      guesses = saved.guesses.slice(0, 3).map(Number).filter((number) => number >= 1 && number <= 100);
      currentStep = Math.min(guesses.length, 2);
      dialValue = wrapValue(saved.dialValue || guesses[guesses.length - 1] || 1);
    } catch (_) {
      sessionStorage.removeItem(storageKey(runId));
    }
  };

  const setDifficultyButtons = () => {
    const blocked = Boolean(activeRun) || Number(serverState?.attempts_remaining || 0) <= 0 || Number(serverState?.cooldown_seconds || 0) > 0;
    document.querySelectorAll("[data-difficulty]").forEach((button) => {
      button.disabled = blocked || finalizing;
    });
  };

  const showResult = (result) => {
    const success = Boolean(result.success);
    elements.resultPanel.hidden = false;
    elements.resultPanel.className = `npc-result-panel ${success ? "success" : "failed"}`;
    elements.resultTitle.textContent = success ? "금고 개방 성공" : "금고 개방 실패";
    elements.resultMessage.textContent = success
      ? "NPC 금고를 열었습니다. 보상이 SD지갑에 입금되었습니다. 10분 뒤 다시 도전할 수 있습니다."
      : "번호가 다르거나 제한시간을 초과했습니다. 5분 뒤 다시 도전할 수 있습니다.";
    elements.resultReward.textContent = success ? `+${won(result.reward)}` : "0원";
    const net = Number(result.net_result || 0);
    elements.resultNet.textContent = `${net > 0 ? "+" : ""}${won(net)}`;
    elements.resultNet.className = net > 0 ? "profit-positive" : net < 0 ? "profit-negative" : "profit-flat";
    if (success) vibrate(0, true);
    else navigator.vibrate?.([90, 80, 90]);
    elements.resultPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const finishRun = async (timedOut = false) => {
    if (!activeRun || finalizing) return;
    finalizing = true;
    elements.dial.classList.add("locked");
    elements.dialMessage.textContent = timedOut ? "시간 초과 · 서버 판정 중" : "번호 확인 중";
    setDifficultyButtons();
    try {
      const { data, error } = await mobile.auth.client.rpc("finish_npc_vault", {
        p_run_id: activeRun.id,
        p_numbers: guesses,
        p_request_id: mobile.uuid()
      });
      if (error) throw error;
      sessionStorage.removeItem(storageKey(activeRun.id));
      activeRun = null;
      targets = [];
      elements.gamePanel.hidden = true;
      showResult(data);
      await loadStatus(false);
    } catch (error) {
      mobile.setMobileStatus(elements.status, friendlyError(error), "error");
      elements.dial.classList.remove("locked");
    } finally {
      finalizing = false;
      setDifficultyButtons();
    }
  };

  const commitDial = () => {
    if (!activeRun || finalizing || currentStep > 2) return;
    guesses[currentStep] = dialValue;
    elements.dialMessage.textContent = `${currentStep + 1}차 번호 ${dialValue} 입력 완료`;
    vibrate(circularDistance(dialValue, targets[currentStep]), dialValue === targets[currentStep]);
    currentStep += 1;
    saveProgress();

    if (currentStep >= 3) {
      renderEntered();
      finishRun(false);
      return;
    }

    setTimeout(() => {
      renderStep();
      saveProgress();
    }, 260);
  };

  const angleForPointer = (event) => {
    const rect = elements.dial.getBoundingClientRect();
    return Math.atan2(event.clientY - (rect.top + rect.height / 2), event.clientX - (rect.left + rect.width / 2)) * 180 / Math.PI;
  };
  const normalizedDelta = (current, previous) => {
    let delta = current - previous;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    return delta;
  };
  const showWrongDirection = () => {
    elements.dial.classList.remove("wrong-direction");
    void elements.dial.offsetWidth;
    elements.dial.classList.add("wrong-direction");
    elements.dialMessage.textContent = `${directionLabels[currentStep]}으로 돌리세요.`;
  };

  elements.dial.addEventListener("pointerdown", (event) => {
    if (!activeRun || finalizing || currentStep > 2) return;
    dragging = true;
    pointerId = event.pointerId;
    elements.dial.setPointerCapture(pointerId);
    lastAngle = angleForPointer(event);
    dragStartValue = dialValue;
    accumulatedAngle = 0;
    event.preventDefault();
  });

  elements.dial.addEventListener("pointermove", (event) => {
    if (!dragging || event.pointerId !== pointerId || !activeRun || finalizing) return;
    const currentAngle = angleForPointer(event);
    const delta = normalizedDelta(currentAngle, lastAngle);
    lastAngle = currentAngle;
    const requiredSign = directions[currentStep] === "clockwise" ? 1 : -1;

    if (Math.abs(delta) >= 0.25 && delta * requiredSign < 0) {
      if (Math.abs(delta) > 2.2) showWrongDirection();
      return;
    }

    accumulatedAngle += delta;
    const numberOffset = Math.round(accumulatedAngle / 3.6);
    setDialValue(dragStartValue + numberOffset, true);
    event.preventDefault();
  });

  const endPointer = (event) => {
    if (!dragging || event.pointerId !== pointerId) return;
    dragging = false;
    try { elements.dial.releasePointerCapture(pointerId); } catch (_) { /* no-op */ }
    pointerId = null;
    commitDial();
    event.preventDefault();
  };
  elements.dial.addEventListener("pointerup", endPointer);
  elements.dial.addEventListener("pointercancel", endPointer);

  elements.dial.addEventListener("keydown", (event) => {
    if (!activeRun || finalizing) return;
    const sign = directions[currentStep] === "clockwise" ? 1 : -1;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      setDialValue(dialValue + sign, true);
      event.preventDefault();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      setDialValue(dialValue - sign, true);
      event.preventDefault();
    } else if (event.key === "Enter" || event.key === " ") {
      commitDial();
      event.preventDefault();
    }
  });

  const beginRun = (run) => {
    if (!run?.id) return;
    const isSame = activeRun?.id === run.id;
    activeRun = run;
    targets = (run.target_numbers || []).map(Number);
    deadlineMs = Date.parse(run.expires_at);
    elements.gameDifficulty.textContent = difficultyInfo[run.difficulty]?.name || "NPC 금고";
    elements.resultPanel.hidden = true;
    elements.gamePanel.hidden = false;
    elements.dial.classList.remove("locked");

    if (!isSame) {
      guesses = [];
      currentStep = 0;
      dialValue = 1;
      restoreProgress(run.id);
    }
    setDialValue(dialValue, false);
    renderStep();
    elements.gamePanel.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const renderServerState = (data) => {
    serverState = data;
    elements.wallet.textContent = won(data.wallet_balance);
    elements.attempts.textContent = `${Number(data.attempts_remaining || 0)}/5`;
    if (data.attempts_reset_at) {
      const reset = new Date(data.attempts_reset_at);
      elements.resetHint.textContent = `한국시간 ${reset.toLocaleDateString("ko-KR")} 00:00에 5회 충전`;
    }
    if (data.active_run) beginRun(data.active_run);
    else if (activeRun) {
      activeRun = null;
      targets = [];
      elements.gamePanel.hidden = true;
    }
    setDifficultyButtons();
  };

  async function loadStatus(clearStatus = true) {
    if (clearStatus) mobile.clearMobileStatus(elements.status);
    try {
      await mobile.loadMobileShell();
      const { data, error } = await mobile.auth.client.rpc("get_npc_vault_status");
      if (error) throw error;
      renderServerState(data);
    } catch (error) {
      mobile.setMobileStatus(elements.status, friendlyError(error), "error");
      document.querySelectorAll("[data-difficulty]").forEach((button) => { button.disabled = true; });
    }
  }

  document.querySelectorAll("[data-difficulty]").forEach((button) => {
    button.addEventListener("click", async () => {
      const difficulty = button.dataset.difficulty;
      const info = difficultyInfo[difficulty];
      if (!info || button.disabled || finalizing) return;
      const accepted = window.confirm(`${info.name}\n참가비 ${won(info.fee)}가 즉시 차감됩니다.\n도전할까요?`);
      if (!accepted) return;

      finalizing = true;
      setDifficultyButtons();
      mobile.clearMobileStatus(elements.status);
      try {
        const { data, error } = await mobile.auth.client.rpc("start_npc_vault", {
          p_difficulty: difficulty,
          p_request_id: mobile.uuid(),
          p_platform: mobile.platform
        });
        if (error) throw error;
        renderServerState(data);
      } catch (error) {
        mobile.setMobileStatus(elements.status, friendlyError(error), "error");
      } finally {
        finalizing = false;
        setDifficultyButtons();
      }
    });
  });

  elements.resultClose.addEventListener("click", () => {
    elements.resultPanel.hidden = true;
    elements.difficultyPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  const tick = () => {
    const now = Date.now();
    if (activeRun && deadlineMs) {
      const remaining = Math.max(0, (deadlineMs - now) / 1000);
      elements.gameTimer.textContent = formatClock(remaining, true);
      elements.gameTimer.parentElement.classList.toggle("danger", remaining <= 5);
      if (remaining <= 0 && !finalizing) finishRun(true);
    }

    if (serverState?.cooldown_until) {
      const cooldownSeconds = Math.max(0, Math.ceil((Date.parse(serverState.cooldown_until) - now) / 1000));
      elements.cooldown.textContent = cooldownSeconds > 0 ? formatClock(cooldownSeconds) : "도전 가능";
      serverState.cooldown_seconds = cooldownSeconds;
      setDifficultyButtons();
    } else {
      elements.cooldown.textContent = "도전 가능";
    }
  };

  ticker = window.setInterval(tick, 100);
  window.addEventListener("beforeunload", () => window.clearInterval(ticker));
  await loadStatus(true);
  tick();
});
