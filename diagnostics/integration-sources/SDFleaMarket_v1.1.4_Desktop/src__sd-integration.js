"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { inspectDatabase, getAccount, applyTransaction } = require("./wallet-db");

const SUPABASE_URL = "https://qmatphbjzafdtlyviqoa.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_H2qTl_30-7hPUYFhJ_N_QA_X71xZswO";
const S_RANK_REP = 7000;
const REQUEST_TIMEOUT_MS = 12000;

function rankFromRep(value) {
  const rep = Math.max(0, Number(value || 0));
  if (rep >= 7000) return "S";
  if (rep >= 4500) return "A";
  if (rep >= 2800) return "B";
  if (rep >= 1600) return "C";
  if (rep >= 800) return "D";
  if (rep >= 300) return "E";
  return "F";
}

function uniqueExisting(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!value) continue;
    const normalized = path.resolve(String(value));
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function sdLinkRoots(currentUserData) {
  const appData = process.env.APPDATA || "";
  const localAppData = process.env.LOCALAPPDATA || "";
  const parent = currentUserData ? path.dirname(currentUserData) : "";
  return uniqueExisting([
    process.env.SD_LINK_USER_DATA,
    appData && path.join(appData, "SD Link"),
    appData && path.join(appData, "sdlink-desktop"),
    appData && path.join(appData, "SDLink"),
    localAppData && path.join(localAppData, "SD Link"),
    parent && path.join(parent, "SD Link"),
    parent && path.join(parent, "sdlink-desktop"),
  ]);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function findSdLinkData(currentUserData) {
  for (const root of sdLinkRoots(currentUserData)) {
    const configPath = path.join(root, "sdlink", "config.json");
    const sessionPath = path.join(root, "sdlink", "online-session.dat");
    if (fs.existsSync(configPath) || fs.existsSync(sessionPath)) {
      return { root, configPath, sessionPath, config: readJson(configPath) || {} };
    }
  }
  return null;
}

function walletCandidates(currentUserData) {
  const roots = [
    process.env.APPDATA,
    process.env.LOCALAPPDATA,
    process.cwd(),
    path.dirname(process.cwd()),
    __dirname,
    path.dirname(__dirname),
    currentUserData,
    currentUserData ? path.dirname(currentUserData) : "",
    "C:\\SD시리즈\\종합",
  ].filter(Boolean);
  const suffixes = [
    ["SDWallet", "data", "sdwallet.sqlite"],
    ["SD지갑", "data", "sdwallet.sqlite"],
    ["sdwallet-desktop", "data", "sdwallet.sqlite"],
    ["apps", "SDWallet", "data", "sdwallet.sqlite"],
    ["apps", "SD지갑", "data", "sdwallet.sqlite"],
    ["data", "sdwallet.sqlite"],
    ["sdwallet.sqlite"],
  ];
  const out = [];
  for (const root of roots) {
    for (const suffix of suffixes) out.push(path.resolve(root, ...suffix));
  }
  return uniqueExisting(out);
}

function resolveWallet(currentUserData) {
  const link = findSdLinkData(currentUserData);
  const configuredPath = String(link?.config?.databasePath || "").trim();
  const selectedId = String(link?.config?.selectedAccountId || "").trim();
  const paths = uniqueExisting([configuredPath, ...walletCandidates(currentUserData)]);

  for (const filePath of paths) {
    if (!filePath || !fs.existsSync(filePath)) continue;
    try {
      const inspected = inspectDatabase(filePath);
      const selected = (selectedId && inspected.accounts.find((account) => account.id === selectedId)) || inspected.accounts[0] || null;
      if (!selected) continue;
      return {
        connected: true,
        path: inspected.path,
        selected,
        selectedAccountId: selected.id,
        source: configuredPath && path.resolve(configuredPath).toLowerCase() === inspected.path.toLowerCase() ? "sd-link" : "auto",
      };
    } catch {
      // 다음 후보를 확인합니다.
    }
  }
  return { connected: false, path: "", selected: null, selectedAccountId: "", source: "none" };
}

function readEncryptedSession(sessionPath, safeStorage) {
  if (!sessionPath || !fs.existsSync(sessionPath)) return null;
  if (!safeStorage?.isEncryptionAvailable?.()) return null;
  try {
    const encoded = fs.readFileSync(sessionPath, "utf8").trim();
    if (!encoded) return null;
    const decrypted = safeStorage.decryptString(Buffer.from(encoded, "base64"));
    const session = JSON.parse(decrypted);
    if (!session?.accessToken || !session?.refreshToken || !session?.user?.id) return null;
    return session;
  } catch {
    return null;
  }
}

function persistEncryptedSession(sessionPath, session, safeStorage) {
  if (!sessionPath || !session || !safeStorage?.isEncryptionAvailable?.()) return false;
  try {
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify(session));
    const temp = `${sessionPath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, encrypted.toString("base64"), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temp, sessionPath);
    return true;
  } catch {
    return false;
  }
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!response.ok) {
      const err = new Error(`SD 온라인 서버 요청 실패 (${response.status})`);
      err.statusCode = response.status;
      err.details = body;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function refreshSession(sessionPath, session, safeStorage) {
  const body = await fetchJson(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      apikey: SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  });
  if (!body?.access_token || !body?.refresh_token || !body?.user?.id) throw new Error("SD Link 로그인 갱신 응답이 올바르지 않습니다.");
  const next = {
    ...session,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Number(body.expires_at || 0) * 1000 || Date.now() + Number(body.expires_in || 3600) * 1000,
    user: body.user,
    email: String(session.email || body.user.email || ""),
  };
  persistEncryptedSession(sessionPath, next, safeStorage);
  return next;
}


async function onlineSession(currentUserData, safeStorage) {
  const link = findSdLinkData(currentUserData);
  if (!link) return { onlineLinked: false, link: null, session: null, userId: "" };

  let session = readEncryptedSession(link.sessionPath, safeStorage);
  if (!session) {
    return {
      onlineLinked: false,
      link,
      session: null,
      userId: String(link.config?.linkedOnlineUserId || ""),
    };
  }

  if (Number(session.expiresAt || 0) <= Date.now() + 60_000) {
    session = await refreshSession(link.sessionPath, session, safeStorage);
  }

  return {
    onlineLinked: true,
    link,
    session,
    userId: String(session.user.id),
  };
}

async function invokeAuthenticatedRpc(currentUserData, safeStorage, functionName, payload = {}) {
  const auth = await onlineSession(currentUserData, safeStorage);
  if (!auth.onlineLinked || !auth.session) {
    const error = new Error("SD Link 온라인 계정이 연결되어 있지 않습니다.");
    error.code = "SD_LINK_NOT_CONNECTED";
    throw error;
  }

  return fetchJson(`${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(functionName)}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${auth.session.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload || {}),
  });
}

