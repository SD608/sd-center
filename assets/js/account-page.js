"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const auth = window.SD_AUTH;
  const status = document.getElementById("accountStatus");
  const refresh = document.getElementById("refreshAccount");
  const logout = document.getElementById("logoutButton");
  const list = document.getElementById("transactionList");
  const showDelete = document.getElementById("showDeleteAccount");
  const deleteForm = document.getElementById("deleteAccountForm");
  const deletePassword = document.getElementById("deletePassword");
  const deleteConfirmText = document.getElementById("deleteConfirmText");
  const deleteButton = document.getElementById("deleteAccountButton");
  let currentSession = null;
  let currentProfile = null;
  if (!auth) return;

  async function loadAccount() {
    auth.clearStatus(status);
    if (refresh) refresh.disabled = true;
    try {
      const session = await auth.requireSession();
      if (!session) return;
      currentSession = session;
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
      currentProfile = profile;
      document.getElementById("accountNickname").textContent = profile.nickname;
      document.getElementById("welcomeName").textContent = `${profile.nickname}님`;
      document.getElementById("accountNumber").textContent = wallet.account_number;
      document.getElementById("accountBalance").textContent = auth.formatWon(wallet.balance);
      document.getElementById("accountCreated").textContent = auth.formatDate(profile.created_at);
      document.getElementById("accountState").textContent = profile.status === "active" ? "정상" : "이용 정지";
      document.getElementById("accountRole").textContent = profile.role === "admin" ? "관리자" : "일반 회원";
      document.getElementById("lastSynced").textContent = auth.formatDate(wallet.updated_at);
      if (profile.role === "admin" && showDelete) {
        showDelete.disabled = true;
        showDelete.textContent = "관리자 계정 삭제 잠금";
      }
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
          meta.textContent = `${auth.formatDate(tx.created_at)} · ${String(tx.platform || "web").toUpperCase()}`;
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
      if (refresh) refresh.disabled = false;
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

  showDelete?.addEventListener("click", () => {
    if (currentProfile?.role === "admin") return;
    deleteForm.hidden = !deleteForm.hidden;
    showDelete.textContent = deleteForm.hidden ? "계정 삭제하기" : "삭제 취소";
    if (!deleteForm.hidden) deletePassword?.focus();
  });

  deleteForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    auth.clearStatus(status);
    if (!currentSession?.user?.email) {
      return auth.setStatus(status, "로그인 정보를 다시 불러온 뒤 시도하세요.", "error");
    }
    if (currentProfile?.role === "admin") {
      return auth.setStatus(status, "관리자 계정은 이 화면에서 삭제할 수 없습니다.", "error");
    }
    const password = String(deletePassword?.value || "");
    const confirmText = String(deleteConfirmText?.value || "").replace(/\s+/g, "");
    if (!password) return auth.setStatus(status, "현재 비밀번호를 입력하세요.", "error");
    if (confirmText !== "계정삭제") {
      return auth.setStatus(status, "확인 문구에 계정삭제를 정확히 입력하세요.", "error");
    }
    const finalConfirm = window.confirm("계정을 영구 삭제합니다. SD 가상계좌와 게임 데이터도 함께 삭제되며 복구할 수 없습니다. 계속할까요?");
    if (!finalConfirm) return;

    deleteButton.disabled = true;
    deleteButton.textContent = "삭제 중…";
    try {
      const { error: reauthError } = await auth.client.auth.signInWithPassword({
        email: currentSession.user.email,
        password
      });
      if (reauthError) throw reauthError;
      const { error } = await auth.client.rpc("delete_my_sd_account");
      if (error) throw error;
      await auth.client.auth.signOut({ scope: "local" }).catch(() => {});
      localStorage.removeItem("sd_pending_email");
      location.replace("index.html?account=deleted");
    } catch (error) {
      auth.setStatus(status, auth.messageForError(error), "error");
      deleteButton.disabled = false;
      deleteButton.textContent = "영구 삭제";
    }
  });

  loadAccount();
});
