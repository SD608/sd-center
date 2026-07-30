"use strict";

const DEFAULT_CONFIG = {
  productName: "SD종합센터",
  version: "2.1.1",
  fileName: "SDCenterSetup.exe",
  downloadUrl: "https://github.com/SD608/sd-center/releases/latest/download/SDCenterSetup.exe",
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

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderExtensions() {
  const grid = document.getElementById("extensionGrid");
  const count = document.getElementById("extensionCount");
  const packs = Array.isArray(window.SD_EXTENSION_PACKS) ? window.SD_EXTENSION_PACKS : [];

  if (count) count.textContent = String(packs.length);
  if (!grid) return;
  grid.replaceChildren();

  if (packs.length === 0) {
    const empty = createElement("div", "extension-empty");
    empty.append(
      createElement("strong", "", "공개된 확장팩이 없습니다."),
      createElement("p", "", "새 확장팩이 등록되면 이곳에 표시됩니다.")
    );
    grid.append(empty);
    return;
  }

  packs.forEach((pack) => {
    const card = createElement("article", `extension-card${pack.featured ? " featured" : ""}`);

    const top = createElement("div", "extension-card-top");
    const icon = createElement("img", "extension-icon");
    icon.src = pack.icon;
    icon.alt = `${pack.name} 아이콘`;

    const titleBox = createElement("div", "extension-title-box");
    titleBox.append(
      createElement("span", "extension-category", pack.category),
      createElement("h3", "", pack.name),
      createElement("p", "extension-version", `${pack.stage} · ${pack.version}`)
    );
    top.append(icon, titleBox);

    const description = createElement("p", "extension-description", pack.description);
    const tags = createElement("div", "extension-tags");
    (pack.tags || []).forEach((tag) => tags.append(createElement("span", "", tag)));

    const meta = createElement("dl", "extension-meta");
    const requirementRow = createElement("div", "");
    requirementRow.append(createElement("dt", "", "필요 버전"), createElement("dd", "", pack.requirements));
    const dateRow = createElement("div", "");
    dateRow.append(createElement("dt", "", "업데이트"), createElement("dd", "", pack.updatedAt));
    meta.append(requirementRow, dateRow);

    const actions = createElement("div", "extension-actions");
    const download = createElement("a", "extension-download");
    download.href = pack.downloadUrl;
    download.download = pack.fileName;
    download.setAttribute("aria-label", `${pack.name} ${pack.stage} ZIP 다운로드`);
    download.append(createElement("span", "", "ZIP 다운로드"), createElement("small", "", pack.fileName));
    const hint = createElement("span", "extension-file-hint", "압축을 풀지 않고 설치");
    actions.append(download, hint);

    card.append(top, description, tags, meta, actions);
    grid.append(card);
  });
}

function initialize() {
  setText("[data-version]", config.version);
  setText("[data-file-name]", config.fileName);
  setText("[data-system]", config.systemRequirement);
  configureLinks();
  renderExtensions();

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
