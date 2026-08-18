"use strict";

const bridge = window.sdCenter;

const elements = {
  appGrid: document.getElementById("appGrid"),
  removedAppGrid: document.getElementById("removedAppGrid"),
  removedEmpty: document.getElementById("removedEmpty"),
  installedPanel: document.getElementById("installedPanel"),
  removedPanel: document.getElementById("removedPanel"),
  storePanel: document.getElementById("storePanel"),
  installedTabButton: document.getElementById("installedTabButton"),
  storeTabButton: document.getElementById("storeTabButton"),
  removedTabButton: document.getElementById("removedTabButton"),
  installedTabCount: document.getElementById("installedTabCount"),
  storeTabCount: document.getElementById("storeTabCount"),
  removedTabCount: document.getElementById("removedTabCount"),
  storeGrid: document.getElementById("storeGrid"),
  storeEmpty: document.getElementById("storeEmpty"),
  storeRefreshButton: document.getElementById("storeRefreshButton"),
  storeStatusSummary: document.getElementById("storeStatusSummary"),
  runningCount: document.getElementById("runningCount"),
  registeredCount: document.getElementById("registeredCount"),
  heroAppCount: document.getElementById("heroAppCount"),
  statusSummary: document.getElementById("statusSummary"),
  removedStatusSummary: document.getElementById("removedStatusSummary"),
  launchAllButton: document.getElementById("launchAllButton"),
  terminateAllButton: document.getElementById("terminateAllButton"),
  addAppButton: document.getElementById("addAppButton"),
  hideCenterButton: document.getElementById("hideCenterButton"),
  quitCenterButton: document.getElementById("quitCenterButton"),
  toast: document.getElementById("toast"),
  centerVersionChip: document.getElementById("centerVersionChip"),
  centerUpdateButton: document.getElementById("centerUpdateButton"),
  favoritesSection: document.getElementById("favoritesSection"),
  favoriteGrid: document.getElementById("favoriteGrid"),
};

const state = {
  apps: [],
  removedApps: [],
  storeApps: [],
  activeTab: "installed",
  busyIds: new Set(),
  storeBusyIds: new Set(),
  storeLoading: false,
  addingApp: false,
  checkingUpdates: false,
  updatingAll: false,
  quitting: false,
  toastTimer: null,
  selfUpdate: { phase: "idle", updateAvailable: false, downloaded: false, version: "", error: "" },
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message, duration = 3000) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");

  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("show");
  }, duration);
}

function iconPath(app) {
  return app.iconUrl || "./icons/icon-512.png";
}

function ensureUpdateControls() {
  if (elements.checkUpdatesButton || !elements.addAppButton?.parentElement) {
    return;
  }

  const parent = elements.addAppButton.parentElement;
  const checkButton = document.createElement("button");
  checkButton.id = "checkUpdatesButton";
  checkButton.type = "button";
  checkButton.className = "button button-secondary";
  checkButton.textContent = "업데이트 확인";

  const updateAllButton = document.createElement("button");
  updateAllButton.id = "updateAllButton";
  updateAllButton.type = "button";
  updateAllButton.className = "button button-secondary";
  updateAllButton.textContent = "모두 업데이트";
  updateAllButton.disabled = true;

  parent.insertBefore(checkButton, elements.addAppButton);
  parent.insertBefore(updateAllButton, elements.addAppButton);
  elements.checkUpdatesButton = checkButton;
  elements.updateAllButton = updateAllButton;
}

function renderSelfUpdate() {
  const button = elements.centerUpdateButton;
  if (!button) return;
  const update = state.selfUpdate || {};
  button.classList.toggle("is-available", Boolean(update.updateAvailable));
  button.disabled = update.phase === "checking" || update.phase === "installing";
  if (update.phase === "checking") button.textContent = "센터 업데이트 확인 중...";
  else if (update.downloaded) button.textContent = update.version ? "센터 v" + update.version + " 설치" : "다운로드 완료 · 설치";
  else if (update.updateAvailable) button.textContent = "센터 업데이트 다운로드 중...";
  else button.textContent = "센터 업데이트";
}

