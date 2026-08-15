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

  function formatAccount(value) {
    return String(value || "-");
  }

  function createBadge(text, extra = "") {
    const badge = document.createElement("span");
    badge.className = `member-badge ${extra}`.trim();
    badge.textContent = text;
    return badge;
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

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      auth.clearStatus(status);
      const value = Math.trunc(Number(amount.value || 0));
      const currentBalance = Math.max(0, Number(member.balance || 0));

      if (!Number.isFinite(value) || value < 1 || value > 1000000000) {
        return auth.setStatus(status, `${isDebit ? "차감" : "지급"} 금액은 1원 이상 10억원 이하로 입력하세요.`, "error");
      }
      if (isDebit && value > currentBalance) {
        return auth.setStatus(status, `현재 잔액 ${currentBalance.toLocaleString("ko-KR")}원보다 많이 차감할 수 없습니다.`, "error");
      }

      const actionText = isDebit ? "차감" : "지급";
      const confirmText = isDebit
        ? `${member.nickname}님의 SD 가상잔액에서 ${value.toLocaleString("ko-KR")}원을 차감할까요?\n\n이 작업은 거래내역에 관리자 차감으로 기록됩니다.`
        : `${member.nickname}님에게 ${value.toLocaleString("ko-KR")}원의 SD 가상잔액을 지급할까요?`;
      if (!window.confirm(confirmText)) return;

      submit.disabled = true;
      submit.textContent = `${actionText} 중…`;
      try {
        const rpcName = isDebit ? "admin_debit_sd_wallet" : "admin_credit_sd_wallet";
        const { data, error } = await auth.client.rpc(rpcName, {
          p_target_user_id: member.user_id,
          p_amount: value,
          p_note: String(note.value || "").trim() || null
        });
        if (error) throw error;

        const balanceAfter = Number(data?.balance_after || 0);
        auth.setStatus(
          status,
          `${data?.nickname || member.nickname}님 ${actionText} 완료: ${value.toLocaleString("ko-KR")}원 · 현재 잔액 ${balanceAfter.toLocaleString("ko-KR")}원`,
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

      const canManage = viewer?.role === "admin"
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
      render();
      if (showSync) {
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
