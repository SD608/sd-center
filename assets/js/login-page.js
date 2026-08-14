"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const auth = window.SD_AUTH;
  const form = document.getElementById("loginForm");
  const status = document.getElementById("formStatus");
  const button = document.getElementById("loginButton");
  const resend = document.getElementById("resendButton");
  const emailInput = document.getElementById("email");
  if (!auth || !form) return;

  const next = new URLSearchParams(location.search).get("next");
  const safeNext = next && next.startsWith("/") ? next : "account.html";

  const isJwtError = (error) => {
    const text = String(error?.message || error || "").toLowerCase();
    return text.includes("jwt")
      || text.includes("token has expired")
      || text.includes("token expired")
      || text.includes("invalid token")
      || text.includes("invalid claim")
      || text.includes("bad_jwt");
  };

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function currentSession(sessionHint = null) {
    if (sessionHint?.access_token && sessionHint?.user?.id) return sessionHint;
    const { data, error } = await auth.client.auth.getSession();
    if (error) throw error;
    return data?.session || null;
  }

  async function refreshSessionForJwt() {
    const { data, error } = await auth.client.auth.refreshSession();
    if (error) throw error;
    if (!data?.session?.access_token || !data?.session?.user?.id) {
      throw new Error("로그인 세션을 갱신하지 못했습니다. 다시 로그인해 주세요.");
    }
    // Android WebView에서 새 세션의 localStorage 반영 직후 REST 요청이 너무 빨리
    // 나가면 이전 JWT가 한 번 사용되는 경우가 있어 아주 짧게 기다린다.
    await delay(120);
    return data.session;
  }

  async function routeOnce(session) {
    if (!session?.user?.id) throw new Error("로그인 세션을 확인하지 못했습니다.");

    const { data: profile, error: profileError } = await auth.client
      .from("profiles")
      .select("id")
      .eq("id", session.user.id)
      .maybeSingle();
    if (profileError) throw profileError;

    if (profile) {
      location.replace(safeNext);
      return;
    }

    const { data: pending, error: pendingError } = await auth.client
      .from("signup_pending")
      .select("email,desired_nickname,finalized_at")
      .maybeSingle();
    if (pendingError) throw pendingError;

    if (pending && !pending.finalized_at) {
      localStorage.setItem("sd_signup_v2_email", pending.email || "");
      localStorage.setItem("sd_signup_v2_nickname", pending.desired_nickname || "");
      localStorage.setItem("sd_signup_v2_stage", "4");
      location.replace("signup.html?resume=1");
      return;
    }

    await auth.client.auth.signOut().catch(() => {});
    throw new Error("SD 회원 데이터가 없는 계정입니다. 회원가입을 다시 진행해 주세요.");
  }

  async function routeSignedInUser(sessionHint = null) {
    let session = await currentSession(sessionHint);
    if (!session) return false;

    try {
      await routeOnce(session);
      return true;
    } catch (error) {
      if (!isJwtError(error)) throw error;

      // 로그인은 성공했지만 모바일 WebView가 직전 JWT를 사용한 경우,
      // refresh token으로 새 access token을 받은 뒤 딱 한 번 재시도한다.
      session = await refreshSessionForJwt();
      await routeOnce(session);
      return true;
    }
  }

  const existing = await auth.getSession().catch(() => null);
  if (existing) {
    try {
      await routeSignedInUser(existing);
      return;
    } catch (error) {
      auth.setStatus(status, auth.messageForError(error), "error");
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    auth.clearStatus(status);
    const values = Object.fromEntries(new FormData(form).entries());
    const email = String(values.email || "").trim().toLowerCase();
    const password = String(values.password || "");
    button.disabled = true;
    button.textContent = "로그인 중…";
    try {
      const { data, error } = await auth.client.auth.signInWithPassword({ email, password });
      if (error) throw error;

      // signInWithPassword가 방금 발급한 세션을 그대로 사용한다.
      // getSession/localStorage를 다시 읽는 타이밍 경쟁을 피하기 위한 핵심 수정.
      await routeSignedInUser(data?.session || null);
    } catch (error) {
      const message = auth.messageForError(error);
      auth.setStatus(status, message, "error");
      if (message.includes("이메일 인증")) {
        localStorage.setItem("sd_pending_email", email);
        localStorage.setItem("sd_signup_v2_email", email);
        localStorage.setItem("sd_signup_v2_stage", "3");
        resend.hidden = false;
      }
    } finally {
      button.disabled = false;
      button.textContent = "로그인";
    }
  });

  resend?.addEventListener("click", async () => {
    const email = String(emailInput?.value || localStorage.getItem("sd_pending_email") || "").trim();
    if (!email) return auth.setStatus(status, "이메일을 입력하세요.", "error");
    resend.disabled = true;
    try {
      const { error } = await auth.client.auth.resend({ type: "signup", email });
      if (error) throw error;
      auth.setStatus(status, "이메일 인증번호를 다시 보냈습니다. 회원가입 페이지에서 인증을 계속하세요.", "success");
    } catch (error) {
      auth.setStatus(status, auth.messageForError(error), "error");
    } finally {
      resend.disabled = false;
    }
  });
});