async function logisticsProgress(currentUserData, safeStorage) {
  // FLEA_LOGISTICS_HQ_UNLOCK_V114
  // 현재 홈페이지 물류 등급표(F 0 / E 300 / D 800 / C 1600 / B 2800 / A 4500 / S 7000)를
  // 그대로 사용하고, S등급 도달 뒤 본부가 개설된 계정은 본부 Lv.1 이상만으로도
  // 플리마켓의 S등급 전용 지역을 계속 이용할 수 있게 합니다.
  let auth;
  try {
    auth = await onlineSession(currentUserData, safeStorage);
  } catch {
    return { onlineLinked: false, rep: 0, grade: "F", logisticsGrade: "F", headquartersLevel: 0, eligibleForSContent: false, userId: "" };
  }
  if (!auth.onlineLinked || !auth.session) {
    return { onlineLinked: false, rep: 0, grade: "F", logisticsGrade: "F", headquartersLevel: 0, eligibleForSContent: false, userId: auth.userId || "" };
  }

  const userId = auth.userId;
  let rep = 0;
  let headquartersLevel = 0;
  let snapshotResolved = false;
  let progressResolved = false;

  // 서버 스냅샷 RPC가 있으면 우선 사용합니다.
  try {
    const snapshotResponse = await invokeAuthenticatedRpc(
      currentUserData,
      safeStorage,
      "get_sd_flea_company_snapshot",
      {}
    );
    const snapshot = Array.isArray(snapshotResponse) ? snapshotResponse[0] : snapshotResponse;
    const snapshotRep = Number(snapshot?.logistics_rep ?? snapshot?.logisticsRep ?? 0);
    const snapshotHq = Number(snapshot?.headquarters_level ?? snapshot?.headquartersLevel ?? 0);
    if (Number.isFinite(snapshotRep)) rep = Math.max(rep, Math.max(0, snapshotRep));
    if (Number.isFinite(snapshotHq)) headquartersLevel = Math.max(headquartersLevel, Math.max(0, Math.trunc(snapshotHq)));
    snapshotResolved = Boolean(snapshot && (Number.isFinite(snapshotRep) || Number.isFinite(snapshotHq)));
  } catch {
    // 아래 sd_logistics_progress 직접 조회가 최종 기준입니다.
  }

  // 본부 레벨까지 반드시 읽기 위해 스냅샷 성공 여부와 관계없이 계정 진행도를 확인합니다.
  try {
    const rows = await fetchJson(`${SUPABASE_URL}/rest/v1/sd_logistics_progress?select=state&user_id=eq.${encodeURIComponent(userId)}&limit=1`, {
      headers: {
        Accept: "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${auth.session.accessToken}`,
      },
    });
    const state = Array.isArray(rows) ? rows[0]?.state : null;
    if (state && typeof state === "object") {
      const progressRep = Number(state.logisticsRep ?? state.logistics_rep ?? 0);
      const progressHq = Number(state.headquartersLevel ?? state.headquarters_level ?? 0);
      if (Number.isFinite(progressRep)) rep = Math.max(rep, Math.max(0, progressRep));
      if (Number.isFinite(progressHq)) headquartersLevel = Math.max(headquartersLevel, Math.max(0, Math.trunc(progressHq)));
      progressResolved = true;
    }
  } catch {
    // 스냅샷도 실패했다면 아래 lookupFailed로 명확히 표시합니다.
  }

  const logisticsGrade = rankFromRep(rep);
  const eligibleForSContent = rep >= S_RANK_REP || headquartersLevel >= 1;
  return {
    onlineLinked: true,
    rep,
    // 기존 main.js의 requiredCompanyGrade="S" 비교 로직과 호환되도록
    // 본부가 개설된 계정은 유효 등급을 S로 반환합니다.
    grade: eligibleForSContent ? "S" : logisticsGrade,
    logisticsGrade,
    headquartersLevel,
    eligibleForSContent,
    userId,
    snapshotResolved,
    progressResolved,
    lookupFailed: !snapshotResolved && !progressResolved,
  };
}

