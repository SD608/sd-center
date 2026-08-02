"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const mobile = window.SD_MOBILE;
  const toggle = document.getElementById("sdcoinSummaryToggle");
  const panel = document.getElementById("sdcoinSummaryPanel");
  const evaluationElement = document.getElementById("homeCoinEvaluation");
  const profitElement = document.getElementById("homeCoinProfit");
  const returnElement = document.getElementById("homeCoinReturn");
  if (!mobile || !toggle || !panel || !evaluationElement || !profitElement || !returnElement) return;

  const won = (value) => `${Math.round(Number(value || 0)).toLocaleString("ko-KR")}원`;
  const resultClass = (value) => Number(value) > 0
    ? "sdcoin-home-positive"
    : Number(value) < 0
      ? "sdcoin-home-negative"
      : "sdcoin-home-flat";

  const setExpanded = (expanded) => {
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.querySelector("b").textContent = expanded ? "접기" : "펼치기";
    panel.hidden = !expanded;
    panel.setAttribute("aria-hidden", String(!expanded));
  };

  setExpanded(false);
  toggle.addEventListener("click", () => {
    setExpanded(toggle.getAttribute("aria-expanded") !== "true");
  });

  const loadSummary = async () => {
    try {
      const shell = await mobile.loadMobileShell();
      if (!shell) return;
      const { data, error } = await mobile.auth.client.rpc("get_sdcoin_market");
      if (error) throw error;
      const coins = data?.coins || [];
      const evaluation = coins.reduce((sum, coin) => sum + Number(coin.evaluation_amount || 0), 0);
      const profit = coins.reduce((sum, coin) => sum + Number(coin.profit_loss || 0), 0);
      const cost = evaluation - profit;
      const rate = cost > 0 ? (profit / cost) * 100 : 0;

      evaluationElement.textContent = won(evaluation);
      profitElement.textContent = `${profit > 0 ? "+" : ""}${won(profit)}`;
      profitElement.className = resultClass(profit);
      returnElement.textContent = `${rate > 0 ? "+" : ""}${rate.toFixed(2)}%`;
      returnElement.className = resultClass(rate);
    } catch (error) {
      evaluationElement.textContent = "확인 불가";
      profitElement.textContent = "-";
      returnElement.textContent = "-";
    }
  };

  await loadSummary();
  const timer = setInterval(loadSummary, 60000);
  window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
});
