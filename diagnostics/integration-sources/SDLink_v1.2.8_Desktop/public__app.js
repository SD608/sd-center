"use strict";

const $ = (id) => document.getElementById(id);
const elements = Object.fromEntries([
  "overallDot","overallState","notice","localBadge","localInfo","accountChooser",
  "loginForm","email","password","remember","loginBadge","loggedInInfo","logoutButton",
  "migrationBadge","migrationInfo","registerButton","migrationButton","syncBadge",
  "onlineBalance","lastSync","syncMessage","autoSync","syncButton","bitcoinSourceInfo",
].map((id) => [id, $(id)]));

let state = null;
let selectedInspection = null;

function won(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.trunc(number).toLocaleString("ko-KR")}원` : "-";
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("ko-KR");
}

function setNotice(message, kind = "info") {
  elements.notice.hidden = !message;
  elements.notice.textContent = message || "";
  elements.notice.className = `notice ${kind}`;
}

function badge(element, text, kind = "") {
  element.textContent = text;
  element.className = `badge ${kind}`.trim();
}

function setBusy(button, busy, text = "처리 중…") {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = text;
  } else if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
  }
  button.disabled = busy;
}

function localSelected() {
  return Boolean(state?.local?.selected && state?.config?.databasePath);
}

function authenticated() {
  return Boolean(state?.auth?.authenticated);
}

function renderAccounts(inspection) {
  elements.accountChooser.innerHTML = "";
  if (!inspection?.accounts?.length) {
    elements.accountChooser.hidden = true;
    return;
  }
  elements.accountChooser.hidden = false;
  for (const account of inspection.accounts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "account-option";
    button.innerHTML = `<span><b>${account.bankName} · ${account.accountNumber}</b><br><small>${account.ownerName} / ${account.username}</small></span><strong>${won(account.balance)}</strong>`;
    button.addEventListener("click", async () => {
      try {
        setNotice("로컬 계좌를 연결하는 중입니다.");
        state = await window.sdLink.selectWallet(inspection.path, account.id);
        selectedInspection = null;
        setNotice("로컬 SD지갑 계좌를 선택했습니다.", "success");
        render();
      } catch (error) {
        setNotice(error.message, "error");
      }
    });
    elements.accountChooser.appendChild(button);
  }
}

function render() {
  const config = state?.config || {};
  const local = state?.local;
  const selected = local?.selected;
  const auth = state?.auth || {};
  const snapshot = state?.snapshot;

  if (selected) {
    badge(elements.localBadge, "선택 완료", "ok");
    elements.localInfo.className = "info-box";
    elements.localInfo.innerHTML = `<b>${selected.bankName} ${selected.accountNumber}</b><br>${selected.ownerName} · ${selected.username}<br>현재 로컬 잔액 <b>${won(selected.balance)}</b><br><small>${config.databasePath}</small>`;
    elements.accountChooser.hidden = true;
  } else {
    badge(elements.localBadge, "미선택");
    elements.localInfo.className = "info-box muted";
    elements.localInfo.textContent = local?.error || "데이터베이스를 자동으로 찾거나 직접 선택하세요.";
  }

  if (auth.authenticated) {
    badge(elements.loginBadge, "로그인 완료", "ok");
    elements.loginForm.hidden = true;
    elements.loggedInInfo.hidden = false;
    elements.loggedInInfo.innerHTML = `<b>${auth.user.email}</b><br><small>온라인 사용자 ID: ${auth.user.id}</small>`;
    elements.logoutButton.hidden = false;
  } else {
    badge(elements.loginBadge, "로그아웃");
    elements.loginForm.hidden = false;
    elements.loggedInInfo.hidden = true;
    elements.logoutButton.hidden = true;
  }

  const migrationStatus = String(snapshot?.migration_status || config.migrationStatus || "");
  if (migrationStatus === "completed") {
    badge(elements.migrationBadge, "이전 완료", "ok");
    elements.migrationInfo.className = "info-box";
    elements.migrationInfo.innerHTML = `기존 잔액 이전이 승인되었습니다.<br>온라인 계좌 <b>${snapshot?.account_number || "-"}</b> · ${won(snapshot?.wallet_balance)}`;
  } else if (migrationStatus === "pending") {
    badge(elements.migrationBadge, "승인 대기", "warn");
    elements.migrationInfo.className = "info-box";
    elements.migrationInfo.textContent = "관리자 승인 대기 중입니다. 승인되면 자동 동기화가 시작됩니다.";
  } else if (migrationStatus === "rejected") {
    badge(elements.migrationBadge, "거절", "error");
    elements.migrationInfo.className = "info-box";
    elements.migrationInfo.textContent = "잔액 이전 신청이 거절되었습니다. 홈페이지 관리자에게 확인하세요.";
  } else if (localSelected() && authenticated()) {
    badge(elements.migrationBadge, "등록 가능", "warn");
    elements.migrationInfo.className = "info-box";
    elements.migrationInfo.innerHTML = `로컬 잔액 <b>${won(selected.balance)}</b>을 홈페이지 계정으로 1회 이전할 수 있습니다.`;
  } else {
    badge(elements.migrationBadge, "대기");
    elements.migrationInfo.className = "info-box muted";
    elements.migrationInfo.textContent = "로컬 지갑 선택과 홈페이지 로그인을 먼저 완료하세요.";
  }

  elements.registerButton.disabled = !(localSelected() && authenticated());
  elements.migrationButton.disabled = !(localSelected() && authenticated()) || migrationStatus === "completed" || migrationStatus === "pending";
  elements.syncButton.disabled = !(localSelected() && authenticated());
  elements.autoSync.checked = Boolean(config.autoSync);
  elements.onlineBalance.textContent = won(snapshot?.wallet_balance);
  elements.lastSync.textContent = formatDate(config.lastSyncAt);
  elements.syncMessage.textContent = config.lastSyncMessage || "-";
  if (elements.bitcoinSourceInfo) {
    if (config.bitcoinSourcePath) {
      const btcText = Number(config.lastBitcoinQuantity ?? 0).toLocaleString("ko-KR", { maximumFractionDigits: 8 });
      elements.bitcoinSourceInfo.className = "info-box";
      elements.bitcoinSourceInfo.innerHTML = `BTC 원본 <b>${config.bitcoinSourcePath}</b><br>최근 감지 수량 <b>${btcText} BTC</b>`;
    } else {
      elements.bitcoinSourceInfo.className = "info-box muted";
      elements.bitcoinSourceInfo.textContent = "선택한 SD지갑 계좌의 실제 판매 가능 BTC를 자동으로 읽습니다.";
    }
  }

  if (config.activated && migrationStatus === "completed") {
    badge(elements.syncBadge, "동기화 중", "ok");
    elements.overallDot.className = "dot ok";
    elements.overallState.textContent = "PC·홈페이지·모바일 연결됨";
  } else if (migrationStatus === "pending") {
    badge(elements.syncBadge, "승인 대기", "warn");
    elements.overallDot.className = "dot warn";
    elements.overallState.textContent = "잔액 이전 승인 대기";
  } else if (localSelected() && authenticated()) {
    badge(elements.syncBadge, "설정 중", "warn");
    elements.overallDot.className = "dot warn";
    elements.overallState.textContent = "연결 설정 필요";
  } else {
    badge(elements.syncBadge, "정지");
    elements.overallDot.className = "dot";
    elements.overallState.textContent = "연결되지 않음";
  }
}

let refreshInFlight = false;
let refreshQueued = false;
let lastSnapshotRefreshAt = 0;

async function refresh(includeSnapshot = true) {
  if (refreshInFlight) {
    refreshQueued = refreshQueued || Boolean(includeSnapshot);
    return;
  }
  refreshInFlight = true;
  try {
    state = await window.sdLink.getState(includeSnapshot);
    if (includeSnapshot) lastSnapshotRefreshAt = Date.now();
    render();
  } catch (error) {
    setNotice(error.message, "error");
  } finally {
    refreshInFlight = false;
    if (refreshQueued) {
      const queuedSnapshot = refreshQueued;
      refreshQueued = false;
      setTimeout(() => refresh(Boolean(queuedSnapshot)), 150);
    }
  }
}

$("autoDetectButton").addEventListener("click", async () => {
  setBusy($("autoDetectButton"), true, "찾는 중…");
  try {
    const matches = await window.sdLink.autoDetect();
    if (!matches.length) {
      setNotice("자동으로 찾지 못했습니다. ‘직접 선택’으로 sdwallet.sqlite를 지정하세요.", "warning");
      return;
    }
    selectedInspection = matches[0];
    renderAccounts(selectedInspection);
    setNotice(`${matches.length}개의 SD지갑 데이터베이스를 찾았습니다. 사용할 계좌를 선택하세요.`, "success");
  } catch (error) {
    setNotice(error.message, "error");
  } finally {
    setBusy($("autoDetectButton"), false);
  }
});

$("chooseBitcoinButton")?.addEventListener("click", async () => {
  try {
    const result = await window.sdLink.chooseBitcoinSource();
    if (!result) return;
    setNotice(`BTC 원본을 연결했습니다. 감지 수량 ${Number(result.quantity).toLocaleString("ko-KR", { maximumFractionDigits: 8 })} BTC`, "success");
    await refresh(false);
  } catch (error) {
    setNotice(error.message, "error");
  }
});

$("chooseDbButton").addEventListener("click", async () => {
  try {
    const inspection = await window.sdLink.chooseDatabase();
    if (!inspection) return;
    selectedInspection = inspection;
    renderAccounts(inspection);
    setNotice("데이터베이스를 확인했습니다. 사용할 계좌를 선택하세요.", "success");
  } catch (error) {
    setNotice(error.message, "error");
  }
});

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = elements.loginForm.querySelector("button[type=submit]");
  setBusy(button, true, "로그인 중…");
  try {
    state = await window.sdLink.login(elements.email.value, elements.password.value, elements.remember.checked);
    elements.password.value = "";
    setNotice("홈페이지 계정에 로그인했습니다.", "success");
    render();
  } catch (error) {
    setNotice(error.message, "error");
  } finally {
    setBusy(button, false);
  }
});

elements.logoutButton.addEventListener("click", async () => {
  state = await window.sdLink.logout();
  setNotice("로그아웃했습니다.");
  render();
});

elements.registerButton.addEventListener("click", async () => {
  setBusy(elements.registerButton, true, "등록 중…");
  try {
    await window.sdLink.registerDevice();
    setNotice("이 PC를 홈페이지 계정에 등록했습니다.", "success");
    await refresh(true);
  } catch (error) {
    setNotice(error.message, "error");
  } finally {
    setBusy(elements.registerButton, false);
  }
});

elements.migrationButton.addEventListener("click", async () => {
  setBusy(elements.migrationButton, true, "신청 중…");
  try {
    const result = await window.sdLink.requestMigration();
    setNotice(result.response?.message || "잔액 이전을 신청했습니다.", "success");
    await refresh(true);
  } catch (error) {
    setNotice(error.message, "error");
  } finally {
    setBusy(elements.migrationButton, false);
  }
});

elements.syncButton.addEventListener("click", async () => {
  setBusy(elements.syncButton, true, "동기화 중…");
  try {
    const result = await window.sdLink.sync();
    setNotice(result.message || result.config?.lastSyncMessage || "동기화를 완료했습니다.", result.waiting ? "warning" : "success");
    await refresh(true);
  } catch (error) {
    setNotice(error.message, "error");
  } finally {
    setBusy(elements.syncButton, false);
  }
});

elements.autoSync.addEventListener("change", async () => {
  state = await window.sdLink.setAutoSync(elements.autoSync.checked);
  render();
});

$("websiteButton").addEventListener("click", () => window.sdLink.openWebsite());
$("accountButton").addEventListener("click", () => window.sdLink.openAccount());
$("mobileButton").addEventListener("click", () => window.sdLink.openMobileDownload());
$("resetButton").addEventListener("click", async () => {
  const result = await window.sdLink.reset();
  if (result?.canceled) return;
  state = result;
  setNotice("이 PC의 SD Link 연결 설정을 초기화했습니다.", "success");
  render();
});

window.sdLink.onStatus((payload) => {
  setNotice(payload.message, payload.kind || "info");
  // 동기화 시작/완료 상태가 올 때마다 서버 snapshot을 다시 요청하면
  // 자동 동기화와 UI 새로고침이 겹쳐 창이 멎는 현상이 생길 수 있습니다.
  // 상태 이벤트에서는 로컬 상태만 가볍게 갱신합니다.
  refresh(false);
});

refresh(true);
setInterval(() => {
  // 온라인 잔액 snapshot은 30초에 한 번만 확인합니다.
  const needSnapshot = Date.now() - lastSnapshotRefreshAt >= 30_000;
  refresh(needSnapshot);
}, 15_000);
