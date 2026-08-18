"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const auth = window.SD_AUTH;
  const status = document.getElementById("shopStatus");
  const root = document.getElementById("profileShopList");
  const titleRoot = document.getElementById("achievementTitleShopList");
  const titleCount = document.getElementById("achievementTitleCount");
  const titleResultText = document.getElementById("achievementTitleResultText");
  const categorySelect = document.getElementById("achievementTitleCategory");
  const sortSelect = document.getElementById("achievementTitleSort");
  const searchInput = document.getElementById("achievementTitleSearch");
  const resetButton = document.getElementById("achievementTitleFilterReset");
  const logout = document.getElementById("logoutButton");
  if (!auth || !root || !titleRoot) return;

  const CATEGORY_META = {
    logistics: { label: "물류센터", order: 1 },
    flea: { label: "플리마켓", order: 2 },
    miner: { label: "광부", order: 3 },
    mukjjippa: { label: "묵찌빠", order: 4 },
    slot: { label: "슬롯", order: 5 },
    oddeven: { label: "홀짝", order: 6 },
    bitcoin: { label: "비트코인", order: 7 },
    sta: { label: "STA", order: 8 },
    gold: { label: "금 구매", order: 9 },
    npcvault: { label: "NPC 금고", order: 10 },
    sdcoin: { label: "SD코인", order: 11 },
    wallet: { label: "지갑", order: 12 },
    ranking: { label: "잔액 랭킹", order: 13 }
  };

  let allTitleItems = [];

  const won = (value) => auth.formatWon(Math.max(0, Math.trunc(Number(value || 0))));
  const dateText = (value) => {
    if (!value) return "달성 완료";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "달성 완료";
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")} 달성`;
  };
  const categoryOf = (item) => {
    const code = String(item?.code || "").toLowerCase();
    if (code.startsWith("sdcoin-")) return "sdcoin";
    const prefix = code.split("-")[0];
    return CATEGORY_META[prefix] ? prefix : "other";
  };
  const categoryLabel = (item) => CATEGORY_META[categoryOf(item)]?.label || "기타";
  const unlockedTime = (item) => {
    const value = Date.parse(item?.unlocked_at || "");
    return Number.isFinite(value) ? value : 0;
  };

  function renderCosmetics(items) {
    root.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "profile-empty";
      empty.style.gridColumn = "1/-1";
      empty.textContent = "현재 등록된 유료 프로필 치장품이 없습니다.";
      root.append(empty);
      return;
    }

    items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "shop-cosmetic-card";
      const kind = document.createElement("span");
      kind.className = "section-kicker";
      kind.textContent = item.kind === "avatar" ? "PROFILE PHOTO" : String(item.kind || "COSMETIC").toUpperCase();
      const name = document.createElement("h3");
      name.textContent = item.name;
      const desc = document.createElement("p");
      desc.textContent = item.description || "프로필 치장품";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.owned ? "보유 중" : `${won(item.price)} 구매`;
      button.disabled = Boolean(item.owned);
      button.addEventListener("click", async () => {
        if (!window.confirm(`${item.name}을(를) ${won(item.price)}에 구매할까요?`)) return;
        button.disabled = true;
        try {
          const { error } = await auth.client.rpc("buy_sd_profile_cosmetic", { p_cosmetic_id: item.id, p_platform: "web" });
          if (error) throw error;
          auth.setStatus(status, `${item.name} 구매 완료`, "success");
          await load();
        } catch (error) {
          auth.setStatus(status, auth.messageForError(error), "error");
          button.disabled = false;
        }
      });
      card.append(kind, name, desc, button);
      root.append(card);
    });
  }

  function filteredTitles() {
    const owned = allTitleItems.filter((item) => Boolean(item.unlocked));
    const category = categorySelect?.value || "all";
    const search = String(searchInput?.value || "").trim().toLocaleLowerCase("ko-KR");
    const sort = sortSelect?.value || "recent";

    let items = owned.filter((item) => category === "all" || categoryOf(item) === category);
    if (search) {
      items = items.filter((item) => {
        const haystack = [item.title_reward, item.name, item.description, categoryLabel(item), item.code]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("ko-KR");
        return haystack.includes(search);
      });
    }

    items.sort((a, b) => {
      if (sort === "oldest") return unlockedTime(a) - unlockedTime(b) || String(a.title_reward || a.name).localeCompare(String(b.title_reward || b.name), "ko");
      if (sort === "name") return String(a.title_reward || a.name).localeCompare(String(b.title_reward || b.name), "ko");
      if (sort === "category") {
        const ca = CATEGORY_META[categoryOf(a)]?.order ?? 99;
        const cb = CATEGORY_META[categoryOf(b)]?.order ?? 99;
        return ca - cb || String(a.title_reward || a.name).localeCompare(String(b.title_reward || b.name), "ko");
      }
      return unlockedTime(b) - unlockedTime(a) || String(a.title_reward || a.name).localeCompare(String(b.title_reward || b.name), "ko");
    });

    return { owned, items };
  }

  function renderTitles() {
    titleRoot.replaceChildren();
    const { owned, items } = filteredTitles();
    if (titleCount) titleCount.textContent = `${owned.length}개 보유`;
    if (titleResultText) {
      const category = categorySelect?.value || "all";
      const categoryName = category === "all" ? "전체 확장팩" : (CATEGORY_META[category]?.label || "기타");
      titleResultText.innerHTML = `<strong>${items.length}개</strong> 표시 · ${categoryName} · 전체 보유 ${owned.length}개`;
    }

    if (!owned.length) {
      const empty = document.createElement("div");
      empty.className = "profile-empty";
      empty.style.gridColumn = "1/-1";
      empty.textContent = "아직 달성해서 보유한 업적 칭호가 없습니다.";
      titleRoot.append(empty);
      return;
    }

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "profile-empty";
      empty.style.gridColumn = "1/-1";
      empty.innerHTML = "선택한 조건에 맞는 보유 칭호가 없습니다.<br>다른 확장팩을 선택하거나 검색어를 지워보세요.";
      titleRoot.append(empty);
      return;
    }

    items.forEach((item) => {
      const equipped = Boolean(item.equipped);
      const card = document.createElement("article");
      card.className = `achievement-title-shop-card${equipped ? " equipped" : ""}`;
      card.dataset.category = categoryOf(item);

      const head = document.createElement("div");
      head.className = "achievement-title-shop-head";
      const icon = document.createElement("span");
      icon.className = "achievement-title-shop-icon";
      icon.textContent = item.icon || "🏆";
      const kicker = document.createElement("span");
      kicker.className = "section-kicker";
      kicker.textContent = equipped ? "EQUIPPED TITLE" : "OWNED TITLE";
      head.append(icon, kicker);

      const category = document.createElement("span");
      category.className = "achievement-title-category";
      category.textContent = categoryLabel(item);

      const name = document.createElement("h3");
      name.textContent = item.title_reward || item.name || "업적 칭호";
      const desc = document.createElement("p");
      desc.textContent = item.description || "업적 달성 보상";
      const state = document.createElement("span");
      state.className = "achievement-title-state";
      state.textContent = equipped ? "현재 프로필에 장착 중" : `${dateText(item.unlocked_at)} · 업적 보상`;

      const button = document.createElement("button");
      button.type = "button";
      button.disabled = equipped;
      button.textContent = equipped ? "장착 중" : "칭호 장착";
      button.addEventListener("click", async () => {
        if (equipped) return;
        button.disabled = true;
        try {
          const { error } = await auth.client.rpc("equip_sd_profile_title", { p_achievement_id: item.id });
          if (error) throw error;
          auth.setStatus(status, `칭호 [${item.title_reward || item.name}] 장착 완료`, "success");
          await load();
        } catch (error) {
          auth.setStatus(status, auth.messageForError(error), "error");
          button.disabled = false;
        }
      });

      card.append(head, category, name, desc, state, button);
      titleRoot.append(card);
    });
  }

  async function load() {
    try {
      const session = await auth.requireSession();
      if (!session) return;
      const { data, error } = await auth.client.rpc("list_sd_profile_shop");
      if (error) throw error;
      renderCosmetics(data?.items || []);
      allTitleItems = Array.isArray(data?.achievement_titles) ? data.achievement_titles : [];
      renderTitles();
    } catch (error) {
      auth.setStatus(status, auth.messageForError(error), "error");
      root.innerHTML = '<div class="profile-empty" style="grid-column:1/-1">상점 정보를 불러오지 못했습니다.</div>';
      titleRoot.innerHTML = '<div class="profile-empty" style="grid-column:1/-1">업적 칭호를 불러오지 못했습니다.</div>';
      if (titleCount) titleCount.textContent = "연동 오류";
      if (titleResultText) titleResultText.textContent = "필터 정보를 불러오지 못했습니다.";
    }
  }

  categorySelect?.addEventListener("change", renderTitles);
  sortSelect?.addEventListener("change", renderTitles);
  searchInput?.addEventListener("input", renderTitles);
  resetButton?.addEventListener("click", () => {
    if (categorySelect) categorySelect.value = "all";
    if (sortSelect) sortSelect.value = "recent";
    if (searchInput) searchInput.value = "";
    renderTitles();
  });

  logout?.addEventListener("click", async () => {
    logout.disabled = true;
    try { await auth.client.auth.signOut(); location.replace("login.html"); }
    finally { logout.disabled = false; }
  });

  await load();
});