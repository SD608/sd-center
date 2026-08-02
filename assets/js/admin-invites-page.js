"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const auth = window.SD_AUTH;
  if (!auth) return;

  const statusBox = document.getElementById("pageStatus");
  const form = document.getElementById("createInviteForm");
  const createButton = document.getElementById("createButton");
  const refreshButton = document.getElementById("refreshButton");
  const logoutButton = document.getElementById("logoutButton");
  const list = document.getElementById("inviteList");
  const summary = document.getElementById("inviteSummary");
  const signupUrl = document.getElementById("signupUrl").textContent.trim();

  const stateLabel = {
    active: "사용 가능",
    used: "사용 완료",
    expired: "기간 만료",
    revoked: "사용 중지"
  };

  function errorMessage(error) {
    const parts = [
      error?.message,
      error?.details,
      error?.hint,
      error?.code ? `오류 코드: ${error.code}` : ""
    ].filter(Boolean);
    return parts.join(" / ") || "알 수 없는 오류";
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      auth.setStatus(statusBox, "클립보드에 복사했습니다.", "success");
      setTimeout(() => auth.clearStatus(statusBox), 1400);
    } catch {
      auth.setStatus(
        statusBox,
        "자동 복사가 차단됐습니다. 코드를 직접 선택해서 복사하세요.",
        "info"
      );
    }
  }

  async function ensureAdmin() {
    const session = await auth.requireSession();
    if (!session) return false;

    const { data, error } = await auth.client
      .from("profiles")
      .select("role,status")
      .eq("id", session.user.id)
      .single();

    if (error) throw error;
    if (data.role !== "admin" || data.status !== "active") {
      location.replace("account.html");
      return false;
    }
    return true;
  }

  function makeRow(item) {
    const row = document.createElement("article");
    row.className = "invite-row";

    const code = document.createElement("strong");
    code.className = "invite-code";
    code.textContent = item.invite_code;

    const state = document.createElement("span");
    state.className = `invite-status ${item.invite_status}`;
    state.textContent = stateLabel[item.invite_status] || item.invite_status;

    const meta = document.createElement("div");
    meta.className = "invite-meta";

    const created = document.createElement("span");
    created.textContent = `생성 ${auth.formatDate(item.created_at)}`;

    const expires = document.createElement("span");
    expires.textContent = item.expires_at
      ? `만료 ${auth.formatDate(item.expires_at)}`
      : "만료 없음";

    const note = document.createElement("span");
    note.textContent = item.note || "메모 없음";

    meta.append(created, expires, note);

    if (item.used_at) {
      const used = document.createElement("span");
      used.textContent =
        `사용 ${auth.formatDate(item.used_at)}` +
        (item.used_nickname ? ` · ${item.used_nickname}` : "");
      meta.append(used);
    }

    const actions = document.createElement("div");
    actions.className = "invite-actions";

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "mini-button";
    copy.textContent = "복사";
    copy.addEventListener("click", () =>
      copyText(`SD 계정 가입\n${signupUrl}\n초대 코드: ${item.invite_code}`)
    );
    actions.append(copy);

    if (item.invite_status === "active") {
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.className = "mini-button danger";
      revoke.textContent = "중지";
      revoke.addEventListener("click", async () => {
        if (!confirm(`${item.invite_code} 코드를 사용 중지할까요?`)) return;
        revoke.disabled = true;
        try {
          const { error } = await auth.client.rpc("admin_revoke_invite_code", {
            p_code: item.invite_code
          });
          if (error) throw error;
          await loadInvites();
        } catch (error) {
          auth.setStatus(statusBox, errorMessage(error), "error");
        } finally {
          revoke.disabled = false;
        }
      });
      actions.append(revoke);
    }

    row.append(code, state, meta, actions);
    return row;
  }

  async function loadInvites() {
    auth.clearStatus(statusBox);
    refreshButton.disabled = true;

    try {
      if (!await ensureAdmin()) return;

      const { data, error } = await auth.client.rpc("admin_list_invite_codes");
      if (error) throw error;

      const items = data || [];
      const counts = items.reduce((result, item) => {
        result[item.invite_status] = (result[item.invite_status] || 0) + 1;
        return result;
      }, {});

      summary.replaceChildren();
      [
        ["전체", items.length],
        ["사용 가능", counts.active || 0],
        ["사용 완료", counts.used || 0],
        ["만료·중지", (counts.expired || 0) + (counts.revoked || 0)]
      ].forEach(([label, value]) => {
        const chip = document.createElement("span");
        chip.append(`${label} `);
        const strong = document.createElement("strong");
        strong.textContent = String(value);
        chip.append(strong);
        summary.append(chip);
      });

      list.replaceChildren();

      if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "invite-empty";
        empty.textContent = "아직 발급한 초대 코드가 없습니다.";
        list.append(empty);
        return;
      }

      items.forEach((item) => list.append(makeRow(item)));
    } catch (error) {
      auth.setStatus(statusBox, errorMessage(error), "error");
      list.innerHTML =
        '<div class="invite-empty">초대 코드 목록을 불러오지 못했습니다.</div>';
    } finally {
      refreshButton.disabled = false;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    auth.clearStatus(statusBox);
    createButton.disabled = true;
    createButton.textContent = "생성 중…";

    try {
      const count = Number(document.getElementById("inviteCount").value);
      const days = Number(document.getElementById("expiresDays").value);
      const note = document.getElementById("inviteNote").value.trim();

      const { data, error } = await auth.client.rpc("admin_create_invite_codes", {
        p_count: count,
        p_expires_days: days,
        p_note: note || null
      });

      if (error) throw error;

      const codes = (data || []).map((item) => item.invite_code);
      auth.setStatus(
        statusBox,
        `${codes.length}개의 초대 코드를 만들었습니다. 아래 목록에서 복사하세요.`,
        "success"
      );

      // 생성 뒤 자동 클립보드 복사를 하지 않음.
      // 브라우저 권한 문제로 실제 생성 성공을 오류처럼 표시하는 현상을 막음.
      await loadInvites();
    } catch (error) {
      auth.setStatus(statusBox, errorMessage(error), "error");
    } finally {
      createButton.disabled = false;
      createButton.textContent = "코드 생성";
    }
  });

  refreshButton.addEventListener("click", loadInvites);

  document.getElementById("copySignupUrl").addEventListener("click", () =>
    copyText(signupUrl)
  );

  logoutButton.addEventListener("click", async () => {
    await auth.client.auth.signOut();
    location.replace("login.html");
  });

  await loadInvites();
});
