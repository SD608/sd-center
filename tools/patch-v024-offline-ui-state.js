"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = process.argv[2];
if (!root) {
  throw new Error("Usage: node patch-v024-offline-ui-state.js <app-root>");
}

const MANIFEST = {
  "main.js": {
    "baseSha256": "13e90ad2b7c8e9576a2d98150c13d570f387d74c9ecf3a797d0a9c14a1c5d0ee",
    "targetSha256": "eec3a7ac2ce56e3fd68005d0ed86f766b99c4d37832f03d8729ad5d6d8afb38d",
    "ops": [
      {"start":264,"end":264,"old":[],"new":["let extensionCatalogSource = \"fallback\";","let extensionCatalogLastError = \"\";"]},
      {"start":809,"end":809,"old":[],"new":["        extensionCatalogSource = \"remote\";","        extensionCatalogLastError = \"\";"]},
      {"start":810,"end":810,"old":[],"new":["        extensionCatalogSource = \"fallback\";","        extensionCatalogLastError = String(error?.message || error || \"확장팩 카탈로그 연결 실패\");"]},
      {"start":1105,"end":1105,"old":[],"new":["        catalogSource: extensionCatalogSource,","        catalogError: extensionCatalogLastError,"]},
      {"start":1109,"end":1110,"old":["      return { ok: false, error: error.message, apps: [] };"],"new":["      return {","        ok: false,","        catalogSource: \"error\",","        catalogError: String(error?.message || error || \"확장팩 상점 연결 실패\"),","        error: error.message,","        apps: [],","      };"]},
      {"start":2904,"end":2904,"old":[],"new":["        if (extensionCatalogSource !== \"remote\") {","          return {","            ok: false,","            offline: true,","            catalogSource: extensionCatalogSource,","            error: \"온라인 업데이트 정보를 확인할 수 없습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.\",","          };","        }"]},
      {"start":2913,"end":2914,"old":["        return { ok: true, count: available.length, apps: available };"],"new":["        return {","          ok: true,","          catalogSource: extensionCatalogSource,","          count: available.length,","          apps: available,","        };"]}
    ]
  },
  "public/index.html": {
    "baseSha256": "6ab9cf886a6011652adae9a4d76ff18af31619e5a9f4fd8a552773c3e70c86ad",
    "targetSha256": "fb9ab3b50841465abae2c1a5bcd513def12982ce7d5ea160bd2599c02669fcdd",
    "ops": [
      {"start":28,"end":28,"old":[],"new":["    <div id=\"previewNetworkStatus\" class=\"preview-network-status hidden\" data-phase=\"online\" role=\"status\" aria-live=\"polite\" title=\"온라인 데이터 연결 상태\">","      <span class=\"preview-network-dot\" aria-hidden=\"true\"></span>","      <b id=\"previewNetworkStatusText\">온라인</b>","    </div>",""]},
      {"start":44,"end":45,"old":["      <button class=\"preview-nav\" type=\"button\" data-preview-view=\"store\"><span>＋</span><b>상점</b><i id=\"storeTabCount\">0</i></button>"],"new":["      <button class=\"preview-nav\" type=\"button\" data-preview-view=\"store\"><span>＋</span><b>상점</b><i id=\"storeTabCount\" title=\"상점 정보 확인 중\">…</i></button>"]}
    ]
  },
  "public/css/ui-preview.css": {
    "baseSha256": "f74d9b712f71af9ab0f47353a49947edd9b9061e8e453c5d47fb15a57b194629",
    "targetSha256": "8843cffc60d5824ed3c9d5987f3e4615523685cc4a34f836e025a1ca7191dda6",
    "ops": [
      {"start":45,"end":45,"old":[],"new":[".preview-network-status{position:fixed;z-index:65;top:66px;right:16px;height:28px;padding:0 9px;border:1px solid #434a53;border-radius:5px;background:#1b1e22;color:#d6dbe1;display:flex;align-items:center;gap:6px;font-size:10px;font-weight:800;box-shadow:0 8px 24px rgba(0,0,0,.24)}",".preview-network-status[data-phase=\"offline\"],.preview-network-status[data-phase=\"error\"]{border-color:#66534a;background:#211b18;color:#f0d7c8}",".preview-network-status[data-phase=\"reconnecting\"]{border-color:#4b596b;background:#171e27;color:#d4e2f5}",".preview-network-dot{width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.9}"]},
      {"start":58,"end":58,"old":[],"new":[".preview-nav>i.network-unavailable{background:#8d745f;color:#fff}",".preview-nav>i.network-pending{background:#3a4149;color:#d9dee4}"]}
    ]
  },
  "public/js/app.js": {
    "baseSha256": "e0f40a6ca3694e7e3a2369ed556922fa599d52faca32350159fa663bb36bbe9c",
    "targetSha256": "33fb5beb18c5a72a67f4887d6368cd295cc3bb59d45eb159bec33cfe0bec5305",
    "ops": [
      {"start":21,"end":21,"old":[],"new":["  networkStatus: document.getElementById(\"previewNetworkStatus\"),","  networkStatusText: document.getElementById(\"previewNetworkStatusText\"),"]},
      {"start":46,"end":46,"old":[],"new":["  storeCatalogSource: \"loading\",","  storeCatalogError: \"\",","  networkOffline: navigator.onLine === false,","  networkReconnecting: false,"]},
      {"start":352,"end":362,"old":["  const actionLabel = app.installed","    ? app.updateAvailable","      ? \"업데이트\"","      : \"설치됨\"","    : app.removed","      ? \"다시 설치\"","      : \"설치\";","  const statusLabel = app.installed","    ? app.updateAvailable","      ? `v${app.currentVersion} → v${app.latestVersion}`","      : `최신 v${app.latestVersion}`","    : `v${app.latestVersion}`;"],"new":["  const unavailable = catalogConnectionUnavailable() || state.networkReconnecting;","  const actionLabel = unavailable","    ? \"연결 필요\"","    : app.installed","      ? app.updateAvailable","        ? \"업데이트\"","        : \"설치됨\"","      : app.removed","        ? \"다시 설치\"","        : \"설치\";","  const statusLabel = unavailable","    ? \"온라인 확인 필요\"","    : app.installed","      ? app.updateAvailable","        ? `v${app.currentVersion} → v${app.latestVersion}`","        : `최신 v${app.latestVersion}`","      : `v${app.latestVersion}`;"]},
      {"start":366,"end":367,"old":["  const disabled = busy || (app.installed && !app.updateAvailable);"],"new":["  const disabled = unavailable || busy || (app.installed && !app.updateAvailable);"]},
      {"start":393,"end":395,"old":["        <span class=\"store-state ${app.updateAvailable ? \"needs-update\" : app.installed ? \"installed\" : \"available\"}\">","          ${app.updateAvailable ? \"업데이트 가능\" : app.installed ? \"설치 완료\" : app.removed ? \"보관함에 있음\" : \"설치 가능\"}"],"new":["        <span class=\"store-state ${unavailable ? \"available\" : app.updateAvailable ? \"needs-update\" : app.installed ? \"installed\" : \"available\"}\">","          ${unavailable ? \"온라인 확인 필요\" : app.updateAvailable ? \"업데이트 가능\" : app.installed ? \"설치 완료\" : app.removed ? \"보관함에 있음\" : \"설치 가능\"}"]},
      {"start":404,"end":404,"old":[],"new":["function catalogConnectionUnavailable() {","  return state.networkOffline ||","    state.storeCatalogSource === \"fallback\" ||","    state.storeCatalogSource === \"offline\" ||","    state.storeCatalogSource === \"error\";","}","","function networkStatusLabel() {","  if (state.networkOffline) return \"오프라인\";","  if (state.networkReconnecting) return \"재연결 중\";","  if (state.storeCatalogSource === \"fallback\" || state.storeCatalogSource === \"error\") {","    return \"온라인 데이터 연결 실패\";","  }","  return \"\";","}","","function renderNetworkStatus() {","  const label = networkStatusLabel();","  if (!elements.networkStatus || !elements.networkStatusText) return;","  elements.networkStatus.classList.toggle(\"hidden\", !label);","  if (!label) {","    elements.networkStatus.dataset.phase = \"online\";","    elements.networkStatusText.textContent = \"온라인\";","    elements.networkStatus.title = \"온라인 데이터 연결 정상\";","    return;","  }","  const phase = state.networkOffline","    ? \"offline\"","    : state.networkReconnecting","      ? \"reconnecting\"","      : \"error\";","  elements.networkStatus.dataset.phase = phase;","  elements.networkStatusText.textContent = label;","  elements.networkStatus.title = state.storeCatalogError","    ? `${label}\\n${state.storeCatalogError}`","    : label;","}","","function applyStoreCatalogResult(result) {","  if (!result) return;","  state.storeCatalogSource = String(","    result.catalogSource ||","      (result.ok ? \"remote\" : state.networkOffline ? \"offline\" : \"error\"),","  );","  state.storeCatalogError = String(result.catalogError || result.error || \"\");","}",""]},
      {"start":406,"end":407,"old":["  elements.storeTabCount.textContent = String(state.storeApps.length);"],"new":["  const catalogUnavailable = catalogConnectionUnavailable();","  const catalogPending = state.storeLoading && state.storeCatalogSource === \"loading\";","  if (catalogPending) {","    elements.storeTabCount.textContent = \"…\";","    elements.storeTabCount.title = \"상점 정보 확인 중\";","  } else if (catalogUnavailable) {","    elements.storeTabCount.textContent = \"!\";","    elements.storeTabCount.title = state.networkOffline","      ? \"오프라인 · 최신 상점 수를 확인할 수 없습니다.\"","      : \"온라인 상점 연결 실패 · 최신 상품 수를 확인할 수 없습니다.\";","  } else {","    elements.storeTabCount.textContent = String(state.storeApps.length);","    elements.storeTabCount.title = `확장팩 상점 ${state.storeApps.length}개`;","  }","  elements.storeTabCount.classList.toggle(\"network-unavailable\", catalogUnavailable);","  elements.storeTabCount.classList.toggle(\"network-pending\", catalogPending);","  renderNetworkStatus();"]},
      {"start":417,"end":422,"old":["      : updates > 0","        ? `${state.storeApps.length}개 상품 · ${updates}개 업데이트 가능`","        : `${state.storeApps.length}개 상품 · ${installed}개 설치됨`;"],"new":["      : catalogUnavailable","        ? state.networkOffline","          ? \"오프라인 · 최신 상품 수를 확인할 수 없습니다.\"","          : \"온라인 상점 연결 실패 · 최신 상품 수를 확인할 수 없습니다.\"","        : updates > 0","          ? `${state.storeApps.length}개 상품 · ${updates}개 업데이트 가능`","          : `${state.storeApps.length}개 상품 · ${installed}개 설치됨`;"]},
      {"start":424,"end":430,"old":["    elements.storeRefreshButton.disabled = state.storeLoading;","    elements.storeRefreshButton.textContent = state.storeLoading","      ? \"새로고침 중...\"","      : \"상점 새로고침\";"],"new":["    elements.storeRefreshButton.disabled = state.storeLoading || state.networkOffline;","    elements.storeRefreshButton.textContent = state.storeLoading","      ? \"새로고침 중...\"","      : state.networkOffline","        ? \"오프라인\"","        : \"상점 새로고침\";"]},
      {"start":435,"end":435,"old":[],"new":["    applyStoreCatalogResult(result);"]},
      {"start":440,"end":440,"old":[],"new":["  } catch (error) {","    state.storeCatalogSource = state.networkOffline ? \"offline\" : \"error\";","    state.storeCatalogError = String(error?.message || error || \"확장팩 상점 연결 실패\");","    showToast(","      state.networkOffline","        ? \"오프라인 상태입니다. 인터넷 연결 후 자동으로 다시 확인합니다.\"","        : \"확장팩 상점을 불러오지 못했습니다.\",","      4500,","    );"]},
      {"start":626,"end":626,"old":[],"new":["    applyStoreCatalogResult(result);","    renderStore();"]},
      {"start":628,"end":629,"old":["      showToast(result.error || \"업데이트 정보를 확인하지 못했습니다.\", 4500);"],"new":["      showToast(","        result.error ||","          (state.networkOffline","            ? \"오프라인 상태에서는 최신 업데이트 여부를 확인할 수 없습니다.\"","            : \"업데이트 정보를 확인하지 못했습니다.\"),","        4500,","      );"]},
      {"start":631,"end":631,"old":[],"new":["    state.storeCatalogSource = \"remote\";","    state.storeCatalogError = \"\";","    renderStore();"]},
      {"start":801,"end":801,"old":[],"new":["function handleBrowserOffline() {","  state.networkOffline = true;","  state.networkReconnecting = false;","  if (state.storeCatalogSource === \"loading\") state.storeCatalogSource = \"offline\";","  renderStore();","  renderApps();","}","","async function handleBrowserOnline() {","  state.networkOffline = false;","  state.networkReconnecting = true;","  renderStore();","  renderApps();","","  try {","    await loadStore(true);","    if (state.storeCatalogSource === \"remote\") {","      const apps = await bridge.listApps();","      setApps(apps);","    }","  } finally {","    state.networkReconnecting = false;","    renderStore();","    renderApps();","  }","}",""]},
      {"start":802,"end":802,"old":[],"new":["  window.addEventListener(\"offline\", handleBrowserOffline);","  window.addEventListener(\"online\", () => {","    void handleBrowserOnline();","  });",""]},
      {"start":980,"end":980,"old":[],"new":["  applyStoreCatalogResult(store);"]}
    ]
  },
  "public/js/ui-preview.js": {
    "baseSha256": "7b0e1ed3b006b4b7a9182ed6a65ece1395798ecf9186cf98abc7512ebf11d20b",
    "targetSha256": "331fc30bae18f59fb9977047ac55a0ec3cf75f926ddf1e8c217fd7cc07200ff3",
    "ops": [
      {"start":508,"end":509,"old":[],"new":["  const catalogUnavailable = typeof catalogConnectionUnavailable === \"function\"","    ? catalogConnectionUnavailable()","    : Boolean(state.networkOffline);","  const reconnecting = Boolean(state.networkReconnecting);","  renderPreviewCenterUpdate();","","  if (catalogUnavailable || reconnecting) {","    previewElements.updateNavCount.textContent = \"!\";","    previewElements.updateNavCount.classList.remove(\"hidden\");","    previewElements.updateNavCount.classList.add(\"network-unavailable\");","    const title = state.networkOffline","      ? \"오프라인\"","      : reconnecting","        ? \"재연결 중\"","        : \"업데이트 서버 연결 실패\";","    const detail = state.networkOffline","      ? \"인터넷 연결 후 자동으로 최신 업데이트 상태를 다시 확인합니다.\"","      : reconnecting","        ? \"온라인 카탈로그를 다시 확인하고 있습니다.\"","        : \"현재 표시된 숫자를 최신 상태로 확정할 수 없습니다. 다시 연결되면 자동으로 갱신합니다.\";","    previewElements.updateSummary.innerHTML = `","      <strong>—</strong>","      <div>","        <h2>${title}</h2>","        <p>${detail}</p>","      </div>","    `;","    previewElements.updateList.innerHTML = '<div class=\"preview-up-to-date\">최신 업데이트 여부를 확인할 수 없습니다.</div>';","    return;","  }",""]},
      {"start":513,"end":515,"old":["  renderPreviewCenterUpdate();",""],"new":["  previewElements.updateNavCount.classList.remove(\"network-unavailable\");"]}
    ]
  }
};

