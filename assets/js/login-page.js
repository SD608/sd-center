"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const auth = window.SD_AUTH;
  const form = document.getElementById("loginForm");
  const status = document.getElementById("formStatus");
  const button = document.getElementById("loginButton");
  const resend = document.getElementById("resendButton");
  const emailInput = document.getElementById("email");
  if (!auth || !form) return;

  const existing = await auth.getSession().catch(() => null);
  if (existing) location.replace("account.html");

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
      const next = new URLSearchParams(location.search).get("next");
      location.replace(next && next.startsWith("/") ? next : "account.html");
    } catch (error) {
      const message = auth.messageForError(error);
      auth.setStatus(status, message, "error");
      if (message.includes("이메일 인증")) {
        localStorage.setItem("sd_pending_email", email);
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
      const { error } = await auth.client.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: auth.config.callbackUrl }
      });
      if (error) throw error;
      auth.setStatus(status, "인증메일을 다시 보냈습니다.", "success");
    } catch (error) {
      auth.setStatus(status, auth.messageForError(error), "error");
    } finally {
      resend.disabled = false;
    }
  });
});
