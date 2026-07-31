"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  if (!window.SD_AUTH) return;
  const guestItems = document.querySelectorAll("[data-auth-guest]");
  const userItems = document.querySelectorAll("[data-auth-user]");
  try {
    const session = await window.SD_AUTH.getSession();
    guestItems.forEach((item) => { item.hidden = Boolean(session); });
    userItems.forEach((item) => { item.hidden = !session; });
    if (session) {
      const { data } = await window.SD_AUTH.client
        .from("profiles")
        .select("nickname")
        .maybeSingle();
      document.querySelectorAll("[data-auth-name]").forEach((item) => {
        item.textContent = data?.nickname ? `${data.nickname}님` : "내 지갑";
      });
    }
  } catch (error) {
    console.warn("로그인 상태 확인 실패", error);
  }
});
