"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(location.search);
  if (params.get("embed") !== "1") return;

  document.body.classList.add("profile-card-editor-embedded");
  const saveState = document.getElementById("profileCardSaveState");
  const saveButton = document.getElementById("saveProfileCardLayout");
  let saveRequested = false;
  let lastDirty = null;

  const post = (type, payload = {}) => {
    if (window.parent === window) return;
    window.parent.postMessage({ type, ...payload }, location.origin);
  };

  const reportHeight = () => {
    const height = Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
    post("sd-profile-card-editor-height", { height });
  };

  const reportState = () => {
    const dirty = Boolean(saveState?.classList.contains("is-dirty") || saveState?.classList.contains("is-saving"));
    if (dirty !== lastDirty) {
      lastDirty = dirty;
      post("sd-profile-card-editor-dirty", { dirty });
    }

    if (saveRequested && !dirty && saveState?.textContent?.trim() === "저장됨") {
      saveRequested = false;
      post("sd-profile-card-layout-saved");
    }
    reportHeight();
  };

  saveButton?.addEventListener("click", () => {
    saveRequested = true;
    setTimeout(reportState, 0);
  });

  window.addEventListener("sd-profile-editor-content-saved", () => {
    post("sd-profile-content-saved");
    reportHeight();
  });

  if (saveState) {
    new MutationObserver(reportState).observe(saveState, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  if ("ResizeObserver" in window) {
    new ResizeObserver(reportHeight).observe(document.documentElement);
  } else {
    window.addEventListener("resize", reportHeight);
  }

  setTimeout(() => {
    reportState();
    reportHeight();
  }, 60);
});
