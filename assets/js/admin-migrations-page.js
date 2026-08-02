"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const auth = window.SD_AUTH;
  if (!auth) return;
  const status = document.getElementById("migrationAdminStatus");
  const list = document.getElementById("migrationAdminList");
  const count = document.getElementById("migrationCount");
  const refresh = document.getElementById("refreshMigrations");

  async function act(name, body, successMessage) {
    const { error } = await auth.client.rpc(name, body);
    if (error) throw error;
    auth.setStatus(status, successMessage, "success");
    await load();
  }

  async function load() {
    auth.clearStatus(status);
    refresh.disabled = true;
    try {
      const session = await auth.requireSession();
      if (!session) return;
      const profile = await auth.client.from("profiles").select("role,status").single();
      if (profile.error) throw profile.error;
      if (profile.data.role !== "admin" || profile.data.status !== "active") {
        location.replace("account.html");
        return;
      }
      const result = await auth.client.rpc("admin_list_sd_wallet_migrations");
      if (result.error) throw result.error;
      const rows = result.data || [];
      count.textContent = `전체 ${rows.length}건 · 승인 대기 ${rows.filter((row) => row.status === "pending").length}건`;
      list.replaceChildren();
      if (!rows.length) {
        const empty = document.createElement("div");
        empty.className = "transaction-empty";
        empty.textContent = "잔액 이전 신청이 없습니다.";
        list.append(empty);
        return;
      }
      rows.forEach((row) => {
        const card = document.createElement("article");
        card.className = `migration-admin-card ${row.status}`;
        const detail = document.createElement("div");
        detail.innerHTML = `<div class="migration-admin-title"><strong>${row.nickname}</strong><span>${row.status === "pending" ? "승인 대기" : row.status === "completed" ? "승인 완료" : "거절"}</span></div><dl><div><dt>온라인 계좌</dt><dd>${row.online_account_number}</dd></div><div><dt>기존 PC 계좌</dt><dd>${row.previous_account_number || "-"}</dd></div><div><dt>로컬 사용자</dt><dd>${row.local_username || "-"} / ${row.local_owner_name || "-"}</dd></div><div><dt>이전 요청액</dt><dd>${auth.formatWon(row.migrated_balance)}</dd></div><div><dt>신청일</dt><dd>${auth.formatDate(row.created_at)}</dd></div></dl>`;
        card.append(detail);
        if (row.status === "pending") {
          const actions = document.createElement("div");
          actions.className = "migration-admin-actions";
          const approve = document.createElement("button");
          approve.className = "primary-button";
          approve.textContent = "승인";
          approve.addEventListener("click", async () => {
            if (!confirm(`${row.nickname}님의 ${auth.formatWon(row.migrated_balance)} 이전을 승인할까요?`)) return;
            approve.disabled = true;
            try { await act("admin_approve_sd_wallet_migration", { p_migration_id: row.migration_id }, "잔액 이전을 승인했습니다."); }
            catch (error) { auth.setStatus(status, auth.messageForError(error), "error"); approve.disabled = false; }
          });
          const reject = document.createElement("button");
          reject.className = "sdlink-revoke";
          reject.textContent = "거절";
          reject.addEventListener("click", async () => {
            const reason = prompt("거절 사유를 입력하세요.", "관리자 확인 후 거절");
            if (reason === null) return;
            reject.disabled = true;
            try { await act("admin_reject_sd_wallet_migration", { p_migration_id: row.migration_id, p_reason: reason }, "잔액 이전을 거절했습니다."); }
            catch (error) { auth.setStatus(status, auth.messageForError(error), "error"); reject.disabled = false; }
          });
          actions.append(approve, reject);
          card.append(actions);
        } else if (row.rejection_reason) {
          const reason = document.createElement("p");
          reason.className = "migration-reason";
          reason.textContent = `사유: ${row.rejection_reason}`;
          card.append(reason);
        }
        list.append(card);
      });
    } catch (error) {
      auth.setStatus(status, auth.messageForError(error), "error");
    } finally {
      refresh.disabled = false;
    }
  }

  refresh.addEventListener("click", load);
  document.getElementById("adminLogout").addEventListener("click", async () => {
    await auth.client.auth.signOut();
    location.replace("login.html");
  });
  load();
});
