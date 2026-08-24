"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const auth = window.SD_AUTH;
  const status = document.getElementById("membersStatus");
  const list = document.getElementById("memberList");
  const refresh = document.getElementById("refreshMembers");
  const search = document.getElementById("memberSearch");
  const logout = document.getElementById("logoutButton");
  if (!auth || !list) return;

  let members = [];
  let viewer = null;
  let adminWalletReady = false;
  let adminWalletDeviceKey = "";
  let adminWalletDeviceSecret = "";

  function formatAccount(value) {
    return String(value || "-");
  }

  function createBadge(text, extra = "") {
    const badge = document.createElement("span");
    badge.className = `member-badge ${extra}`.trim();
    badge.textContent = text;
    return badge;
  }

  function randomHex(bytes = 32) {
    if (!globalThis.crypto?.getRandomValues) return "";
    const values = new Uint8Array(bytes);
    globalThis.crypto.getRandomValues(values);
    return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  function randomRequestId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    if (!globalThis.crypto?.getRandomValues) return "";
    const values = new Uint8Array(16);
    globalThis.crypto.getRandomValues(values);
    values[6] = (values[6] & 0x0f) | 0x40;
    values[8] = (values[8] & 0x3f) | 0x80;
    const hex = Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function getAdminWalletSecret() {
    const storageKey = "sd_admin_wallet_device_secret_v2";
    try {
      let value = String(localStorage.getItem(storageKey) || "").trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(value)) {
        value = randomHex(32);
        if (!value) return "";
        localStorage.setItem(storageKey, value);
      }
      return value;
    } catch {
      return "";
    }
  }

  async function bindAdminWalletDevice() {
    adminWalletReady = false;
    adminWalletDeviceKey = String(auth.security?.getDeviceKey?.() || "").trim();
    adminWalletDeviceSecret = getAdminWalletSecret();
    if (!adminWalletDeviceKey || !adminWalletDeviceSecret) {
      throw new Error("ADMIN_DEVICE_BINDING_UNAVAILABLE");
    }

    const heartbeat = await auth.client.rpc("record_sd_access_heartbeat", {
      p_device_key: adminWalletDeviceKey,
      p_platform: auth.security?.detectPlatform?.() || "web",
      p_browser_label: auth.security?.detectBrowser?.() || null,
      p_timezone: auth.security?.timezone?.() || null,
      p_locale: navigator.language || null,
      p_page: auth.security?.currentPageLabel?.() || "account.html"
    });
    if (heartbeat.error) throw heartbeat.error;

    const bound = await auth.client.rpc("admin_bind_sd_wallet_device_v2", {
      p_device_key: adminWalletDeviceKey,
      p_device_secret: adminWalletDeviceSecret
    });
    if (bound.error) throw bound.error;
    adminWalletReady = true;
  }

  function createAmountForm(member, mode) {
    const isDebit = mode === "debit";
    const form = document.createElement("form");
    form.className = `admin-wallet-form ${isDebit ? "debit" : "credit"}`;
    form.hidden = true;

    const amount = document.createElement("input");
    amount.type = "number";
    amount.min = "1";
    amount.max = String(isDebit ? Math.max(1, Math.min(1000000000, Number(member.balance || 0))) : 1000000000);
    amount.step = "1";
    amount.placeholder = isDebit ? "차감 금액" : "지급 금액";
    amount.required = true;

    const note = document.createElement("input");
    note.type = "text";
    note.maxLength = 80;
    note.placeholder = isDebit ? "차감 사유 (선택)" : "메모 (선택)";

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = isDebit ? "debit-submit" : "credit-submit";
    submit.textContent = isDebit ? "차감하기" : "지급하기";

    const quick = document.createElement("div");
    quick.className = "credit-quick";
    [[10000,"1만"],[100000,"10만"],[1000000,"100만"],[10000000,"1000만"]].forEach(([value,label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${isDebit ? "-" : "+"}${label}`;
      button.addEventListener("click", () => {
        const limit = isDebit
          ? Math.min(1000000000, Math.max(0, Number(member.balance || 0)))
          : 1000000000;
        amount.value = String(Math.min(limit, Math.max(0, Number(amount.value || 0)) + value));
      });
      quick.append(button);
    });

    form.append(amount, note, submit, quick);

    let pendingFingerprint = "";
    let pendingRequestId = "";

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      auth.clearStatus(status);
      const value = Math.trunc(Number(amount.value || 0));
      const currentBalance = Math.max(0, Number(member.balance || 0));
      const noteText = String(note.value || "").trim();

      if (!Number.isFinite(value) || value < 1 || value > 1000000000) {
        return auth.setStatus(status, `${isDebit ? "차감" : "지급"} 금액은 1원 이상 10억원 이하로 입력하세요.`, "error");
      }
      if (isDebit && value > currentBalance) {
        return auth.setStatus(status, `현재 잔액 ${currentBalance.toLocaleString("ko-KR")}원보다 많이 차감할 수 없습니다.`, "error");
      }
      if (!adminWalletReady || !adminWalletDeviceKey || !adminWalletDeviceSecret) {
        return auth.setStatus(status, "관리자 지갑 보안 확인이 완료되지 않아 지급/차감을 사용할 수 없습니다.", "error");
      }

      const actionText = isDebit ? "차감" : "지급";
      const confirmText = isDebit
        ? `${member.nickname}님의 SD 가상잔액에서 ${value.toLocaleString("ko-KR")}원을 차감할까요?\n\n이 작업은 거래내역에 관리자 차감으로 기록됩니다.`
        : `${member.nickname}님에게 ${value.toLocaleString("ko-KR")}원의 SD 가상잔액을 지급할까요?`;
      if (!window.confirm(confirmText)) return;

      const fingerprint = JSON.stringify([member.user_id, isDebit ? "debit" : "credit", value, noteText]);
      if (pendingFingerprint !== fingerprint || !pendingRequestId) {
        pendingFingerprint = fingerprint;
        pendingRequestId = randomRequestId();
      }
      if (!pendingRequestId) {
        return auth.setStatus(status, "안전한 요청 번호를 만들지 못했습니다. 다시 로그인한 뒤 시도하세요.", "error");
      }

      submit.disabled = true;
      submit.textContent = `${actionText} 중…`;
      try {
        const { data, error } = await auth.client.rpc("sd_admin_v2_adjust_wallet", {
          p_target_user_id: member.user_id,
          p_direction: isDebit ? "debit" : "credit",
          p_amount: value,
          p_request_id: pendingRequestId,
          p_device_key: adminWalletDeviceKey,
          p_device_secret: adminWalletDeviceSecret,
          p_note: noteText || null
        });
        if (error) throw error;

        pendingFingerprint = "";
        pendingRequestId = "";
        const balanceAfter = Number(data?.balance_after || 0);
        const retryLabel = data?.duplicate ? " · 재시도 중복 방지 확인" : "";
        auth.setStatus(
          status,
          `${data?.nickname || member.nickname}님 ${actionText} 완료: ${value.toLocaleString("ko-KR")}원 · 현재 잔액 ${balanceAfter.toLocaleString("ko-KR")}원${retryLabel}`,
          "success"
        );
        await loadMembers(false);
      } catch (error) {
        auth.setStatus(status, auth.messageForError(error), "error");
      } finally {
        submit.disabled = false;
        submit.textContent = isDebit ? "차감하기" : "지급하기";
      }
    });

    return { form, amount };
  }

  function render() {
    const query = String(search?.value || "").trim().toLowerCase();
    const filtered = members.filter((member) => {
      if (!query) return true;
      return String(member.nickname || "").toLowerCase().includes(query)
        || String(member.account_number || "").toLowerCase().includes(query);
    });
    list.replaceChildren();
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "member-empty";
      empty.textContent = query ? "검색 결과가 없습니다." : "표시할 회원이 없습니다.";
      list.append(empty);
      return;
    }

    filtered.forEach((member) => {
      const card = document.createElement("article");
      card.className = "member-card";
      const row = document.createElement("div");
      row.className = "member-mainrow";

      const name = document.createElement("div");
      name.className = "member-name";
      const strong = document.createElement("strong");
      strong.textContent = member.nickname || "회원";
      name.append(strong);
      if (member.is_me) name.append(createBadge("내 계정"));
      if (member.role === "admin") name.append(createBadge("관리자", "admin"));

      const account = document.createElement("div");
      account.className = "member-account";
      account.textContent = formatAccount(member.account_number);

      const balance = document.createElement("div");
      balance.className = "member-balance";
      balance.textContent = auth.formatWon(member.balance);

      row.append(name, account, balance);

      const canManage = adminWalletReady
        && viewer?.role === "admin"
        && !member.is_me
        && member.status === "active"
        && member.role !== "admin";

      if (canManage) {
        const actions = document.createElement("div");
        actions.className = "admin-wallet-actions";

        const creditToggle = document.createElement("button");
        creditToggle.type = "button";
        creditToggle.className = "admin-credit-toggle";
        creditToggle.textContent = "지급";

        const debitToggle = document.createElement("button");
        debitToggle.type = "button";
        debitToggle.className = "admin-debit-toggle";
        debitToggle.textContent = "차감";
        debitToggle.disabled = Number(member.balance || 0) <= 0;
        if (debitToggle.disabled) debitToggle.title = "차감할 잔액이 없습니다.";

        actions.append(creditToggle, debitToggle);
        row.append(actions);

        const credit = createAmountForm(member, "credit");
        const debit = createAmountForm(member, "debit");
        card.append(row, credit.form, debit.form);

        creditToggle.addEventListener("click", () => {
          const willOpen = credit.form.hidden;
          credit.form.hidden = !willOpen;
          debit.form.hidden = true;
          creditToggle.textContent = willOpen ? "닫기" : "지급";
          debitToggle.textContent = "차감";
          if (willOpen) credit.amount.focus();
        });

        debitToggle.addEventListener("click", () => {
          if (debitToggle.disabled) return;
          const willOpen = debit.form.hidden;
          debit.form.hidden = !willOpen;
          credit.form.hidden = true;
          debitToggle.textContent = willOpen ? "닫기" : "차감";
          creditToggle.textContent = "지급";
          if (willOpen) debit.amount.focus();
        });
      } else {
        const spacer = document.createElement("span");
        row.append(spacer);
        card.append(row);
      }
      list.append(card);
    });
  }

  async function loadMembers(showSync = true) {
    if (refresh) refresh.disabled = true;
    try {
      const session = await auth.requireSession();
      if (!session) return;
      const [profileResult, memberResult] = await Promise.all([
        auth.client.from("profiles").select("role,status").single(),
        auth.client.rpc("list_sd_member_wallets")
      ]);
      if (profileResult.error) throw profileResult.error;
      if (memberResult.error) throw memberResult.error;
      viewer = profileResult.data;
      members = memberResult.data || [];

      adminWalletReady = false;
      if (viewer?.role === "admin" && viewer?.status === "active") {
        try {
          await bindAdminWalletDevice();
        } catch (error) {
          adminWalletReady = false;
          auth.setStatus(status, "관리자 지갑 보안 확인에 실패했습니다. 지급/차감 기능은 비활성화됩니다.", "error");
        }
      }

      render();
      if (showSync && (viewer?.role !== "admin" || adminWalletReady)) {
        auth.setStatus(status, `회원 ${members.length}명의 계좌를 불러왔습니다.`, "success");
        setTimeout(() => auth.clearStatus(status), 1600);
      }
    } catch (error) {
      auth.setStatus(status, auth.messageForError(error), "error");
      list.innerHTML = '<div class="member-empty">회원 계좌를 불러오지 못했습니다.</div>';
    } finally {
      if (refresh) refresh.disabled = false;
    }
  }

  search?.addEventListener("input", render);
  refresh?.addEventListener("click", () => loadMembers(true));
  logout?.addEventListener("click", async () => {
    logout.disabled = true;
    try {
      await auth.client.auth.signOut();
      location.replace("login.html");
    } finally {
      logout.disabled = false;
    }
  });

  await loadMembers(true);
});
