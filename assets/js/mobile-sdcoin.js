"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const mobile = window.SD_MOBILE;
  const status = document.getElementById("sdcoinStatus");
  const refreshButton = document.getElementById("sdcoinRefresh");
  const marketList = document.getElementById("sdcoinMarketList");
  const detailSection = document.getElementById("sdcoinDetail");
  const quantityInput = document.getElementById("tradeQuantity");
  const buyButton = document.getElementById("buyCoin");
  const sellButton = document.getElementById("sellCoin");
  const tradeStatus = document.getElementById("sdcoinTradeStatus");
  const ownedList = document.getElementById("sdcoinOwnedList");
  const holdingCount = document.getElementById("sdcoinHoldingCount");
  const detailIcon = document.getElementById("detailIcon");
  if (!mobile) return;

  const state = {
    market: null,
    selectedCode: "DDJ",
    busy: false,
    countdownTimer: null,
    refreshTimer: null
  };

  const coinIcons = {
    DDJ: "assets/icons/coins/ddj.svg",
    HSH: "assets/icons/coins/hsh.svg",
    SET: "assets/icons/coins/set.svg",
    HIZ: "assets/icons/coins/hiz.svg",
    KNG: "assets/icons/coins/kng.svg",
    SDC: "assets/icons/coins/sdc.svg"
  };

  const won = (value) => `${Math.round(Number(value || 0)).toLocaleString("ko-KR")}원`;
  const quantityText = (value) => Number(value || 0).toLocaleString("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8
  });
  const changeClass = (value) => Number(value) > 0 ? "coin-up" : Number(value) < 0 ? "coin-down" : "coin-flat";
  const profitClass = (value) => Number(value) > 0 ? "profit-positive" : Number(value) < 0 ? "profit-negative" : "profit-flat";
  const changeText = (value) => {
    const number = Number(value || 0);
    return `${number > 0 ? "+" : ""}${number.toFixed(3)}%`;
  };
  const selectedCoin = () => state.market?.coins?.find((coin) => coin.code === state.selectedCode) || state.market?.coins?.[0];
  const coinReturnRate = (coin) => {
    const evaluation = Number(coin?.evaluation_amount || 0);
    const profit = Number(coin?.profit_loss || 0);
    const cost = evaluation - profit;
    return cost > 0 ? (profit / cost) * 100 : 0;
  };
  const setTradeStatus = (message, type = "error") => {
    if (!tradeStatus) return;
    tradeStatus.textContent = message;
    tradeStatus.className = `sdcoin-trade-status ${type}`;
    tradeStatus.hidden = false;
  };
  const clearTradeStatus = () => {
    if (!tradeStatus) return;
    tradeStatus.hidden = true;
    tradeStatus.textContent = "";
    tradeStatus.className = "sdcoin-trade-status";
  };

  const durationText = (target) => {
    if (!target) return "-";
    const seconds = Math.max(0, Math.floor((new Date(target).getTime() - Date.now()) / 1000));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainSeconds = seconds % 60;
    if (days > 0) return `${days}일 ${hours}시간`;
    if (hours > 0) return `${hours}시간 ${minutes}분`;
    return `${minutes}분 ${String(remainSeconds).padStart(2, "0")}초`;
  };

  const renderCountdowns = () => {
    if (!state.market) return;
    document.getElementById("regularCountdown").textContent = durationText(state.market.next_regular_at);
    document.getElementById("shockCountdown").textContent = durationText(state.market.next_shock_at);
    document.getElementById("weeklyCountdown").textContent = durationText(state.market.next_weekly_at);
  };

  const renderTotals = () => {
    const coins = state.market?.coins || [];
    const evaluation = coins.reduce((sum, coin) => sum + Number(coin.evaluation_amount || 0), 0);
    const profit = coins.reduce((sum, coin) => sum + Number(coin.profit_loss || 0), 0);
    document.getElementById("sdcoinTotalEvaluation").textContent = won(evaluation);
    const profitElement = document.getElementById("sdcoinTotalProfit");
    profitElement.textContent = `${profit > 0 ? "+" : ""}${won(profit)}`;
    profitElement.className = profitClass(profit);
  };

  const renderOwned = () => {
    const owned = (state.market?.coins || []).filter((coin) => Number(coin.quantity || 0) > 0);
    holdingCount.textContent = `${owned.length}종 보유`;
    ownedList.replaceChildren();
    if (!owned.length) {
      ownedList.innerHTML = '<div class="empty-mobile sdcoin-owned-empty">아직 보유한 코인이 없습니다.</div>';
      return;
    }

    owned.forEach((coin) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = `sdcoin-owned-card${coin.code === state.selectedCode ? " active" : ""}`;

      const image = document.createElement("img");
      image.src = coinIcons[coin.code] || "assets/icons/sdcoin.svg";
      image.alt = "";

      const info = document.createElement("span");
      info.className = "sdcoin-owned-info";
      const name = document.createElement("strong");
      name.textContent = coin.name;
      const quantity = document.createElement("span");
      quantity.textContent = `${quantityText(coin.quantity)} ${coin.code}`;
      info.append(name, quantity);

      const value = document.createElement("span");
      value.className = "sdcoin-owned-value";
      const evaluation = document.createElement("strong");
      evaluation.textContent = won(coin.evaluation_amount);
      const profit = document.createElement("span");
      profit.className = profitClass(coin.profit_loss);
      const rate = coinReturnRate(coin);
      profit.textContent = `${Number(coin.profit_loss) > 0 ? "+" : ""}${won(coin.profit_loss)} · ${rate > 0 ? "+" : ""}${rate.toFixed(2)}%`;
      value.append(evaluation, profit);

      card.append(image, info, value);
      card.addEventListener("click", async () => {
        state.selectedCode = coin.code;
        clearTradeStatus();
        renderOwned();
        renderMarket();
        renderDetail();
        await loadChart();
        detailSection.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      ownedList.append(card);
    });
  };

  const renderMarket = () => {
    const coins = state.market?.coins || [];
    marketList.replaceChildren();
    if (!coins.length) {
      marketList.innerHTML = '<div class="empty-mobile">표시할 코인이 없습니다.</div>';
      return;
    }

    coins.forEach((coin) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `sdcoin-market-row${coin.code === state.selectedCode ? " active" : ""}`;
      button.dataset.coinCode = coin.code;

      const icon = document.createElement("img");
      icon.className = "sdcoin-market-icon";
      icon.src = coinIcons[coin.code] || "assets/icons/sdcoin.svg";
      icon.alt = "";

      const info = document.createElement("span");
      info.className = "sdcoin-market-info";
      const name = document.createElement("strong");
      name.textContent = coin.name;
      const holding = document.createElement("span");
      holding.textContent = `보유 ${quantityText(coin.quantity)} ${coin.code}`;
      info.append(name, holding);

      const price = document.createElement("span");
      price.className = "sdcoin-market-price";
      const priceValue = document.createElement("strong");
      priceValue.textContent = won(coin.current_price);
      const change = document.createElement("span");
      change.className = changeClass(coin.last_change_percent);
      change.textContent = `45분 ${changeText(coin.last_change_percent)}`;
      price.append(priceValue, change);

      button.append(icon, info, price);
      button.addEventListener("click", async () => {
        state.selectedCode = coin.code;
        clearTradeStatus();
        renderOwned();
        renderMarket();
        renderDetail();
        await loadChart();
      });
      marketList.append(button);
    });
  };

  const renderDetail = () => {
    const coin = selectedCoin();
    if (!coin) {
      detailSection.hidden = true;
      return;
    }
    state.selectedCode = coin.code;
    detailSection.hidden = false;
    detailIcon.src = coinIcons[coin.code] || "assets/icons/sdcoin.svg";
    detailIcon.alt = `${coin.name} 이미지`;
    document.getElementById("detailCode").textContent = coin.code;
    document.getElementById("detailName").textContent = coin.name;
    document.getElementById("detailPrice").textContent = won(coin.current_price);
    const detailChange = document.getElementById("detailChange");
    detailChange.textContent = `45분 ${changeText(coin.last_change_percent)} · 7일 ${changeText(coin.seven_day_change_percent)}`;
    detailChange.className = changeClass(coin.last_change_percent);
    document.getElementById("holdingQuantity").textContent = `${quantityText(coin.quantity)} ${coin.code}`;
    document.getElementById("averageBuyPrice").textContent = won(coin.average_buy_price);
    document.getElementById("holdingEvaluation").textContent = won(coin.evaluation_amount);
    const profit = document.getElementById("holdingProfit");
    profit.textContent = `${Number(coin.profit_loss) > 0 ? "+" : ""}${won(coin.profit_loss)}`;
    profit.className = profitClass(coin.profit_loss);
    renderTradePreview();
  };

  const createSvgElement = (name, attributes = {}) => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    return element;
  };

  const renderChart = (rows) => {
    const chart = document.getElementById("sdcoinChart");
    chart.replaceChildren();
    if (!rows?.length) {
      chart.innerHTML = '<div class="empty-mobile">아직 가격 기록이 없습니다.</div>';
      document.getElementById("chartRange").textContent = "-";
      return;
    }

    const width = 600;
    const height = 220;
    const paddingX = 14;
    const paddingY = 20;
    const prices = rows.map((row) => Number(row.price));
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const spread = Math.max(1, maxPrice - minPrice);
    const points = rows.map((row, index) => {
      const x = rows.length === 1 ? width / 2 : paddingX + (index / (rows.length - 1)) * (width - paddingX * 2);
      const y = height - paddingY - ((Number(row.price) - minPrice) / spread) * (height - paddingY * 2);
      return { x, y };
    });

    const svg = createSvgElement("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" });
    const defs = createSvgElement("defs");
    const gradient = createSvgElement("linearGradient", { id: "sdcoinArea", x1: "0", y1: "0", x2: "0", y2: "1" });
    gradient.append(
      createSvgElement("stop", { offset: "0%", "stop-color": "#8b7bff", "stop-opacity": ".32" }),
      createSvgElement("stop", { offset: "100%", "stop-color": "#8b7bff", "stop-opacity": "0" })
    );
    defs.append(gradient);
    svg.append(defs);

    [0.25, 0.5, 0.75].forEach((ratio) => {
      svg.append(createSvgElement("line", {
        x1: paddingX, x2: width - paddingX,
        y1: height * ratio, y2: height * ratio,
        class: "sdcoin-chart-grid"
      }));
    });

    const pointText = points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
    const areaPath = `M ${points[0].x} ${height - paddingY} L ${pointText.replaceAll(",", " ")} L ${points.at(-1).x} ${height - paddingY} Z`;
    svg.append(createSvgElement("path", { d: areaPath, class: "sdcoin-chart-area" }));
    svg.append(createSvgElement("polyline", { points: pointText, class: "sdcoin-chart-line" }));
    const lastPoint = points.at(-1);
    svg.append(createSvgElement("circle", { cx: lastPoint.x, cy: lastPoint.y, r: 6, class: "sdcoin-chart-dot" }));

    const high = createSvgElement("text", { x: paddingX, y: 16, class: "sdcoin-chart-label" });
    high.textContent = `고가 ${won(maxPrice)}`;
    const low = createSvgElement("text", { x: paddingX, y: height - 3, class: "sdcoin-chart-label" });
    low.textContent = `저가 ${won(minPrice)}`;
    svg.append(high, low);
    chart.append(svg);

    const firstDate = new Date(rows[0].recorded_at);
    const lastDate = new Date(rows.at(-1).recorded_at);
    document.getElementById("chartRange").textContent = `${firstDate.toLocaleDateString("ko-KR")} ~ ${lastDate.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
  };

  const loadChart = async () => {
    const coin = selectedCoin();
    if (!coin) return;
    const chart = document.getElementById("sdcoinChart");
    chart.innerHTML = '<div class="empty-mobile">차트를 불러오는 중입니다.</div>';
    const { data, error } = await mobile.auth.client.rpc("get_sdcoin_chart", { p_coin_code: coin.code });
    if (error) throw error;
    renderChart(data || []);
  };

  const validQuantity = () => {
    const quantity = Number(quantityInput.value);
    if (!Number.isFinite(quantity) || quantity < 0.05) return null;
    const units = Math.round(quantity * 20);
    if (Math.abs(quantity - units / 20) > 0.0000001) return null;
    return units / 20;
  };

  const renderTradePreview = () => {
    const coin = selectedCoin();
    const quantity = validQuantity();
    if (!coin || quantity === null) {
      document.getElementById("tradeGross").textContent = "-";
      document.getElementById("tradeFee").textContent = "-";
      document.getElementById("tradeTotal").textContent = "-";
      return;
    }
    const gross = Math.round(Number(coin.current_price) * quantity);
    const fee = Math.ceil(gross * 0.05);
    document.getElementById("tradeGross").textContent = won(gross);
    document.getElementById("tradeFee").textContent = won(fee);
    document.getElementById("tradeTotalLabel").textContent = "구매 시 차감 / 판매 시 입금";
    document.getElementById("tradeTotal").textContent = `${won(gross + fee)} / ${won(Math.max(0, gross - fee))}`;
  };

  const setBusy = (busy) => {
    state.busy = busy;
    refreshButton.disabled = busy;
    buyButton.disabled = busy;
    sellButton.disabled = busy;
    quantityInput.disabled = busy;
  };

  const loadMarket = async ({ quiet = false, force = false } = {}) => {
    if (state.busy && !force) return;
    if (!quiet) mobile.clearMobileStatus(status);
    refreshButton.disabled = true;
    try {
      const shell = await mobile.loadMobileShell();
      if (!shell) return;
      const { data, error } = await mobile.auth.client.rpc("get_sdcoin_market");
      if (error) throw error;
      state.market = data;
      if (!state.market.coins?.some((coin) => coin.code === state.selectedCode)) {
        state.selectedCode = state.market.coins?.[0]?.code || "DDJ";
      }
      mobile.updateBalanceText(state.market.wallet_balance);
      renderTotals();
      renderCountdowns();
      renderOwned();
      renderMarket();
      renderDetail();
      await loadChart();
      if (!quiet) {
        mobile.setMobileStatus(status, "최신 시세로 갱신했습니다.", "success");
        setTimeout(() => mobile.clearMobileStatus(status), 1200);
      }
    } catch (error) {
      mobile.setMobileStatus(status, mobile.auth.messageForError(error), "error");
    } finally {
      refreshButton.disabled = false;
    }
  };

  const trade = async (side) => {
    if (state.busy) return;
    const coin = selectedCoin();
    const quantity = validQuantity();
    if (!coin) return;
    if (quantity === null) {
      return setTradeStatus("수량을 0.05 이상, 0.05 단위로 입력하세요.", "error");
    }
    if (side === "sell" && quantity > Number(coin.quantity)) {
      return setTradeStatus("보유 코인 수량이 부족합니다.", "error");
    }

    setBusy(true);
    clearTradeStatus();
    try {
      const { data, error } = await mobile.auth.client.rpc("trade_sdcoin", {
        p_coin_code: coin.code,
        p_side: side,
        p_quantity: quantity,
        p_request_id: mobile.uuid(),
        p_platform: mobile.platform
      });
      if (error) throw error;
      mobile.updateBalanceText(data.balance_after);
      const action = side === "buy" ? "구매" : "판매";
      setTradeStatus(
        `${coin.name} ${quantityText(quantity)} ${coin.code} ${action} 완료 · 수수료 ${won(data.fee)}`,
        "success"
      );
      await loadMarket({ quiet: true, force: true });
    } catch (error) {
      setTradeStatus(mobile.auth.messageForError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  quantityInput.addEventListener("input", () => {
    clearTradeStatus();
    renderTradePreview();
  });
  document.querySelectorAll("[data-quantity]").forEach((button) => {
    button.addEventListener("click", () => {
      quantityInput.value = button.dataset.quantity;
      clearTradeStatus();
      renderTradePreview();
    });
  });
  refreshButton.addEventListener("click", () => loadMarket());
  buyButton.addEventListener("click", () => trade("buy"));
  sellButton.addEventListener("click", () => trade("sell"));

  state.countdownTimer = setInterval(renderCountdowns, 1000);
  state.refreshTimer = setInterval(() => loadMarket({ quiet: true }), 60000);
  window.addEventListener("pagehide", () => {
    clearInterval(state.countdownTimer);
    clearInterval(state.refreshTimer);
  }, { once: true });

  await loadMarket({ quiet: true });
});
