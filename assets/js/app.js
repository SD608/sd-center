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

function isMobileVisit() {
  return window.matchMedia("(max-width: 760px)").matches ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
}

function isAndroidVisit() {
  return /Android/i.test(navigator.userAgent || "");
}

function injectMobileInstallStyles() {
  if (document.getElementById("sdMobileInstallStyles")) return;
  const style = document.createElement("style");
  style.id = "sdMobileInstallStyles";
  style.textContent = `
    .sd-mobile-install-spotlight { display:none; }
    @media (max-width:760px) {
      .sd-mobile-install-spotlight {
        width:calc(100% - 20px);
        margin:12px auto 0;
        padding:18px;
        border:1px solid rgba(112,159,255,.28);
        border-radius:20px;
        background:linear-gradient(135deg,rgba(34,73,148,.94),rgba(16,35,72,.96));
        box-shadow:0 18px 48px rgba(0,0,0,.3);
      }
      .sd-mobile-install-head { display:flex; align-items:center; gap:13px; }
      .sd-mobile-install-head img { width:54px; height:54px; flex:0 0 auto; border-radius:16px; box-shadow:0 10px 24px rgba(0,0,0,.28); }
      .sd-mobile-install-copy { min-width:0; display:flex; flex-direction:column; }
      .sd-mobile-install-copy small { color:#8fb4ff; font-size:.66rem; font-weight:900; letter-spacing:.13em; }
      .sd-mobile-install-copy strong { margin-top:2px; color:#fff; font-size:1.08rem; letter-spacing:-.025em; }
      .sd-mobile-install-copy span { margin-top:2px; color:#b7c7df; font-size:.74rem; line-height:1.45; }
      .sd-mobile-install-primary,
      .sd-mobile-install-secondary {
        display:flex;
        width:100%;
        min-height:56px;
        margin-top:14px;
        align-items:center;
        justify-content:center;
        border-radius:15px;
        font-weight:900;
        text-align:center;
      }
      .sd-mobile-install-primary {
        background:linear-gradient(135deg,#65d1ff,#6385ff 78%);
        color:#fff;
        box-shadow:0 14px 30px rgba(72,122,255,.32);
        font-size:.95rem;
      }
      .sd-mobile-install-secondary {
        min-height:46px;
        margin-top:9px;
        border:1px solid rgba(164,190,236,.18);
        background:rgba(255,255,255,.045);
        color:#c8d5e8;
        font-size:.78rem;
      }
      .sd-mobile-install-note { display:block; margin-top:10px; color:#8192aa; font-size:.68rem; line-height:1.55; text-align:center; }
      .sd-mobile-install-spotlight + .hero { padding-top:42px; }
      .sd-mobile-install-spotlight + .hero .hero-actions [data-download-link] { display:none; }
    }
  `;
  document.head.append(style);
}

async function resolveLatestMobileApk() {
  const fallback = "https://github.com/SD608/sd-center/releases";
  try {
    const response = await fetch("https://api.github.com/repos/SD608/sd-center/releases?per_page=20", {
      headers: { Accept: "application/vnd.github+json" }
    });
    if (!response.ok) return fallback;
    const releases = await response.json();
    if (!Array.isArray(releases)) return fallback;

    for (const release of releases) {
      if (!release || release.draft || !Array.isArray(release.assets)) continue;
      const asset = release.assets.find((item) => item && item.name === "SDCenter-Mobile.apk");
      if (asset && asset.browser_download_url) return asset.browser_download_url;
    }
  } catch (_) {
    // GitHub API 호출 실패 시 릴리스 목록으로 이동합니다.
  }
  return fallback;
}

function initializeMobileInstallSpotlight() {
  if (!isMobileVisit()) return;
  const header = document.querySelector(".site-header");
  if (!header || document.querySelector(".sd-mobile-install-spotlight")) return;

  injectMobileInstallStyles();

  const card = createElement("section", "sd-mobile-install-spotlight");
  card.setAttribute("aria-label", "SD종합센터 모바일 설치");

  const head = createElement("div", "sd-mobile-install-head");
  const icon = createElement("img", "");
  icon.src = "assets/icons/center.png";
  icon.alt = "";

  const copy = createElement("div", "sd-mobile-install-copy");
  copy.append(
    createElement("small", "", isAndroidVisit() ? "ANDROID APP" : "MOBILE"),
    createElement("strong", "", isAndroidVisit() ? "SD종합센터 앱 설치" : "SD종합센터 모바일"),
    createElement("span", "", isAndroidVisit()
      ? "Android 앱을 설치하면 홈 화면에서 바로 실행할 수 있습니다."
      : "모바일 웹 버전을 바로 실행할 수 있습니다.")
  );
  head.append(icon, copy);
  card.append(head);

  if (isAndroidVisit()) {
    const installButton = createElement("a", "sd-mobile-install-primary", "Android 앱 설치하기");
    installButton.href = "https://github.com/SD608/sd-center/releases";
    installButton.setAttribute("data-mobile-apk-download", "");
    installButton.setAttribute("aria-label", "SD종합센터 Android APK 다운로드");
    card.append(installButton);

    resolveLatestMobileApk().then((url) => {
      installButton.href = url;
    });

    const webButton = createElement("a", "sd-mobile-install-secondary", "설치 없이 웹으로 사용");
    webButton.href = "mobile.html";
    card.append(webButton);

    card.append(createElement(
      "small",
      "sd-mobile-install-note",
      "APK 다운로드 후 브라우저의 다운로드 알림에서 파일을 열어 설치하세요."
    ));
  } else {
    const webButton = createElement("a", "sd-mobile-install-primary", "모바일 웹으로 시작하기");
    webButton.href = "mobile.html";
    card.append(webButton);
    card.append(createElement(
      "small",
      "sd-mobile-install-note",
      "설치형 앱은 Android용으로 제공됩니다."
    ));
  }

  header.insertAdjacentElement("afterend", card);
}

function initialize() {
  setText("[data-version]", config.version);
  setText("[data-file-name]", config.fileName);
  setText("[data-system]", config.systemRequirement);
  configureLinks();
  renderExtensions();
  initializeMobileInstallSpotlight();

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
