"use strict";

(() => {
  const SPECIAL_ID = "completed";
  const ORDER_KEY = "sd608-achievement-category-order-v1";
  const DEFAULT_ORDER = [
    "logistics", "flea", "miner", "mukjjippa", "slot", "oddeven",
    "bitcoin", "sta", "gold", "npcvault", "sdcoin", "wallet", "ranking"
  ];

  const readOrder = () => {
    try {
      const value = JSON.parse(localStorage.getItem(ORDER_KEY) || "[]");
      if (!Array.isArray(value)) return [...DEFAULT_ORDER];
      const seen = new Set();
      const order = value.map(String).filter((id) => DEFAULT_ORDER.includes(id) && !seen.has(id) && seen.add(id));
      DEFAULT_ORDER.forEach((id) => { if (!seen.has(id)) order.push(id); });
      return order;
    } catch (_) { return [...DEFAULT_ORDER]; }
  };
  const saveOrder = (order) => {
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch (_) {}
  };

  function completedPanel(main, completed) {
    const panel = document.createElement("section");
    panel.className = "achievement-panel";
    panel.dataset.achievementPanel = SPECIAL_ID;
    const heading = document.createElement("div");
    heading.className = "achievement-category-title";
    const titleWrap = document.createElement("div");
    const kicker = document.createElement("span");
    kicker.textContent = "COMPLETED";
    const title = document.createElement("h2");
    title.textContent = "달성 완료";
    titleWrap.append(kicker, title);
    const meta = document.createElement("span");
    meta.className = "achievement-category-meta";
    meta.textContent = `${completed.length}개 달성`;
    heading.append(titleWrap, meta);
    const grid = document.createElement("div");
    grid.className = "achievement-grid";
    completed.forEach((card) => grid.append(card.cloneNode(true)));
    if (!completed.length) {
      const empty = document.createElement("div");
      empty.className = "achievement-empty";
      empty.textContent = "아직 달성한 업적이 없습니다.";
      grid.append(empty);
    }
    panel.append(heading, grid);
    main.append(panel);
    return panel;
  }

  function activate(id) {
    const tabs = document.querySelector(".achievement-tabs");
    const main = document.querySelector(".achievements-page");
    if (!tabs || !main) return;
    tabs.querySelectorAll("[data-achievement-tab]").forEach((button) => {
      const active = button.dataset.achievementTab === id;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    main.querySelectorAll("[data-achievement-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.achievementPanel === id));
  }

  function wireDrag(tabs) {
    let dragging = null;
    tabs.querySelectorAll(".achievement-tab[data-achievement-tab]:not([data-achievement-tab='completed'])").forEach((button) => {
      button.draggable = true;
      button.title = "드래그하여 순서 변경";
      button.addEventListener("dragstart", () => { dragging = button; button.classList.add("is-dragging"); });
      button.addEventListener("dragend", () => {
        button.classList.remove("is-dragging");
        dragging = null;
        const order = [...tabs.querySelectorAll(".achievement-tab[data-achievement-tab]:not([data-achievement-tab='completed'])")].map((node) => node.dataset.achievementTab);
        saveOrder(order);
        apply(false);
      });
      button.addEventListener("dragover", (event) => {
        if (!dragging || dragging === button) return;
        event.preventDefault();
        const rect = button.getBoundingClientRect();
        tabs.insertBefore(dragging, event.clientX < rect.left + rect.width / 2 ? button : button.nextSibling);
      });
    });
  }

  function apply(preserveActive = true) {
    const tabs = document.querySelector(".achievement-tabs");
    const main = document.querySelector(".achievements-page");
    if (!tabs || !main) return;
    const activeBefore = preserveActive ? tabs.querySelector(".achievement-tab.active")?.dataset.achievementTab : null;

    tabs.querySelector(`[data-achievement-tab="${SPECIAL_ID}"]`)?.remove();
    main.querySelector(`[data-achievement-panel="${SPECIAL_ID}"]`)?.remove();

    const order = readOrder();
    order.forEach((id) => {
      const button = tabs.querySelector(`[data-achievement-tab="${id}"]`);
      const panel = main.querySelector(`[data-achievement-panel="${id}"]`);
      if (button) tabs.append(button);
      if (panel) main.append(panel);
    });

    const completed = [...main.querySelectorAll(".achievement-card.complete")].filter((card) => !card.closest(`[data-achievement-panel="${SPECIAL_ID}"]`));
    const completedButton = document.createElement("button");
    completedButton.type = "button";
    completedButton.className = "achievement-tab achievement-completed-tab";
    completedButton.dataset.achievementTab = SPECIAL_ID;
    completedButton.textContent = `달성 완료 (${completed.length})`;
    completedButton.addEventListener("click", () => activate(SPECIAL_ID));
    tabs.prepend(completedButton);
    completedPanel(main, completed);

    tabs.querySelectorAll(".achievement-tab[data-achievement-tab]").forEach((button) => {
      if (button.dataset.achievementTab === SPECIAL_ID) return;
      button.onclick = () => activate(button.dataset.achievementTab);
    });
    wireDrag(tabs);

    const available = new Set([...tabs.querySelectorAll("[data-achievement-tab]")].map((node) => node.dataset.achievementTab));
    activate(available.has(activeBefore) ? activeBefore : (completed.length ? SPECIAL_ID : order.find((id) => available.has(id))));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => apply(false), { once: true });
  else apply(false);
  window.addEventListener("sd-achievements-updated", () => queueMicrotask(() => apply(true)));
})();
