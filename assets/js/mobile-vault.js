"use strict";
document.addEventListener("DOMContentLoaded", async () => {
  const mobile = window.SD_MOBILE;
  const status = document.getElementById("vaultStatus");
  const setupPanel = document.getElementById("vaultSetupPanel");
  const unlockPanel = document.getElementById("vaultUnlockPanel");
  const door = document.getElementById("vaultDoor");
  const room = document.getElementById("goldRoom");
  const grid = document.getElementById("goldGrid");
  const goldWeight = document.getElementById("goldWeight");
  const buyBarsInput = document.getElementById("goldBuyBars");
  const buyCount = document.getElementById("goldBuyCount");
  const buyCost = document.getElementById("goldBuyCost");
  const buyButton = document.getElementById("buyGoldButton");
  const minusButton = document.getElementById("goldMinus");
  const plusButton = document.getElementById("goldPlus");

  const PRICE_PER_BAR = 826000;
  const MAX_BARS_PER_PURCHASE = 10000;
  let currentGoldGrams = 0;
  let weightUnit = "g";
  let walletBalance = 0;
  let stateReady = false;
  let purchasePending = false;
  if (!mobile) return;

  const formatNumber = (value, maximumFractionDigits = 2) => Number(value || 0).toLocaleString("ko-KR", { maximumFractionDigits });

  const renderGoldWeight = () => {
    if (!goldWeight) return;
    if (weightUnit === "kg") {
      const kilograms = currentGoldGrams / 1000;
      goldWeight.textContent = `${formatNumber(kilograms, 1)}kg`;
      goldWeight.setAttribute("aria-label", "현재 kg 단위. 눌러서 g로 변경");
      goldWeight.setAttribute("aria-pressed", "true");
      return;
    }
    goldWeight.textContent = `${formatNumber(currentGoldGrams, 2)}g`;
    goldWeight.setAttribute("aria-label", "현재 g 단위. 눌러서 kg로 변경");
    goldWeight.setAttribute("aria-pressed", "false");
  };

  const normalizeStatePayload = (payload) => {
  const data = Array.isArray(payload) ? payload[0] : payload;
  return data && typeof data === "object" ? data : {};
  };

  const normalizedBuyBars = () => {
  const raw = Number(buyBarsInput.value);
  const bars = Number.isFinite(raw) ? Math.trunc(raw) : 1;
  return Math.min(MAX_BARS_PER_PURCHASE, Math.max(1, bars));
  };

  const maxAffordableBars = () => Math.max(
  0,
  Math.min(MAX_BARS_PER_PURCHASE, Math.floor(Math.max(0, walletBalance) / PRICE_PER_BAR))
  );

  const renderBuySummary = () => {
  const bars = normalizedBuyBars();
  const cost = bars * PRICE_PER_BAR;
  const affordable = maxAffordableBars();
  buyBarsInput.value = String(bars);
  buyCount.textContent = `${bars.toLocaleString("ko-KR")}개`;
  buyCost.textContent = mobile.auth.formatWon(cost);
  buyButton.disabled = purchasePending || !stateReady || cost > walletBalance;
  minusButton.disabled = purchasePending || bars <= 1;
  plusButton.disabled = purchasePending || bars >= MAX_BARS_PER_PURCHASE || (stateReady && bars >= affordable);
  buyBarsInput.disabled = purchasePending;
  };

  const renderState = (payload) => {
    const data = normalizeStatePayload(payload);
    stateReady = true;
    const snapshotBars = Math.max(0, Math.trunc(Number(data?.gold_bars || 0)));
    const snapshotGrams = Math.max(0, Number(data?.gold_grams || 0));
    if (Number.isFinite(snapshotBars) && Number.isFinite(snapshotGrams)) {
      void (async () => {
      try {
        const { error } = await mobile.auth.client.rpc("upsert_sd_flea_gold_snapshot", {
          p_gold_bars: snapshotBars,
          p_gold_grams: snapshotGrams
        });
        if (error) throw error;
      } catch (_) {
        // 프로필용 금 보유량 동기화 실패가 금고 화면 자체를 막지 않게 합니다.
      }
    })();
    }
    walletBalance = Number(data.balance || 0);
    mobile.updateBalanceText(walletBalance);
    setupPanel.hidden = data.has_pin;
    unlockPanel.hidden = !data.has_pin || !data.is_locked;

    if (!data.is_locked && data.has_pin) {
      door.classList.add("open");
      setTimeout(() => room.classList.add("visible"), 350);
      const grams = Number(data.gold_grams || 0);
      const bars = Number(data.gold_bars || 0);
      currentGoldGrams = grams;
      document.getElementById("goldCount").textContent = `${bars.toLocaleString("ko-KR")}개`;
      renderGoldWeight();
      renderBuySummary();

      grid.replaceChildren();
      const visibleCount = Math.min(bars, 100);
      for (let index = 0; index < visibleCount; index += 1) {
        const bar = document.createElement("div");
        bar.className = "gold-bar";
        grid.append(bar);
      }
      if (bars > 100) {
        const more = document.createElement("div");
        more.className = "empty-mobile";
        more.style.gridColumn = "1/-1";
        more.textContent = `화면에는 100개까지만 표시 · 총 ${bars.toLocaleString("ko-KR")}개`;
        grid.append(more);
      }
      if (bars === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-mobile";
        empty.style.gridColumn = "1/-1";
        empty.textContent = "아직 구매한 금괴가 없습니다.";
        grid.append(empty);
      }
    } else {
      door.classList.remove("open");
      room.classList.remove("visible");
    }
  };

  const load = async () => {
    mobile.clearMobileStatus(status);
    try {
      await mobile.loadMobileShell();
      const { data, error } = await mobile.auth.client.rpc("get_sd_vault_state");
      if (error) throw error;
      renderState(data);
    } catch (error) {
      mobile.setMobileStatus(status, mobile.auth.messageForError(error), "error");
    }
  };

  goldWeight?.addEventListener("click", () => {
    weightUnit = weightUnit === "g" ? "kg" : "g";
    renderGoldWeight();
  });

  buyBarsInput.addEventListener("input", renderBuySummary);
  buyBarsInput.addEventListener("change", renderBuySummary);
  buyBarsInput.addEventListener("blur", renderBuySummary);
  minusButton.addEventListener("click", () => {
  buyBarsInput.value = String(Math.max(1, normalizedBuyBars() - 1));
  renderBuySummary();
  });
  plusButton.addEventListener("click", () => {
  const affordable = stateReady ? Math.max(1, maxAffordableBars()) : MAX_BARS_PER_PURCHASE;
  buyBarsInput.value = String(Math.min(MAX_BARS_PER_PURCHASE, affordable, normalizedBuyBars() + 1));
  renderBuySummary();
  });

  buyButton.addEventListener("click", async () => {
  if (purchasePending) return;
  const bars = normalizedBuyBars();
  const cost = bars * PRICE_PER_BAR;
  if (!stateReady) return mobile.setMobileStatus(status, "금고 정보를 불러온 뒤 다시 시도하세요.", "error");
  if (cost > walletBalance) return mobile.setMobileStatus(status, "금 구매에 필요한 가상잔액이 부족합니다.", "error");

  purchasePending = true;
  renderBuySummary();
  mobile.clearMobileStatus(status);
  try {
    const { error } = await mobile.auth.client.rpc("buy_sd_vault_gold", {
      p_bars: bars,
      p_request_id: mobile.uuid(),
      p_platform: mobile.platform
    });
    if (error) throw error;

    const { data: refreshedState, error: refreshError } = await mobile.auth.client.rpc("get_sd_vault_state");
    if (refreshError) throw refreshError;
    renderState(refreshedState);
    mobile.setMobileStatus(status, `금괴 ${bars.toLocaleString("ko-KR")}개를 구매했습니다.`, "success");
  } catch (error) {
    try {
      const { data: refreshedState, error: refreshError } = await mobile.auth.client.rpc("get_sd_vault_state");
      if (!refreshError && refreshedState) renderState(refreshedState);
    } catch (_) {}
    mobile.setMobileStatus(status, mobile.auth.messageForError(error), "error");
  } finally {
    purchasePending = false;
    renderBuySummary();
  }
  });

  document.getElementById("setPinButton").addEventListener("click", async () => {
    const pin = document.getElementById("newVaultPin").value.trim();
    const confirm = document.getElementById("confirmVaultPin").value.trim();
    if (pin !== confirm) return mobile.setMobileStatus(status, "PIN 확인 값이 다릅니다.", "error");
    try {
      const { error } = await mobile.auth.client.rpc("set_sd_vault_pin", { p_new_pin: pin, p_current_pin: null });
      if (error) throw error;
      mobile.setMobileStatus(status, "금고 PIN을 설정했습니다.", "success");
      await load();
    } catch (error) {
      mobile.setMobileStatus(status, mobile.auth.messageForError(error), "error");
    }
  });

  document.getElementById("unlockVaultButton").addEventListener("click", async () => {
    const pin = document.getElementById("vaultPin").value.trim();
    try {
      const { data, error } = await mobile.auth.client.rpc("unlock_sd_vault", { p_pin: pin });
      if (error) throw error;
      renderState(data);
      mobile.setMobileStatus(status, "금고가 열렸습니다.", "success");
    } catch (error) {
      mobile.setMobileStatus(status, mobile.auth.messageForError(error), "error");
    }
  });

  document.getElementById("lockVaultButton").addEventListener("click", async () => {
    try {
      const { error } = await mobile.auth.client.rpc("lock_sd_vault");
      if (error) throw error;
      await load();
    } catch (error) {
      mobile.setMobileStatus(status, mobile.auth.messageForError(error), "error");
    }
  });

  renderBuySummary();
  load();
});