async function checkSelfUpdate(silent = false) {
  const result = await bridge.checkSelfUpdate();
  if (!result?.ok && !silent) showToast(result?.error || "종합센터 업데이트를 확인하지 못했습니다.", 4500);
  return result;
}

async function handleSelfUpdateButton() {
  if (state.selfUpdate?.downloaded) {
    const result = await bridge.installSelfUpdate();
    if (result?.canceled) return;
    if (!result?.ok) showToast(result?.error || "종합센터 업데이트를 설치하지 못했습니다.", 4500);
    return;
  }
  const result = await checkSelfUpdate(false);
  if (result?.ok && !result.updateAvailable && !result.downloaded) showToast("SD종합센터가 최신 버전입니다.");
}

function formatRemovedAt(value) {
  if (!value) {
    return "이전 버전에서 제거됨";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "삭제 시각 확인 불가";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function renderOverview() {
  const runningCount = state.apps.filter((app) => app.running).length;
  const appCount = state.apps.length;
  const removedCount = state.removedApps.length;
  const updateCount = state.apps.filter((app) => app.updateAvailable).length;

  elements.runningCount.textContent = String(runningCount);
  elements.registeredCount.textContent = `${appCount}개`;
  elements.heroAppCount.textContent = String(appCount);
  elements.installedTabCount.textContent = String(appCount);
  elements.removedTabCount.textContent = String(removedCount);
  elements.launchAllButton.textContent = `${appCount}개 앱 모두 실행`;
  elements.launchAllButton.disabled = appCount === 0;

  if (elements.checkUpdatesButton) {
    elements.checkUpdatesButton.disabled = state.checkingUpdates || state.updatingAll;
    elements.checkUpdatesButton.textContent = state.checkingUpdates
      ? "업데이트 확인 중..."
      : "업데이트 확인";
  }
  if (elements.updateAllButton) {
    elements.updateAllButton.disabled =
      updateCount === 0 || state.updatingAll || state.checkingUpdates;
    elements.updateAllButton.textContent = state.updatingAll
      ? "업데이트 중..."
      : updateCount > 0
        ? `모두 업데이트 (${updateCount})`
        : "모두 업데이트";
  }
  document.documentElement.style.setProperty(
    "--running-progress",
    `${(runningCount / Math.max(1, appCount)) * 100}%`,
  );

  elements.statusSummary.textContent =
    runningCount > 0
      ? `${runningCount}개 앱 실행 중 · 카드를 눌러 기존 창을 다시 열 수 있습니다.`
      : appCount > 0
        ? "현재 실행 중인 연결 앱이 없습니다."
        : "등록된 앱이 없습니다. ZIP 앱을 추가하거나 보관함에서 재설치해 주세요.";

  if (updateCount > 0) {
    elements.statusSummary.textContent =
      `${updateCount}개 확장팩 업데이트 가능 · 확장팩 상점에서 업데이트할 수 있습니다.`;
  }

  elements.removedStatusSummary.textContent =
    removedCount > 0
      ? `${removedCount}개 앱 보관 중 · 다시 설치하면 기존 저장 데이터를 이어서 사용합니다.`
      : "현재 보관 중인 삭제된 앱이 없습니다.";
}

function installedAppCard(app) {
  const busy = state.busyIds.has(app.id);
  const runningClass = app.running ? " is-running" : "";
  const importedClass = app.builtin ? "" : " is-imported";
  const launchLabel = app.updateRequired
    ? "필수 업데이트"
    : app.running
      ? "앱 창 열기"
      : "실행";
  const statusLabel = app.updateRequired
    ? `필수 v${app.requiredVersion}`
    : app.updateAvailable
      ? "상점 업데이트"
      : app.running
        ? "실행 중"
        : "대기";
  const sourceLabel = app.builtin ? "기본 앱" : "ZIP 추가 앱";

  return `
    <article class="app-card${runningClass}${importedClass}" data-id="${escapeHtml(app.id)}" data-accent="${escapeHtml(app.accent)}">
      <div class="card-heading">
        <div class="app-identity">
          <div class="app-icon">
            <img src="${escapeHtml(iconPath(app))}" alt="" draggable="false">
          </div>
          <div class="app-title">
            <strong>${escapeHtml(app.name)}</strong>
            <span>${escapeHtml(app.version)}</span>
          </div>
        </div>
        <div class="status-group">
          <button class="favorite-button${app.favorite ? " is-favorite" : ""}" type="button" title="${app.favorite ? "즐겨찾기 해제" : "즐겨찾기에 추가"}" aria-label="${app.favorite ? "즐겨찾기 해제" : "즐겨찾기에 추가"}">${app.favorite ? "★" : "☆"}</button>
          <span class="source-pill">${sourceLabel}</span>
          <div class="status-pill">
            <span class="status-dot"></span>
            <span>${statusLabel}</span>
          </div>
        </div>
      </div>

      <p class="app-description">${escapeHtml(app.description)}</p>

      <div class="improvement-box">
        <span>${app.updateAvailable ? "새 업데이트 내용" : "마지막 개선 사항"}</span>
        <p>${escapeHtml(app.updateAvailable && app.updateNotes ? app.updateNotes : app.improvement)}</p>
      </div>

      <div class="card-actions">
        <button class="button button-primary launch-button" type="button" ${busy ? "disabled" : ""}>
          ${busy ? "처리 중..." : launchLabel}
        </button>
        ${
          app.running
            ? `<button class="button button-danger terminate-button" type="button" ${busy ? "disabled" : ""}>종료</button>`
            : ""
        }
        <button class="button button-secondary folder-button" type="button" title="앱 폴더 열기">폴더</button>
        <button class="button button-delete delete-button" type="button" ${busy ? "disabled" : ""}>센터에서 제거</button>
      </div>
    </article>
  `;
}

function removedAppCard(app) {
  const busy = state.busyIds.has(app.id);
  const importedClass = app.builtin ? "" : " is-imported";
  const sourceLabel = app.builtin ? "기본 앱" : "ZIP 추가 앱";
  const cleanupLabel = app.builtin
    ? "저장 데이터 삭제"
    : "완전히 삭제";

  return `
    <article class="app-card removed-app-card${importedClass}" data-id="${escapeHtml(app.id)}" data-accent="${escapeHtml(app.accent)}">
      <div class="card-heading">
        <div class="app-identity">
          <div class="app-icon removed-icon">
            <img src="${escapeHtml(iconPath(app))}" alt="" draggable="false">
          </div>
          <div class="app-title">
            <strong>${escapeHtml(app.name)}</strong>
            <span>${escapeHtml(app.version)}</span>
          </div>
        </div>
        <div class="status-group">
          <span class="source-pill">${sourceLabel}</span>
          <div class="status-pill removed-status-pill">
            <span class="status-dot"></span>
            <span>보관 중</span>
          </div>
        </div>
      </div>

      <p class="app-description">${escapeHtml(app.description)}</p>

      <div class="removed-info-box">
        <span>센터에서 제거한 시각</span>
        <strong>${escapeHtml(formatRemovedAt(app.removedAt))}</strong>
        <p>${app.restorable ? "앱 파일을 확인했습니다. 원클릭 재설치가 가능합니다." : "앱 파일이 없어 새 ZIP이 필요합니다."}</p>
      </div>

      <div class="card-actions">
        <button class="button button-restore restore-button" type="button" ${busy || !app.restorable ? "disabled" : ""}>
          ${busy ? "처리 중..." : "다시 설치"}
        </button>
        <button class="button button-delete permanent-delete-button" type="button" ${busy ? "disabled" : ""}>
          ${cleanupLabel}
        </button>
      </div>
    </article>
  `;
}

function favoriteShortcut(app) {
  const status = app.updateRequired
    ? `필수 v${app.requiredVersion}`
    : app.running
      ? "실행 중"
      : app.updateAvailable
        ? `v${app.latestVersion} 업데이트 가능`
        : "바로 실행";
  return `
    <button class="favorite-shortcut${app.running ? " is-running" : ""}" type="button" data-id="${escapeHtml(app.id)}">
      <img src="${escapeHtml(iconPath(app))}" alt="" draggable="false">
      <span>
        <strong>${escapeHtml(app.name)}</strong>
        <small>${escapeHtml(status)}</small>
      </span>
      <b>열기</b>
    </button>
  `;
}

function renderFavorites() {
  const favorites = state.apps
    .filter((app) => app.favorite)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "ko"));
  elements.favoritesSection?.classList.toggle("hidden", favorites.length === 0);
  if (elements.favoriteGrid) {
    elements.favoriteGrid.innerHTML = favorites.map(favoriteShortcut).join("");
  }
}

