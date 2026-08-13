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

  async function routeSignedInUser() {
    const { data: profile, error: profileError } = await auth.client
      .from("profiles")
      .select("id")
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

  const existing = await auth.getSession().catch(() => null);
  if (existing) {
    try {
      await routeSignedInUser();
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
      const { error } = await auth.client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await routeSignedInUser();
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
