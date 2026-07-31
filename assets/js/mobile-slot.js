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
  let balance = 0;
  if (!mobile) return;

  const renderBalance = (value) => { balance = Number(value); mobile.updateBalanceText(balance); };
  try {
    const state = await mobile.loadMobileShell();
    if (!state) return;
    renderBalance(state.wallet.balance);
  } catch (error) {
    return mobile.setMobileStatus(status, mobile.auth.messageForError(error), "error");
  }

  document.querySelectorAll("[data-slot-bet]").forEach((button) => button.addEventListener("click", () => {
    const raw = button.dataset.slotBet;
    input.value = raw === "all" ? Math.max(0, balance) : raw;
  }));

  spinButton.addEventListener("click", async () => {
    const wager = Math.trunc(Number(input.value));
    if (!Number.isSafeInteger(wager) || wager < 100) return mobile.setMobileStatus(status, "베팅금을 100원 이상 입력하세요.", "error");
    if (wager > balance) return mobile.setMobileStatus(status, "가상잔액이 부족합니다.", "error");
    mobile.clearMobileStatus(status);
    spinButton.disabled = true;
    reels.forEach((reel) => reel.classList.add("spinning"));
    const timer = setInterval(() => reels.forEach((reel) => {
      const key = visualKeys[Math.floor(Math.random() * visualKeys.length)];
      reel.textContent = symbols[key];
    }), 75);
    try {
      const { data, error } = await mobile.auth.client.rpc("play_sd_slot", {
        p_wager: wager,
        p_request_id: mobile.uuid(),
        p_platform: mobile.platform
      });
      if (error) throw error;
      await new Promise((resolve) => setTimeout(resolve, 900));
      clearInterval(timer);
      data.reels.forEach((key, index) => { reels[index].textContent = symbols[key] || key; });
      resultCard.className = `result-card-mobile ${data.won ? "win" : "lose"}`;
      resultTitle.textContent = data.jackpot ? "황금색 777 JACKPOT!" : data.won ? `${data.result_name} x${data.multiplier}` : "꽝";
      resultDetail.textContent = data.won
        ? `가상 당첨금 +${Number(data.payout).toLocaleString("ko-KR")}원`
        : `가상 베팅금 -${Number(data.wager).toLocaleString("ko-KR")}원`;
      renderBalance(data.balance_after);
    } catch (error) {
      clearInterval(timer);
      mobile.setMobileStatus(status, mobile.auth.messageForError(error), "error");
    } finally {
      reels.forEach((reel) => reel.classList.remove("spinning"));
      spinButton.disabled = false;
    }
  });
});