function storeCard(app) {
  const busy = state.storeBusyIds.has(app.id);
  const actionLabel = app.installed
    ? app.updateAvailable
      ? "업데이트"
      : "설치됨"
    : app.removed
      ? "다시 설치"
      : "설치";
  const statusLabel = app.installed
    ? app.updateAvailable
      ? `v${app.currentVersion} → v${app.latestVersion}`
      : `최신 v${app.latestVersion}`
    : `v${app.latestVersion}`;
  const buttonClass = app.installed && !app.updateAvailable
    ? "button button-secondary store-action-button is-installed"
    : "button button-primary store-action-button";
  const disabled = busy || (app.installed && !app.updateAvailable);
  const icon = app.iconUrl
    ? `<img src="${escapeHtml(app.iconUrl)}" alt="" draggable="false">`
    : `<span class="store-generic-icon">SD</span>`;

  return `
    <article class="store-card" data-id="${escapeHtml(app.id)}" data-accent="${escapeHtml(app.accent)}">
      <div class="store-card-top">
        <div class="store-app-identity">
          <div class="store-app-icon">${icon}</div>
          <div>
            <div class="store-name-row">
              <strong>${escapeHtml(app.name)}</strong>
              ${app.builtin ? '<span class="store-type-badge">기본 앱</span>' : '<span class="store-type-badge">확장팩</span>'}
            </div>
            <span class="store-version">${escapeHtml(statusLabel)}</span>
          </div>
        </div>
        <span class="store-price">FREE</span>
      </div>
      <p class="store-description">${escapeHtml(app.description)}</p>
      <div class="store-notes">
        <span>UPDATE NOTES</span>
        <p>${escapeHtml(app.notes || "최신 공식 확장팩 버전입니다.")}</p>
      </div>
      <div class="store-card-footer">
        <span class="store-state ${app.updateAvailable ? "needs-update" : app.installed ? "installed" : "available"}">
          ${app.updateAvailable ? "업데이트 가능" : app.installed ? "설치 완료" : app.removed ? "보관함에 있음" : "설치 가능"}
        </span>
        <button class="${buttonClass}" type="button" ${disabled ? "disabled" : ""}>
          ${busy ? "처리 중..." : actionLabel}
        </button>
      </div>
    </article>
  `;
}

