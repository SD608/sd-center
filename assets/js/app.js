"use strict";

const config = window.SD_SITE_CONFIG || {};
const isPlaceholder = (value) =>
  !value || /YOUR_GITHUB_ID|YOUR_REPOSITORY/.test(String(value));

function setText(selector, value) {
  document.querySelectorAll(selector).forEach((element) => {
    element.textContent = value;
  });
}

function configureLinks() {
  const downloadUrl = config.downloadUrl || "#";
  const placeholder = isPlaceholder(downloadUrl);

  document.querySelectorAll("[data-download-link]").forEach((link) => {
    link.href = placeholder ? "#" : downloadUrl;
    if (!placeholder) {
      link.setAttribute("download", config.fileName || "SDCenterSetup.exe");
    }

    link.addEventListener("click", (event) => {
      if (placeholder) {
        event.preventDefault();
        const notice = document.getElementById("configNotice");
        notice.hidden = false;
        return;
      }

      window.setTimeout(() => {
        document.getElementById("downloadModal").hidden = false;
      }, 180);
    });
  });

  document.querySelectorAll("[data-release-link]").forEach((link) => {
    link.href = isPlaceholder(config.releasePageUrl) ? "#" : config.releasePageUrl;
  });

  document.querySelectorAll("[data-source-link]").forEach((link) => {
    link.href = isPlaceholder(config.sourcePageUrl) ? "#" : config.sourcePageUrl;
  });
}

function initialize() {
  setText("[data-version]", config.version || "2.0.0");
  setText("[data-file-name]", config.fileName || "SDCenterSetup.exe");
  setText("[data-system]", config.systemRequirement || "Windows 10/11 64비트");
  configureLinks();

  const modal = document.getElementById("downloadModal");
  const closeModal = () => {
    modal.hidden = true;
  };

  document.getElementById("modalClose").addEventListener("click", closeModal);
  document.getElementById("modalConfirm").addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });

  const notice = document.getElementById("configNotice");
  notice.querySelector("button").addEventListener("click", () => {
    notice.hidden = true;
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal();
  });
}

document.addEventListener("DOMContentLoaded", initialize);
