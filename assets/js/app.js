"use strict";

const DEFAULT_CONFIG = {
  productName: "SD종합센터",
  version: "2.1.1",
  fileName: "SDCenterSetup.exe",
  downloadUrl: "https://github.com/SD608/sd-center/releases/download/v2.1.1/SDCenterSetup.exe",
  releasePageUrl: "https://github.com/SD608/sd-center/releases/tag/v2.1.1",
  sourcePageUrl: "https://github.com/SD608/sd-center",
  systemRequirement: "Windows 10/11 64비트"
};

const config = { ...DEFAULT_CONFIG, ...(window.SD_SITE_CONFIG || {}) };

function setText(selector, value) {
  document.querySelectorAll(selector).forEach((element) => {
    element.textContent = value;
  });
}

function configureLinks() {
  document.querySelectorAll("[data-download-link]").forEach((link) => {
    link.href = config.downloadUrl;
    link.addEventListener("click", () => {
      window.setTimeout(() => {
        const modal = document.getElementById("downloadModal");
        if (modal) modal.hidden = false;
      }, 180);
    });
  });

  document.querySelectorAll("[data-release-link]").forEach((link) => {
    link.href = config.releasePageUrl;
  });

  document.querySelectorAll("[data-source-link]").forEach((link) => {
    link.href = config.sourcePageUrl;
  });
}

function initialize() {
  setText("[data-version]", config.version);
  setText("[data-file-name]", config.fileName);
  setText("[data-system]", config.systemRequirement);
  configureLinks();

  const modal = document.getElementById("downloadModal");
  const closeModal = () => {
    if (modal) modal.hidden = true;
  };

  const closeButton = document.getElementById("modalClose");
  const confirmButton = document.getElementById("modalConfirm");
  if (closeButton) closeButton.addEventListener("click", closeModal);
  if (confirmButton) confirmButton.addEventListener("click", closeModal);
  if (modal) {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal();
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal();
  });
}

document.addEventListener("DOMContentLoaded", initialize);
