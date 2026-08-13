"use strict";
document.addEventListener("DOMContentLoaded", async () => {
  const mobile = window.SD_MOBILE;
  const status = document.getElementById("bitcoinStatus");
  const quantity = document.getElementById("btcQuantity");
  const syncedAt = document.getElementById("btcSyncedAt");
  const localUpdatedAt = document.getElementById("btcLocalUpdatedAt");
  if (!mobile) return;

  const formatDate = (value) => {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("ko-KR");
  };

  try {
    await mobile.loadMobileShell();
    const { data, error } = await mobile.auth.client.rpc("get_sd_bitcoin_snapshot");
    if (error) throw error;
    const btc = Number(data?.btc_quantity || 0);
    quantity.textContent = `${btc.toLocaleString("ko-KR", { minimumFractionDigits: 0, maximumFractionDigits: 8 })} BTC`;
    syncedAt.textContent = formatDate(data?.synced_at);
    localUpdatedAt.textContent = formatDate(data?.local_updated_at);

    if (!data?.available) {
      mobile.setMobileStatus(
        status,
        "아직 PC BTC 수량이 올라오지 않았습니다. PC에서 SD Link v1.2.0 이상으로 동기화하세요.",
        "info"
      );
    }
  } catch (error) {
    mobile.setMobileStatus(status, mobile.auth.messageForError(error), "error");
    quantity.textContent = "-";
  }
});