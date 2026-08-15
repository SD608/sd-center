"use strict";

(function initializeSDAuth() {
  const config = window.SD_SUPABASE_CONFIG;
  if (!config || !config.url || !config.publishableKey) {
    console.error("SD Supabase 공개 연결 정보가 없습니다.");
    return;
  }
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error("Supabase 브라우저 라이브러리를 불러오지 못했습니다.");
    return;
  }

  const client = window.supabase.createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });

  const formatWon = (value) => `${Number(value || 0).toLocaleString("ko-KR")}원`;
  const formatDate = (value) => {
    if (!value) return "-";
    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit"
    }).format(new Date(value));
  };
  const messageForError = (error) => {
    const raw = String(error?.message || error || "알 수 없는 오류");
    const lower = raw.toLowerCase();
    if (lower.includes("invalid login credentials")) return "이메일 또는 비밀번호가 맞지 않습니다.";
    if (lower.includes("email not confirmed")) return "이메일 인증이 아직 끝나지 않았습니다. 받은 메일의 인증 버튼을 눌러주세요.";
    if (lower.includes("user already registered")) return "이미 가입된 이메일입니다.";
    if (lower.includes("password") && lower.includes("characters")) return "비밀번호는 8자 이상으로 입력하세요.";
    if (lower.includes("database error") || lower.includes("saving new user")) return "가입 정보를 저장하지 못했습니다. 초대 코드와 닉네임을 확인하세요.";
    if (lower.includes("rate limit")) return "요청이 너무 많습니다. 잠시 뒤 다시 시도하세요.";
    if (lower.includes("failed to fetch") || lower.includes("network")) return "서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.";
    return raw;
  };
  const setStatus = (element, message, type = "info") => {
    if (!element) return;
    element.textContent = message;
    element.className = `form-status ${type}`;
    element.hidden = false;
  };
  const clearStatus = (element) => {
    if (!element) return;
    element.hidden = true;
    element.textContent = "";
  };
  const getSession = async () => {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data.session;
  };
  const requireSession = async () => {
    const session = await getSession();
    if (!session) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.replace(`login.html?next=${next}`);
      return null;
    }
    return session;
  };

  // ---------------------------------------------------------------------------
  // 보안용 접속 상태
  // - GPS/정밀 위치는 요청하지 않습니다.
  // - 브라우저별 무작위 device_key, 플랫폼, 브라우저, 시간대, 현재 페이지만 기록합니다.
  // - 실시간 Presence의 전체 목록은 관리자만 읽을 수 있도록 DB RLS로 제한합니다.
  // ---------------------------------------------------------------------------
  const presenceListeners = new Set();
  let presenceChannel = null;
  let presenceUserId = null;
  let heartbeatTimer = null;
  let latestPresencePayload = null;

  const randomUuid = () => {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
      const r = Math.floor(Math.random() * 16);
      const v = ch === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  const getSecurityDeviceKey = () => {
    const storageKey = "sd_security_device_key_v1";
    try {
      let value = localStorage.getItem(storageKey);
      if (!value) {
        value = randomUuid();
        localStorage.setItem(storageKey, value);
      }
      return value;
    } catch {
      return `temp-${randomUuid()}`;
    }
  };

  const detectPlatform = () => {
    const ua = navigator.userAgent || "";
    if (/SD608Android/i.test(ua)) return "Android 앱";
    if (/Android/i.test(ua)) return "Android 웹";
    if (/iPhone/i.test(ua)) return "iPhone 웹";
    if (/iPad/i.test(ua)) return "iPad 웹";
    if (/Windows/i.test(ua)) return "Windows 웹";
    if (/Macintosh|Mac OS X/i.test(ua)) return "macOS 웹";
    if (/Linux/i.test(ua)) return "Linux 웹";
    return "웹";
  };

  const detectBrowser = () => {
    const ua = navigator.userAgent || "";
    if (/SamsungBrowser/i.test(ua)) return "Samsung Internet";
    if (/Edg\//i.test(ua)) return "Microsoft Edge";
    if (/CriOS|Chrome\//i.test(ua)) return "Chrome";
    if (/FxiOS|Firefox\//i.test(ua)) return "Firefox";
    if (/Safari\//i.test(ua) && !/Chrome|CriOS|Edg\//i.test(ua)) return "Safari";
    return "기타 브라우저";
  };

  const currentPageLabel = () => {
    const file = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    const labels = {
      "index.html": "홈페이지",
      "account.html": "내 지갑",
      "ranking.html": "잔액 랭킹",
      "mobile.html": "모바일 센터",
      "wallet-mobile.html": "모바일 지갑",
      "vault-mobile.html": "SD금고",
      "npc-vault-mobile.html": "NPC 금고 따기",
      "odd-even-mobile.html": "홀짝",
      "slot-mobile.html": "슬롯",
      "sdcoin-mobile.html": "SD코인",
      "bitcoin-mobile.html": "비트코인 조회",
      "device-link.html": "PC 연결 관리",
      "admin-invites.html": "초대코드 관리",
      "admin-migrations.html": "이전 승인 관리",
      "admin-security.html": "보안·회원 관리"
    };
    return labels[file] || file;
  };

  const timezone = () => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "-"; }
    catch { return "-"; }
  };

  const makePresencePayload = (session, nickname) => ({
    user_id: session.user.id,
    nickname: nickname || "회원",
    device_key: getSecurityDeviceKey(),
    platform: detectPlatform(),
    browser: detectBrowser(),
    timezone: timezone(),
    locale: navigator.language || "-",
    page: currentPageLabel(),
    online_at: new Date().toISOString()
  });

  const emitPresence = () => {
    const state = presenceChannel?.presenceState?.() || {};
    presenceListeners.forEach((listener) => {
      try { listener(state); } catch (error) { console.warn("Presence listener error", error); }
    });
    window.dispatchEvent(new CustomEvent("sd:presence-sync", { detail: state }));
  };

  const recordHeartbeat = async (payload) => {
    if (!payload) return;
    try {
      const { error } = await client.rpc("record_sd_access_heartbeat", {
        p_device_key: payload.device_key,
        p_platform: payload.platform,
        p_browser_label: payload.browser,
        p_timezone: payload.timezone,
        p_locale: payload.locale,
        p_page: payload.page
      });
      if (error) throw error;
    } catch (error) {
      // 보안 SQL을 아직 설치하지 않은 상태에서도 기존 기능이 망가지지 않도록 경고만 남깁니다.
      console.warn("접속 보안 기록 실패", error?.message || error);
    }
  };

  const stopPresence = async () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (presenceChannel) {
      try { await presenceChannel.untrack(); } catch {}
      try { await client.removeChannel(presenceChannel); } catch {}
    }
    presenceChannel = null;
    presenceUserId = null;
    latestPresencePayload = null;
    emitPresence();
  };

  const startPresence = async (session) => {
    if (!session?.user?.id) {
      await stopPresence();
      return;
    }
    if (presenceChannel && presenceUserId === session.user.id) return;
    await stopPresence();

    try {
      const { data: profile, error: profileError } = await client
        .from("profiles")
        .select("nickname,status")
        .eq("id", session.user.id)
        .single();
      if (profileError) throw profileError;
      if (profile?.status !== "active") return;

      latestPresencePayload = makePresencePayload(session, profile?.nickname);
      await recordHeartbeat(latestPresencePayload);
      try { await client.realtime.setAuth(session.access_token); } catch {}

      const channel = client.channel("sd-security-online", {
        config: {
          private: true,
          presence: { key: session.user.id }
        }
      });

      channel
        .on("presence", { event: "sync" }, emitPresence)
        .on("presence", { event: "join" }, emitPresence)
        .on("presence", { event: "leave" }, emitPresence)
        .subscribe(async (status, error) => {
          if (status === "SUBSCRIBED") {
            try { await channel.track(latestPresencePayload); } catch (trackError) {
              console.warn("Presence track 실패", trackError);
            }
            emitPresence();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn("Presence 연결 실패", error || status);
          }
        });

      presenceChannel = channel;
      presenceUserId = session.user.id;
      heartbeatTimer = setInterval(async () => {
        if (!latestPresencePayload) return;
        latestPresencePayload = {
          ...latestPresencePayload,
          page: currentPageLabel(),
          online_at: new Date().toISOString()
        };
        await recordHeartbeat(latestPresencePayload);
        try { await presenceChannel?.track(latestPresencePayload); } catch {}
      }, 4 * 60 * 1000);
    } catch (error) {
      console.warn("접속 상태 시작 실패", error?.message || error);
    }
  };

  const onPresenceChange = (listener) => {
    if (typeof listener !== "function") return () => {};
    presenceListeners.add(listener);
    try { listener(presenceChannel?.presenceState?.() || {}); } catch {}
    return () => presenceListeners.delete(listener);
  };

  window.SD_AUTH = {
    client,
    config,
    formatWon,
    formatDate,
    messageForError,
    setStatus,
    clearStatus,
    getSession,
    requireSession,
    onPresenceChange,
    getPresenceState: () => presenceChannel?.presenceState?.() || {},
    security: {
      getDeviceKey: getSecurityDeviceKey,
      detectPlatform,
      detectBrowser,
      timezone,
      currentPageLabel
    }
  };

  // 초기 세션 + 이후 로그인/로그아웃을 자동 추적합니다.
  getSession().then((session) => startPresence(session)).catch((error) => {
    console.warn("초기 접속 상태 확인 실패", error);
  });

  client.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => {
      void startPresence(session);
    }, 0);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !latestPresencePayload) return;
    latestPresencePayload = {
      ...latestPresencePayload,
      page: currentPageLabel(),
      online_at: new Date().toISOString()
    };
    void recordHeartbeat(latestPresencePayload);
    void presenceChannel?.track(latestPresencePayload).catch(() => {});
  });
})();