function renderStore() {
  if (!elements.storeGrid) return;
  elements.storeTabCount.textContent = String(state.storeApps.length);
  elements.storeGrid.innerHTML = state.storeApps.map(storeCard).join("");
  elements.storeEmpty?.classList.toggle(
    "hidden",
    state.storeLoading || state.storeApps.length > 0,
  );
  const installed = state.storeApps.filter((app) => app.installed).length;
  const updates = state.storeApps.filter((app) => app.updateAvailable).length;
  if (elements.storeStatusSummary) {
    elements.storeStatusSummary.textContent = state.storeLoading
      ? "홈페이지 카탈로그 새로고침 중..."
      : updates > 0
        ? `${state.storeApps.length}개 상품 · ${updates}개 업데이트 가능`
        : `${state.storeApps.length}개 상품 · ${installed}개 설치됨`;
  }
  if (elements.storeRefreshButton) {
    elements.storeRefreshButton.disabled = state.storeLoading;
    elements.storeRefreshButton.textContent = state.storeLoading
      ? "새로고침 중..."
      : "상점 새로고침";
  }
}

async function loadStore(force = false) {
  if (state.storeLoading) return;
  state.storeLoading = true;
  renderStore();
  try {
    const result = await bridge.getExtensionStore(force);
    if (!result?.ok) {
      showToast(result?.error || "확장팩 상점을 불러오지 못했습니다.", 4500);
      return;
    }
    state.storeApps = Array.isArray(result.apps) ? result.apps : [];
  } finally {
    state.storeLoading = false;
    renderStore();
  }
}

