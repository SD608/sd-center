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

  const CARD_BLOCKS = {
    photo: { label: "프로필 사진", description: "현재 장착한 프로필 사진" },
    identity: { label: "닉네임 · 칭호", description: "닉네임과 장착 중인 업적 칭호" },
    assets: { label: "공개 자산", description: "계좌·코인을 제외한 공개 자산 평가액" },
    gold: { label: "보유 금", description: "SD금고의 금 보유량과 평가액" },
    slot_best: { label: "슬롯 최고 기록", description: "온라인 슬롯의 최고 당첨 기록" }
  };
  const CARD_KEYS = Object.keys(CARD_BLOCKS);
  const DEFAULT_CARD_LAYOUT = {
    version: 1,
    order: [...CARD_KEYS],
    visible: Object.fromEntries(CARD_KEYS.map((key) => [key, true]))
  };

  let profile = null;
  let savedLayout = null;
  let draftLayout = null;
  let draggingRow = null;
  let draggingPointerId = null;
  let isSaving = false;

  const won = (value) => auth.formatWon(Math.max(0, Math.trunc(Number(value || 0))));
  const number = (value) => Number(value || 0).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  const setStatus = (message, type = "info") => auth.setStatus(status, message, type);

  function normalizeLayout(input) {
    const rawOrder = Array.isArray(input?.order) ? input.order.map(String) : [];
    const order = [];
    rawOrder.forEach((key) => {
      if (CARD_BLOCKS[key] && !order.includes(key)) order.push(key);
    });
    CARD_KEYS.forEach((key) => { if (!order.includes(key)) order.push(key); });

    const visible = {};
    CARD_KEYS.forEach((key) => {
      visible[key] = typeof input?.visible?.[key] === "boolean" ? input.visible[key] : true;
    });
    return { version: 1, order, visible };
  }

  function cloneLayout(layout) {
    const normalized = normalizeLayout(layout);
    return { version: 1, order: [...normalized.order], visible: { ...normalized.visible } };
  }

  function layoutSignature(layout) {
    const normalized = normalizeLayout(layout);
    return JSON.stringify({ order: normalized.order, visible: normalized.visible });
  }

  function isDirty() {
    return Boolean(savedLayout && draftLayout && layoutSignature(savedLayout) !== layoutSignature(draftLayout));
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

    document.getElementById("profileAssetTotal").textContent = profile?.assets?.total == null
      ? "정보 없음"
      : won(profile.assets.total);

    document.getElementById("profileGold").textContent = profile?.assets?.gold_bars == null
      ? "정보 없음"
      : `${number(profile.assets.gold_bars)}개 · ${number(profile.assets.gold_grams)}g · ${won(profile.assets.gold_value)}`;

    const slot = profile?.slot_best || null;
    document.getElementById("profileSlotIcon").textContent = slot?.icon || "🎰";
    document.getElementById("profileSlotLabel").textContent = slot?.label || "기록 없음";
    const score = Number(slot?.score || 0);
    document.getElementById("profileSlotScore").textContent = slot
      ? (score > 0 ? `최고 점수 ${number(score)}` : "최고 기록 없음")
      : "기록 없음";
  }

  function syncOrderFromEditor() {
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
    syncOrderFromEditor();
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
    syncOrderFromEditor();
  }

  function onPointerUp(event) {
    if (draggingRow && event.pointerId === draggingPointerId) finishDrag();
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
      layoutEditor.append(row);
    });

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
      renderProfileValues();
      savedLayout = cloneLayout(profile.card_layout || DEFAULT_CARD_LAYOUT);
      draftLayout = cloneLayout(savedLayout);
      renderEditor();
    } catch (error) {
      setStatus(auth.messageForError(error), "error");
      content.hidden = true;
    }
  }

  saveButton?.addEventListener("click", async () => {
    if (!draftLayout || !isDirty() || isSaving) return;
    syncOrderFromEditor();
    isSaving = true;
    updateSaveState();

    try {
      const { data, error } = await auth.client.rpc("save_sd_profile_card_layout", { p_layout: draftLayout });
      if (error) throw error;
      savedLayout = cloneLayout(data?.card_layout || draftLayout);
      draftLayout = cloneLayout(savedLayout);
      profile.card_layout = cloneLayout(savedLayout);
      renderEditor();
      setStatus("프로필 카드 공개 항목과 배치를 저장했습니다.", "success");
    } catch (error) {
      setStatus(auth.messageForError(error), "error");
    } finally {
      isSaving = false;
      updateSaveState();
    }
  });

  resetButton?.addEventListener("click", () => {
    if (isSaving) return;
    draftLayout = cloneLayout(DEFAULT_CARD_LAYOUT);
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
