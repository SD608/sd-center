"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const root = document.querySelector("[data-home-v2]");
  if (!root) return;

  const packs = Array.isArray(window.SD_EXTENSION_PACKS) ? window.SD_EXTENSION_PACKS : [];
  root.dataset.extensionCount = String(packs.length);
  document.documentElement.classList.add("home-v2-ready");
});
