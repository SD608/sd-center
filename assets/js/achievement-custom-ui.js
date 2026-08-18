"use strict";

(() => {
  const SPECIAL_ID = "completed";
  const ORDER_KEY = "sd608-achievement-category-order-v1";
  const DEFAULT_ORDER = [
    "logistics", "flea", "miner", "mukjjippa", "slot", "oddeven",
    "bitcoin", "sta", "gold", "npcvault", "sdcoin", "wallet", "ranking"
  ];
  const LABELS = {
    logistics: "물류센터", flea: "플리마켓", miner: "광부", mukjjippa: "묵찌빠",
    slot: "슬롯", oddeven: "홀짝", bitcoin: "비트코인", sta: "STA",
    gold: "금 구매", npcvault: "NPC 금고", sdcoin: "SD코인", wallet: "지갑",
    ranking: "통장 잔고 랭킹"
  };

  let lastActiveId = "";
  let remoteLoadedFor = "";
  let drag = null;
  let suppressClick = false;
  let refreshTimer = null;

  const auth = () => window.SD_AUTH || null;
  const achievements = () => Array.isArray(window.SD_ACHIEVEMENTS) ? window.SD_ACHIEVEMENTS : [];
  const progress = () => window.SD_ACHIEVEMENT_PROGRESS || {};
  const unlocked = () => window.SD_ACHIEVEMENT_UNLOCKED || {};

  function isDone(item) {
    if (!item) return false;
    if (Boolean(unlocked()[item.id])) return true;
    return Boolean(item.p && typeof item.t === "number" && Number(progress()[item.id] || 0) >= item.t);
  }

  function injectStyles() {
    if (document.getElementById("achievement-custom-ui-style")) return;
    const style = document.createElement("style");
    style.id = "achievement-custom-ui-style";
    style.textContent = `
      .achievement-tab.completed-tab{border-color:rgba(91,214,153,.28);background:rgba(91,214,153,.08);color:#a9edc9}
      .achievement-tab.completed-tab.active{border-color:rgba(91,214,153,.5);background:linear-gradient(145deg,rgba(91,214,153,.2),rgba(91,214,153,.08));color:#d8ffea}
      .achievement-tab.sortable-tab{display:inline-flex;align-items:center;gap:7px;padding-right:9px}
      .achievement-drag-handle{display:grid;place-items:center;width:24px;height:28px;margin-left:1px;border-radius:8px;color:#62718b;font-size:16px;line-height:1;cursor:grab;touch-action:none;user-select:none}
      .achievement-drag-handle:hover{background:rgba(255,255,255,.06);color:#b8c5d9}
      .achievement-tab.dragging{opacity:.58;transform:scale(.97);border-style:dashed}
      .achievement-tab.dragging .achievement-drag-handle{cursor:grabbing}
      .achievement-order-tools{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:8px;padding:0 2px}
      .achievement-order-hint{margin-right:auto;color:#66758e;font-size:.66rem;font-weight:800}
      .achievement-order-reset{min-height:30px;padding:0 10px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:rgba(255,255,255,.035);color:#8f9db2;font:inherit;font-size:.68rem;font-weight:900;cursor:pointer}
      .achievement-order-reset:hover{color:#e2e9f5;border-color:rgba(255,255,255,.15)}
      .achievement-source-category{display:inline-flex;align-items:center;min-height:25px;margin-top:13px;padding:0 9px;border:1px solid rgba(91,214,153,.15);border-radius:999px;background:rgba(91,214,153,.06);color:#8fd6b1;font-size:.65rem;font-weight:900}
      .achievement-unlocked-at{margin-top:10px;color:#65758e;font-size:.68rem;font-weight:800}
      .achievement-completed-empty{padding:44px 24px;border:1px dashed rgba(91,214,153,.18);border-radius:22px;background:rgba(91,214,153,.025);color:#789188;text-align:center;line-height:1.8}
      @media(max-width:760px){.achievement-order-hint{display:none}.achievement-order-tools{margin-top:6px}.achievement-drag-handle{width:27px}}
    `;
    document.head.append(style);
  }

  function readLocalOrder() {
    try {
      const value = JSON.parse(localStorage.getItem(ORDER_KEY) || "[]");
      return Array.isArray(value) ? value.map(String) : [];
    } catch {
      return [];
    }
  }

  function normalizeOrder(order) {
    const seen = new Set();
    const result = [];
    for (const id of Array.isArray(order) ? order : []) {
      if (!DEFAULT_ORDER.includes(id) || seen.has(id)) continue;
      seen.add(id);
      result.push(id);
    }
    for (const id of DEFAULT_ORDER) {
      if (!seen.has(id)) result.push(id);
    }
    return result;
  }

  function saveLocalOrder(order) {
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(normalizeOrder(order))); } catch {}
  }

  async function currentUserId() {
    try {
      const client = auth()?.client;
      if (!client?.auth) return "";
      const { data } = await client.auth.getSession();
      return String(data?.session?.user?.id || "");
    } catch {
      return "";
    }
  }

  async function saveRemoteOrder(order) {
    const client = auth()?.client;
    const userId = await currentUserId();
    if (!client || !userId) return false;
    const payload = {
      user_id: userId,
      achievement_category_order: normalizeOrder(order),
      updated_at: new Date().toISOString()
    };
    const result = await client.from("sd_user_preferences").upsert(payload, { onConflict: "user_id" });
    if (result.error) throw result.error;
    remoteLoadedFor = userId;
    return true;
  }

  async function loadRemoteOrder() {
    const client = auth()?.client;
    const userId = await currentUserId();
    if (!client || !userId || remoteLoadedFor === userId) return;
    remoteLoadedFor = userId;
    try {
      const result = await client
        .from("sd_user_preferences")
        .select("achievement_category_order")
        .eq("user_id", userId)
        .maybeSingle();
      if (result.error) throw result.error;
      const remote = Array.isArray(result.data?.achievement_category_order)
        ? result.data.achievement_category_order.map(String)
        : [];
      if (remote.length) {
        const order = normalizeOrder(remote);
        saveLocalOrder(order);
        reorderRegular(order);
      } else {
        const local = readLocalOrder();
        if (local.length) await saveRemoteOrder(local);
      }
    } catch (error) {
      console.warn("[SD Achievement UI] category order sync failed", error?.message || error);
    }
  }

  function regularTabs() {
    const tabs = document.querySelector(".achievement-tabs");
    if (!tabs) return [];
    return [...tabs.querySelectorAll(".achievement-tab[data-achievement-tab]")]
      .filter((button) => button.dataset.achievementTab !== SPECIAL_ID);
  }

  function currentOrder() {
    return regularTabs().map((button) => String(button.dataset.achievementTab || ""))
      .filter((id) => DEFAULT_ORDER.includes(id));
  }

  function reorderPanels(order) {
    const main = document.querySelector(".achievements-page");
    const note = main?.querySelector(".achievement-placeholder");
    if (!main) return;
    for (const id of normalizeOrder(order)) {
      const panel = main.querySelector(`[data-achievement-panel="${id}"]`);
      if (panel) main.insertBefore(panel, note || null);
    }
  }

  function reorderRegular(order) {
    const tabs = document.querySelector(".achievement-tabs");
    if (!tabs) return;
    const normalized = normalizeOrder(order);
    for (const id of normalized) {
      const button = tabs.querySelector(`.achievement-tab[data-achievement-tab="${id}"]`);
      if (button) tabs.append(button);
    }
    const special = tabs.querySelector(`.achievement-tab[data-achievement-tab="${SPECIAL_ID}"]`);
    if (special) tabs.prepend(special);
    reorderPanels(normalized);
  }

  function rowMap() {
    const rows = window.SD_ACHIEVEMENT_SYNC?.getRows?.() || [];
    return new Map(rows.map((row) => [String(row.achievement_id || ""), row]));
  }

  function formattedDate(value) {
    const time = Date.parse(String(value || ""));
    if (!Number.isFinite(time)) return "";
    return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(time));
  }

  function cloneCompletedCard(item, rows) {
    const list = achievements().filter((entry) => entry.c === item.c);
    const index = list.findIndex((entry) => entry.id === item.id);
    const panel = document.querySelector(`[data-achievement-panel="${item.c}"]`);
    const source = index >= 0 ? panel?.querySelectorAll(".achievement-card")?.[index] : null;
    if (!source) return null;
    const clone = source.cloneNode(true);
    clone.dataset.achievementId = item.id;
    const category = document.createElement("div");
    category.className = "achievement-source-category";
    category.textContent = LABELS[item.c] || item.c;
    const name = clone.querySelector(".achievement-name");
    if (name) clone.insertBefore(category, name);
    else clone.append(category);

    const when = formattedDate(rows.get(item.id)?.unlocked_at);
    if (when) {
      const date = document.createElement("div");
      date.className = "achievement-unlocked-at";
      date.textContent = `달성일 ${when}`;
      clone.append(date);
    }
    return clone;
  }

  function buildCompletedView() {
    const tabs = document.querySelector(".achievement-tabs");
    const main = document.querySelector(".achievements-page");
    if (!tabs || !main) return;

    tabs.querySelector(`[data-achievement-tab="${SPECIAL_ID}"]`)?.remove();
    main.querySelector(`[data-achievement-panel="${SPECIAL_ID}"]`)?.remove();

    const rows = rowMap();
    const completed = achievements().filter(isDone).sort((left, right) => {
      const leftTime = Date.parse(String(rows.get(left.id)?.unlocked_at || "")) || 0;
      const rightTime = Date.parse(String(rows.get(right.id)?.unlocked_at || "")) || 0;
      if (leftTime !== rightTime) return rightTime - leftTime;
      const categoryDiff = DEFAULT_ORDER.indexOf(left.c) - DEFAULT_ORDER.indexOf(right.c);
      return categoryDiff || achievements().indexOf(left) - achievements().indexOf(right);
    });

    const button = document.createElement("button");
    button.type = "button";
    button.className = "achievement-tab completed-tab";
    button.dataset.achievementTab = SPECIAL_ID;
    button.textContent = `달성 업적 (${completed.length})`;
    tabs.prepend(button);

    const panel = document.createElement("section");
    panel.className = "achievement-panel";
    panel.dataset.achievementPanel = SPECIAL_ID;
    panel.innerHTML = `<div class="achievement-category-title"><div><span>ACHIEVED</span><h2>달성한 업적</h2></div><span class="achievement-category-meta">${completed.length}/${achievements().length} 달성</span></div>`;

    if (!completed.length) {
      panel.insertAdjacentHTML("beforeend", '<div class="achievement-completed-empty">아직 달성한 업적이 없습니다.<br>첫 업적을 달성하면 이곳에 자동으로 모입니다.</div>');
    } else {
      const grid = document.createElement("div");
      grid.className = "achievement-grid achievement-completed-grid";
      for (const item of completed) {
        const card = cloneCompletedCard(item, rows);
        if (card) grid.append(card);
      }
      panel.append(grid);
    }

    const firstRegularPanel = main.querySelector(`[data-achievement-panel]:not([data-achievement-panel="${SPECIAL_ID}"])`);
    main.insertBefore(panel, firstRegularPanel || main.querySelector(".achievement-placeholder") || null);
  }

  function addOrderTools() {
    const wrap = document.querySelector(".achievement-tabs-wrap");
    if (!wrap) return;
    let tools = wrap.querySelector(".achievement-order-tools");
    if (!tools) {
      tools = document.createElement("div");
      tools.className = "achievement-order-tools";
      tools.innerHTML = '<span class="achievement-order-hint">⋮⋮ 손잡이를 끌어 카테고리 순서를 변경할 수 있습니다.</span><button class="achievement-order-reset" type="button">기본 순서</button>';
      wrap.append(tools);
      tools.querySelector(".achievement-order-reset")?.addEventListener("click", async () => {
        try { localStorage.removeItem(ORDER_KEY); } catch {}
        reorderRegular(DEFAULT_ORDER);
        try { await saveRemoteOrder(DEFAULT_ORDER); } catch (error) {
          console.warn("[SD Achievement UI] reset sync failed", error?.message || error);
        }
      });
    }
  }

  function decorateHandles() {
    for (const button of regularTabs()) {
      button.classList.add("sortable-tab");
      if (button.querySelector(".achievement-drag-handle")) continue;
      const handle = document.createElement("span");
      handle.className = "achievement-drag-handle";
      handle.textContent = "⋮⋮";
      handle.title = "끌어서 순서 변경";
      handle.setAttribute("aria-label", "카테고리 순서 변경");
      button.append(handle);
    }
  }

  function activate(id) {
    const tabs = document.querySelector(".achievement-tabs");
    const main = document.querySelector(".achievements-page");
    if (!tabs || !main) return;
    const button = tabs.querySelector(`[data-achievement-tab="${id}"]`);
    const panel = main.querySelector(`[data-achievement-panel="${id}"]`);
    if (!button || !panel) return;
    tabs.querySelectorAll(".achievement-tab").forEach((entry) => entry.classList.toggle("active", entry === button));
    main.querySelectorAll("[data-achievement-panel]").forEach((entry) => entry.classList.toggle("active", entry === panel));
  }

  function bindDragEvents() {
    const tabs = document.querySelector(".achievement-tabs");
    if (!tabs || tabs.dataset.customSortBound === "1") return;
    tabs.dataset.customSortBound = "1";

    tabs.addEventListener("click", (event) => {
      if (suppressClick) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const button = event.target.closest("[data-achievement-tab]");
      if (button) lastActiveId = String(button.dataset.achievementTab || "");
    }, true);

    tabs.addEventListener("pointerdown", (event) => {
      const handle = event.target.closest(".achievement-drag-handle");
      const button = handle?.closest(".achievement-tab[data-achievement-tab]");
      if (!handle || !button || button.dataset.achievementTab === SPECIAL_ID) return;
      event.preventDefault();
      event.stopPropagation();
      drag = {
        button,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false
      };
      try { handle.setPointerCapture(event.pointerId); } catch {}
    });

    tabs.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (!drag.active && distance < 5) return;
      if (!drag.active) {
        drag.active = true;
        drag.button.classList.add("dragging");
      }
      event.preventDefault();

      const rect = tabs.getBoundingClientRect();
      if (event.clientX < rect.left + 44) tabs.scrollLeft -= 14;
      else if (event.clientX > rect.right - 44) tabs.scrollLeft += 14;

      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".achievement-tab[data-achievement-tab]");
      if (!target || target === drag.button || target.dataset.achievementTab === SPECIAL_ID || target.parentElement !== tabs) return;
      const targetRect = target.getBoundingClientRect();
      const after = event.clientX > targetRect.left + targetRect.width / 2;
      tabs.insertBefore(drag.button, after ? target.nextSibling : target);
      const special = tabs.querySelector(`[data-achievement-tab="${SPECIAL_ID}"]`);
      if (special) tabs.prepend(special);
    });

    const finish = async (event) => {
      if (!drag || (event.pointerId != null && event.pointerId !== drag.pointerId)) return;
      const wasActive = drag.active;
      drag.button.classList.remove("dragging");
      drag = null;
      if (!wasActive) return;
      suppressClick = true;
      window.setTimeout(() => { suppressClick = false; }, 60);
      const order = currentOrder();
      saveLocalOrder(order);
      reorderPanels(order);
      try { await saveRemoteOrder(order); } catch (error) {
        console.warn("[SD Achievement UI] order sync failed", error?.message || error);
      }
    };

    tabs.addEventListener("pointerup", (event) => { void finish(event); });
    tabs.addEventListener("pointercancel", (event) => { void finish(event); });
  }

  function enhance() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      const tabs = document.querySelector(".achievement-tabs");
      if (!tabs || !achievements().length) return;

      injectStyles();
      const activeBefore = lastActiveId || tabs.querySelector(".achievement-tab.active")?.dataset.achievementTab || "";
      const local = readLocalOrder();
      reorderRegular(local.length ? local : DEFAULT_ORDER);
      buildCompletedView();
      decorateHandles();
      addOrderTools();
      bindDragEvents();

      if (activeBefore === SPECIAL_ID) activate(SPECIAL_ID);
      else if (activeBefore) activate(activeBefore);

      void loadRemoteOrder().then(() => {
        decorateHandles();
        if (lastActiveId === SPECIAL_ID) activate(SPECIAL_ID);
      });
    }, 0);
  }

  window.addEventListener("sd-achievements-updated", enhance);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", enhance, { once: true });
  else enhance();
})();
