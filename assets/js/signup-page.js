"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const auth = window.SD_AUTH;
  const form = document.getElementById("signupForm");
  const status = document.getElementById("formStatus");
  const submit = document.getElementById("signupButton");
  const resend = document.getElementById("resendButton");
  const emailInput = document.getElementById("email");
  const inviteInput = document.getElementById("inviteCode");
  if (!auth || !form) return;

  inviteInput?.addEventListener("input", () => {
    inviteInput.value = inviteInput.value.toUpperCase().replace(/\s+/g, "");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    auth.clearStatus(status);
    const values = Object.fromEntries(new FormData(form).entries());
    const nickname = String(values.nickname || "").trim();
    const email = String(values.email || "").trim().toLowerCase();
    const password = String(values.password || "");
    const passwordConfirm = String(values.passwordConfirm || "");
    const inviteCode = String(values.inviteCode || "").trim().toUpperCase();

    if (nickname.length < 2 || nickname.length > 20) {
      auth.setStatus(status, "닉네임은 2자 이상 20자 이하로 입력하세요.", "error");
      return;
    }
    if (password.length < 8) {
      auth.setStatus(status, "비밀번호는 8자 이상으로 입력하세요.", "error");
      return;
    }
    if (password !== passwordConfirm) {
      auth.setStatus(status, "비밀번호 확인이 일치하지 않습니다.", "error");
      return;
    }
    if (!inviteCode) {
      auth.setStatus(status, "받은 1회용 초대 코드를 입력하세요.", "error");
      return;
    }
    if (!values.consent) {
      auth.setStatus(status, "가상 서비스 안내를 확인하고 동의해 주세요.", "error");
      return;
    }

    submit.disabled = true;
    submit.textContent = "계정 생성 중…";
    try {
      const { data, error } = await auth.client.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: auth.config.callbackUrl,
          data: {
            nickname,
            invite_code: inviteCode
          }
        }
      });
      if (error) throw error;
      localStorage.setItem("sd_pending_email", email);
      resend.hidden = false;
      if (data.session) {
        auth.setStatus(status, "회원가입이 완료되었습니다. 내 지갑으로 이동합니다.", "success");
        setTimeout(() => location.assign("account.html"), 900);
      } else {
        auth.setStatus(status, "가입 요청이 완료되었습니다. 이메일함에서 SD608 인증 메일을 열고 인증 버튼을 눌러주세요.", "success");
      }
    } catch (error) {
      auth.setStatus(status, auth.messageForError(error), "error");
    } finally {
      submit.disabled = false;
      submit.textContent = "SD 계정 만들기";
    }
  });

  resend?.addEventListener("click", async () => {
    const email = String(emailInput?.value || localStorage.getItem("sd_pending_email") || "").trim();
    if (!email) {
      auth.setStatus(status, "인증메일을 받을 이메일을 입력하세요.", "error");
      return;
    }
    resend.disabled = true;
    try {
      const { error } = await auth.client.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: auth.config.callbackUrl }
      });
      if (error) throw error;
      auth.setStatus(status, "인증메일을 다시 보냈습니다. 스팸함도 확인해 주세요.", "success");
    } catch (error) {
      auth.setStatus(status, auth.messageForError(error), "error");
    } finally {
      resend.disabled = false;
    }
  });
});