async function installFromStore(id) {
  if (state.storeBusyIds.has(id)) return;
  const current = state.storeApps.find((entry) => entry.id === id);
  state.storeBusyIds.add(id);
  renderStore();
  try {
    const result = await bridge.installStoreApp(id);
    if (!result?.ok) {
      showToast(result?.error || "확장팩을 설치하지 못했습니다.", 5000);
      return;
    }
    if (result.store?.apps) {
      state.storeApps = result.store.apps;
    } else {
      await loadStore(false);
    }
    showToast(
      result.alreadyLatest
        ? `${current?.name || "확장팩"}은 이미 최신 버전입니다.`
        : result.action === "updated"
          ? `${current?.name || "확장팩"} 업데이트를 완료했습니다.`
          : `${current?.name || "확장팩"} 설치를 완료했습니다.`,
      4200,
    );
  } finally {
    state.storeBusyIds.delete(id);
    renderStore();
  }
}

function renderApps() {
  renderOverview();
  renderFavorites();
  renderStore();
  const orderedApps = [...state.apps].sort((a, b) => {
    const favoriteOrder = Number(Boolean(b.favorite)) - Number(Boolean(a.favorite));
    if (favoriteOrder !== 0) return favoriteOrder;
    return String(a.name).localeCompare(String(b.name), "ko");
  });
  elements.appGrid.innerHTML = orderedApps
    .map(installedAppCard)
    .join("");

  elements.removedAppGrid.innerHTML = state.removedApps
    .map(removedAppCard)
    .join("");

  elements.removedEmpty.classList.toggle(
    "hidden",
    state.removedApps.length > 0,
  );
}

function setApps(apps) {
  state.apps = Array.isArray(apps) ? apps : [];
  renderApps();
}

function setRemovedApps(apps) {
  state.removedApps = Array.isArray(apps) ? apps : [];
  renderApps();
}

function selectTab(tab) {
  state.activeTab = tab === "removed" || tab === "store" ? tab : "installed";
  const installedActive = state.activeTab === "installed";
  const storeActive = state.activeTab === "store";
  const removedActive = state.activeTab === "removed";

  elements.installedPanel.classList.toggle("hidden", !installedActive);
  elements.storePanel.classList.toggle("hidden", !storeActive);
  elements.removedPanel.classList.toggle("hidden", !removedActive);
  elements.installedTabButton.classList.toggle("active", installedActive);
  elements.storeTabButton.classList.toggle("active", storeActive);
  elements.removedTabButton.classList.toggle("active", removedActive);
  if (storeActive && state.storeApps.length === 0 && !state.storeLoading) {
    void loadStore(true);
  }
}

async function withBusy(id, action) {
  state.busyIds.add(id);
  renderApps();

  try {
    return await action();
  } finally {
    state.busyIds.delete(id);
    renderApps();
  }
}

async function launchApp(id) {
  const currentApp = state.apps.find((entry) => entry.id === id);
  const result = await withBusy(id, () => bridge.launchApp(id));

  if (!result.ok) {
    showToast(result.error || "앱을 실행하지 못했습니다.");
    return;
  }

  showToast(
    result.mandatoryUpdated
      ? `${currentApp?.name || "앱"} 필수 업데이트를 완료하고 실행했습니다.`
      : result.alreadyRunning
        ? `${currentApp?.name || "앱"} 창을 다시 열었습니다.`
        : `${currentApp?.name || "앱"}을 실행했습니다.`,
    result.mandatoryUpdated ? 4200 : 3000,
  );
}

async function terminateApp(id) {
  const currentApp = state.apps.find((entry) => entry.id === id);
  const result = await withBusy(id, () => bridge.terminateApp(id));

  if (!result.ok) {
    showToast(result.error || "앱을 종료하지 못했습니다.");
    return;
  }

  showToast(`${currentApp?.name || "앱"} 종료 요청을 보냈습니다.`);
}

