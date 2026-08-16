"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const mobile = window.SD_MOBILE;
  const status = document.getElementById("fleaStatus");
  const inventoryRoot = document.getElementById("fleaInventory");
  const marketRoot = document.getElementById("fleaMarket");
  const profileRoot = document.getElementById("fleaProfileSummary");
  const refreshButton = document.getElementById("fleaRefresh");
  const inventoryCount = document.getElementById("inventoryCount");
  const marketCount = document.getElementById("marketCount");
  if (!mobile || !inventoryRoot || !marketRoot) return;

  let walletBalance = 0;
  let inventory = [];
  let market = [];
  let currentProfile = null;

  const won = (value) => mobile.auth.formatWon(Math.max(0, Math.trunc(Number(value || 0))));
  const tierName = (tier) => ({ worn:"낡음", normal:"평범", fancy:"고급진", premium:"최고급", safe:"금고" }[tier] || tier || "-");
  const conditionText = (value) => `${Math.max(0, Math.min(100, Number(value ?? 100))).toFixed(0)}%`;

  const setBusy = (button, busy, label) => {
    if (!button) return;
    if (busy) {
      button.dataset.oldText = button.textContent;
      button.disabled = true;
      button.textContent = label;
    } else {
      button.disabled = false;
      button.textContent = button.dataset.oldText || button.textContent;
    }
  };

  function activateTab(name) {
    document.querySelectorAll("[data-flea-tab]").forEach((button) => button.classList.toggle("active", button.dataset.fleaTab === name));
    document.querySelectorAll("[data-flea-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.fleaPanel === name));
  }

  document.querySelectorAll("[data-flea-tab]").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.fleaTab)));

  function itemMeta(item, purchased = false) {
    const wrap = document.createElement("div");
    wrap.className = "flea-meta";
    const origin = document.createElement("span");
    origin.innerHTML = `최초 출처 · <b>${String(item.origin_nickname || "회원")}</b>`;
    const condition = document.createElement("span");
    condition.innerHTML = `상태 · <b>${conditionText(item.condition_percent)}</b>`;
    const acquired = document.createElement("span");
    acquired.textContent = purchased ? "시스템 마켓 구매품" : "PC 플리마켓 획득품";
    wrap.append(origin, condition, acquired);
    return wrap;
  }

  function renderInventory() {
    inventoryRoot.replaceChildren();
    inventoryCount.textContent = String(inventory.length);
    if (!inventory.length) {
      const empty = document.createElement("div");
      empty.className = "flea-empty";
      empty.innerHTML = "온라인 보관함이 비어 있습니다.<br>PC 플리마켓에서 물건을 획득한 뒤 SD Link가 동기화되면 여기에 표시됩니다.";
      inventoryRoot.append(empty);
      return;
    }

    inventory.forEach((item) => {
      const card = document.createElement("article");
      card.className = "flea-item-card";
      const purchased = item.acquisition_kind === "system_purchase";
      const salePrice = purchased
        ? Math.floor(Number(item.purchase_price ?? item.current_value ?? 0) * 0.5)
        : Math.floor(Number(item.current_value || 0) * 0.95);

      const top = document.createElement("div");
      top.className = "flea-item-top";
      const title = document.createElement("div");
      title.className = "flea-item-title";
      const tier = document.createElement("span");
      tier.className = `flea-tier ${item.tier || ""}`;
      tier.textContent = tierName(item.tier);
      const name = document.createElement("strong");
      name.textContent = item.name || "아이템";
      title.append(tier, name);
      if (item.is_showcased) {
        const show = document.createElement("span");
        show.className = "showcase-badge";
        show.textContent = "★ 프로필 자랑 중";
        title.append(show);
      }

      const value = document.createElement("div");
      value.className = "flea-price";
      value.innerHTML = `${won(item.current_value)}<small>현재 가치</small>`;
      top.append(title, value);

      const actions = document.createElement("div");
      actions.className = "flea-actions";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "flea-sell-button";
      button.textContent = `시스템에 ${won(salePrice)} 판매`;
      const rule = document.createElement("div");
      rule.className = "flea-resale";
      rule.textContent = purchased ? `구매가 ${won(item.purchase_price)} → 재판매 50%` : "PC 획득품 · 판매 수수료 5%";
      actions.append(button, rule);

      button.addEventListener("click", async () => {
        const message = purchased
          ? `${item.name}을(를) 시스템에 ${won(salePrice)}에 재판매할까요?\n시스템 구매품은 구매가의 50%만 받을 수 있습니다.`
          : `${item.name}을(를) 시스템에 ${won(salePrice)}에 판매할까요?`;
        if (!window.confirm(message)) return;
        setBusy(button, true, "판매 중…");
        mobile.clearMobileStatus(status);
        try {
          const { data, error } = await mobile.auth.client.rpc("sell_my_sd_flea_item", {
            p_item_id: item.id,
            p_request_id: mobile.uuid(),
            p_platform: mobile.platform
          });
          if (error) throw error;
          walletBalance = Number(data.balance_after || walletBalance);
          mobile.updateBalanceText(walletBalance);
          mobile.setMobileStatus(status, `${data.name || item.name} 판매 완료 · +${won(data.payout)}`, "success");
          await loadMarketData(false);
        } catch (error) {
          mobile.setMobileStatus(status, mobile.auth.messageForError(error), "error");
        } finally {
          setBusy(button, false);
        }
      });

      card.append(top, itemMeta(item, purchased), actions);
      inventoryRoot.append(card);
    });
  }

  function renderMarket() {
    marketRoot.replaceChildren();
    marketCount.textContent = String(market.length);
    if (!market.length) {
      const empty = document.createElement("div");
      empty.className = "flea-empty";
      empty.innerHTML = "현재 시스템이 보유한 판매 물건이 없습니다.<br>다른 회원이 아이템을 시스템에 판매하면 이곳에 등록됩니다.";
      marketRoot.append(empty);
      return;
    }

    market.forEach((item) => {
      const card = document.createElement("article");
      card.className = "flea-item-card";
      const top = document.createElement("div");
      top.className = "flea-item-top";
      const title = document.createElement("div");
      title.className = "flea-item-title";
      const tier = document.createElement("span");
      tier.className = `flea-tier ${item.tier || ""}`;
      tier.textContent = tierName(item.tier);
      const name = document.createElement("strong");
      name.textContent = item.name || "아이템";
      title.append(tier, name);
      const price = document.createElement("div");
      price.className = "flea-price";
      price.innerHTML = `${won(item.list_price)}<small>시스템 판매가</small>`;
      top.append(title, price);

      const meta = document.createElement("div");
      meta.className = "flea-meta";
      const origin = document.createElement("span");
      origin.innerHTML = `최초 출처 · <b>${String(item.origin_nickname || "회원")}</b>`;
      const seller = document.createElement("span");
      seller.innerHTML = `최근 시스템 판매자 · <b>${String(item.last_seller_nickname || "회원")}</b>`;
      const future = document.createElement("span");
      future.innerHTML = `구매 후 재판매 가능 · <b>${won(Math.floor(Number(item.list_price || 0) * 0.5))}</b> (50%)`;
      meta.append(origin, seller, future);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "flea-buy-button";
      button.textContent = walletBalance >= Number(item.list_price || 0) ? `${won(item.list_price)} 구매` : "잔액 부족";
      button.disabled = walletBalance < Number(item.list_price || 0);
      button.addEventListener("click", async () => {
        if (!window.confirm(`${item.name}을(를) ${won(item.list_price)}에 구매할까요?\n나중에 시스템에게 재판매하면 구매가의 50%만 받을 수 있습니다.`)) return;
        setBusy(button, true, "구매 중…");
        mobile.clearMobileStatus(status);
        try {
          const { data, error } = await mobile.auth.client.rpc("buy_sd_flea_market_item", {
            p_stock_id: item.stock_id,
            p_request_id: mobile.uuid(),
            p_platform: mobile.platform
          });
          if (error) throw error;
          walletBalance = Number(data.balance_after || walletBalance);
          mobile.updateBalanceText(walletBalance);
          mobile.setMobileStatus(status, `${data.name || item.name} 구매 완료 · 출처 ${data.origin_nickname || item.origin_nickname}`, "success");
          await loadMarketData(false);
        } catch (error) {
          mobile.setMobileStatus(status, mobile.auth.messageForError(error), "error");
        } finally {
          setBusy(button, false);
        }
      });

      card.append(top, meta, button);
      marketRoot.append(card);
    });
  }

  function renderProfile() {
    profileRoot.replaceChildren();
    if (!currentProfile?.created) {
      profileRoot.className = "flea-profile-summary";
      const empty = document.createElement("div");
      empty.className = "flea-empty";
      empty.innerHTML = `<strong>${currentProfile?.nickname || "회원"}</strong>님의 공개 프로필이 아직 없습니다.<br>홈페이지 프로필 화면에서 만들 수 있습니다.`;
      profileRoot.append(empty);
      return;
    }
    profileRoot.className = "flea-profile-summary created";
    const icon = document.createElement("div");
    icon.className = "flea-profile-icon";
    if (currentProfile.avatar_url) {
      const img = document.createElement("img");
      img.src = currentProfile.avatar_url;
      img.alt = "프로필 사진";
      img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:18px";
      icon.append(img);
    } else icon.textContent = "👤";
    const info = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = currentProfile.title ? `[${currentProfile.title}] ${currentProfile.nickname}` : currentProfile.nickname;
    const body = document.createElement("p");
    body.textContent = `프로필 자산 ${won(currentProfile.assets?.total)} · 자랑 아이템 ${(currentProfile.showcase_items || []).length}개 · 업적 ${(currentProfile.achievements || []).length}개`;
    info.append(title, body);
    profileRoot.append(icon, info);
  }

  async function loadMarketData(showNotice = true) {
    if (refreshButton) refreshButton.disabled = true;
    try {
      const shell = await mobile.loadMobileShell();
      if (!shell) return;
      walletBalance = Number(shell.wallet.balance || 0);
      const [inventoryResult, marketResult, profileResult] = await Promise.all([
        mobile.auth.client.rpc("list_my_sd_flea_items"),
        mobile.auth.client.rpc("list_sd_flea_market_stock"),
        mobile.auth.client.rpc("get_sd_public_profile", { p_user_id: null })
      ]);
      if (inventoryResult.error) throw inventoryResult.error;
      if (marketResult.error) throw marketResult.error;
      if (profileResult.error) throw profileResult.error;
      inventory = inventoryResult.data?.items || [];
      market = marketResult.data?.items || [];
      currentProfile = profileResult.data || null;
      renderInventory();
      renderMarket();
      renderProfile();
      if (showNotice) {
        mobile.setMobileStatus(status, `내 물건 ${inventory.length}개 · 시스템 재고 ${market.length}개`, "success");
        window.setTimeout(() => mobile.clearMobileStatus(status), 1600);
      }
    } catch (error) {
      mobile.setMobileStatus(status, mobile.auth.messageForError(error), "error");
      inventoryRoot.innerHTML = '<div class="flea-empty">플리마켓 데이터를 불러오지 못했습니다.</div>';
      marketRoot.innerHTML = '<div class="flea-empty">시스템 재고를 불러오지 못했습니다.</div>';
    } finally {
      if (refreshButton) refreshButton.disabled = false;
    }
  }

  refreshButton?.addEventListener("click", () => loadMarketData(true));
  await loadMarketData(true);
});