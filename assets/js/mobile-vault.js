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
  let currentGoldGrams = 0;
  let weightUnit = "g";
  if (!mobile) return;

  const formatNumber = (value, maximumFractionDigits = 2) => Number(value || 0).toLocaleString("ko-KR", {
    maximumFractionDigits
  });

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

  const renderState = (data) => {
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

  load();
});
