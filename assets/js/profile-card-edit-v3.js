"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const auth = window.SD_AUTH;
  if (!auth) return;

  const status = document.getElementById("profileCardEditStatus");
  const content = document.getElementById("profileCardEditContent");
  const missing = document.getElementById("profileCardEditMissing");
  const cardGrid = document.getElementById("profileCardGrid");
  const cardEmpty = document.getElementById("profileCardEmpty");
  const layoutEditor = document.getElementById("profileCardLayoutEditor");
  const saveButton = document.getElementById("saveProfileCardLayout");
  const resetButton = document.getElementById("resetProfileCardLayout");
  const cancelButton = document.getElementById("cancelProfileCardLayout");
  const saveState = document.getElementById("profileCardSaveState");
  const previewState = document.getElementById("profileCardPreviewState");
  const logoutButton = document.getElementById("logoutButton");

  const COIN_CODES = ["DDJ", "HSH", "SET", "HIZ", "KNG", "SDC"];
  const CARD_BLOCKS = {
    photo: { label: "프로필 사진", description: "현재 장착한 프로필 사진" },
    identity: { label: "닉네임 · 칭호", description: "닉네임과 장착 중인 업적 칭호" },
    assets: { label: "공개 자산", description: "계좌·코인을 제외한 공개 자산 평가액" },
    gold: { label: "보유 금", description: "g / kg / 수량 중 선택한 방식으로 표시" },
    coins: { label: "코인 보유 수량", description: "공개할 코인을 직접 선택" },
    slot_best: { label: "슬롯 최고 기록", description: "온라인 슬롯의 최고 당첨 기록" }
  };
  const CARD_KEYS = Object.keys(CARD_BLOCKS);
  const DEFAULT_LAYOUT = {
    version: 3,
    order: [...CARD_KEYS],
    visible: Object.fromEntries(CARD_KEYS.map((key) => [key, true])),
    settings: { gold_display: "count", coin_codes: [...COIN_CODES] }
  };

  let profile = null;
  let savedLayout = null;
  let draftLayout = null;
  let draggingRow = null;
  let draggingPointerId = null;
  let isSaving = false;

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

  function normalizeLayout(input) {
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
      version: 3,
      order,
      visible,
      settings: {
        gold_display: normalizeGoldDisplay(input?.settings?.gold_display),
        coin_codes: normalizeCoinCodes(input?.settings?.coin_codes)
      }
    };
  }

  function cloneLayout(layout) {
    const normalized = normalizeLayout(layout);
    return {
      version: 3,
      order: [...normalized.order],
      visible: { ...normalized.visible },
      settings: {
        gold_display: normalized.settings.gold_display,
        coin_codes: [...normalized.settings.coin_codes]
      }
    };
  }

  function signature(layout) {
    const normalized = normalizeLayout(layout);
    return JSON.stringify({ order: normalized.order, visible: normalized.visible, settings: normalized.settings });
  }

  function isDirty() {
    return Boolean(savedLayout && draftLayout && signature(savedLayout) !== signature(draftLayout));
  }

  function updateSaveState() {
    const dirty = isDirty();
    [saveState, previewState].forEach((node) => {
      if (!node) return;
      node.classList.toggle("is-dirty", dirty && !isSaving);
      node.classList.toggle("is-saving", isSaving);
    });

    if (isSaving) {
      if (saveState) saveState.textContent = "저장 중";
      if (previewState) previewState.textContent = "저장 중";
    } else if (dirty) {
      if (saveState) saveState.textContent = "저장 안 됨";
      if (previewState) previewState.textContent = "미리보기 변경됨";
    } else {
      if (saveState) saveState.textContent = "저장됨";
      if (previewState) previewState.textContent = "저장된 상태";
    }

    if (saveButton) saveButton.disabled = isSaving || !dirty;
    if (cancelButton) cancelButton.disabled = isSaving || !dirty;
  }

  function applyLayout(layout) {
    if (!cardGrid) return;
    const normalized = normalizeLayout(layout);
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

  function renderGoldValue() {
    const mode = normalizeLayout(draftLayout || DEFAULT_LAYOUT).settings.gold_display;
    const gold = document.getElementById("profileGold");
    const note = document.getElementById("profileGoldModeNote");
    if (!gold) return;

    if (mode === "g") {
      gold.textContent = profile?.assets?.gold_grams == null ? "정보 없음" : `${number(profile.assets.gold_grams, 4)}g`;
      if (note) note.textContent = "g 기준";
      return;
    }
    if (mode === "kg") {
      const kilograms = profile?.assets?.gold_kilograms ?? (profile?.assets?.gold_grams == null ? null : Number(profile.assets.gold_grams) / 1000);
      gold.textContent = kilograms == null ? "정보 없음" : `${number(kilograms, 6)}kg`;
      if (note) note.textContent = "kg 기준";
      return;
    }

    gold.textContent = profile?.assets?.gold_bars == null ? "정보 없음" : `${number(profile.assets.gold_bars, 0)}개`;
    if (note) note.textContent = "수량 기준";
  }

  function selectedCoins() {
    const selected = new Set(normalizeLayout(draftLayout || DEFAULT_LAYOUT).settings.coin_codes);
    return (Array.isArray(profile?.coins) ? profile.coins : []).filter((coin) => selected.has(String(coin.code || "").toUpperCase()));
  }

  function renderCoins() {
    const root = document.getElementById("profileCoins");
    if (!root) return;
    root.replaceChildren();
    const coins = selectedCoins();
    if (!coins.length) {
      const empty = document.createElement("span");
      empty.className = "profile-coin-empty";
      empty.textContent = "표시할 코인 없음";
      root.append(empty);
      return;
    }

    coins.forEach((coin) => {
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

  function renderProfileValues() {
    document.getElementById("profileNickname").textContent = profile?.nickname || "회원";
    const title = document.getElementById("profileTitleBadge");
    title.hidden = !profile?.title;
    title.textContent = profile?.title || "";

    const photo = document.getElementById("profilePhoto");
    photo.replaceChildren();
    if (profile?.avatar_url) {
      const image = document.createElement("img");
      image.src = profile.avatar_url;
      image.alt = `${profile?.nickname || "회원"} 프로필 사진`;
      photo.append(image);
    } else {
      const fallback = document.createElement("span");
      fallback.textContent = "👤";
      photo.append(fallback);
    }

    document.getElementById("profileAssetTotal").textContent = profile?.assets?.total == null ? "정보 없음" : won(profile.assets.total);
    renderGoldValue();
    renderCoins();

    const slot = profile?.slot_best || null;
    document.getElementById("profileSlotIcon").textContent = slot?.icon || "🎰";
    document.getElementById("profileSlotLabel").textContent = slot?.label || "기록 없음";
    const score = Number(slot?.score || 0);
    document.getElementById("profileSlotScore").textContent = slot ? (score > 0 ? number(score) : "기록 없음") : "기록 없음";
  }

  function syncOrder() {
    if (!layoutEditor || !draftLayout) return;
    draftLayout.order = [...layoutEditor.querySelectorAll("[data-layout-block]")]
      .map((row) => row.dataset.layoutBlock)
      .filter(Boolean);
    applyLayout(draftLayout);
    updateSaveState();
  }

  function finishDrag() {
    if (!draggingRow) return;
    draggingRow.classList.remove("is-dragging");
    draggingRow = null;
    draggingPointerId = null;
    document.body.classList.remove("profile-layout-dragging");
    syncOrder();
  }

  function onPointerDown(event) {
    const handle = event.currentTarget;
    const row = handle.closest("[data-layout-block]");
    if (!row || event.button > 0) return;
    event.preventDefault();
    draggingRow = row;
    draggingPointerId = event.pointerId;
    row.classList.add("is-dragging");
    document.body.classList.add("profile-layout-dragging");
    try { handle.setPointerCapture(event.pointerId); } catch (_) {}
  }

  function onPointerMove(event) {
    if (!draggingRow || event.pointerId !== draggingPointerId || !layoutEditor) return;
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.("[data-layout-block]");
    if (!target || target === draggingRow || target.parentElement !== layoutEditor) return;
    const rect = target.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    layoutEditor.insertBefore(draggingRow, before ? target : target.nextSibling);
    syncOrder();
  }

  function onPointerUp(event) {
    if (draggingRow && event.pointerId === draggingPointerId) finishDrag();
  }

  function renderGoldModeOptions(row) {
    const options = document.createElement("div");
    options.className = "profile-card-row-options";
    const label = document.createElement("span");
    label.className = "profile-card-row-options-label";
    label.textContent = "금 표시 방식";
    const choices = document.createElement("div");
    choices.className = "profile-card-segmented";

    [
      ["g", "g"],
      ["kg", "kg"],
      ["count", "수량 (개)"]
    ].forEach(([value, text]) => {
      const option = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "profileGoldDisplayMode";
      input.value = value;
      input.checked = draftLayout.settings.gold_display === value;
      const caption = document.createElement("span");
      caption.textContent = text;
      input.addEventListener("change", () => {
        if (!input.checked) return;
        draftLayout.settings.gold_display = value;
        renderGoldValue();
        updateSaveState();
      });
      option.append(input, caption);
      choices.append(option);
    });

    options.append(label, choices);
    row.append(options);
  }

  function renderCoinOptions(row) {
    const options = document.createElement("div");
    options.className = "profile-card-row-options profile-card-coin-options";
    const label = document.createElement("span");
    label.className = "profile-card-row-options-label";
    label.textContent = "공개할 코인";

    const selector = document.createElement("div");
    selector.className = "profile-card-coin-selector";
    const coinMap = new Map((Array.isArray(profile?.coins) ? profile.coins : []).map((coin) => [String(coin.code || "").toUpperCase(), coin]));

    COIN_CODES.forEach((code) => {
      const coin = coinMap.get(code);
      const choice = document.createElement("label");
      choice.className = "profile-card-coin-choice";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = code;
      input.checked = draftLayout.settings.coin_codes.includes(code);
      const text = document.createElement("span");
      const codeLabel = document.createElement("b");
      codeLabel.textContent = code;
      const qty = document.createElement("small");
      qty.textContent = number(coin?.quantity || 0, 8);
      text.append(codeLabel, qty);

      input.addEventListener("change", () => {
        const checked = new Set(draftLayout.settings.coin_codes);
        if (input.checked) checked.add(code);
        else checked.delete(code);
        draftLayout.settings.coin_codes = COIN_CODES.filter((item) => checked.has(item));
        renderCoins();
        updateSaveState();
      });

      choice.append(input, text);
      selector.append(choice);
    });

    options.append(label, selector);
    row.append(options);
  }

  function renderEditor() {
    if (!layoutEditor || !draftLayout) return;
    layoutEditor.replaceChildren();

    draftLayout.order.forEach((key) => {
      const meta = CARD_BLOCKS[key];
      if (!meta) return;
      const row = document.createElement("div");
      row.className = "profile-card-layout-row";
      row.dataset.layoutBlock = key;
      row.classList.toggle("is-hidden", !draftLayout.visible[key]);

      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "profile-card-drag-handle";
      handle.title = "끌어서 위치 변경";
      handle.setAttribute("aria-label", `${meta.label} 위치 이동`);
      handle.textContent = "⋮⋮";
      handle.addEventListener("pointerdown", onPointerDown);
      handle.addEventListener("pointermove", onPointerMove);
      handle.addEventListener("pointerup", onPointerUp);
      handle.addEventListener("pointercancel", onPointerUp);

      const info = document.createElement("div");
      info.className = "profile-card-layout-info";
      const name = document.createElement("strong");
      name.textContent = meta.label;
      const desc = document.createElement("small");
      desc.textContent = meta.description;
      info.append(name, desc);

      const toggle = document.createElement("label");
      toggle.className = "profile-card-visibility-toggle";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(draftLayout.visible[key]);
      const slider = document.createElement("span");
      slider.className = "profile-card-toggle-slider";
      const toggleText = document.createElement("b");
      toggleText.textContent = input.checked ? "공개" : "숨김";
      input.addEventListener("change", () => {
        draftLayout.visible[key] = input.checked;
        toggleText.textContent = input.checked ? "공개" : "숨김";
        row.classList.toggle("is-hidden", !input.checked);
        applyLayout(draftLayout);
        updateSaveState();
      });
      toggle.append(input, slider, toggleText);
      row.append(handle, info, toggle);
      if (key === "gold") renderGoldModeOptions(row);
      if (key === "coins") renderCoinOptions(row);
      layoutEditor.append(row);
    });

    renderGoldValue();
    renderCoins();
    applyLayout(draftLayout);
    updateSaveState();
  }

  async function load() {
    try {
      const session = await auth.requireSession();
      if (!session) return;
      const { data, error } = await auth.client.rpc("get_sd_public_profile", { p_user_id: null });
      if (error) throw error;
      profile = data;
      if (!profile?.created) {
        missing.hidden = false;
        content.hidden = true;
        return;
      }
      missing.hidden = true;
      content.hidden = false;
      savedLayout = cloneLayout(profile.card_layout || DEFAULT_LAYOUT);
      draftLayout = cloneLayout(savedLayout);
      renderProfileValues();
      renderEditor();
    } catch (error) {
      setStatus(auth.messageForError(error), "error");
      content.hidden = true;
    }
  }

  saveButton?.addEventListener("click", async () => {
    if (!draftLayout || !isDirty() || isSaving) return;
    syncOrder();
    isSaving = true;
    updateSaveState();
    try {
      const { data, error } = await auth.client.rpc("save_sd_profile_card_layout", { p_layout: draftLayout });
      if (error) throw error;
      savedLayout = cloneLayout(data?.card_layout || draftLayout);
      draftLayout = cloneLayout(savedLayout);
      profile.card_layout = cloneLayout(savedLayout);
      renderEditor();
      setStatus("프로필 카드 공개 항목과 표시 방식을 저장했습니다.", "success");
    } catch (error) {
      setStatus(auth.messageForError(error), "error");
    } finally {
      isSaving = false;
      updateSaveState();
    }
  });

  resetButton?.addEventListener("click", () => {
    if (isSaving) return;
    draftLayout = cloneLayout(DEFAULT_LAYOUT);
    renderEditor();
    setStatus("기본 배치를 미리보기 중입니다. 저장하면 공개 프로필에 적용됩니다.", "info");
  });

  cancelButton?.addEventListener("click", () => {
    if (isSaving || !savedLayout) return;
    draftLayout = cloneLayout(savedLayout);
    renderEditor();
    setStatus("저장하지 않은 변경사항을 취소했습니다.", "info");
  });

  window.addEventListener("pointerup", finishDrag);
  window.addEventListener("pointercancel", finishDrag);
  window.addEventListener("beforeunload", (event) => {
    if (!isDirty() || isSaving) return;
    event.preventDefault();
    event.returnValue = "";
  });

  logoutButton?.addEventListener("click", async () => {
    if (isDirty() && !window.confirm("저장하지 않은 프로필 카드 변경사항이 있습니다. 로그아웃할까요?")) return;
    logoutButton.disabled = true;
    try { await auth.client.auth.signOut(); location.replace("login.html"); }
    finally { logoutButton.disabled = false; }
  });

  await load();
});
