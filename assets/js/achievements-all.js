"use strict";

(() => {
  const CATEGORIES = [
    ["logistics", "LOGISTICS", "물류센터"],
    ["flea", "FLEA MARKET", "플리마켓"],
    ["miner", "MINER", "광부"],
    ["mukjjippa", "MUK-JJI-PPA", "묵찌빠"],
    ["slot", "SLOT", "슬롯"],
    ["oddeven", "ODD / EVEN", "홀짝"],
    ["bitcoin", "BITCOIN", "비트코인 채굴"],
    ["sta", "STA", "STA"],
    ["gold", "GOLD", "금 구매"],
    ["npcvault", "NPC VAULT", "NPC 금고 따기"],
    ["sdcoin", "SD COIN", "SD코인"],
    ["wallet", "WALLET", "지갑"],
    ["ranking", "BANK BALANCE RANKING", "통장 잔고 랭킹"],
  ].map(([id, english, label]) => ({ id, english, label }));

  // Presentation only. Never used to decide unlocks; server/Core `unlocked` is final.
  const TARGETS = new Map(Object.entries({
    "logistics-03":5,"logistics-04":10,"logistics-06":100000000,"logistics-07":1000000000,"logistics-08":10000000000,"logistics-10":5,"logistics-11":10,"logistics-12":100,"logistics-13":1000,"logistics-14":100,"logistics-15":100,
    "flea-01":1,"flea-02":10,"flea-03":100,"flea-05":10000000,"flea-06":100000000,"flea-07":1000000000,"flea-08":100,"flea-09":500,"flea-10":1000,"flea-13":1000,"flea-14":10,"flea-17":100,"flea-18":500,"flea-19":50,
    "miner-01":1000,"miner-02":1000000,"miner-03":5000000,"miner-04":10000000,"miner-05":10000,"miner-09":100000000,
    "mukjjippa-02":8,
    "slot-04":100,"slot-05":1000,"slot-06":50,"slot-07":100000000,
    "oddeven-01":8,"oddeven-02":8,"oddeven-03":8,"oddeven-05":100,"oddeven-06":1000,"oddeven-09":5,"oddeven-10":5,
    "bitcoin-02":10,"bitcoin-03":100,"bitcoin-04":1000,
    "sta-03":100,
    "gold-01":10,"gold-02":100,"gold-03":1000,
    "npcvault-04":10,"npcvault-05":100,"npcvault-06":10,"npcvault-08":10,
    "sdcoin-coin-01":10000,"sdcoin-coin-02":10000,"sdcoin-coin-03":10000,"sdcoin-coin-04":10000,"sdcoin-coin-05":10000,"sdcoin-coin-06":10000,"sdcoin-02":6,"sdcoin-03":100000,
    "wallet-02":10000000,"wallet-03":100000000,"wallet-04":1000000000,"wallet-05":10000000000,"wallet-06":100000000000,"wallet-07":1000000000000,
  }));

  const number = (value) => Number(value || 0).toLocaleString("ko-KR");
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const catalog = () => window.SD_ACHIEVEMENT_SYNC?.getCatalog?.() || window.SD_ACHIEVEMENTS || [];
  const done = (item) => Boolean(item?.unlocked);

  function progressBlock(item) {
    const target = TARGETS.get(item.code);
    if (!Number.isFinite(target) || target <= 0 || item.current_value == null) return null;
    const current = Math.max(0, Number(item.current_value || 0));
    const pct = Math.max(0, Math.min(100, current / target * 100));
    const root = el("div", "achievement-progress");
    const head = el("div", "achievement-progress-head");
    head.append(el("span", "", "진행률"), el("strong", "", `${pct.toFixed(pct >= 10 ? 0 : 1)}%`));
    const track = el("div", "achievement-progress-track");
    const fill = el("div", "achievement-progress-fill");
    fill.style.width = `${pct}%`;
    track.append(fill);
    const detail = el("div", "achievement-progress-detail");
    detail.append(el("span", "", number(current)), el("span", "", `목표 ${number(target)}`));
    root.append(head, track, detail);
    return root;
  }

  function achievementCard(item) {
    const complete = done(item);
    const hiddenLocked = Boolean(item.hidden && !complete);
    const card = el("article", `achievement-card${complete ? " complete" : ""}${hiddenLocked ? " hidden-achievement" : ""}`);
    card.dataset.achievementId = item.code;

    const top = el("div", "achievement-top");
    const icon = el("div", "achievement-icon", hiddenLocked ? "❔" : (item.icon || (complete ? "✅" : "🏆")));
    icon.setAttribute("aria-hidden", "true");
    const badgeText = complete ? (item.title_owned ? "달성 · 칭호" : "달성") : hiddenLocked ? "HIDDEN" : "진행 중";
    top.append(icon, el("span", `achievement-badge${hiddenLocked ? " hidden-badge" : ""}`, badgeText));

    const name = el("h3", "achievement-name", hiddenLocked ? "???" : (item.name || item.code));
    const condition = el("div", "achievement-condition");
    condition.append(el("small", "", complete ? "달성 조건" : "달성 조건"), el("strong", "", hiddenLocked ? "???" : (item.description || "조건 정보 없음")));
    card.append(top, name, condition);

    if (!hiddenLocked) {
      const progress = progressBlock(item);
      if (progress) card.append(progress);
    }
    return card;
  }

  function setStatus(text) {
    const note = document.querySelector(".achievement-placeholder") || el("div", "achievement-placeholder");
    note.textContent = text;
    if (!note.isConnected) document.querySelector(".achievements-page")?.append(note);
  }

  function render(detail = {}) {
    const tabs = document.querySelector(".achievement-tabs");
    const main = document.querySelector(".achievements-page");
    if (!tabs || !main) return;

    const items = catalog().filter((item) => item && item.code && item.category);
    const previous = tabs.querySelector(".achievement-tab.active")?.dataset.achievementTab || "logistics";
    const count = document.querySelector(".achievement-count");
    const completed = items.filter(done).length;
    if (count) count.textContent = items.length ? `등록 업적 ${items.length}개 · 달성 ${completed}개` : "업적 동기화 대기";

    const intro = document.querySelector(".achievements-head p");
    if (intro) intro.textContent = "업적과 칭호는 서버에서 확인된 기록만 표시됩니다.";

    tabs.replaceChildren();
    main.querySelectorAll("[data-achievement-panel]").forEach((node) => node.remove());
    main.querySelector(".achievement-placeholder")?.remove();

    if (!items.length) {
      setStatus(detail?.synced === false ? "업적 서버에 연결할 수 없습니다." : "업적을 불러오는 중입니다.");
      return;
    }

    const present = CATEGORIES.filter((category) => items.some((item) => item.category === category.id));
    const activeId = present.some((c) => c.id === previous) ? previous : present[0]?.id;

    present.forEach((category) => {
      const group = items.filter((item) => item.category === category.id).sort((a,b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || a.code.localeCompare(b.code));
      const active = category.id === activeId;
      const button = el("button", `achievement-tab${active ? " active" : ""}`, `${category.label} (${group.length})`);
      button.type = "button";
      button.dataset.achievementTab = category.id;
      button.setAttribute("aria-selected", active ? "true" : "false");
      tabs.append(button);

      const panel = el("section", `achievement-panel${active ? " active" : ""}`);
      panel.dataset.achievementPanel = category.id;
      const heading = el("div", "achievement-category-title");
      const titleWrap = el("div");
      titleWrap.append(el("span", "", category.english), el("h2", "", category.label));
      heading.append(titleWrap, el("span", "achievement-category-meta", `${group.filter(done).length}/${group.length} 달성`));
      const grid = el("div", "achievement-grid");
      group.forEach((item) => grid.append(achievementCard(item)));
      panel.append(heading, grid);
      main.append(panel);
    });

    tabs.onclick = (event) => {
      const button = event.target.closest("[data-achievement-tab]");
      if (!button) return;
      tabs.querySelectorAll(".achievement-tab").forEach((node) => {
        const active = node === button;
        node.classList.toggle("active", active);
        node.setAttribute("aria-selected", active ? "true" : "false");
      });
      main.querySelectorAll("[data-achievement-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.achievementPanel === button.dataset.achievementTab));
    };
    setStatus(detail?.synced === false ? "마지막으로 확인된 업적 정보를 표시 중입니다." : "서버 업적 동기화 완료");
  }

  window.SD_ACHIEVEMENT_RENDER = { render, done, targets: TARGETS };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => render(), { once: true });
  else render();
  window.addEventListener("sd-achievements-updated", (event) => render(event.detail || {}));
})();
