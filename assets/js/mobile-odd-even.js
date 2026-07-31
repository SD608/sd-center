"use strict";
document.addEventListener("DOMContentLoaded", async () => {
  const mobile = window.SD_MOBILE;
  const status = document.getElementById("oddStatus");
  const input = document.getElementById("oddWager");
  const dice = [document.getElementById("die1"), document.getElementById("die2")];
  const resultCard = document.getElementById("oddResult");
  const resultTitle = document.getElementById("oddResultTitle");
  const resultDetail = document.getElementById("oddResultDetail");
  let balance = 0;
  let busy = false;
  if (!mobile) return;

  const renderBalance = (value) => { balance = Number(value); mobile.updateBalanceText(balance); };
  try {
    const state = await mobile.loadMobileShell();
    if (!state) return;
    renderBalance(state.wallet.balance);
  } catch (error) {
    return mobile.setMobileStatus(status, mobile.auth.messageForError(error), "error");
  }

  document.querySelectorAll("[data-odd-bet]").forEach((button) => button.addEventListener("click", () => {
    const raw = button.dataset.oddBet;
    input.value = raw === "all" ? Math.max(0, balance) : raw;
  }));

  const play = async (choice) => {
    if (busy) return;
    const wager = Math.trunc(Number(input.value));
    if (!Number.isSafeInteger(wager) || wager < 100) return mobile.setMobileStatus(status, "베팅금을 100원 이상 입력하세요.", "error");
    if (wager > balance) return mobile.setMobileStatus(status, "가상잔액이 부족합니다.", "error");
    busy = true;
    mobile.clearMobileStatus(status);
    document.querySelectorAll(".choice-grid button").forEach((button) => button.disabled = true);
    dice.forEach((die) => die.classList.add("rolling"));
    const timer = setInterval(() => dice.forEach((die) => die.textContent = String(Math.floor(Math.random() * 6) + 1)), 80);
    try {
      const { data, error } = await mobile.auth.client.rpc("play_sd_odd_even", {
        p_choice: choice,
        p_wager: wager,
        p_request_id: mobile.uuid(),
        p_platform: mobile.platform
      });
      if (error) throw error;
      await new Promise((resolve) => setTimeout(resolve, 650));
      clearInterval(timer);
      dice[0].textContent = data.die1;
      dice[1].textContent = data.die2;
      resultCard.className = `result-card-mobile ${data.won ? "win" : "lose"}`;
      resultTitle.textContent = data.won ? "정답! 가상 당첨금 지급" : "틀렸습니다";
      const parityText = data.parity === "even" ? "짝" : "홀";
      resultDetail.textContent = `합계 ${data.total} · ${parityText} · ${data.won ? "+" + Number(data.payout).toLocaleString("ko-KR") : "-" + Number(data.wager).toLocaleString("ko-KR")}원`;
      renderBalance(data.balance_after);
    } catch (error) {
      clearInterval(timer);
      mobile.setMobileStatus(status, mobile.auth.messageForError(error), "error");
    } finally {
      dice.forEach((die) => die.classList.remove("rolling"));
      document.querySelectorAll(".choice-grid button").forEach((button) => button.disabled = false);
      busy = false;
    }
  };

  document.getElementById("chooseOdd").addEventListener("click", () => play("odd"));
  document.getElementById("chooseEven").addEventListener("click", () => play("even"));
});
