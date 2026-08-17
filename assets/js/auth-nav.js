"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const currentPath = (location.pathname || "").toLowerCase();
  const isAchievementsPage = currentPath.endsWith("/achievements.html") || currentPath.endsWith("achievements.html");

  if (isAchievementsPage) {
    const removeAchievementExplanation = () => {
      // 동적 업적 목록 아래에 별도 카드처럼 보이던 보조 박스는 표시하지 않습니다.
      document.querySelectorAll(".achievement-placeholder").forEach((element) => element.remove());
    };

    const achievementScriptMatcher = /(?:^|\/)achievements-all\.js(?:\?|$)/i;
    const achievementScripts = () => [...document.scripts].filter((script) =>
      achievementScriptMatcher.test(String(script.src || ""))
    );

    const loadAchievementSort = () => {
      if (document.querySelector('script[data-achievements-sort]')) return;
      const sortScript = document.createElement("script");
      sortScript.src = "assets/js/achievements-sort.js?v=20260817-easy-order";
      sortScript.dataset.achievementsSort = "";
      document.head.appendChild(sortScript);
    };

    const existingScripts = achievementScripts();
    const existingAchievementScript = existingScripts[0] || null;

    // achievements.html에서 이미 achievements-all.js를 불러오고 있으므로
    // data 속성이 없다는 이유로 같은 스크립트를 다시 삽입하지 않습니다.
    if (existingAchievementScript) {
      existingAchievementScript.dataset.achievementsAll = "";
      existingScripts.slice(1).forEach((script) => script.remove());
      removeAchievementExplanation();
      loadAchievementSort();
    } else {
      const achievementScript = document.createElement("script");
      achievementScript.src = "assets/js/achievements-all.js?v=20260818-duplicate-fix";
      achievementScript.dataset.achievementsAll = "";
      achievementScript.addEventListener("load", () => {
        removeAchievementExplanation();
        loadAchievementSort();
      });
      document.head.appendChild(achievementScript);
    }

    // achievements-all.js의 첫 렌더 및 서버 진행도 재렌더 뒤에도
    // 보조 박스가 다시 남지 않게 제거합니다.
    setTimeout(removeAchievementExplanation, 0);
    window.addEventListener("sd-achievements-updated", () => setTimeout(removeAchievementExplanation, 0));
  }

  const nav = document.querySelector(".nav-links");
  if (nav) {
    const achievementLinks = [
      ...nav.querySelectorAll('a[href="achievements.html"], a[href="./achievements.html"]')
    ];

    if (achievementLinks.length) {
      // HTML에 이미 존재하는 업적 메뉴를 재사용하고, 혹시 남아 있는 중복은 제거합니다.
      achievementLinks[0].dataset.achievementsLink = "";
      achievementLinks.slice(1).forEach((link) => link.remove());
    } else {
      const achievementLink = document.createElement("a");
      achievementLink.href = "achievements.html";
      achievementLink.textContent = "업적";
      achievementLink.dataset.achievementsLink = "";

      const rankingLink = nav.querySelector('a[href="ranking.html"]');
      if (rankingLink) rankingLink.insertAdjacentElement("afterend", achievementLink);
      else nav.prepend(achievementLink);
    }
  }

  if (!window.SD_AUTH) return;

  // 홈페이지 안의 로그인/회원가입 링크를 모두 게스트 전용으로 취급합니다.
  const guestItems = Array.from(new Set([
    ...document.querySelectorAll("[data-auth-guest]"),
    ...document.querySelectorAll('a[href="login.html"], a[href="./login.html"], a[href="signup.html"], a[href="./signup.html"]')
  ]));
  const userItems = Array.from(document.querySelectorAll("[data-auth-user]"));

  const setVisible = (element, visible) => {
    if (!element) return;

    element.hidden = !visible;
    if (visible) {
      element.style.removeProperty("display");
      element.removeAttribute("aria-hidden");
    } else {
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