"use strict";

const fs = require("node:fs");

const target = process.argv[2];
if (!target) throw new Error("Usage: node patch-renderer.js <public/js/app.js>");
let text = fs.readFileSync(target, "utf8");

function replaceOne(oldText, newText, label) {
  if (text.includes(newText)) return;
  if (!text.includes(oldText)) throw new Error(`Patch target missing: ${label}`);
  text = text.replace(oldText, newText);
}

replaceOne(
  '  addingApp: false,\n  quitting: false,\n',
  '  addingApp: false,\n  checkingUpdates: false,\n  updatingAll: false,\n  quitting: false,\n',
  "renderer updater state",
);

replaceOne(
  `function iconPath(app) {\n  return app.iconUrl || "./icons/icon-512.png";\n}\n`,
  `function iconPath(app) {\n  return app.iconUrl || "./icons/icon-512.png";\n}\n\nfunction ensureUpdateControls() {\n  if (elements.checkUpdatesButton || !elements.addAppButton?.parentElement) {\n    return;\n  }\n\n  const parent = elements.addAppButton.parentElement;\n  const checkButton = document.createElement("button");\n  checkButton.id = "checkUpdatesButton";\n  checkButton.type = "button";\n  checkButton.className = "button button-secondary";\n  checkButton.textContent = "업데이트 확인";\n\n  const updateAllButton = document.createElement("button");\n  updateAllButton.id = "updateAllButton";\n  updateAllButton.type = "button";\n  updateAllButton.className = "button button-secondary";\n  updateAllButton.textContent = "모두 업데이트";\n  updateAllButton.disabled = true;\n\n  parent.insertBefore(checkButton, elements.addAppButton);\n  parent.insertBefore(updateAllButton, elements.addAppButton);\n  elements.checkUpdatesButton = checkButton;\n  elements.updateAllButton = updateAllButton;\n}\n`,
  "update control creation",
);

replaceOne(
  `  const runningCount = state.apps.filter((app) => app.running).length;\n  const appCount = state.apps.length;\n  const removedCount = state.removedApps.length;\n`,
  `  const runningCount = state.apps.filter((app) => app.running).length;\n  const appCount = state.apps.length;\n  const removedCount = state.removedApps.length;\n  const updateCount = state.apps.filter((app) => app.updateAvailable).length;\n`,
  "update count overview",
);

replaceOne(
  `  elements.launchAllButton.disabled = appCount === 0;\n  document.documentElement.style.setProperty(\n`,
  `  elements.launchAllButton.disabled = appCount === 0;\n\n  if (elements.checkUpdatesButton) {\n    elements.checkUpdatesButton.disabled = state.checkingUpdates || state.updatingAll;\n    elements.checkUpdatesButton.textContent = state.checkingUpdates\n      ? "업데이트 확인 중..."\n      : "업데이트 확인";\n  }\n  if (elements.updateAllButton) {\n    elements.updateAllButton.disabled =\n      updateCount === 0 || state.updatingAll || state.checkingUpdates;\n    elements.updateAllButton.textContent = state.updatingAll\n      ? "업데이트 중..."\n      : updateCount > 0\n        ? \`모두 업데이트 (\${updateCount})\`\n        : "모두 업데이트";\n  }\n\n  document.documentElement.style.setProperty(\n`,
  "update toolbar state",
);

replaceOne(
  `  elements.removedStatusSummary.textContent =\n    removedCount > 0\n      ? \`\${removedCount}개 앱 보관 중 · 다시 설치하면 기존 저장 데이터를 이어서 사용합니다.\`\n      : "현재 보관 중인 삭제된 앱이 없습니다.";\n`,
  `  if (updateCount > 0) {\n    elements.statusSummary.textContent =\n      \`\${updateCount}개 확장팩 업데이트 가능 · 카드의 업데이트 버튼 또는 모두 업데이트를 사용할 수 있습니다.\`;\n  }\n\n  elements.removedStatusSummary.textContent =\n    removedCount > 0\n      ? \`\${removedCount}개 앱 보관 중 · 다시 설치하면 기존 저장 데이터를 이어서 사용합니다.\`\n      : "현재 보관 중인 삭제된 앱이 없습니다.";\n`,
  "update summary",
);

replaceOne(
  `  const statusLabel = app.updateRequired\n    ? \`v\${app.requiredVersion} 필요\`\n    : app.running\n      ? "실행 중"\n      : "대기";\n`,
  `  const statusLabel = app.updateRequired\n    ? \`필수 v\${app.requiredVersion}\`\n    : app.updateAvailable\n      ? \`v\${app.latestVersion} 업데이트\`\n      : app.running\n        ? "실행 중"\n        : "대기";\n`,
  "card update status",
);

