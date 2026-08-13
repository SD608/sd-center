"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const auth = window.SD_AUTH;
  if (!auth) return;

  const statusBox = document.getElementById("pageStatus");
  const refreshButton = document.getElementById("refreshButton");
  const logoutButton = document.getElementById("logoutButton");
  const onlineList = document.getElementById("onlineList");
  const memberList = document.getElementById("memberList");
  const eventList = document.getElementById("eventList");
  let members = [];
  let events = [];
  let presenceState = {};

  function text(value, fallback = "-") {
    const normalized = String(value ?? "").trim();
    return normalized || fallback;
  }

  function shortDeviceKey(value) {
    const key = text(value, "");
    if (!key) return "-";
    return key.length > 14 ? `${key.slice(0, 8)}…${key.slice(-4)}` : key;
  }

  function makeElement(tag, className, content) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (content !== undefined) el.textContent = content;
    return el;
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

  function flattenPresence(state) {
    return Object.values(state || {}).flatMap((items) => Array.isArray(items) ? items : []);
  }

  function updateSummary() {
    const online = flattenPresence(presenceState);
    const uniqueOnlineUsers = new Set(online.map((item) => item.user_id).filter(Boolean));
    document.getElementById("onlineCount").textContent = `${uniqueOnlineUsers.size}명`;
    document.getElementById("memberCount").textContent = `${members.length}명`;
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const login24 = events.filter((item) => item.action === "login" && new Date(item.event_time).getTime() >= since).length;
    document.getElementById("login24Count").textContent = `${login24}회`;
    const deviceTotal = members.reduce((sum, item) => sum + Number(item.browser_device_count || 0), 0);
    document.getElementById("deviceCount").textContent = `${deviceTotal}개`;
  }

  function renderOnline() {
    const items = flattenPresence(presenceState)
      .filter((item) => item?.user_id)
      .sort((a, b) => new Date(b.online_at || 0) - new Date(a.online_at || 0));
    onlineList.replaceChildren();
    if (!items.length) {
      onlineList.append(makeElement("div", "security-empty", "현재 Presence로 확인되는 접속자가 없습니다."));
      updateSummary();
      return;
    }

    items.forEach((item) => {
      const row = makeElement("article", "security-row");
      const primary = makeElement("div", "security-primary");
      primary.append(
        makeElement("strong", "", text(item.nickname, "회원")),
        makeElement("span", "", `기기 ${shortDeviceKey(item.device_key)}`)
      );
      const device = makeElement("div", "security-meta");
      device.append(
        makeElement("span", "", `${text(item.platform)} · ${text(item.browser)}`),
        makeElement("span", "", `${text(item.timezone)} · ${text(item.locale)}`)
      );
      const page = makeElement("div", "security-meta");
      page.append(
        makeElement("span", "", `현재 ${text(item.page)}`),
        makeElement("span", "", `갱신 ${auth.formatDate(item.online_at)}`)
      );
      row.append(primary, device, page, makeElement("span", "security-pill online", "접속 중"));
      onlineList.append(row);
    });
    updateSummary();
  }

  function renderMembers() {
    memberList.replaceChildren();
    if (!members.length) {
      memberList.append(makeElement("div", "security-empty", "회원 정보가 없습니다."));
      updateSummary();
      return;
    }
    const onlineIds = new Set(flattenPresence(presenceState).map((item) => item.user_id));
    const oneDay = 24 * 60 * 60 * 1000;

    members.forEach((item) => {
      const row = makeElement("article", "security-row");
      const primary = makeElement("div", "security-primary");
      primary.append(
        makeElement("strong", "", item.nickname),
        makeElement("span", "", text(item.email))
      );
      const account = makeElement("div", "security-meta");
      account.append(
        makeElement("span", "", `${text(item.account_number)} · ${auth.formatWon(item.balance)}`),
        makeElement("span", "", `가입 ${auth.formatDate(item.joined_at)} · 초대 ${text(item.used_invite_code)}`)
      );
      const access = makeElement("div", "security-meta");
      const latestDeviceAt = item.latest_device_last_seen_at ? new Date(item.latest_device_last_seen_at).getTime() : 0;
      const latestFirstAt = item.latest_device_first_seen_at ? new Date(item.latest_device_first_seen_at).getTime() : 0;
      const isRecentNewDevice = Number(item.browser_device_count || 0) > 1 && latestFirstAt > Date.now() - oneDay;
      access.append(
        makeElement("span", "", `마지막 로그인 ${auth.formatDate(item.last_sign_in_at)}`),
        makeElement("span", "", `${text(item.latest_platform)} · ${text(item.latest_browser)} · ${text(item.latest_timezone)}`),
        makeElement("span", "", `웹/앱 기기 ${Number(item.browser_device_count || 0)} · 연결 PC ${Number(item.linked_pc_count || 0)}`)
      );
      const state = onlineIds.has(item.user_id)
        ? makeElement("span", "security-pill online", "접속 중")
        : isRecentNewDevice
          ? makeElement("span", "security-pill warn", "새 기기")
          : makeElement("span", "security-pill offline", item.member_status === "active" ? "오프라인" : "이용 정지");
      row.append(primary, account, access, state);
      memberList.append(row);
    });
    updateSummary();
  }

  const actionInfo = {
    login: ["로그인", "login"],
    logout: ["로그아웃", "logout"],
    user_signedup: ["회원가입", "signup"],
    user_repeated_signup: ["중복 가입 시도", "danger"],
    user_recovery_requested: ["비밀번호 복구 요청", "warn"],
    user_updated_password: ["비밀번호 변경", "warn"],
    factor_in_progress: ["MFA 등록 시작", "warn"],
    verification_attempted: ["MFA 인증 시도", "warn"],
    mfa_code_login: ["MFA 로그인", "login"]
  };

  function detectChangedIps(items) {
    const ordered = [...items].sort((a, b) => new Date(a.event_time) - new Date(b.event_time));
    const previous = new Map();
    const changed = new Set();
    ordered.forEach((item) => {
      if (item.action !== "login" || !item.actor_id || !item.ip_address) return;
      const prev = previous.get(item.actor_id);
      if (prev && prev !== item.ip_address) changed.add(item.event_id);
      previous.set(item.actor_id, item.ip_address);
    });
    return changed;
  }

  function renderEvents() {
    eventList.replaceChildren();
    if (!events.length) {
      eventList.append(makeElement(
        "div",
        "security-empty",
        "인증 감사 로그가 없습니다. Supabase → Authentication → Audit Logs에서 'Write audit logs to the database'를 켜면 IP와 로그인 기록을 여기서 확인할 수 있습니다."
      ));
      updateSummary();
      return;
    }

    const changedIps = detectChangedIps(events);
    events.forEach((item) => {
      const [label, type] = actionInfo[item.action] || [item.action, "offline"];
      const row = makeElement("article", "security-row");
      const primary = makeElement("div", "security-primary");
      primary.append(
        makeElement("strong", "", text(item.nickname, text(item.email, "알 수 없는 계정"))),
        makeElement("span", "", text(item.email))
      );
      const network = makeElement("div", "security-meta");
      network.append(
        makeElement("span", "", `IP ${text(item.ip_address, "기록 없음")}`),
        makeElement("span", "", `제공자 ${text(item.provider, "-")}`)
      );
      const time = makeElement("div", "security-meta");
      time.append(
        makeElement("span", "", auth.formatDate(item.event_time)),
        changedIps.has(item.event_id)
          ? makeElement("span", "", "이 계정의 직전 로그인과 다른 IP")
          : makeElement("span", "", "")
      );
      const badge = makeElement("span", `security-pill ${changedIps.has(item.event_id) ? "warn" : type}`, changedIps.has(item.event_id) ? `${label} · IP 변경` : label);
      row.append(primary, network, time, badge);
      eventList.append(row);
    });
    updateSummary();
  }

  async function loadAll() {
    auth.clearStatus(statusBox);
    refreshButton.disabled = true;
    try {
      if (!await ensureAdmin()) return;
      const [membersResult, eventsResult] = await Promise.all([
        auth.client.rpc("admin_list_sd_members"),
        auth.client.rpc("admin_list_sd_auth_events", { p_limit: 150 })
      ]);
      if (membersResult.error) throw membersResult.error;
      if (eventsResult.error) throw eventsResult.error;
      members = membersResult.data || [];
      events = eventsResult.data || [];
      renderMembers();
      renderEvents();
      renderOnline();
      auth.setStatus(statusBox, "보안 정보를 갱신했습니다.", "success");
      setTimeout(() => auth.clearStatus(statusBox), 1400);
    } catch (error) {
      auth.setStatus(statusBox, auth.messageForError(error), "error");
    } finally {
      refreshButton.disabled = false;
    }
  }

  auth.onPresenceChange((state) => {
    presenceState = state || {};
    renderOnline();
    if (members.length) renderMembers();
  });

  refreshButton.addEventListener("click", loadAll);
  logoutButton.addEventListener("click", async () => {
    await auth.client.auth.signOut();
    location.replace("login.html");
  });

  await loadAll();
});