class SdIntegration {
  constructor({ userDataPath, safeStorage }) {
    this.userDataPath = userDataPath;
    this.safeStorage = safeStorage;
    this.company = { onlineLinked: false, rep: 0, grade: "F", logisticsGrade: "F", headquartersLevel: 0, eligibleForSContent: false, userId: "" };
    this.lastCompanyRefreshAt = 0;
  }

  walletState() {
    const wallet = resolveWallet(this.userDataPath);
    if (!wallet.connected) return { connected: false, balance: 0, account: null, source: wallet.source };
    try {
      const account = getAccount(wallet.path, wallet.selectedAccountId);
      return { connected: true, balance: Number(account.balance || 0), account, path: wallet.path, source: wallet.source };
    } catch {
      return { connected: false, balance: 0, account: null, source: "error" };
    }
  }

  adjustWallet(amount, memo) {
    const wallet = resolveWallet(this.userDataPath);
    if (!wallet.connected) throw new Error("SD지갑 가상계좌를 찾지 못했습니다. SD Link에서 지갑을 먼저 연결하세요.");
    const tx = applyTransaction(wallet.path, wallet.selectedAccountId, Number(amount), String(memo || "SD 플리마켓 가상거래"));
    return { transaction: tx, wallet: this.walletState() };
  }

  async refreshCompany(force = false) {
    if (!force && Date.now() - this.lastCompanyRefreshAt < 15000) return this.company;
    this.company = await logisticsProgress(this.userDataPath, this.safeStorage);
    this.lastCompanyRefreshAt = Date.now();
    return this.company;
  }

  async syncFleaInventory(items) {
    const payloadItems = Array.isArray(items) ? items.map((item) => ({
      local_item_id: String(item?.id || ""),
      box_id: String(item?.boxId || ""),
      name: String(item?.name || ""),
      tier: String(item?.tier || "worn"),
      original_value: Math.max(0, Math.trunc(Number(item?.originalValue || 0))),
      current_value: Math.max(0, Math.trunc(Number(item?.currentValue ?? item?.originalValue ?? 0))),
      condition_percent: Math.max(0, Math.min(100, Number(item?.conditionPercent ?? 100))),
      acquired_at: String(item?.acquiredAt || new Date().toISOString()),
      source: String(item?.source || "PC 플리마켓"),
    })) : [];

    return invokeAuthenticatedRpc(
      this.userDataPath,
      this.safeStorage,
      "sync_sd_flea_pc_inventory",
      { p_items: payloadItems }
    );
  }

  companyState() {
    return { ...this.company, requiredRep: S_RANK_REP };
  }
}

module.exports = { SdIntegration, rankFromRep, S_RANK_REP };
