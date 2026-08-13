"use strict";
document.addEventListener("DOMContentLoaded", async () => {
  const mobile = window.SD_MOBILE;
  const status = document.getElementById("oddStatus");
  const input = document.getElementById("oddWager");
  const dice = [document.getElementById("die1"), document.getElementById("die2")];
  const resultCard = document.getElementById("oddResult");
  const resultTitle = document.getElementById("oddResultTitle");
  const resultDetail = document.getElementById("oddResultDetail");
  const phase = document.getElementById("oddPhase");
  const rollButton = document.getElementById("rollOddEven");
  const stopButton = document.getElementById("stopOddEven");
  const choiceGrid = document.getElementById("oddChoiceGrid");
  const betButtons = [...document.querySelectorAll("[data-odd-bet]")];

  let balance = 0;
  let rolling = false;
  let busy = false;
  let animationTimer = null;
  let roundId = null;
  let wagerLocked = 0;

  if (!mobile) return;

  const renderBalance = (value) => {
    balance = Number(value);
    mobile.updateBalanceText(balance);
  };

  const setBetControlsDisabled = (disabled) => {
    input.disabled = disabled;
    betButtons.forEach((button) => { button.disabled = disabled; });
  };

  const setDiceHidden = () => {
    dice.forEach((die) => {
      die.textContent = "?";
      die.classList.remove("rolling");
      die.classList.add("hidden-die");
    });
  };

  const setDiceVisible = (values) => {
    dice.forEach((die, index) => {
      die.classList.remove("hidden-die", "rolling");
      die.textContent = String(values[index]);
    });
  };

  const stopAnimation = () => {
    if (animationTimer) clearInterval(animationTimer);
    animationTimer = null;
    dice.forEach((die) => die.classList.remove("rolling"));
  };

  try {
    const state = await mobile.loadMobileShell();
    if (!state) return;
    renderBalance(state.wallet.balance);
  } catch (error) {
    return mobile.setMobileStatus(status, mobile.auth.messageForError(error), "error");
  }

  betButtons.forEach((button) => button.addEventListener("click", () => {
    const raw = button.dataset.oddBet;
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

  rollButton.addEventListener("click", () => {
    if (busy || rolling || roundId) return;
    const wager = Math.trunc(Number(input.value));
    if (!Number.isSafeInteger(wager) || wager < 100) {
      return mobile.setMobileStatus(status, "베팅금을 100원 이상 입력하세요.", "error");
    }
    if (wager > balance) {
      return mobile.setMobileStatus(status, "가상잔액이 부족합니다.", "error");
    }

    mobile.clearMobileStatus(status);
    wagerLocked = wager;
    rolling = true;
    setBetControlsDisabled(true);
    rollButton.disabled = true;
    stopButton.disabled = false;
    choiceGrid.hidden = true;
    resultCard.className = "result-card-mobile";
    phase.textContent = "굴리는 중";
    resultTitle.textContent = "원하는 순간 멈추기를 누르세요";
    resultDetail.textContent = `베팅 ${wager.toLocaleString("ko-KR")}원`;
    dice.forEach((die) => {
      die.classList.remove("hidden-die");
      die.classList.add("rolling");
    });
    animationTimer = setInterval(() => {
      dice.forEach((die) => { die.textContent = String(Math.floor(Math.random() * 6) + 1); });
    }, 75);
  });

  stopButton.addEventListener("click", async () => {
    if (!rolling || busy) return;
    busy = true;
    stopButton.disabled = true;
    stopAnimation();
    setDiceHidden();
    phase.textContent = "서버 결과 확정";
    resultTitle.textContent = "결과를 숨긴 상태입니다";
    resultDetail.textContent = "홀 또는 짝을 선택하세요.";

    try {
      const { data, error } = await mobile.auth.client.rpc("start_sd_odd_even", {
        p_wager: wagerLocked,
        p_request_id: mobile.uuid(),
        p_platform: mobile.platform
      });
      if (error) throw error;
      roundId = data.round_id;
      renderBalance(data.balance_after_wager);
      choiceGrid.hidden = false;
      phase.textContent = "선택 대기";
      resultTitle.textContent = "홀 또는 짝을 선택하세요";
      resultDetail.textContent = "선택하면 주사위가 공개됩니다.";
      rolling = false;
    } catch (error) {
      roundId = null;
      rolling = false;
      setDiceVisible([1, 1]);
      setBetControlsDisabled(false);
      rollButton.disabled = false;
      mobile.setMobileStatus(status, mobile.auth.messageForError(error), "error");
    } finally {
      busy = false;
    }
  });

  const finish = async (choice) => {
    if (!roundId || busy) return;
    busy = true;
    [...choiceGrid.querySelectorAll("button")].forEach((button) => { button.disabled = true; });
    mobile.clearMobileStatus(status);
    try {
      const { data, error } = await mobile.auth.client.rpc("finish_sd_odd_even", {
        p_round_id: roundId,
        p_choice: choice
      });
      if (error) throw error;
      setDiceVisible([data.die1, data.die2]);
      resultCard.className = `result-card-mobile ${data.won ? "win" : "lose"}`;
      phase.textContent = "결과 공개";
      resultTitle.textContent = data.won ? "정답! 가상 당첨금 지급" : "틀렸습니다";
      const parityText = data.parity === "even" ? "짝" : "홀";
      resultDetail.textContent =
        `합계 ${data.total} · ${parityText} · ${data.won ? "+" + Number(data.payout).toLocaleString("ko-KR") : "-" + Number(data.wager).toLocaleString("ko-KR")}원`;
      renderBalance(data.balance_after);
      roundId = null;
      wagerLocked = 0;
      choiceGrid.hidden = true;
      setBetControlsDisabled(false);
      rollButton.disabled = false;
    } catch (error) {
      mobile.setMobileStatus(status, mobile.auth.messageForError(error), "error");
    } finally {
      [...choiceGrid.querySelectorAll("button")].forEach((button) => { button.disabled = false; });
      busy = false;
    }
  };

  document.getElementById("chooseOdd").addEventListener("click", () => finish("odd"));
  document.getElementById("chooseEven").addEventListener("click", () => finish("even"));
});