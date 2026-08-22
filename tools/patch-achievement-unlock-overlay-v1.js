"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { patchMainSource } = require("./achievement-overlay-main-patch");
const { patchOverlaySoundSource } = require("./achievement-overlay-sound-v2");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-achievement-unlock-overlay-v1.js <app-root>");
const EXPECTED_R5_MAIN_SHA256 = "eec3a7ac2ce56e3fd68005d0ed86f766b99c4d37832f03d8729ad5d6d8afb38d";
const repoRoot = path.resolve(__dirname, "..");
const helperSource = path.join(repoRoot, "preview", "v024-core", "sdlink-achievement-overlay.js");
const mainPath = path.join(root, "main.js");
const helperTarget = path.join(root, "src", "sdlink-achievement-overlay.js");

if (!fs.existsSync(mainPath)) throw new Error("SDCenter main.js missing");
if (!fs.existsSync(helperSource)) throw new Error("Achievement overlay runtime helper missing");
const main = fs.readFileSync(mainPath, "utf8").replace(/\r\n/g, "\n");
const alreadyPatched = main.includes("patchIntegratedSdLinkAchievementOverlay");
const hash = crypto.createHash("sha256").update(main).digest("hex");
if (!alreadyPatched && hash !== EXPECTED_R5_MAIN_SHA256) {
  throw new Error(`R5 main.js identity mismatch. expected=${EXPECTED_R5_MAIN_SHA256} actual=${hash}`);
}

fs.mkdirSync(path.dirname(helperTarget), { recursive: true });
const helper = fs.readFileSync(helperSource, "utf8").replace(/\r\n/g, "\n");
const polishedHelper = patchOverlaySoundSource(helper);
fs.writeFileSync(helperTarget, polishedHelper, "utf8");
const patched = patchMainSource(main);
fs.writeFileSync(mainPath, patched, "utf8");
for (const marker of ["patchIntegratedSdLinkAchievementOverlay", "achievementOverlayPatch", "sdlink-achievement-overlay"]) {
  if (!patched.includes(marker)) throw new Error(`Achievement overlay marker missing after patch: ${marker}`);
}
for (const marker of ["ACHIEVEMENT_CHIME_DATA_URL", "media-src data:", "autoplay preload=\"auto\""]) {
  if (!polishedHelper.includes(marker)) throw new Error(`Achievement chime marker missing after patch: ${marker}`);
}
if (polishedHelper.includes("shell.beep()")) throw new Error("Windows system beep must not remain in final achievement overlay helper");
console.log(`Chapter 3-7 achievement unlock overlay patch applied with custom chime; base=${alreadyPatched ? "already-patched" : "exact-r5"}`);
