"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const auth = window.SD_AUTH;
  const status = document.getElementById("rankingStatus");
  const list = document.getElementById("rankingList");
  const podium = document.getElementById("rankingPodium");
  const summary = document.getElementById("myRankingSummary");
  const refresh = document.getElementById("refreshRanking");
  const logout = document.getElementById("logoutButton");
  if (!auth || !list || !podium) return;

  let rankedMembers = [];
  let viewerIsAdmin = false;

  const balanceOf = (member) => {
    const value = Number(member?.balance || 0);
    return Number.isFinite(value) ? value : 0;
  };

  function applyRanks(members) {
    const sorted = [...members].sort((a, b) => {
      const balanceDiff = balanceOf(b) - balanceOf(a);
      if (balanceDiff !== 0) return balanceDiff;
      return String(a.nickname || "").localeCompare(String(b.nickname || ""), "ko");
    });

    let lastBalance = null;
    let lastRank = 0;
    return sorted.map((member, index) => {
      const balance = balanceOf(member);
      if (lastBalance === null || balance !== lastBalance) {
        lastRank = index + 1;
        lastBalance = balance;
      }
      return { ...member, balance, rank: lastRank };
    });
  }

  function rankLabel(rank) {
    if (rank === 1) return "🥇";
    if (rank === 2) return "🥈";
    if (rank === 3) return "🥉";
    return `#${rank}`;
  }

  function makePodiumCard(member, placeClass) {
    const card = document.createElement("article");
    card.className = `rank-podium-card ${placeClass}${member?.is_me ? " is-me" : ""}`;

    if (!member) {
      card.classList.add("empty");
      card.innerHTML = '<span class="rank-medal">-</span><strong>아직 회원이 없습니다.</strong><small>-</small>';
      return card;
    }

    const medal = document.createElement("span");
    medal.className = "rank-medal";
    medal.textContent = rankLabel(member.rank);

    const name = document.createElement("strong");
    name.textContent = member.nickname || "회원";

    const balance = document.createElement("b");
    balance.textContent = auth.formatWon(member.balance);

    const meta = document.createElement("small");
    meta.textContent = member.is_me ? "내 계정" : "SD 가상잔액";

    card.append(medal, name, balance, meta);
    return card;
  }

  function renderPodium() {
    podium.replaceChildren();
    const first = rankedMembers[0] || null;
    const second = rankedMembers[1] || null;
    const third = rankedMembers[2] || null;
    podium.append(
      makePodiumCard(second, "second"),
      makePodiumCard(first, "first"),
      makePodiumCard(third, "third")
    );
  }

  function renderSummary() {
    if (!summary) return;
    if (viewerIsAdmin) {
      summary.innerHTML = '<span>내 순위</span><strong>랭킹 제외</strong><small>관리자 계정은 잔액 랭킹에 포함되지 않습니다.</small>';
      return;
    }
    const me = rankedMembers.find((member) => member.is_me);
    if (!me) {
      summary.innerHTML = '<span>내 순위</span><strong>-</strong><small>내 계정 정보를 찾지 못했습니다.</small>';
      return;
    }
    summary.replaceChildren();
    const label = document.createElement("span");
    label.textContent = "내 순위";
    const rank = document.createElement("strong");
    rank.textContent = `${me.rank}위 / ${rankedMembers.length}명`;
    const balance = document.createElement("small");
    balance.textContent = `${me.nickname || "회원"} · ${auth.formatWon(me.balance)}`;
    summary.append(label, rank, balance);
  }

  function renderList() {
    list.replaceChildren();
    if (!rankedMembers.length) {
      const empty = document.createElement("div");
      empty.className = "rank-empty";
      empty.textContent = "표시할 회원이 없습니다.";
      list.append(empty);
      return;
    }

    rankedMembers.forEach((member) => {
      const row = document.createElement("article");
      row.className = `rank-row${member.is_me ? " is-me" : ""}${member.rank <= 3 ? ` top-${member.rank}` : ""}`;

      const rank = document.createElement("div");
      rank.className = "rank-number";
      rank.textContent = rankLabel(member.rank);

      const identity = document.createElement("div");
      identity.className = "rank-identity";
      const name = document.createElement("strong");
      name.textContent = member.nickname || "회원";
      identity.append(name);
      if (member.is_me) {
        const badge = document.createElement("span");
        badge.className = "rank-me-badge";
        badge.textContent = "내 계정";
        identity.append(badge);
      }

      const balance = document.createElement("div");
      balance.className = "rank-balance";
      balance.textContent = auth.formatWon(member.balance);

      row.append(rank, identity, balance);
      list.append(row);
    });
  }

  async function loadRanking(showNotice = true) {
    if (refresh) refresh.disabled = true;
    try {
      const session = await auth.requireSession();
      if (!session) return;

      const { data, error } = await auth.client.rpc("list_sd_member_wallets");
      if (error) throw error;

      const allMembers = data || [];
      viewerIsAdmin = allMembers.some((member) => member.is_me && member.role === "admin");
      const rankingMembers = allMembers.filter((member) => member.role !== "admin");
      rankedMembers = applyRanks(rankingMembers);
      renderPodium();
      renderSummary();
      renderList();

      if (showNotice) {
        auth.setStatus(status, `관리자를 제외한 잔액 랭킹 ${rankedMembers.length}명을 불러왔습니다.`, "success");
        window.setTimeout(() => auth.clearStatus(status), 1600);
      }
    } catch (error) {
      auth.setStatus(status, auth.messageForError(error), "error");
      list.innerHTML = '<div class="rank-empty">잔액 랭킹을 불러오지 못했습니다.</div>';
      podium.replaceChildren();
    } finally {
      if (refresh) refresh.disabled = false;
    }
  }

  refresh?.addEventListener("click", () => loadRanking(true));
  logout?.addEventListener("click", async () => {
    logout.disabled = true;
    try {
      await auth.client.auth.signOut();
      location.replace("login.html");
    } finally {
      logout.disabled = false;
    }
  });

  await loadRanking(true);
});