async function addAppZip() {
  if (state.addingApp) {
    return;
  }

  state.addingApp = true;
  elements.addAppButton.disabled = true;
  elements.addAppButton.textContent = "ZIP 확인 중...";

  try {
    const result = await bridge.addAppZip();

    if (result.canceled) {
      return;
    }

    if (!result.ok) {
      showToast(result.error || "앱을 추가하지 못했습니다.", 4200);
      return;
    }

    selectTab("installed");
  renderSelfUpdate();
  window.setTimeout(() => { void checkSelfUpdate(true); }, 1200);
    showToast(
      result.restoredFromBin
        ? `${result.app.name}을 새 ZIP으로 다시 설치했습니다.`
        : result.updated
          ? `${result.app.name}을 새 ZIP 버전으로 업데이트했습니다.`
          : `${result.app.name}을 종합센터에 추가했습니다.`,
      3800,
    );
  } finally {
    state.addingApp = false;
    elements.addAppButton.disabled = false;
    elements.addAppButton.textContent = "ZIP 앱 추가";
  }
}

async function checkAppUpdates() {
  if (state.checkingUpdates || state.updatingAll) return;
  state.checkingUpdates = true;
  renderApps();

  try {
    const result = await bridge.checkAppUpdates();
    if (!result.ok) {
      showToast(result.error || "업데이트 정보를 확인하지 못했습니다.", 4500);
      return;
    }
    showToast(
      result.count > 0
        ? `업데이트 가능한 확장팩이 ${result.count}개 있습니다.`
        : "설치된 확장팩이 모두 최신 버전입니다.",
      3800,
    );
  } finally {
    state.checkingUpdates = false;
    renderApps();
  }
}

async function updateApp(id) {
  const currentApp = state.apps.find((entry) => entry.id === id);
  const result = await withBusy(id, () => bridge.updateApp(id));

  if (result?.canceled) return;
  if (!result?.ok) {
    showToast(result?.error || "앱을 업데이트하지 못했습니다.", 4500);
    return;
  }
  if (result.alreadyLatest) {
    showToast(`${currentApp?.name || "앱"}은 이미 최신 버전입니다.`);
    return;
  }
  showToast(`${currentApp?.name || result.app?.name || "앱"} 업데이트가 완료되었습니다.`, 4000);
}

async function updateAllApps() {
  if (state.updatingAll || state.checkingUpdates) return;
  state.updatingAll = true;
  renderApps();

  try {
    const result = await bridge.updateAllApps();
    if (result?.canceled) return;
    if (!result?.ok && !result?.updatedCount) {
      showToast(result?.error || "확장팩 모두 업데이트를 완료하지 못했습니다.", 4800);
      return;
    }
    if ((result?.count || 0) === 0) {
      showToast("설치된 확장팩이 모두 최신 버전입니다.");
      return;
    }
    showToast(
      result.failedCount
        ? `${result.updatedCount}개 업데이트 완료 · ${result.failedCount}개 실패`
        : `확장팩 ${result.updatedCount}개 업데이트 완료`,
      4500,
    );
  } finally {
    state.updatingAll = false;
    renderApps();
  }
}

async function toggleFavorite(id) {
  const currentApp = state.apps.find((entry) => entry.id === id);
  const result = await bridge.toggleFavorite(id);
  if (!result?.ok) {
    showToast(result?.error || "즐겨찾기를 변경하지 못했습니다.");
    return;
  }
  showToast(result.favorite
    ? `${currentApp?.name || "앱"}을 즐겨찾기에 추가했습니다.`
    : `${currentApp?.name || "앱"}을 즐겨찾기에서 해제했습니다.`);
}

async function downloadExtensionZips() {
  if (state.downloadingExtensions) return;
  state.downloadingExtensions = true;
  state.downloadProgress = null;
  renderOverview();
  try {
    const result = await bridge.downloadExtensionZips();
    if (result?.canceled) return;
    if (!result?.ok && !result?.downloadedCount) {
      showToast(result?.error || "확장팩 ZIP을 다운로드하지 못했습니다.", 5000);
      return;
    }
    showToast(result.failedCount
      ? `${result.downloadedCount}개 ZIP 다운로드 완료 · ${result.failedCount}개 실패`
      : `확장팩 ZIP ${result.downloadedCount}개를 모두 다운로드했습니다.`, 4800);
  } finally {
    state.downloadingExtensions = false;
    state.downloadProgress = null;
    renderOverview();
  }
}

