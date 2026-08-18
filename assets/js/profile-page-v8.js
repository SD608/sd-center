"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const auth = window.SD_AUTH;
  if (!auth) return;

  const status = document.getElementById("profileStatus");
  const content = document.getElementById("profileContent");
  const missing = document.getElementById("profileMissing");
  const createButton = document.getElementById("createProfileButton");
  const refreshButton = document.getElementById("refreshProfile");
  const logoutButton = document.getElementById("logoutButton");
  const cardGrid = document.getElementById("profileCardGrid");
  const cardEmpty = document.getElementById("profileCardEmpty");

  const requestedUserId = new URLSearchParams(location.search).get("user") || null;
  let profile = null;

  const COIN_CODES = ["DDJ", "HSH", "SET", "HIZ", "KNG", "SDC"];
  const CARD_KEYS = ["photo", "nickname", "title", "assets", "gold", "coins", "flea_showcase"];
  const DEFAULT_CARD_LAYOUT = {
    version: 6,
    order: [...CARD_KEYS],
    visible: { photo: true, nickname: true, title: true, assets: true, gold: true, coins: true, flea_showcase: false },
    settings: { gold_display: "count", coin_codes: [...COIN_CODES] }
  };

  const won = (value) => auth.formatWon(Math.max(0, Math.trunc(Number(value || 0))));
  const number = (value, digits = 2) => Number(value || 0).toLocaleString("ko-KR", { maximumFractionDigits: digits });
  const setStatus = (message, type = "info") => auth.setStatus(status, message, type);

  function normalizeGoldDisplay(value) {
    const mode = String(value || "count").toLowerCase();
    if (mode === "weight") return "g";
    return ["count", "g", "kg"].includes(mode) ? mode : "count";
  }

  function normalizeCoinCodes(value) {
    if (!Array.isArray(value)) return [...COIN_CODES];
    const requested = new Set(value.map((code) => String(code).toUpperCase()));
    return COIN_CODES.filter((code) => requested.has(code));
  }

  function normalizeCardLayout(input) {
    const order = [];
    const rawOrder = Array.isArray(input?.order) ? input.order.map(String) : [];
    rawOrder.forEach((key) => {
      if (key === "identity") {
        if (!order.includes("nickname")) order.push("nickname");
        if (!order.includes("title")) order.push("title");
        return;
      }
      if (CARD_KEYS.includes(key) && !order.includes(key)) order.push(key);
    });
    CARD_KEYS.forEach((key) => { if (!order.includes(key)) order.push(key); });

    const legacyIdentity = typeof input?.visible?.identity === "boolean" ? input.visible.identity : true;
    const visible = {};
    CARD_KEYS.forEach((key) => {
      if (typeof input?.visible?.[key] === "boolean") visible[key] = input.visible[key];
      else if (key === "nickname" || key === "title") visible[key] = legacyIdentity;
      else if (key === "flea_showcase") visible[key] = false;
      else visible[key] = true;
    });

    return {
      version: 6,
      order,
      visible,
      settings: {
        gold_display: normalizeGoldDisplay(input?.settings?.gold_display),
        coin_codes: normalizeCoinCodes(input?.settings?.coin_codes)
      }
    };
  }

  function applyCardLayout(layout) {
    if (!cardGrid) return;
    const normalized = normalizeCardLayout(layout);
    let visibleCount = 0;
    normalized.order.forEach((key, index) => {
      const block = cardGrid.querySelector(`[data-card-block="${key}"]`);
      if (!block) return;
      block.style.order = String(index);
      block.hidden = !normalized.visible[key];
      if (normalized.visible[key]) visibleCount += 1;
    });
    cardGrid.hidden = visibleCount === 0;
    if (cardEmpty) cardEmpty.hidden = visibleCount > 0;
  }

  function renderMissing() {
    content.hidden = true;
    missing.hidden = false;
    document.getElementById("missingName").textContent = `${profile?.nickname || "회원"}님의 공개 프로필이 아직 없습니다.`;
    createButton.hidden = !profile?.is_me;
    document.getElementById("profileHeading").textContent = profile?.is_me ? "내 프로필" : `${profile?.nickname || "회원"} 프로필`;
  }

  function renderPhoto() {
    const root = document.getElementById("profilePhoto");
    if (!root) return;
    root.replaceChildren();
    if (profile?.avatar_url) {
      const img = document.createElement("img");
      img.src = profile.avatar_url;
      img.alt = `${profile?.nickname || "회원"} 프로필 사진`;
      root.append(img);
      return;
    }
    const fallback = document.createElement("span");
    fallback.textContent = "👤";
    root.append(fallback);
  }

  function renderCoins(layout) {
    const root = document.getElementById("profileCoins");
    if (!root) return;
    root.replaceChildren();

    const coins = Array.isArray(profile?.coins) ? profile.coins : null;
    if (!coins) {
      const hidden = document.createElement("span");
      hidden.className = "profile-coin-empty";
      hidden.textContent = "비공개";
      root.append(hidden);
      return;
    }

    const selected = new Set(layout.settings.coin_codes);
    const visibleCoins = coins.filter((coin) => selected.has(String(coin.code || "").toUpperCase()));
    if (!visibleCoins.length) {
      const empty = document.createElement("span");
      empty.className = "profile-coin-empty";
      empty.textContent = "표시할 코인 없음";
      root.append(empty);
      return;
    }

    visibleCoins.forEach((coin) => {
      const chip = document.createElement("div");
      chip.className = "profile-coin-chip";
      const code = document.createElement("b");
      code.textContent = coin.code || "코인";
      const quantity = document.createElement("strong");
      quantity.textContent = number(coin.quantity, 8);
      chip.append(code, quantity);
      root.append(chip);
    });
  }

  function renderFleaShowcase() {
    const root = document.getElementById("profileFleaShowcase");
    if (!root) return;
    root.replaceChildren();
    const items = Array.isArray(profile?.showcase_items) ? profile.showcase_items : null;
    if (!items) {
      const hidden = document.createElement("span");
      hidden.className = "profile-showcase-empty";
      hidden.textContent = "비공개";
      root.append(hidden);
      return;
    }
    if (!items.length) {
      const empty = document.createElement("span");
      empty.className = "profile-showcase-empty";
      empty.textContent = "등록된 아이템 없음";
      root.append(empty);
      return;
    }
    items.forEach((item) => {
      const card = document.createElement("div");
      card.className = "profile-showcase-item";
      const name = document.createElement("strong");
      name.textContent = item.name || "플리마켓 아이템";
      const value = document.createElement("span");
      value.textContent = won(item.current_value || 0);
      card.append(name, value);
      root.append(card);
    });
  }

  function renderCardValues() {
    const layout = normalizeCardLayout(profile?.card_layout || DEFAULT_CARD_LAYOUT);

    const nickname = document.getElementById("profileNickname");
    if (nickname) nickname.textContent = profile?.nickname || "비공개";

    const title = document.getElementById("profileTitleBadge");
    if (title) title.textContent = profile?.title || "장착된 칭호 없음";

    const assetTotal = document.getElementById("profileAssetTotal");
    if (assetTotal) assetTotal.textContent = profile?.assets?.total == null ? "비공개" : won(profile.assets.total);

    const gold = document.getElementById("profileGold");
    const goldNote = document.getElementById("profileGoldModeNote");
    if (gold) {
      if (layout.settings.gold_display === "g") {
        gold.textContent = profile?.assets?.gold_grams == null ? "비공개" : `${number(profile.assets.gold_grams, 4)}g`;
        if (goldNote) goldNote.textContent = "g 기준";
      } else if (layout.settings.gold_display === "kg") {
        const kilograms = profile?.assets?.gold_kilograms ?? (profile?.assets?.gold_grams == null ? null : Number(profile.assets.gold_grams) / 1000);
        gold.textContent = kilograms == null ? "비공개" : `${number(kilograms, 6)}kg`;
        if (goldNote) goldNote.textContent = "kg 기준";
      } else {
        gold.textContent = profile?.assets?.gold_bars == null ? "비공개" : `${number(profile.assets.gold_bars, 0)}개`;
        if (goldNote) goldNote.textContent = "수량 기준";
      }
    }

    renderCoins(layout);
    renderFleaShowcase();
  }

  function renderProfileCard() {
    missing.hidden = true;
    content.hidden = false;
    document.getElementById("profileHeading").textContent = profile?.is_me ? "내 프로필" : `${profile?.nickname || "회원"} 프로필`;
    renderPhoto();
    renderCardValues();
    applyCardLayout(profile?.card_layout || DEFAULT_CARD_LAYOUT);
  }

  async function loadProfile(showNotice = true) {
    if (refreshButton) refreshButton.disabled = true;
    auth.clearStatus(status);
    try {
      const session = await auth.requireSession();
      if (!session) return;
      const { data, error } = await auth.client.rpc("get_sd_public_profile", { p_user_id: requestedUserId });
      if (error) throw error;
      profile = data;
      if (!profile?.created) renderMissing();
      else renderProfileCard();

      if (showNotice) {
        setStatus("프로필을 불러왔습니다.", "success");
        setTimeout(() => auth.clearStatus(status), 1400);
      }
    } catch (error) {
      setStatus(auth.messageForError(error), "error");
      content.hidden = true;
      missing.hidden = false;
      document.getElementById("missingName").textContent = "프로필을 불러오지 못했습니다.";
      createButton.hidden = true;
    } finally {
      if (refreshButton) refreshButton.disabled = false;
    }
  }

  createButton?.addEventListener("click", async () => {
    createButton.disabled = true;
    try {
      const { error } = await auth.client.rpc("create_sd_public_profile");
      if (error) throw error;
      setStatus("공개 프로필을 만들었습니다.", "success");
      await loadProfile(false);
    } catch (error) {
      setStatus(auth.messageForError(error), "error");
    } finally {
      createButton.disabled = false;
    }
  });

  refreshButton?.addEventListener("click", () => loadProfile(true));
  logoutButton?.addEventListener("click", async () => {
    logoutButton.disabled = true;
    try {
      await auth.client.auth.signOut();
      location.replace("login.html");
    } finally {
      logoutButton.disabled = false;
    }
  });

  await loadProfile(true);
});
