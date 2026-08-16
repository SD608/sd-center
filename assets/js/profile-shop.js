"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const auth = window.SD_AUTH;
  const status = document.getElementById("shopStatus");
  const root = document.getElementById("profileShopList");
  const logout = document.getElementById("logoutButton");
  if (!auth || !root) return;

  const won = (value) => auth.formatWon(Math.max(0, Math.trunc(Number(value || 0))));

  async function load() {
    try {
      const session = await auth.requireSession();
      if (!session) return;
      const { data, error } = await auth.client.rpc("list_sd_profile_shop");
      if (error) throw error;
      const items = data?.items || [];
      root.replaceChildren();
      if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "profile-empty";
        empty.style.gridColumn = "1/-1";
        empty.innerHTML = "현재 등록된 치장품이 없습니다.<br>상품은 나중에 추가할 수 있도록 상점 시스템만 만들어 둔 상태입니다.";
        root.append(empty);
        return;
      }
      items.forEach((item) => {
        const card = document.createElement("article");
        card.className = "shop-cosmetic-card";
        const kind = document.createElement("span");
        kind.className = "section-kicker";
        kind.textContent = item.kind === "avatar" ? "PROFILE PHOTO" : item.kind.toUpperCase();
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
    } catch (error) {
      auth.setStatus(status, auth.messageForError(error), "error");
      root.innerHTML = '<div class="profile-empty" style="grid-column:1/-1">상점 정보를 불러오지 못했습니다.</div>';
    }
  }

  logout?.addEventListener("click", async () => {
    logout.disabled = true;
    try { await auth.client.auth.signOut(); location.replace("login.html"); }
    finally { logout.disabled = false; }
  });

  await load();
});