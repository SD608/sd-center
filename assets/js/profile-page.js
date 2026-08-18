"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const auth = window.SD_AUTH;
  if (!auth) return;

  const status = document.getElementById("profileStatus");
  const content = document.getElementById("profileContent");
  const missing = document.getElementById("profileMissing");
  const createButton = document.getElementById("createProfileButton");
  const refreshButton = document.getElementById("refreshProfile");
  const logoutButton = document.getElementById("logoutButton");
  const ownerTools = document.getElementById("profileOwnerTools");
  const showcaseRoot = document.getElementById("profileShowcase");
  const achievementsRoot = document.getElementById("profileAchievements");
  const showcasePicker = document.getElementById("showcasePicker");
  const avatarPicker = document.getElementById("avatarPicker");
  const titlePicker = document.getElementById("titlePicker");
  const saveShowcase = document.getElementById("saveShowcaseButton");
  const cardGrid = document.getElementById("profileCardGrid");
  const cardEmpty = document.getElementById("profileCardEmpty");
  const layoutEditor = document.getElementById("profileCardLayoutEditor");
  const saveCardLayout = document.getElementById("saveProfileCardLayout");
  const resetCardLayout = document.getElementById("resetProfileCardLayout");
  const cancelCardLayout = document.getElementById("cancelProfileCardLayout");

  const params = new URLSearchParams(location.search);
  const requestedUserId = params.get("user") || null;
  let profile = null;
  let ownedItems = [];
  let shopItems = [];
  let savedCardLayout = null;
  let draftCardLayout = null;
  let draggingLayoutRow = null;
  let draggingPointerId = null;

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

  const won = (value) => auth.formatWon(Math.max(0, Math.trunc(Number(value || 0))));
  const number = (value) => Number(value || 0).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  const tierName = (tier) => ({ worn:"낡음", normal:"평범", fancy:"고급진", premium:"최고급", safe:"금고" }[tier] || tier || "-");
  const setStatus = (message, type = "info") => auth.setStatus(status, message, type);

  function normalizeCardLayout(input) {
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

  function cloneCardLayout(layout) {
    const normalized = normalizeCardLayout(layout);
    return { version: 1, order: [...normalized.order], visible: { ...normalized.visible } };
  }

  function applyCardLayout(layout) {
    if (!cardGrid) return;
    const normalized = normalizeCardLayout(layout);
    let visibleCount = 0;
    normalized.order.forEach((key, index) => {
      const block = cardGrid.querySelector(`[data-card-block="${key}"]`);
      if (!block) return;
      block.style.order = String(index);
      block.hidden = !normalized.visible[key];
      if (normalized.visible[key]) visibleCount += 1;
    });
    if (cardEmpty) cardEmpty.hidden = visibleCount > 0;
    cardGrid.hidden = visibleCount === 0;
  }

  function renderMissing() {
    content.hidden = true;
    missing.hidden = false;
    document.getElementById("missingName").textContent = `${profile?.nickname || "회원"}님의 공개 프로필이 아직 없습니다.`;
    createButton.hidden = !profile?.is_me;
    document.getElementById("profileHeading").textContent = profile?.is_me ? "내 프로필" : `${profile?.nickname || "회원"} 프로필`;
  }

  function renderPhoto() {
    const root = document.getElementById("profilePhoto");
    root.replaceChildren();
    if (profile?.avatar_url) {
      const img = document.createElement("img");
      img.src = profile.avatar_url;
      img.alt = `${profile.nickname || "회원"} 프로필 사진`;
      root.append(img);
    } else {
      const span = document.createElement("span");
      span.textContent = "👤";
      root.append(span);
    }
  }

  function renderShowcase() {
    showcaseRoot.replaceChildren();
    const items = profile?.showcase_items || [];
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "profile-empty";
      empty.style.gridColumn = "1/-1";
      empty.textContent = "프로필에 등록된 플리마켓 아이템이 없습니다.";
      showcaseRoot.append(empty);
      return;
    }
    items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "showcase-item";
      const tier = document.createElement("span");
      tier.className = "tier";
      tier.textContent = tierName(item.tier);
      const name = document.createElement("h3");
      name.textContent = item.name || "아이템";
      const value = document.createElement("strong");
      value.textContent = won(item.current_value);
      const source = document.createElement("p");
      source.textContent = `최초 출처 · ${item.origin_nickname || "회원"}`;
      card.append(tier, name, value, source);
      showcaseRoot.append(card);
    });
  }

  function renderAchievements() {
    achievementsRoot.replaceChildren();
    const items = profile?.achievements || [];
    document.getElementById("achievementCount").textContent = `${items.length}개`;
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "profile-empty";
      empty.style.gridColumn = "1/-1";
      empty.textContent = "아직 획득한 업적이 없습니다.";
      achievementsRoot.append(empty);
      return;
    }
    items.forEach((achievement) => {
      const card = document.createElement("article");
      card.className = "achievement-card";
      const icon = document.createElement("div");
      icon.className = "achievement-icon";
      icon.textContent = achievement.icon || "🏆";
      const info = document.createElement("div");
      const name = document.createElement("h3");
      name.textContent = achievement.name || "업적";
      const desc = document.createElement("p");
      desc.textContent = achievement.description || "";
      info.append(name, desc);
      if (achievement.title_reward) {
        const title = document.createElement("span");
        title.className = "achievement-title";
        title.textContent = `칭호 · ${achievement.title_reward}`;
        info.append(title);
      }
      card.append(icon, info);
      achievementsRoot.append(card);
    });
  }

  function renderCardValues() {
    document.getElementById("profileNickname").textContent = profile?.nickname || "회원";
    const title = document.getElementById("profileTitleBadge");
    title.hidden = !profile?.title;
    title.textContent = profile?.title || "";

    const assetTotal = document.getElementById("profileAssetTotal");
    assetTotal.textContent = profile?.assets?.total == null ? "비공개" : won(profile.assets.total);

    const gold = document.getElementById("profileGold");
    gold.textContent = profile?.assets?.gold_bars == null
      ? "비공개"
      : `${number(profile.assets.gold_bars)}개 · ${number(profile.assets.gold_grams)}g · ${won(profile.assets.gold_value)}`;

    const slot = profile?.slot_best || null;
    document.getElementById("profileSlotIcon").textContent = slot?.icon || "🎰";
    document.getElementById("profileSlotLabel").textContent = slot?.label || "기록 없음";
    const score = Number(slot?.score || 0);
    document.getElementById("profileSlotScore").textContent = slot ? (score > 0 ? `최고 점수 ${number(score)}` : "최고 기록 없음") : "비공개";
  }

  function renderProfileCard() {
    missing.hidden = true;
    content.hidden = false;
    document.getElementById("profileHeading").textContent = profile?.is_me ? "내 프로필" : `${profile?.nickname || "회원"} 프로필`;
    renderPhoto();
    renderCardValues();
    savedCardLayout = cloneCardLayout(profile?.card_layout || DEFAULT_CARD_LAYOUT);
    draftCardLayout = cloneCardLayout(savedCardLayout);
    applyCardLayout(savedCardLayout);
    ownerTools.hidden = !profile?.is_me;
    if (profile?.is_me) renderCardLayoutEditor();
    renderShowcase();
    renderAchievements();
  }

  function syncDraftOrderFromEditor() {
    if (!layoutEditor || !draftCardLayout) return;
    draftCardLayout.order = [...layoutEditor.querySelectorAll("[data-layout-block]")].map((row) => row.dataset.layoutBlock);
    applyCardLayout(draftCardLayout);
  }

  function finishLayoutDrag() {
    if (!draggingLayoutRow) return;
    draggingLayoutRow.classList.remove("is-dragging");
    draggingLayoutRow = null;
    draggingPointerId = null;
    document.body.classList.remove("profile-layout-dragging");
    syncDraftOrderFromEditor();
  }

  function handleLayoutPointerDown(event) {
    const handle = event.currentTarget;
    const row = handle.closest("[data-layout-block]");
    if (!row || event.button > 0) return;
    event.preventDefault();
    draggingLayoutRow = row;
    draggingPointerId = event.pointerId;
    row.classList.add("is-dragging");
    document.body.classList.add("profile-layout-dragging");
    try { handle.setPointerCapture(event.pointerId); } catch (_) {}
  }

  function handleLayoutPointerMove(event) {
    if (!draggingLayoutRow || event.pointerId !== draggingPointerId || !layoutEditor) return;
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.("[data-layout-block]");
    if (!target || target === draggingLayoutRow || target.parentElement !== layoutEditor) return;
    const rect = target.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    layoutEditor.insertBefore(draggingLayoutRow, before ? target : target.nextSibling);
  }

  function handleLayoutPointerUp(event) {
    if (draggingLayoutRow && event.pointerId === draggingPointerId) finishLayoutDrag();
  }

  function renderCardLayoutEditor() {
    if (!layoutEditor || !profile?.is_me) return;
    draftCardLayout = cloneCardLayout(draftCardLayout || savedCardLayout || DEFAULT_CARD_LAYOUT);
    layoutEditor.replaceChildren();

    draftCardLayout.order.forEach((key) => {
      const meta = CARD_BLOCKS[key];
      if (!meta) return;
      const row = document.createElement("div");
      row.className = "profile-card-layout-row";
      row.dataset.layoutBlock = key;

      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "profile-card-drag-handle";
      handle.setAttribute("aria-label", `${meta.label} 위치 이동`);
      handle.title = "끌어서 위치 변경";
      handle.textContent = "⋮⋮";
      handle.addEventListener("pointerdown", handleLayoutPointerDown);
      handle.addEventListener("pointermove", handleLayoutPointerMove);
      handle.addEventListener("pointerup", handleLayoutPointerUp);
      handle.addEventListener("pointercancel", handleLayoutPointerUp);

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
      input.checked = Boolean(draftCardLayout.visible[key]);
      const slider = document.createElement("span");
      slider.className = "profile-card-toggle-slider";
      const text = document.createElement("b");
      text.textContent = input.checked ? "공개" : "숨김";
      input.addEventListener("change", () => {
        draftCardLayout.visible[key] = input.checked;
        text.textContent = input.checked ? "공개" : "숨김";
        row.classList.toggle("is-hidden", !input.checked);
        applyCardLayout(draftCardLayout);
      });
      toggle.append(input, slider, text);
      row.classList.toggle("is-hidden", !input.checked);
      row.append(handle, info, toggle);
      layoutEditor.append(row);
    });
  }

  function renderShowcasePicker() {
    showcasePicker.replaceChildren();
    if (!ownedItems.length) {
      const empty = document.createElement("div");
      empty.className = "profile-empty";
      empty.textContent = "현재 온라인 보관함에 아이템이 없습니다.";
      showcasePicker.append(empty);
      saveShowcase.disabled = true;
      return;
    }
    saveShowcase.disabled = false;
    const selected = new Set((profile.showcase_items || []).map((item) => String(item.id)));
    ownedItems.forEach((item) => {
      const row = document.createElement("div");
      row.className = "showcase-option";
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = item.id;
      input.checked = selected.has(String(item.id));
      const name = document.createElement("span");
      name.textContent = item.name || "아이템";
      label.append(input, name);
      const value = document.createElement("b");
      value.textContent = won(item.current_value);
      row.append(label, value);
      showcasePicker.append(row);
    });
  }

  function renderAvatarPicker() {
    avatarPicker.replaceChildren();
    const ownedAvatars = shopItems.filter((item) => item.kind === "avatar" && item.owned);
    if (!ownedAvatars.length) {
      const empty = document.createElement("div");
      empty.className = "profile-empty";
      empty.textContent = "구매한 프로필 사진이 없습니다.";
      avatarPicker.append(empty);
      return;
    }
    ownedAvatars.forEach((item) => {
      const row = document.createElement("div");
      row.className = "profile-select-option";
      const name = document.createElement("span");
      name.textContent = item.name;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "사용";
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          const { error } = await auth.client.rpc("equip_sd_profile_avatar", { p_cosmetic_id: item.id });
          if (error) throw error;
          setStatus("프로필 사진을 변경했습니다.", "success");
          await loadProfile(false);
        } catch (error) { setStatus(auth.messageForError(error), "error"); }
        finally { button.disabled = false; }
      });
      row.append(name, button);
      avatarPicker.append(row);
    });
  }

  function renderTitlePicker() {
    titlePicker.replaceChildren();
    const titles = (profile.achievements || []).filter((item) => item.title_reward);
    if (!titles.length) {
      const empty = document.createElement("div");
      empty.className = "profile-empty";
      empty.textContent = "현재 장착할 수 있는 칭호가 없습니다.";
      titlePicker.append(empty);
      return;
    }
    titles.forEach((achievement) => {
      const row = document.createElement("div");
      row.className = "profile-select-option";
      const name = document.createElement("span");
      name.textContent = achievement.title_reward;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "장착";
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          const { error } = await auth.client.rpc("equip_sd_profile_title", { p_achievement_id: achievement.id });
          if (error) throw error;
          setStatus(`칭호 [${achievement.title_reward}] 장착 완료`, "success");
          await loadProfile(false);
        } catch (error) { setStatus(auth.messageForError(error), "error"); }
        finally { button.disabled = false; }
      });
      row.append(name, button);
      titlePicker.append(row);
    });
  }

  async function loadOwnerTools() {
    if (!profile?.is_me || !profile?.created) return;
    const [itemsResult, shopResult] = await Promise.all([
      auth.client.rpc("list_my_sd_flea_items"),
      auth.client.rpc("list_sd_profile_shop")
    ]);
    if (itemsResult.error) throw itemsResult.error;
    if (shopResult.error) throw shopResult.error;
    ownedItems = itemsResult.data?.items || [];
    shopItems = shopResult.data?.items || [];
    renderShowcasePicker();
    renderAvatarPicker();
    renderTitlePicker();
  }

  async function loadProfile(showNotice = true) {
    if (refreshButton) refreshButton.disabled = true;
    auth.clearStatus(status);
    try {
      const session = await auth.requireSession();
      if (!session) return;
      const { data, error } = await auth.client.rpc("get_sd_public_profile", { p_user_id: requestedUserId });
      if (error) throw error;
      profile = data;
      if (!profile?.created) renderMissing();
      else {
        renderProfileCard();
        await loadOwnerTools();
      }
      if (showNotice) {
        setStatus("프로필을 불러왔습니다.", "success");
        setTimeout(() => auth.clearStatus(status), 1400);
      }
    } catch (error) {
      setStatus(auth.messageForError(error), "error");
      content.hidden = true;
      missing.hidden = false;
      document.getElementById("missingName").textContent = "프로필을 불러오지 못했습니다.";
      createButton.hidden = true;
    } finally {
      if (refreshButton) refreshButton.disabled = false;
    }
  }

  createButton?.addEventListener("click", async () => {
    createButton.disabled = true;
    try {
      const { error } = await auth.client.rpc("create_sd_public_profile");
      if (error) throw error;
      setStatus("공개 프로필을 만들었습니다.", "success");
      await loadProfile(false);
    } catch (error) { setStatus(auth.messageForError(error), "error"); }
    finally { createButton.disabled = false; }
  });

  saveCardLayout?.addEventListener("click", async () => {
    if (!draftCardLayout) return;
    syncDraftOrderFromEditor();
    saveCardLayout.disabled = true;
    try {
      const { data, error } = await auth.client.rpc("save_sd_profile_card_layout", { p_layout: draftCardLayout });
      if (error) throw error;
      savedCardLayout = cloneCardLayout(data?.card_layout || draftCardLayout);
      draftCardLayout = cloneCardLayout(savedCardLayout);
      profile.card_layout = cloneCardLayout(savedCardLayout);
      renderCardLayoutEditor();
      applyCardLayout(savedCardLayout);
      setStatus("프로필 카드 공개 항목과 배치를 저장했습니다.", "success");
    } catch (error) {
      setStatus(auth.messageForError(error), "error");
    } finally {
      saveCardLayout.disabled = false;
    }
  });

  resetCardLayout?.addEventListener("click", () => {
    draftCardLayout = cloneCardLayout(DEFAULT_CARD_LAYOUT);
    renderCardLayoutEditor();
    applyCardLayout(draftCardLayout);
    setStatus("기본 배치를 미리보기 중입니다. 저장해야 공개 프로필에 적용됩니다.", "info");
  });

  cancelCardLayout?.addEventListener("click", () => {
    draftCardLayout = cloneCardLayout(savedCardLayout || DEFAULT_CARD_LAYOUT);
    renderCardLayoutEditor();
    applyCardLayout(savedCardLayout || DEFAULT_CARD_LAYOUT);
    setStatus("저장하지 않은 카드 편집 내용을 취소했습니다.", "info");
  });

  saveShowcase?.addEventListener("click", async () => {
    const ids = [...showcasePicker.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
    if (ids.length > 6) return setStatus("자랑 아이템은 최대 6개까지 선택할 수 있습니다.", "error");
    saveShowcase.disabled = true;
    try {
      const { error } = await auth.client.rpc("set_sd_flea_showcase", { p_item_ids: ids });
      if (error) throw error;
      setStatus("자랑 아이템을 저장했습니다.", "success");
      await loadProfile(false);
    } catch (error) { setStatus(auth.messageForError(error), "error"); }
    finally { saveShowcase.disabled = false; }
  });

  showcasePicker?.addEventListener("change", () => {
    const checked = [...showcasePicker.querySelectorAll('input[type="checkbox"]:checked')];
    if (checked.length > 6) {
      checked[checked.length - 1].checked = false;
      setStatus("자랑 아이템은 최대 6개까지 선택할 수 있습니다.", "error");
    }
  });

  window.addEventListener("pointerup", finishLayoutDrag);
  window.addEventListener("pointercancel", finishLayoutDrag);
  refreshButton?.addEventListener("click", () => loadProfile(true));
  logoutButton?.addEventListener("click", async () => {
    logoutButton.disabled = true;
    try { await auth.client.auth.signOut(); location.replace("login.html"); }
    finally { logoutButton.disabled = false; }
  });

  await loadProfile(true);
});
