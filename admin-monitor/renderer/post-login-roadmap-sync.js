"use strict";

(() => {
  const loginForm = document.getElementById("loginForm");
  const appView = document.getElementById("appView");
  if (!loginForm || !appView || typeof window.loadRoadmap !== "function") return;

  let activeObserver = null;
  let timeoutId = null;

  const clearWatch = () => {
    if (activeObserver) activeObserver.disconnect();
    activeObserver = null;
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = null;
  };

  const syncAfterLogin = () => {
    if (appView.hidden) return false;
    clearWatch();
    Promise.resolve(window.loadRoadmap(false)).catch(() => {});
    return true;
  };

  loginForm.addEventListener("submit", () => {
    clearWatch();
    if (syncAfterLogin()) return;

    activeObserver = new MutationObserver(() => syncAfterLogin());
    activeObserver.observe(appView, { attributes: true, attributeFilter: ["hidden"] });
    timeoutId = setTimeout(clearWatch, 30000);
  });
})();
