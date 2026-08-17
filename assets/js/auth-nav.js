"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  if ((location.pathname || "").toLowerCase().endsWith("/achievements.html") || (location.pathname || "").toLowerCase().endsWith("achievements.html")) {
    const removeAchievementExplanation = () => {
      document.querySelectorAll(".achievement-placeholder").forEach((element) => {
        if ((element.textContent || "").includes("업적 조건 94종")) element.remove();
      });
    };

    const loadAchievementSort = () => {
      if (document.querySelector('script[data-achievements-sort]')) return;
      const sortScript = document.createElement("script");
      sortScript.src = "assets/js/achievements-sort.js?v=20260817-easy-order";
      sortScript.dataset.achievementsSort = "";
      document.head.appendChild(sortScript);
    };

    if (!document.querySelector('script[data-achievements-all]')) {
      const achievementScript = document.createElement("script");
      achievementScript.src = "assets/js/achievements-all.js?v=20260817-all";
      achievementScript.dataset.achievementsAll = "";
      achievementScript.addEventListener("load", () => {
        removeAchievementExplanation();
        loadAchievementSort();
      });
      document.head.appendChild(achievementScript);
    } else {
      removeAchievementExplanation();
      loadAchievementSort();
    }
  }

  const nav = document.querySelector(".nav-links");
  if (nav && !nav.querySelector('[data-achievements-link]')) {
    const achievementLink = document.createElement("a");
    achievementLink.href = "achievements.html";
    achievementLink.textContent = "업적";
    achievementLink.dataset.achievementsLink = "";

    const rankingLink = nav.querySelector('a[href="ranking.html"]');
    if (rankingLink) rankingLink.insertAdjacentElement("afterend", achievementLink);
    else nav.prepend(achievementLink);
  }

  if (!window.SD_AUTH) return;

  // 홈페이지 안의 로그인/회원가입 링크를 모두 게스트 전용으로 취급합니다.
  // data-auth-guest가 빠진 푸터 링크도 로그인 후 함께 숨깁니다.
  const guestItems = Array.from(new Set([
    ...document.querySelectorAll("[data-auth-guest]"),
    ...document.querySelectorAll('a[href="login.html"], a[href="./login.html"], a[href="signup.html"], a[href="./signup.html"]')
  ]));
  const userItems = Array.from(document.querySelectorAll("[data-auth-user]"));

  const setVisible = (element, visible) => {
    if (!element) return;

    element.hidden = !visible;
    if (visible) {
      // CSS에 display 값이 있어도 원래 디자인대로 다시 보이게 합니다.
      element.style.removeProperty("display");
      element.removeAttribute("aria-hidden");
    } else {
      // style.css의 display:inline-flex 등이 hidden 속성을 덮어쓰는 경우까지 차단합니다.
      element.style.setProperty("display", "none", "important");
      element.setAttribute("aria-hidden", "true");
    }
  };

  const applySessionUI = (session) => {
    const signedIn = Boolean(session);
    guestItems.forEach((item) => setVisible(item, !signedIn));
    userItems.forEach((item) => setVisible(item, signedIn));
  };

  const applyNickname = async (session) => {
    if (!session) return;

    try {
      const { data } = await window.SD_AUTH.client
        .from("profiles")
        .select("nickname")
        .maybeSingle();

      document.querySelectorAll("[data-auth-name]").forEach((item) => {
        item.textContent = data?.nickname ? `${data.nickname}님` : "내 지갑";
      });
    } catch (error) {
      console.warn("닉네임 확인 실패", error);
    }
  };

  try {
    const session = await window.SD_AUTH.getSession();
    applySessionUI(session);
    await applyNickname(session);

    // 로그인/로그아웃 상태가 같은 탭에서 바뀌는 경우에도 즉시 반영합니다.
    if (window.SD_AUTH.client?.auth?.onAuthStateChange) {
      window.SD_AUTH.client.auth.onAuthStateChange((_event, nextSession) => {
        applySessionUI(nextSession);
        void applyNickname(nextSession);
      });
    }
  } catch (error) {
    console.warn("로그인 상태 확인 실패", error);
  }
});
