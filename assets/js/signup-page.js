"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const auth = window.SD_AUTH;
  if (!auth) return;

  const status = document.getElementById("formStatus");
  const progress = [...document.querySelectorAll("#signupProgress span")];
  const steps = [...document.querySelectorAll(".signup-step[data-step]")];

  const accountForm = document.getElementById("accountStepForm");
  const emailForm = document.getElementById("emailStepForm");
  const verifyForm = document.getElementById("verifyStepForm");
  const joinForm = document.getElementById("joinStepForm");

  const nicknameInput = document.getElementById("nickname");
  const passwordInput = document.getElementById("password");
  const passwordConfirmInput = document.getElementById("passwordConfirm");
  const consentInput = document.getElementById("consent");
  const emailInput = document.getElementById("email");
  const verifyCodeInput = document.getElementById("verifyCode");
  const joinCodeInput = document.getElementById("joinCode");
  const verifyEmailView = document.getElementById("verifyEmailView");
  const joinEmailView = document.getElementById("joinEmailView");
  const completeSummary = document.getElementById("completeSummary");

  const sendVerifyButton = document.getElementById("sendVerifyButton");
  const verifyEmailButton = document.getElementById("verifyEmailButton");
  const finishSignupButton = document.getElementById("finishSignupButton");
  const resendVerifyButton = document.getElementById("resendVerifyButton");
  const resendJoinButton = document.getElementById("resendJoinButton");

  const STORAGE_EMAIL = "sd_signup_v2_email";
  const STORAGE_NICK = "sd_signup_v2_nickname";
  const STORAGE_STAGE = "sd_signup_v2_stage";

  const state = {
    nickname: "",
    password: "",
    email: ""
  };

  function onlyDigits(input) {
    if (!input) return;
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D+/g, "");
    });
  }
  onlyDigits(verifyCodeInput);
  onlyDigits(joinCodeInput);

  function setBusy(button, busy, busyText, normalText) {
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? busyText : normalText;
  }

  function saveProgress(stage) {
    if (state.email) localStorage.setItem(STORAGE_EMAIL, state.email);
    if (state.nickname) localStorage.setItem(STORAGE_NICK, state.nickname);
    localStorage.setItem(STORAGE_STAGE, String(stage));
  }

  function clearProgress() {
    localStorage.removeItem(STORAGE_EMAIL);
    localStorage.removeItem(STORAGE_NICK);
    localStorage.removeItem(STORAGE_STAGE);
    localStorage.removeItem("sd_pending_email");
  }

  function showStep(step) {
    auth.clearStatus(status);
    steps.forEach((section) => {
      section.hidden = Number(section.dataset.step) !== step;
    });
    progress.forEach((bar, index) => {
      bar.classList.toggle("active", index < Math.min(step, 4));
    });
    if (state.email) {
      if (verifyEmailView) verifyEmailView.textContent = state.email;
      if (joinEmailView) joinEmailView.textContent = state.email;
    }
    if (step <= 4) saveProgress(step);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function getOwnProfile() {
    const { data, error } = await auth.client
      .from("profiles")
      .select("id,nickname")
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function getPending() {
    const { data, error } = await auth.client
      .from("signup_pending")
      .select("email,desired_nickname,email_verified_at,second_code_sent_at,finalized_at")
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function sendSecondCode() {
    if (!state.email) throw new Error("회원가입 이메일 정보가 없습니다.");

    const { error: beginError } = await auth.client.rpc("begin_sd_signup_code_phase");
    if (beginError) throw beginError;

    const { error: otpError } = await auth.client.auth.signInWithOtp({
      email: state.email,
      options: { shouldCreateUser: false }
    });
    if (otpError) throw otpError;

    saveProgress(4);
    showStep(4);
    auth.setStatus(status, "이메일 인증이 완료되었습니다. 새로 도착한 1회용 가입 코드를 입력하세요.", "success");
  }

  async function resumeIfPossible() {
    const session = await auth.getSession().catch(() => null);
    if (session) {
      const profile = await getOwnProfile().catch(() => null);
      if (profile) {
        location.replace("account.html");
        return true;
      }

      const pending = await getPending().catch(() => null);
      if (pending) {
        state.email = String(pending.email || session.user?.email || "").toLowerCase();
        state.nickname = String(pending.desired_nickname || "");
        if (nicknameInput) nicknameInput.value = state.nickname;
        if (emailInput) emailInput.value = state.email;

        if (session.user?.email_confirmed_at || pending.email_verified_at) {
          showStep(4);
          auth.setStatus(status, "완료되지 않은 회원가입을 이어서 진행합니다. 가입 코드를 다시 받아 입력하세요.", "info");
        } else {
          showStep(3);
        }
        return true;
      }
    }

    const pendingEmail = String(localStorage.getItem(STORAGE_EMAIL) || "").trim().toLowerCase();
    const pendingNick = String(localStorage.getItem(STORAGE_NICK) || "").trim();
    const pendingStage = Number(localStorage.getItem(STORAGE_STAGE) || 0);
    if (pendingEmail && pendingStage >= 3) {
      state.email = pendingEmail;
      state.nickname = pendingNick;
      if (emailInput) emailInput.value = pendingEmail;
      if (nicknameInput) nicknameInput.value = pendingNick;
      showStep(3);
      auth.setStatus(status, "이전에 요청한 이메일 인증을 이어서 진행합니다.", "info");
      return true;
    }
    return false;
  }

  accountForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    auth.clearStatus(status);
    const nickname = String(nicknameInput?.value || "").trim();
    const password = String(passwordInput?.value || "");
    const confirm = String(passwordConfirmInput?.value || "");

    if (nickname.length < 2 || nickname.length > 20) {
      return auth.setStatus(status, "닉네임은 2자 이상 20자 이하로 입력하세요.", "error");
    }
    if (password.length < 8) {
      return auth.setStatus(status, "비밀번호는 8자 이상으로 입력하세요.", "error");
    }
    if (password !== confirm) {
      return auth.setStatus(status, "비밀번호 확인이 일치하지 않습니다.", "error");
    }
    if (!consentInput?.checked) {
      return auth.setStatus(status, "가상 서비스 안내를 확인하고 동의해 주세요.", "error");
    }

    state.nickname = nickname;
    state.password = password;
    if (emailInput && state.email) emailInput.value = state.email;
    showStep(2);
  });

  document.getElementById("backToAccount")?.addEventListener("click", () => showStep(1));

  emailForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    auth.clearStatus(status);
    const email = String(emailInput?.value || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return auth.setStatus(status, "사용할 이메일을 정확히 입력하세요.", "error");
    }
    if (!state.password || !state.nickname) {
      auth.setStatus(status, "계정 정보를 다시 입력해 주세요.", "error");
      showStep(1);
      return;
    }

    setBusy(sendVerifyButton, true, "전송 중…", "인증번호 보내기");
    try {
      const { data, error } = await auth.client.auth.signUp({
        email,
        password: state.password,
        options: {
          data: {
            nickname: state.nickname,
            signup_flow: "email_double_otp_v1"
          }
        }
      });
      if (error) throw error;

      if (data.session) {
        await auth.client.auth.signOut().catch(() => {});
        throw new Error("Supabase의 이메일 확인 기능이 꺼져 있습니다. Authentication의 Confirm email을 켜고 다시 시도하세요.");
      }

      state.email = email;
      state.password = "";
      if (passwordInput) passwordInput.value = "";
      if (passwordConfirmInput) passwordConfirmInput.value = "";
      localStorage.setItem("sd_pending_email", email);
      saveProgress(3);
      showStep(3);
      auth.setStatus(status, "이메일로 인증번호를 보냈습니다. 메일의 번호를 입력하세요.", "success");
    } catch (error) {
      auth.setStatus(status, auth.messageForError(error), "error");
    } finally {
      setBusy(sendVerifyButton, false, "전송 중…", "인증번호 보내기");
    }
  });

  verifyForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    auth.clearStatus(status);
    const token = String(verifyCodeInput?.value || "").replace(/\D+/g, "");
    if (token.length < 6) {
      return auth.setStatus(status, "이메일에 표시된 인증번호를 입력하세요.", "error");
    }

    setBusy(verifyEmailButton, true, "확인 중…", "이메일 인증하기");
    try {
      const { data, error } = await auth.client.auth.verifyOtp({
        email: state.email,
        token,
        type: "signup"
      });
      if (error) throw error;
      if (!data.session) throw new Error("이메일 인증 세션을 만들지 못했습니다.");
      if (verifyCodeInput) verifyCodeInput.value = "";
      await sendSecondCode();
    } catch (error) {
      auth.setStatus(status, auth.messageForError(error), "error");
    } finally {
      setBusy(verifyEmailButton, false, "확인 중…", "이메일 인증하기");
    }
  });

  resendVerifyButton?.addEventListener("click", async () => {
    auth.clearStatus(status);
    if (!state.email) return auth.setStatus(status, "인증할 이메일 정보가 없습니다.", "error");
    setBusy(resendVerifyButton, true, "전송 중…", "인증번호 다시 보내기");
    try {
      const { error } = await auth.client.auth.resend({ type: "signup", email: state.email });
      if (error) throw error;
      auth.setStatus(status, "이메일 인증번호를 다시 보냈습니다. 새로 온 번호를 사용하세요.", "success");
    } catch (error) {
      auth.setStatus(status, auth.messageForError(error), "error");
    } finally {
      setBusy(resendVerifyButton, false, "전송 중…", "인증번호 다시 보내기");
    }
  });

  joinForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    auth.clearStatus(status);
    const token = String(joinCodeInput?.value || "").replace(/\D+/g, "");
    if (token.length < 6) {
      return auth.setStatus(status, "이메일로 새로 받은 1회용 가입 코드를 입력하세요.", "error");
    }

    setBusy(finishSignupButton, true, "가입 처리 중…", "회원가입 완료");
    try {
      const { data: otpData, error: otpError } = await auth.client.auth.verifyOtp({
        email: state.email,
        token,
        type: "email"
      });
      if (otpError) throw otpError;
      if (!otpData.session) throw new Error("가입 코드 인증 세션을 만들지 못했습니다.");

      const { data, error } = await auth.client.rpc("finalize_sd_email_signup");
      if (error) throw error;

      clearProgress();
      if (joinCodeInput) joinCodeInput.value = "";
      if (completeSummary) {
        completeSummary.textContent = `${data?.nickname || state.nickname || "회원"} · ${data?.account_number || "가상계좌 생성 완료"} · 시작 가상잔액 ${Number(data?.balance || 250000).toLocaleString("ko-KR")}원`;
      }
      showStep(5);
      auth.setStatus(status, "회원가입이 완료되었습니다.", "success");
    } catch (error) {
      auth.setStatus(status, auth.messageForError(error), "error");
    } finally {
      setBusy(finishSignupButton, false, "가입 처리 중…", "회원가입 완료");
    }
  });

  resendJoinButton?.addEventListener("click", async () => {
    auth.clearStatus(status);
    setBusy(resendJoinButton, true, "전송 중…", "가입 코드 다시 보내기");
    try {
      const session = await auth.getSession();
      if (!session) throw new Error("회원가입 인증 세션이 만료되었습니다. 로그인 후 회원가입을 이어서 진행하세요.");
      await sendSecondCode();
      auth.setStatus(status, "새 1회용 가입 코드를 보냈습니다. 이전 코드는 사용하지 마세요.", "success");
    } catch (error) {
      auth.setStatus(status, auth.messageForError(error), "error");
    } finally {
      setBusy(resendJoinButton, false, "전송 중…", "가입 코드 다시 보내기");
    }
  });

  await resumeIfPossible();
});
