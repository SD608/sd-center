"use strict";

const IMPORT_NEEDLE = 'const { createSdLinkBackgroundWindowGuard } = require("./src/sdlink-background-window-guard");';
const IMPORT_LINE = 'const { patchIntegratedSdLinkAchievementOverlay } = require("./src/sdlink-achievement-overlay");';
const HOOK_NEEDLE = `    const coreRuntimePatch = patchIntegratedSdLinkCoreRuntime(childDirectory);\n    if (!coreRuntimePatch?.ok) {\n      console.warn("SD Link → SD Core 런타임 패치 실패", coreRuntimePatch?.reason || coreRuntimePatch);\n    }`;
const HOOK_APPEND = `${HOOK_NEEDLE}\n    const achievementOverlayPatch = patchIntegratedSdLinkAchievementOverlay(childDirectory, { app });\n    if (!achievementOverlayPatch?.ok) {\n      console.warn("SD Link 업적 해금 오버레이 패치 실패", achievementOverlayPatch?.reason || achievementOverlayPatch);\n    }`;

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`Achievement overlay patch marker missing: ${label}`);
  if (source.indexOf(needle, first + needle.length) >= 0) throw new Error(`Achievement overlay patch marker is ambiguous: ${label}`);
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

function patchMainSource(source) {
  let text = String(source || "").replace(/\r\n/g, "\n");
  if (!text.includes(IMPORT_LINE)) text = replaceOnce(text, IMPORT_NEEDLE, `${IMPORT_NEEDLE}\n${IMPORT_LINE}`, "overlay import");
  if (!text.includes("const achievementOverlayPatch = patchIntegratedSdLinkAchievementOverlay")) {
    text = replaceOnce(text, HOOK_NEEDLE, HOOK_APPEND, "overlay SD Link hook");
  }
  return text;
}

module.exports = { IMPORT_LINE, IMPORT_NEEDLE, HOOK_NEEDLE, patchMainSource };
