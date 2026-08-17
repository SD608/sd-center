"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const auth = window.SD_AUTH;
  const root = document.getElementById("profileAchievements");
  const count = document.getElementById("achievementCount");
  if (!auth || !root || !count) return;

  const params = new URLSearchParams(location.search);
  const requestedUserId = params.get("user") || null;
  const refreshButton = document.getElementById("refreshProfile");
  const createButton = document.getElementById("createProfileButton");

  const CATEGORY_META = {
    logistics: { label: "물류센터", icon: "🚚" },
    flea: { label: "플리마켓", icon: "🧰" },
    miner: { label: "광부", icon: "⛏️" },
    mukjjippa: { label: "묵찌빠", icon: "✊" },
    slot: { label: "슬롯", icon: "🎰" },
    oddeven: { label: "홀짝", icon: "🎲" },
    bitcoin: { label: "비트코인", icon: "₿" },
    sta: { label: "STA", icon: "🏍️" },
    gold: { label: "금 구매", icon: "🪙" },
    npcvault: { label: "NPC 금고", icon: "🔐" },
    sdcoin: { label: "SD코인", icon: "📈" },
    wallet: { label: "지갑", icon: "💰" },
    ranking: { label: "잔액 랭킹", icon: "👑" }
  };

  let latestPayload = null;
  let renderInProgress = false;
  let requestSerial = 0;

  const catalog = () => Array.isArray(window.SD_ACHIEVEMENTS) ? window.SD_ACHIEVEMENTS : [];
  const catalogMap = () => new Map(catalog().map((achievement) => [String(achievement.id), achievement]));

  function formatUnlockedAt(value) {
    if (!value) return "달성 완료";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "달성 완료";
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")} 달성`;
  }

  function render(payload) {
    const definitions = catalog();
    const definitionsById = catalogMap();
    const items = Array.isArray(payload?.items) ? payload.items : [];

    renderInProgress = true;
    try {
      root.replaceChildren();
      count.textContent = definitions.length
        ? `${items.length}/${definitions.length} 달성`
        : `${items.length}개 달성`;

      if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "profile-empty";
        empty.style.gridColumn = "1/-1";
        empty.dataset.profileAchievementSync = "";
        empty.textContent = "아직 획득한 업적이 없습니다.";
        root.append(empty);
        return;
      }

      items.forEach((progress) => {
        const id = String(progress?.id || "");
        const definition = definitionsById.get(id) || null;
        const category = CATEGORY_META[definition?.c] || { label: "업적", icon: "🏆" };

        const card = document.createElement("article");
        card.className = "achievement-card";
        card.dataset.profileAchievementSync = "";
        card.dataset.achievementId = id;

        const icon = document.createElement("div");
        icon.className = "achievement-icon";
        icon.textContent = category.icon;

        const info = document.createElement("div");
        const name = document.createElement("h3");
        const hiddenWithoutReveal = definition?.h && (!definition?.n || definition.n === "???");
        name.textContent = hiddenWithoutReveal ? "히든 업적" : (definition?.n || id || "업적");

        const desc = document.createElement("p");
        desc.textContent = hiddenWithoutReveal ? "히든 업적 달성" : (definition?.d || "업적 달성");

        const meta = document.createElement("span");
        meta.className = "achievement-title";
        meta.textContent = `${category.label} · ${formatUnlockedAt(progress?.unlocked_at || progress?.updated_at)}`;

        info.append(name, desc, meta);
        card.append(icon, info);
        root.append(card);
      });
    } finally {
      renderInProgress = false;
    }
  }

  async function loadAchievements() {
    const serial = ++requestSerial;
    try {
      const session = await auth.requireSession();
      if (!session) return;

      const { data, error } = await auth.client.rpc("get_sd_public_profile_achievement_progress", {
        p_user_id: requestedUserId
      });
      if (error) throw error;
      if (serial !== requestSerial) return;
      if (!data?.created) return;

      latestPayload = data;
      render(data);
    } catch (error) {
      console.warn("프로필 업적 연동 실패", error);
      if (!latestPayload) count.textContent = "업적 연동 오류";
    }
  }

  // 기존 profile-page.js가 구형 업적 배열로 다시 그리더라도
  // 새 계정 업적 데이터가 마지막에 유지되도록 감시합니다.
  const observer = new MutationObserver(() => {
    if (renderInProgress || !latestPayload) return;
    if (!root.querySelector("[data-profile-achievement-sync]")) {
      queueMicrotask(() => render(latestPayload));
    }
  });
  observer.observe(root, { childList: true });

  refreshButton?.addEventListener("click", () => setTimeout(() => void loadAchievements(), 250));
  createButton?.addEventListener("click", () => setTimeout(() => void loadAchievements(), 600));

  void loadAchievements();
});