function sha256(text) {
  return crypto.createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

function applyFilePatch(relPath, spec) {
  const fullPath = path.join(root, ...relPath.split("/"));
  const source = fs.readFileSync(fullPath, "utf8").replace(/\r\n/g, "\n");
  const sourceSha = sha256(source);
  if (sourceSha !== spec.baseSha256) {
    if (sourceSha === spec.targetSha256) {
      console.log(`already patched: ${relPath}`);
      return;
    }
    throw new Error(`R4 base mismatch for ${relPath}: expected ${spec.baseSha256}, got ${sourceSha}`);
  }

  const lines = source.split("\n");
  for (const op of [...spec.ops].sort((a, b) => b.start - a.start)) {
    const actual = lines.slice(op.start, op.end);
    if (JSON.stringify(actual) !== JSON.stringify(op.old)) {
      throw new Error(`offline UI patch context mismatch in ${relPath} at lines ${op.start + 1}-${op.end}`);
    }
    lines.splice(op.start, op.end - op.start, ...op.new);
  }

  const output = lines.join("\n");
  const outputSha = sha256(output);
  if (outputSha !== spec.targetSha256) {
    throw new Error(`offline UI patch output mismatch for ${relPath}: expected ${spec.targetSha256}, got ${outputSha}`);
  }
  fs.writeFileSync(fullPath, output, "utf8");
  console.log(`patched: ${relPath} -> ${outputSha}`);
}

for (const [relPath, spec] of Object.entries(MANIFEST)) applyFilePatch(relPath, spec);
console.log("SDCenter offline/remote-failure UI state patch applied.");
