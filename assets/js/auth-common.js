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

  window.SD_AUTH = {
    client,
    config,
    formatWon,
    formatDate,
    messageForError,
    setStatus,
    clearStatus,
    getSession,
    requireSession
  };
})();
