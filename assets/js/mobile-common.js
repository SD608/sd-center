"use strict";

(function initializeMobileCommon() {
  const installCompactBottomNavigation = () => {
    const nav = document.querySelector(".mobile-bottom-nav");
    if (!nav) return;

    const fileName = (location.pathname.split("/").pop() || "mobile.html").toLowerCase();
    const items = [
      {
        id: "wallet",
        href: "wallet-mobile.html",
        label: "지갑",
        icon: "assets/icons/wallet.png",
        active: fileName === "wallet-mobile.html"
      },
      {
        id: "home",
        href: "mobile.html",
        label: "홈",
        icon: "assets/icons/center.png",
        active: fileName === "mobile.html" || fileName === ""
      },
      {
        id: "coin",
        href: "sdcoin-mobile.html",
        label: "코인",
        icon: "assets/icons/sdcoin.svg",
        active: fileName === "sdcoin-mobile.html"
      }
    ];

    nav.classList.add("mobile-bottom-nav-three");
    nav.innerHTML = items.map((item) => `
      <a class="${item.active ? "active" : ""}" href="${item.href}" data-bottom-nav="${item.id}"${item.active ? ' aria-current="page"' : ""}>
        <img src="${item.icon}" alt="">
        <span>${item.label}</span>
      </a>
    `).join("");

    if (!document.querySelector('link[data-mobile-nav-v2]')) {
      const stylesheet = document.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = "assets/css/mobile-nav-v2.css?v=1";
      stylesheet.dataset.mobileNavV2 = "true";
      document.head.appendChild(stylesheet);
    }
  };

  installCompactBottomNavigation();

  const auth = window.SD_AUTH;
  if (!auth) return;

  let deferredInstallPrompt = null;
  let goldSnapshotSyncPromise = null;
  const platform = /SD608Android/i.test(navigator.userAgent) ? "android" : "web";
  const uuid = () => {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
      const random = Math.floor(Math.random() * 16);
      const value = character === "x" ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    });
  };
  const setMobileStatus = (element, message, type = "info") => {
    if (!element) return;
    element.textContent = message;
    element.className = `status-mobile ${type}`;
    element.hidden = false;
  };

  const clearMobileStatus = (element) => {
    if (!element) return;
    element.hidden = true;
    element.textContent = "";
  };
  const fetchWallet = async () => {
    const { data, error } = await auth.client
      .from("wallets")
      .select("id,account_number,balance,created_at,updated_at")
      .single();
    if (error) throw error;
    return data;
  };

  const updateBalanceText = (balance) => {
    document.querySelectorAll("[data-mobile-balance]").forEach((element) => {
      element.textContent = auth.formatWon(balance);
    });
  };

  const syncGoldSnapshot = async () => {
    if (goldSnapshotSyncPromise) return goldSnapshotSyncPromise;
    goldSnapshotSyncPromise = (async () => {
      try {
        const { data: vaultState, error: vaultError } = await auth.client.rpc("get_sd_vault_state");
        if (vaultError || !vaultState) return false;
        const bars = Math.max(0, Math.trunc(Number(vaultState.gold_bars || 0)));
        const grams = Math.max(0, Number(vaultState.gold_grams || 0));
        const { error: snapshotError } = await auth.client.rpc("upsert_sd_flea_gold_snapshot", {
          p_gold_bars: bars,
          p_gold_grams: grams
        });
        if (snapshotError) throw snapshotError;
        return true;
      } catch (error) {
        console.warn("SD 프로필 금 보유량 자동 동기화 실패", error?.message || error);
        return false;
      } finally {
        window.setTimeout(() => { goldSnapshotSyncPromise = null; }, 1500);
      }
    })();
    return goldSnapshotSyncPromise;
  };

  const loadMobileShell = async () => {
    const session = await auth.requireSession();
    if (!session) return null;
    const [profileResult, walletResult] = await Promise.all([
      auth.client.from("profiles").select("nickname,status,role").single(),
      auth.client.from("wallets").select("id,account_number,balance,updated_at").single()
    ]);
    if (profileResult.error) throw profileResult.error;
    if (walletResult.error) throw walletResult.error;
    if (profileResult.data.status !== "active") throw new Error("현재 이용할 수 없는 계정입니다.");
    document.querySelectorAll("[data-mobile-name]").forEach((element) => {
      element.textContent = profileResult.data.nickname;
    });
    document.querySelectorAll("[data-mobile-account]").forEach((element) => {
      element.textContent = walletResult.data.account_number;
    });
    updateBalanceText(walletResult.data.balance);
    await syncGoldSnapshot();
    return { session, profile: profileResult.data, wallet: walletResult.data };
  };
  document.addEventListener("click", async (event) => {
    const logoutButton = event.target.closest("[data-mobile-logout]");
    if (!logoutButton) return;
    logoutButton.disabled = true;
    try {
      await auth.client.auth.signOut();
      location.replace("login.html?next=%2Fsd-center%2Fmobile.html");
    } finally {
      logoutButton.disabled = false;
    }
  });
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    document.querySelectorAll("[data-install-banner]").forEach((element) => element.classList.add("visible"));
  });
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-install-app]");
    if (!button || !deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    document.querySelectorAll("[data-install-banner]").forEach((element) => element.classList.remove("visible"));
  });
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("service-worker.js").catch(console.error));
  }

  window.SD_MOBILE = {
    auth,
    platform,
    uuid,
    setMobileStatus,
    clearMobileStatus,
    fetchWallet,
    updateBalanceText,
    syncGoldSnapshot,
    loadMobileShell
  };
})();