async function deleteApp(id) {
  const currentApp = state.apps.find((entry) => entry.id === id);
  const result = await withBusy(id, () => bridge.deleteApp(id));

  if (result.canceled) {
    return;
  }

  if (!result.ok) {
    showToast(result.error || "앱을 제거하지 못했습니다.", 4200);
    return;
  }

  if (result.movedToBin) {
    selectTab("removed");
    const dataMessage = result.deletedData
      ? " 저장 데이터는 삭제했습니다."
      : " 저장 데이터는 유지했습니다.";
    showToast(
      `${currentApp?.name || result.name || "앱"}을 삭제된 앱 보관함으로 옮겼습니다.${dataMessage}`,
      4300,
    );
    return;
  }

  showToast(
    `${currentApp?.name || result.name || "앱"}과 저장 데이터를 완전히 삭제했습니다.`,
    4000,
  );
}

async function restoreApp(id) {
  const currentApp = state.removedApps.find((entry) => entry.id === id);
  const result = await withBusy(id, () => bridge.restoreApp(id));

  if (!result.ok) {
    showToast(result.error || "앱을 다시 설치하지 못했습니다.", 4500);
    return;
  }

  selectTab("installed");
  showToast(
    `${currentApp?.name || result.app?.name || "앱"}을 다시 설치했습니다. 기존 저장 데이터가 유지됩니다.`,
    4200,
  );
}

async function permanentlyDeleteRemovedApp(id) {
  const currentApp = state.removedApps.find((entry) => entry.id === id);
  const result = await withBusy(id, () =>
    bridge.permanentlyDeleteRemovedApp(id),
  );

  if (result.canceled) {
    return;
  }

  if (!result.ok) {
    showToast(result.error || "앱을 완전히 삭제하지 못했습니다.", 4500);
    return;
  }

  if (result.remainsInBin) {
    showToast(
      `${currentApp?.name || result.name || "기본 앱"}의 저장 데이터를 삭제했습니다. 앱은 보관함에서 다시 설치할 수 있습니다.`,
      4500,
    );
    return;
  }

  showToast(
    result.deletedData
      ? `${currentApp?.name || result.name || "앱"}의 앱 파일, ZIP 백업, 저장 데이터를 삭제했습니다.`
      : `${currentApp?.name || result.name || "앱"}의 앱 파일과 ZIP 백업을 삭제했습니다.`,
    4500,
  );
}

