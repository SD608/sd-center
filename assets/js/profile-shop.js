"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const auth = window.SD_AUTH;
  const status = document.getElementById("shopStatus");
  const root = document.getElementById("profileShopList");
  const titleRoot = document.getElementById("achievementTitleShopList");
  const titleCount = document.getElementById("achievementTitleCount");
  const logout = document.getElementById("logoutButton");
  if (!auth || !root || !titleRoot) return;

  const won = (value) => auth.formatWon(Math.max(0, Math.trunc(Number(value || 0))));
  const dateText = (value) => {
    if (!value) return "달성 완료";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "달성 완료";
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")} 달성`;
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

  function renderTitles(items) {
    titleRoot.replaceChildren();
    const unlockedCount = items.filter((item) => item.unlocked).length;
    if (titleCount) titleCount.textContent = `${unlockedCount}/${items.length}개 보유`;

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "profile-empty";
      empty.style.gridColumn = "1/-1";
      empty.textContent = "등록된 업적 칭호가 없습니다.";
      titleRoot.append(empty);
      return;
    }

    items.forEach((item) => {
      const unlocked = Boolean(item.unlocked);
      const equipped = Boolean(item.equipped);
      const card = document.createElement("article");
      card.className = `achievement-title-shop-card${unlocked ? "" : " locked"}${equipped ? " equipped" : ""}`;

      const head = document.createElement("div");
      head.className = "achievement-title-shop-head";
      const icon = document.createElement("span");
      icon.className = "achievement-title-shop-icon";
      icon.textContent = item.icon || (unlocked ? "🏆" : "🔒");
      const kicker = document.createElement("span");
      kicker.className = "section-kicker";
      kicker.textContent = equipped ? "EQUIPPED TITLE" : unlocked ? "ACHIEVEMENT TITLE" : "LOCKED TITLE";
      head.append(icon, kicker);

      const name = document.createElement("h3");
      name.textContent = item.title_reward || item.name || "업적 칭호";
      const desc = document.createElement("p");
      desc.textContent = item.description || "업적 달성 보상";
      const state = document.createElement("span");
      state.className = "achievement-title-state";
      state.textContent = equipped ? "현재 프로필에 장착 중" : unlocked ? `${dateText(item.unlocked_at)} · 무료 보상` : "업적을 달성하면 자동 지급";

      const button = document.createElement("button");
      button.type = "button";
      button.disabled = !unlocked || equipped;
      button.textContent = equipped ? "장착 중" : unlocked ? "칭호 장착" : "업적 미달성";
      button.addEventListener("click", async () => {
        if (!unlocked || equipped) return;
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

      card.append(head, name, desc, state, button);
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
      renderTitles(data?.achievement_titles || []);
    } catch (error) {
      auth.setStatus(status, auth.messageForError(error), "error");
      root.innerHTML = '<div class="profile-empty" style="grid-column:1/-1">상점 정보를 불러오지 못했습니다.</div>';
      titleRoot.innerHTML = '<div class="profile-empty" style="grid-column:1/-1">업적 칭호를 불러오지 못했습니다.</div>';
      if (titleCount) titleCount.textContent = "연동 오류";
    }
  }

  logout?.addEventListener("click", async () => {
    logout.disabled = true;
    try { await auth.client.auth.signOut(); location.replace("login.html"); }
    finally { logout.disabled = false; }
  });

  await load();
});