replaceOne(
  `      <div class="improvement-box">\n        <span>마지막 개선 사항</span>\n        <p>\${escapeHtml(app.improvement)}</p>\n      </div>\n`,
  `      <div class="improvement-box">\n        <span>\${app.updateAvailable ? "새 업데이트 내용" : "마지막 개선 사항"}</span>\n        <p>\${escapeHtml(app.updateAvailable && app.updateNotes ? app.updateNotes : app.improvement)}</p>\n      </div>\n`,
  "card update notes",
);

replaceOne(
  `        <button class="button button-primary launch-button" type="button" \${busy ? "disabled" : ""}>\n          \${busy ? "처리 중..." : launchLabel}\n        </button>\n`,
  `        <button class="button button-primary launch-button" type="button" \${busy ? "disabled" : ""}>\n          \${busy ? "처리 중..." : launchLabel}\n        </button>\n        \${\n          app.updateAvailable\n            ? \`<button class="button button-secondary update-button" type="button" \${busy ? "disabled" : ""}>v\${escapeHtml(app.latestVersion)} 업데이트</button>\`\n            : ""\n        }\n`,
  "card update button",
);

replaceOne(
  `async function deleteApp(id) {\n`,
  `async function checkAppUpdates() {\n  if (state.checkingUpdates || state.updatingAll) return;\n  state.checkingUpdates = true;\n  renderApps();\n\n  try {\n    const result = await bridge.checkAppUpdates();\n    if (!result.ok) {\n      showToast(result.error || "업데이트 정보를 확인하지 못했습니다.", 4500);\n      return;\n    }\n    showToast(\n      result.count > 0\n        ? \`업데이트 가능한 확장팩이 \${result.count}개 있습니다.\`\n        : "설치된 확장팩이 모두 최신 버전입니다.",\n      3800,\n    );\n  } finally {\n    state.checkingUpdates = false;\n    renderApps();\n  }\n}\n\nasync function updateApp(id) {\n  const currentApp = state.apps.find((entry) => entry.id === id);\n  const result = await withBusy(id, () => bridge.updateApp(id));\n\n  if (result?.canceled) return;\n  if (!result?.ok) {\n    showToast(result?.error || "앱을 업데이트하지 못했습니다.", 4500);\n    return;\n  }\n  if (result.alreadyLatest) {\n    showToast(\`\${currentApp?.name || "앱"}은 이미 최신 버전입니다.\`);\n    return;\n  }\n  showToast(\`\${currentApp?.name || result.app?.name || "앱"} 업데이트가 완료되었습니다.\`, 4000);\n}\n\nasync function updateAllApps() {\n  if (state.updatingAll || state.checkingUpdates) return;\n  state.updatingAll = true;\n  renderApps();\n\n  try {\n    const result = await bridge.updateAllApps();\n    if (result?.canceled) return;\n    if (!result?.ok && !result?.updatedCount) {\n      showToast(result?.error || "확장팩 모두 업데이트를 완료하지 못했습니다.", 4800);\n      return;\n    }\n    if ((result?.count || 0) === 0) {\n      showToast("설치된 확장팩이 모두 최신 버전입니다.");\n      return;\n    }\n    showToast(\n      result.failedCount\n        ? \`\${result.updatedCount}개 업데이트 완료 · \${result.failedCount}개 실패\`\n        : \`확장팩 \${result.updatedCount}개 업데이트 완료\`,\n      4500,\n    );\n  } finally {\n    state.updatingAll = false;\n    renderApps();\n  }\n}\n\nasync function deleteApp(id) {\n`,
  "renderer update actions",
);

replaceOne(
  `    if (event.target.closest(".launch-button")) {\n      await launchApp(id);\n      return;\n    }\n`,
  `    if (event.target.closest(".update-button")) {\n      await updateApp(id);\n      return;\n    }\n\n    if (event.target.closest(".launch-button")) {\n      await launchApp(id);\n      return;\n    }\n`,
  "update button click",
);

replaceOne(
  `  elements.addAppButton.addEventListener("click", addAppZip);\n`,
  `  elements.addAppButton.addEventListener("click", addAppZip);\n  elements.checkUpdatesButton?.addEventListener("click", checkAppUpdates);\n  elements.updateAllButton?.addEventListener("click", updateAllApps);\n`,
  "update toolbar events",
);

replaceOne(
  `async function initialize() {\n  bindEvents();\n`,
  `async function initialize() {\n  ensureUpdateControls();\n  bindEvents();\n`,
  "initialize update controls",
);

if (!text.includes("bridge.checkAppUpdates")) throw new Error("check update UI missing");
if (!text.includes(".update-button")) throw new Error("update button UI missing");
if (!text.includes("모두 업데이트")) throw new Error("update-all UI missing");

fs.writeFileSync(target, text, "utf8");
console.log("Patched renderer with v2.1.3 extension auto-updater UI");
