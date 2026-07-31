"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const auth = window.SD_AUTH;
  const title = document.getElementById("callbackTitle");
  const message = document.getElementById("callbackMessage");
  const icon = document.getElementById("callbackIcon");
  if (!auth) return;

  const query = new URLSearchParams(location.search);
  const returnedError = query.get("error_description") || query.get("error");
  if (returnedError) {
    icon.textContent = "!";
    icon.classList.add("error");
    title.textContent = "인증에 실패했습니다";
    message.textContent = decodeURIComponent(returnedError.replace(/\+/g, " "));
    return;
  }

  try {
    const code = query.get("code");
    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    if (code) {
      const { error } = await auth.client.auth.exchangeCodeForSession(code);
      if (error) throw error;
      history.replaceState({}, document.title, location.pathname);
    } else if (hash.get("access_token") && hash.get("refresh_token")) {
      const { error } = await auth.client.auth.setSession({
        access_token: hash.get("access_token"),
        refresh_token: hash.get("refresh_token")
      });
      if (error) throw error;
      history.replaceState({}, document.title, location.pathname);
    }
    const session = await auth.getSession();
    if (!session) throw new Error("인증 세션을 확인하지 못했습니다. 인증 링크를 다시 열어주세요.");
    icon.textContent = "✓";
    title.textContent = "이메일 인증 완료";
    message.textContent = "SD 계정이 활성화되었습니다. 내 지갑으로 이동합니다.";
    setTimeout(() => location.replace("../account.html"), 1200);
  } catch (error) {
    icon.textContent = "!";
    icon.classList.add("error");
    title.textContent = "인증 처리 실패";
    message.textContent = auth.messageForError(error);
  }
});