function bindEvents() {
  elements.appGrid.addEventListener("click", async (event) => {
    const card = event.target.closest(".app-card");

    if (!card) {
      return;
    }

    const id = card.dataset.id;

    if (event.target.closest(".favorite-button")) {
      await toggleFavorite(id);
      return;
    }

    if (event.target.closest(".update-button")) {
      await updateApp(id);
      return;
    }

    if (event.target.closest(".launch-button")) {
      await launchApp(id);
      return;
    }

    if (event.target.closest(".terminate-button")) {
      await terminateApp(id);
      return;
    }

    if (event.target.closest(".delete-button")) {
      await deleteApp(id);
      return;
    }

    if (event.target.closest(".folder-button")) {
      const result = await bridge.openAppFolder(id);

      if (!result.ok) {
        showToast(result.error || "폴더를 열지 못했습니다.");
      }
    }
  });

  elements.favoriteGrid?.addEventListener("click", async (event) => {
    const shortcut = event.target.closest(".favorite-shortcut");
    if (!shortcut) return;
    await launchApp(shortcut.dataset.id);
  });

  elements.removedAppGrid.addEventListener("click", async (event) => {
    const card = event.target.closest(".app-card");

    if (!card) {
      return;
    }

    const id = card.dataset.id;

    if (event.target.closest(".restore-button")) {
      await restoreApp(id);
      return;
    }

    if (event.target.closest(".permanent-delete-button")) {
      await permanentlyDeleteRemovedApp(id);
    }
  });

  elements.installedTabButton.addEventListener("click", () => {
    selectTab("installed");
  });

  elements.storeTabButton.addEventListener("click", () => {
    selectTab("store");
  });

  elements.removedTabButton.addEventListener("click", () => {
    selectTab("removed");
  });

  elements.storeRefreshButton?.addEventListener("click", () => {
    void loadStore(true);
  });

  elements.storeGrid?.addEventListener("click", async (event) => {
    const card = event.target.closest(".store-card");
    const action = event.target.closest(".store-action-button");
    if (!card || !action || action.disabled) return;
    await installFromStore(card.dataset.id);
  });

  elements.centerUpdateButton?.addEventListener("click", handleSelfUpdateButton);
  elements.addAppButton.addEventListener("click", addAppZip);
  elements.checkUpdatesButton?.addEventListener("click", checkAppUpdates);
  elements.updateAllButton?.addEventListener("click", updateAllApps);

  elements.launchAllButton.addEventListener("click", async () => {
    elements.launchAllButton.disabled = true;

    try {
      const result = await bridge.launchAll();
      showToast(
        result.ok
          ? `${result.count}개 앱에 실행 요청을 보냈습니다.`
          : "일부 앱을 실행하지 못했습니다.",
      );
    } finally {
      elements.launchAllButton.disabled = state.apps.length === 0;
    }
  });

  elements.terminateAllButton.addEventListener("click", async () => {
    elements.terminateAllButton.disabled = true;

    try {
      await bridge.terminateAll();
      showToast("실행 중인 연결 앱에 종료 요청을 보냈습니다.");
    } finally {
      elements.terminateAllButton.disabled = false;
    }
  });

  elements.hideCenterButton.addEventListener("click", () => {
    bridge.hide();
  });

  elements.quitCenterButton.addEventListener("click", async () => {
    if (state.quitting) {
      return;
    }

    state.quitting = true;
    elements.quitCenterButton.disabled = true;
    elements.quitCenterButton.textContent = "종료 중...";

    try {
      const result = await bridge.quitCompletely();

      if (result?.canceled) {
        state.quitting = false;
        elements.quitCenterButton.disabled = false;
        elements.quitCenterButton.textContent = "완전 종료";
      }
    } catch {
      // 완전 종료가 승인되면 Electron 프로세스가 먼저 종료될 수 있습니다.
    }
  });

  bridge.onAppStates(setApps);
  bridge.onRemovedAppStates(setRemovedApps);
  bridge.onBulkDownloadProgress?.((progress) => {
    state.downloadProgress = progress || null;
    renderOverview();
  });
  bridge.onSelfUpdateState?.((update) => {
    state.selfUpdate = update || state.selfUpdate;
    renderSelfUpdate();
    if (update?.phase === "available") showToast("새 SD종합센터 업데이트를 다운로드합니다.", 3500);
    if (update?.phase === "downloaded") showToast(update.version ? "SD종합센터 v" + update.version + " 다운로드 완료 · 설치할 수 있습니다." : "종합센터 업데이트 다운로드가 완료되었습니다.", 5000);
    if (update?.phase === "error") showToast(update.error || "종합센터 업데이트 오류", 4500);
  });
}

async function initialize() {
  bindEvents();
  const [apps, removedApps, centerInfo, store] = await Promise.all([
    bridge.listApps(),
    bridge.listRemovedApps(),
    bridge.getCenterInfo(),
    bridge.getExtensionStore(false),
  ]);
  if (elements.centerVersionChip && centerInfo?.version) {
    elements.centerVersionChip.textContent = `v${centerInfo.version}`;
    elements.centerVersionChip.title = `현재 SD종합센터 버전: v${centerInfo.version}`;
  }
  if (store?.ok && Array.isArray(store.apps)) {
    state.storeApps = store.apps;
  }
  setApps(apps);
  setRemovedApps(removedApps);
  renderStore();
  selectTab("installed");
}

initialize().catch((error) => {
  console.error(error);
  showToast(`초기화 오류: ${error.message}`);
});
