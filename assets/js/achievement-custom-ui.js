"use strict";

(() => {
  const SPECIAL_ID = "completed";
  const ORDER_KEY = "sd608-achievement-category-order-v1";
  const DEFAULT_ORDER = [
    "logistics", "flea", "miner", "mukjjippa", "slot", "oddeven",
    "bitcoin", "sta", "gold", "npcvault", "sdcoin", "wallet", "ranking"
  ];
  let remoteLoadedFor = "";

  const auth = () => window.SD_AUTH || null;
  const normalizeOrder = (value) => {
    const source = Array.isArray(value) ? value.map(String) : [];
    const seen = new Set();
    const order = source.filter((id) => DEFAULT_ORDER.includes(id) && !seen.has(id) && seen.add(id));
    DEFAULT_ORDER.forEach((id) => { if (!seen.has(id)) order.push(id); });
    return order;
  };
  const readOrder = () => {
    try { return normalizeOrder(JSON.parse(localStorage.getItem(ORDER_KEY) || "[]")); }
    catch (_) { return [...DEFAULT_ORDER]; }
  };
  const saveLocalOrder = (order) => {
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(normalizeOrder(order))); } catch (_) {}
  };

  async function currentUserId() {
    try {
      const client = auth()?.client;
      if (!client?.auth) return "";
      const { data } = await client.auth.getSession();
      return String(data?.session?.user?.id || "");
    } catch (_) { return ""; }
  }

  async function saveRemoteOrder(order) {
    const client = auth()?.client;
    const userId = await currentUserId();
    if (!client || !userId) return false;
    const { error } = await client.from("sd_user_preferences").upsert({
      user_id: userId,
      achievement_category_order: normalizeOrder(order),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) throw error;
    remoteLoadedFor = userId;
    return true;
  }

  async function loadRemoteOrder() {
    const client = auth()?.client;
    const userId = await currentUserId();
    if (!client || !userId || remoteLoadedFor === userId) return;
    remoteLoadedFor = userId;
    try {
      const { data, error } = await client.from("sd_user_preferences")
        .select("achievement_category_order")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      if (Array.isArray(data?.achievement_category_order) && data.achievement_category_order.length) {
        saveLocalOrder(data.achievement_category_order);
        apply(false);
      } else {
        await saveRemoteOrder(readOrder());
      }
    } catch (error) {
      console.warn("[SD Achievement UI] category order sync unavailable", error?.message || error);
    }
  }

  function injectStyles() {
    if (document.getElementById("achievement-custom-ui-v2-style")) return;
    const style = document.createElement("style");
    style.id = "achievement-custom-ui-v2-style";
    style.textContent = `
      .achievement-tab.achievement-completed-tab{border-color:rgba(91,214,153,.28);background:rgba(91,214,153,.08);color:#a9edc9}
      .achievement-drag-handle{display:inline-grid;place-items:center;width:20px;height:24px;margin-left:5px;border-radius:7px;color:#62718b;cursor:grab;user-select:none}
      .achievement-tab.is-dragging{opacity:.58;border-style:dashed}
      .achievement-order-tools{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:8px}
      .achievement-order-hint{margin-right:auto;color:#66758e;font-size:.66rem;font-weight:800}
      .achievement-order-reset{min-height:30px;padding:0 10px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:rgba(255,255,255,.035);color:#8f9db2;font:inherit;font-size:.68rem;font-weight:900;cursor:pointer}
      @media(max-width:760px){.achievement-order-hint{display:none}}
    `;
    document.head.append(style);
  }

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
    if (!tabs || !main || !id) return;
    tabs.querySelectorAll("[data-achievement-tab]").forEach((button) => {
      const active = button.dataset.achievementTab === id;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    main.querySelectorAll("[data-achievement-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.achievementPanel === id));
  }

  function ensureTools() {
    const wrap = document.querySelector(".achievement-tabs-wrap");
    if (!wrap || wrap.querySelector(".achievement-order-tools")) return;
    const tools = document.createElement("div");
    tools.className = "achievement-order-tools";
    const hint = document.createElement("span");
    hint.className = "achievement-order-hint";
    hint.textContent = "드래그하여 카테고리 순서 변경";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "achievement-order-reset";
    reset.textContent = "기본 순서";
    reset.addEventListener("click", () => {
      saveLocalOrder(DEFAULT_ORDER);
      void saveRemoteOrder(DEFAULT_ORDER).catch((error) => console.warn("[SD Achievement UI] order save unavailable", error?.message || error));
      apply(false);
    });
    tools.append(hint, reset);
    wrap.append(tools);
  }

  function wireDrag(tabs) {
    let dragging = null;
    tabs.querySelectorAll(".achievement-tab[data-achievement-tab]:not([data-achievement-tab='completed'])").forEach((button) => {
      if (!button.querySelector(".achievement-drag-handle")) {
        const handle = document.createElement("span");
        handle.className = "achievement-drag-handle";
        handle.textContent = "⋮⋮";
        handle.setAttribute("aria-hidden", "true");
        button.append(handle);
      }
      button.draggable = true;
      button.addEventListener("dragstart", () => { dragging = button; button.classList.add("is-dragging"); });
      button.addEventListener("dragend", () => {
        button.classList.remove("is-dragging");
        dragging = null;
        const order = [...tabs.querySelectorAll(".achievement-tab[data-achievement-tab]:not([data-achievement-tab='completed'])")].map((node) => node.dataset.achievementTab);
        saveLocalOrder(order);
        void saveRemoteOrder(order).catch((error) => console.warn("[SD Achievement UI] order save unavailable", error?.message || error));
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
    injectStyles();
    ensureTools();
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
      if (button.dataset.achievementTab !== SPECIAL_ID) button.onclick = () => activate(button.dataset.achievementTab);
    });
    wireDrag(tabs);

    const available = new Set([...tabs.querySelectorAll("[data-achievement-tab]")].map((node) => node.dataset.achievementTab));
    activate(available.has(activeBefore) ? activeBefore : (completed.length ? SPECIAL_ID : order.find((id) => available.has(id))));
  }

  async function boot() {
    apply(false);
    await loadRemoteOrder();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void boot(), { once: true });
  else void boot();
  window.addEventListener("sd-achievements-updated", () => queueMicrotask(() => apply(true)));
})();
