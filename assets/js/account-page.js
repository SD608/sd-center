"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const auth = window.SD_AUTH;
  const status = document.getElementById("accountStatus");
  const refresh = document.getElementById("refreshAccount");
  const logout = document.getElementById("logoutButton");
  const list = document.getElementById("transactionList");
  if (!auth) return;

  async function loadAccount() {
    auth.clearStatus(status);
    refresh.disabled = true;
    try {
      const session = await auth.requireSession();
      if (!session) return;
      document.getElementById("accountEmail").textContent = session.user.email || "-";

      const [profileResult, walletResult, txResult] = await Promise.all([
        auth.client.from("profiles").select("nickname,status,role,created_at").single(),
        auth.client.from("wallets").select("id,account_number,balance,created_at,updated_at").single(),
        auth.client.from("transactions")
          .select("id,description,transaction_type,amount,balance_after,platform,created_at")
          .order("created_at", { ascending: false })
          .limit(30)
      ]);
      if (profileResult.error) throw profileResult.error;
      if (walletResult.error) throw walletResult.error;
      if (txResult.error) throw txResult.error;

      const profile = profileResult.data;
      const wallet = walletResult.data;
      document.getElementById("accountNickname").textContent = profile.nickname;
      document.getElementById("welcomeName").textContent = `${profile.nickname}님`;
      document.getElementById("accountNumber").textContent = wallet.account_number;
      document.getElementById("accountBalance").textContent = auth.formatWon(wallet.balance);
      document.getElementById("accountCreated").textContent = auth.formatDate(profile.created_at);
      document.getElementById("accountState").textContent = profile.status === "active" ? "정상" : "이용 정지";
      document.getElementById("accountRole").textContent = profile.role === "admin" ? "관리자" : "일반 회원";
      document.getElementById("lastSynced").textContent = auth.formatDate(wallet.updated_at);

      list.replaceChildren();
      const transactions = txResult.data || [];
      if (!transactions.length) {
        const empty = document.createElement("div");
        empty.className = "transaction-empty";
        empty.textContent = "아직 거래 내역이 없습니다.";
        list.append(empty);
      } else {
        transactions.forEach((tx) => {
          const row = document.createElement("article");
          row.className = "transaction-row";
          const info = document.createElement("div");
          const title = document.createElement("strong");
          title.textContent = tx.description;
          const meta = document.createElement("span");
          meta.textContent = `${auth.formatDate(tx.created_at)} · ${tx.platform.toUpperCase()}`;
          info.append(title, meta);
          const amount = document.createElement("div");
          amount.className = `transaction-amount ${tx.amount > 0 ? "plus" : "minus"}`;
          amount.textContent = `${tx.amount > 0 ? "+" : ""}${Number(tx.amount).toLocaleString("ko-KR")}원`;
          const balance = document.createElement("small");
          balance.textContent = `잔액 ${auth.formatWon(tx.balance_after)}`;
          amount.append(balance);
          row.append(info, amount);
          list.append(row);
        });
      }
      auth.setStatus(status, "서버와 동기화되었습니다.", "success");
      setTimeout(() => auth.clearStatus(status), 1800);
    } catch (error) {
      auth.setStatus(status, auth.messageForError(error), "error");
    } finally {
      refresh.disabled = false;
    }
  }

  refresh?.addEventListener("click", loadAccount);
  logout?.addEventListener("click", async () => {
    logout.disabled = true;
    try {
      await auth.client.auth.signOut();
      location.replace("login.html");
    } finally {
      logout.disabled = false;
    }
  });
  loadAccount();
});
