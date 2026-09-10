"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const header = document.querySelector(".home-header");
  const toggle = document.querySelector(".home-nav-toggle");
  const nav = document.getElementById("homeNav");

  const setMenuOpen = (open) => {
    if (!header || !toggle) return;
    header.classList.toggle("is-nav-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
  };

  if (header && toggle && nav) {
    toggle.addEventListener("click", () => {
      setMenuOpen(!header.classList.contains("is-nav-open"));
    });

    nav.addEventListener("click", (event) => {
      if (event.target.closest("a")) setMenuOpen(false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        const wasOpen = header.classList.contains("is-nav-open");
        setMenuOpen(false);
        if (wasOpen) toggle.focus();
      }
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 980) setMenuOpen(false);
    });
  }

  const extensionCount = document.getElementById("extensionCount");
  const extensionCountPreview = document.getElementById("extensionCountPreview");
  if (extensionCount && extensionCountPreview) {
    const syncExtensionCount = () => {
      const count = Number.parseInt(extensionCount.textContent || "0", 10);
      extensionCountPreview.textContent = Number.isFinite(count) ? String(count) : "0";
    };

    syncExtensionCount();
    const observer = new MutationObserver(syncExtensionCount);
    observer.observe(extensionCount, { childList: true, characterData: true, subtree: true });
  }
});
