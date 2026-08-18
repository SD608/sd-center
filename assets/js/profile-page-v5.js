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
  const showcaseRoot = document.getElementById("profileShowcase");
  const achievementsRoot = document.getElementById("profileAchievements");
  const cardGrid = document.getElementById("profileCardGrid");
  const cardEmpty = document.getElementById("profileCardEmpty");

  const requestedUserId = new URLSearchParams(location.search).get("user") || null;
  let profile = null;

  const COIN_CODES = ["DDJ", "HSH", "SET", "HIZ", "KNG", "SDC"];
  const CARD_KEYS = ["photo", "identity", "assets", "gold", "coins"];
  const DEFAULT_CARD_LAYOUT = {
    version: 4,
    order: [...CARD_KEYS],
    visible: Object.fromEntries(CARD_KEYS.map((key) => [key, true])),
    settings: { gold_display: "count", coin_codes: [...COIN_CODES] }
  };

  const won = (value) => auth.formatWon(Math.max(0, Math.trunc(Number(value || 0))));
  const number = (value, digits = 2) => Number(value || 0).toLocaleString("ko-KR", { maximumFractionDigits: digits });
  const tierName = (tier) => ({ worn:"낡음", normal:"평범", fancy:"고급진", premium:"최고급", safe:"금고" }[tier] || tier || "-");
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
    (Array.isArray(input?.order) ? input.order : []).map(String).forEach((key) => {
      if (CARD_KEYS.includes(key) && !order.includes(key)) order.push(key);
    });
    CARD_KEYS.forEach((key) => { if (!order.includes(key)) order.push(key); });

    const visible = {};
    CARD_KEYS.forEach((key) => {
      visible[key] = typeof input?.visible?.[key] === "boolean" ? input.visible[key] : true;
    });

    return {
      version: 4,
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
      img.alt = `${profile.nickname || "회원"} 프로필 사진`;
      root.append(img);
    } else {
      const span = document.createElement("span");
      span.textContent = "👤";
      root.append(span);
    }
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
      code.textContent = coin.code || "COIN";
      const quantity = document.createElement("strong");
      quantity.textContent = number(coin.quantity, 8);
      chip.append(code, quantity);
      root.append(chip);
    });
  }

  function renderCardValues() {
    const layout = normalizeCardLayout(profile?.card_layout || DEFAULT_CARD_LAYOUT);
    const nickname = document.getElementById("profileNickname");
    if (nickname) nickname.textContent = profile?.nickname || "회원";

    const title = document.getElementById("profileTitleBadge");
    if (title) {
      title.hidden = !profile?.title;
      title.textContent = profile?.title || "";
    }

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
  }

  function renderShowcase() {
    if (!showcaseRoot) return;
    showcaseRoot.replaceChildren();
    const items = profile?.showcase_items || [];
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "profile-empty";
      empty.style.gridColumn = "1/-1";
      empty.textContent = "프로필에 등록된 플리마켓 아이템이 없습니다.";
      showcaseRoot.append(empty);
      return;
    }

    items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "showcase-item";
      const tier = document.createElement("span");
      tier.className = "tier";
      tier.textContent = tierName(item.tier);
      const name = document.createElement("h3");
      name.textContent = item.name || "아이템";
      const value = document.createElement("strong");
      value.textContent = won(item.current_value);
      const source = document.createElement("p");
      source.textContent = `최초 출처 · ${item.origin_nickname || "회원"}`;
      card.append(tier, name, value, source);
      showcaseRoot.append(card);
    });
  }

  function renderAchievements() {
    if (!achievementsRoot) return;
    achievementsRoot.replaceChildren();
    const items = profile?.achievements || [];
    const count = document.getElementById("achievementCount");
    if (count) count.textContent = `${items.length}개`;

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "profile-empty";
      empty.style.gridColumn = "1/-1";
      empty.textContent = "아직 획득한 업적이 없습니다.";
      achievementsRoot.append(empty);
      return;
    }

    items.forEach((achievement) => {
      const card = document.createElement("article");
      card.className = "achievement-card";
      const icon = document.createElement("div");
      icon.className = "achievement-icon";
      icon.textContent = achievement.icon || "🏆";
      const info = document.createElement("div");
      const name = document.createElement("h3");
      name.textContent = achievement.name || "업적";
      const desc = document.createElement("p");
      desc.textContent = achievement.description || "";
      info.append(name, desc);
      if (achievement.title_reward) {
        const reward = document.createElement("span");
        reward.className = "achievement-title";
        reward.textContent = `칭호 · ${achievement.title_reward}`;
        info.append(reward);
      }
      card.append(icon, info);
      achievementsRoot.append(card);
    });
  }

  function renderProfileCard() {
    missing.hidden = true;
    content.hidden = false;
    document.getElementById("profileHeading").textContent = profile?.is_me ? "내 프로필" : `${profile?.nickname || "회원"} 프로필`;
    renderPhoto();
    renderCardValues();
    applyCardLayout(profile?.card_layout || DEFAULT_CARD_LAYOUT);
    renderShowcase();
    renderAchievements();
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
