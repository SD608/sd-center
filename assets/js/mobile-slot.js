"use strict";
document.addEventListener("DOMContentLoaded", async () => {
  const mobile = window.SD_MOBILE;
  const status = document.getElementById("slotStatus");
  const input = document.getElementById("slotWager");
  const spinButton = document.getElementById("spinButton");
  const reels = [...document.querySelectorAll(".slot-reel")];
  const resultCard = document.getElementById("slotResult");
  const resultTitle = document.getElementById("slotResultTitle");
  const resultDetail = document.getElementById("slotResultDetail");
  const symbols = {
    stone:"🪨", coal:"◼", copper:"🟤", iron:"⚙", gold:"🟨",
    emerald:"💚", diamond:"💎", seven:"7", "red-seven":"🔴7", "gold-seven":"✨7"
  };
  const visualKeys = Object.keys(symbols);
  const SPIN_FRAME_MS = 96;
  const FIRST_REEL_MIN_MS = 1450;
  const REEL_STOP_GAP_MS = 650;
  const REEL_DECELERATION_STEPS_MS = [130, 190, 270];

  let balance = 0;
  let audioContext = null;
  let reelTimers = [];
  if (!mobile) return;

  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));
  const renderBalance = (value) => {
    balance = Number(value);
    mobile.updateBalanceText(balance);
  };

  function ensureAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioContext) audioContext = new AudioContextClass();
    if (audioContext.state === "suspended") void audioContext.resume().catch(() => {});
    return audioContext;
  }

  function tone(frequency, delay = 0, duration = 0.08, type = "square", volume = 0.035) {
    const context = ensureAudio();
    if (!context) return;
    try {
      const start = context.currentTime + Math.max(0, delay);
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(Math.max(40, Number(frequency) || 220), start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(0.025, duration));
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + Math.max(0.03, duration) + 0.02);
    } catch {
      // 오디오가 제한된 환경에서도 슬롯 자체는 계속 동작합니다.
    }
  }

  function playSpinStartSound() {
    tone(150, 0, 0.08, "sawtooth", 0.025);
    tone(190, 0.055, 0.09, "sawtooth", 0.022);
  }

  function playReelStopSound(index) {
    const base = [310, 390, 490][index] || 390;
    tone(base, 0, 0.075, "square", 0.045);
    tone(base * 2, 0.028, 0.055, "triangle", 0.026);
  }

  function playWinSound(multiplier, jackpot = false) {
    if (jackpot) {
      [0, 4, 7, 12, 16, 19, 24].forEach((step, index) => {
        tone(420 * (2 ** (step / 12)), index * 0.095, 0.28, "triangle", 0.065);
      });
      return;
    }
    const base = Number(multiplier || 0) >= 100 ? 520 : Number(multiplier || 0) >= 10 ? 440 : 360;
    [0, 4, 7, 12].forEach((step, index) => {
      tone(base * (2 ** (step / 12)), index * 0.11, 0.22, "sine", 0.055);
    });
  }

  function playLoseSound() {
    tone(175, 0, 0.11, "sine", 0.026);
    tone(125, 0.08, 0.14, "sine", 0.022);
  }

  function randomSymbol() {
    const key = visualKeys[Math.floor(Math.random() * visualKeys.length)];
    return symbols[key];
  }

  function clearReelTimers() {
    reelTimers.forEach((timer) => {
      if (timer) window.clearInterval(timer);
    });
    reelTimers = [];
  }

  function startReels() {
    clearReelTimers();
    reels.forEach((reel) => {
      reel.classList.remove("stopping", "slowing");
      reel.classList.add("spinning");
    });
    reelTimers = reels.map((reel) => window.setInterval(() => {
      reel.textContent = randomSymbol();
    }, SPIN_FRAME_MS));
  }

  function stopReel(index, key) {
    if (reelTimers[index]) window.clearInterval(reelTimers[index]);
    reelTimers[index] = null;
    const reel = reels[index];
    if (!reel) return;
    reel.textContent = symbols[key] || key || "?";
    reel.classList.remove("spinning", "slowing");
    reel.classList.add("stopping");
    playReelStopSound(index);
    window.setTimeout(() => reel.classList.remove("stopping"), 280);
  }

  async function slowAndStopReel(index, key) {
    if (reelTimers[index]) window.clearInterval(reelTimers[index]);
    reelTimers[index] = null;
    const reel = reels[index];
    if (!reel) return;

    // 세 릴 모두 정확히 같은 감속 패턴을 거쳐 멈춥니다.
    reel.classList.remove("spinning");
    reel.classList.add("slowing");
    for (const delay of REEL_DECELERATION_STEPS_MS) {
      reel.textContent = randomSymbol();
      await wait(delay);
    }
    stopReel(index, key);
  }

  async function settleReelsSequentially(finalKeys, spinStartedAt) {
    const elapsed = performance.now() - spinStartedAt;
    await wait(Math.max(0, FIRST_REEL_MIN_MS - elapsed));
    for (let index = 0; index < reels.length; index += 1) {
      await slowAndStopReel(index, finalKeys[index]);
      if (index < reels.length - 1) await wait(REEL_STOP_GAP_MS);
    }
    reelTimers = [];
  }

  function abortSpinAnimation() {
    clearReelTimers();
    reels.forEach((reel) => reel.classList.remove("spinning", "slowing", "stopping"));
  }

  try {
    const state = await mobile.loadMobileShell();
    if (!state) return;
    renderBalance(state.wallet.balance);
  } catch (error) {
    return mobile.setMobileStatus(status, mobile.auth.messageForError(error), "error");
  }

  document.querySelectorAll("[data-slot-bet]").forEach((button) => button.addEventListener("click", () => {
    const raw = button.dataset.slotBet;
    if (raw === "reset") {
      input.value = "0";
      return;
    }
    if (raw === "all") {
      input.value = String(Math.max(0, Math.trunc(balance)));
      return;
    }
    const current = Math.max(0, Math.trunc(Number(input.value) || 0));
    input.value = String(current + Math.trunc(Number(raw) || 0));
  }));

  spinButton.addEventListener("click", async () => {
    const wager = Math.trunc(Number(input.value));
    if (!Number.isSafeInteger(wager) || wager < 100) return mobile.setMobileStatus(status, "베팅금을 100원 이상 입력하세요.", "error");
    if (wager > balance) return mobile.setMobileStatus(status, "가상잔액이 부족합니다.", "error");

    // 모바일 브라우저는 사용자 터치 직후 오디오 컨텍스트를 활성화해야 합니다.
    ensureAudio();
    playSpinStartSound();
    mobile.clearMobileStatus(status);
    spinButton.disabled = true;
    input.disabled = true;
    resultCard.className = "result-card-mobile spinning-result";
    resultTitle.textContent = "회전 중...";
    resultDetail.textContent = "세 릴 모두 같은 감속 속도로 하나씩 멈춥니다.";

    const spinStartedAt = performance.now();
    startReels();

    try {
      const { data, error } = await mobile.auth.client.rpc("play_sd_slot", {
        p_wager: wager,
        p_request_id: mobile.uuid(),
        p_platform: mobile.platform
      });
      if (error) throw error;
      if (!data || !Array.isArray(data.reels) || data.reels.length < 3) throw new Error("슬롯 결과 형식이 올바르지 않습니다.");

      await settleReelsSequentially(data.reels, spinStartedAt);

      resultCard.className = `result-card-mobile ${data.won ? "win" : "lose"}`;
      resultTitle.textContent = data.jackpot ? "황금색 777 JACKPOT!" : data.won ? `${data.result_name} x${data.multiplier}` : "꽝";
      resultDetail.textContent = data.won
        ? `가상 당첨금 +${Number(data.payout).toLocaleString("ko-KR")}원`
        : `가상 베팅금 -${Number(data.wager).toLocaleString("ko-KR")}원`;
      renderBalance(data.balance_after);

      if (data.won) playWinSound(data.multiplier, Boolean(data.jackpot));
      else playLoseSound();

      if (data.won) {
        const slotLabel = data.jackpot ? "황금색 777 JACKPOT" : `${data.result_name || "당첨"} x${Number(data.multiplier || 0)}`;
        const slotIcon = data.jackpot ? "✨7" : "🎰";
        const slotScore = data.jackpot ? 1000000 : Number(data.multiplier || 0);
        try {
          const rankingResult = await mobile.auth.client.rpc("record_sd_flea_slot_result", {
            p_score: slotScore,
            p_label: slotLabel,
            p_icon: slotIcon,
            p_jackpot: Boolean(data.jackpot)
          });
          if (rankingResult?.error) console.warn("slot ranking record failed", rankingResult.error);
        } catch (rankingError) {
          console.warn("slot ranking record failed", rankingError);
        }
      }
    } catch (error) {
      abortSpinAnimation();
      resultCard.className = "result-card-mobile lose";
      resultTitle.textContent = "회전 실패";
      resultDetail.textContent = "다시 시도하세요.";
      mobile.setMobileStatus(status, mobile.auth.messageForError(error), "error");
    } finally {
      abortSpinAnimation();
      input.disabled = false;
      spinButton.disabled = false;
    }
  });
});