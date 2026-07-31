"use strict";
document.addEventListener("DOMContentLoaded", async () => {
  const mobile = window.SD_MOBILE;
  const status = document.getElementById("walletStatus");
  const list = document.getElementById("mobileTransactions");
  const refreshButton = document.getElementById("walletRefresh");
  if (!mobile) return;

  const load = async () => {
    mobile.clearMobileStatus(status);
    refreshButton.disabled = true;
    try {
      const state = await mobile.loadMobileShell();
      if (!state) return;
      const { data, error } = await mobile.auth.client.from("transactions")
        .select("id,description,amount,balance_after,platform,created_at")
        .order("created_at", { ascending: false }).limit(30);
      if (error) throw error;
      list.replaceChildren();
      if (!data?.length) {
        list.innerHTML = '<div class="empty-mobile">아직 거래 내역이 없습니다.</div>';
      } else {
        data.forEach((tx) => {
          const row = document.createElement("article");
          row.className = "wallet-row";
          const info = document.createElement("div");
          const title = document.createElement("strong");
          title.textContent = tx.description;
          const meta = document.createElement("span");
          meta.textContent = `${mobile.auth.formatDate(tx.created_at)} · ${String(tx.platform).toUpperCase()}`;
          info.append(title, meta);
          const amount = document.createElement("div");
          amount.className = `amount ${tx.amount > 0 ? "plus" : "minus"}`;
          amount.textContent = `${tx.amount > 0 ? "+" : ""}${Number(tx.amount).toLocaleString("ko-KR")}원`;
          const balance = document.createElement("span");
          balance.textContent = `잔액 ${mobile.auth.formatWon(tx.balance_after)}`;
          amount.append(balance);
          row.append(info, amount);
          list.append(row);
        });
      }
      mobile.setMobileStatus(status, "서버와 동기화되었습니다.", "success");
      setTimeout(() => mobile.clearMobileStatus(status), 1300);
    } catch (error) {
      mobile.setMobileStatus(status, mobile.auth.messageForError(error), "error");
    } finally {
      refreshButton.disabled = false;
    }
  };

  refreshButton.addEventListener("click", load);
  load();
});
