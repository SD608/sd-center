"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SOUND_MARK = "ACHIEVEMENT_CHIME_DATA_URL";
const DEFAULT_MP3_PATH = path.join(__dirname, "..", "assets", "audio", "achievement-unlock-13.mp3");
const MIN_MP3_BYTES = 1024;
const EXPECTED_MP3_BYTES = 71889;
const EXPECTED_MP3_SHA256 = "33b200c45be66dfecd8130e94b8942b34720abe8fdffb36981aa18286f78237a";

function hasMp3Signature(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 3) return false;
  if (bytes.subarray(0, 3).toString("ascii") === "ID3") return true;
  // MPEG audio frame sync: 11 set bits followed by a valid non-reserved layer/version nibble.
  for (let i = 0; i < Math.min(bytes.length - 1, 4096); i += 1) {
    if (bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0) return true;
  }
  return false;
}

function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function validateAchievementChimeMp3(bytes) {
  if (!Buffer.isBuffer(bytes)) {
    throw new Error("reviewed achievement MP3 must be a Buffer");
  }
  if (bytes.length < MIN_MP3_BYTES) {
    throw new Error(`reviewed achievement MP3 is too small/placeholder: ${bytes.length} bytes`);
  }
  if (bytes.length !== EXPECTED_MP3_BYTES) {
    throw new Error(`reviewed achievement MP3 size mismatch: expected=${EXPECTED_MP3_BYTES} actual=${bytes.length}`);
  }
  if (!hasMp3Signature(bytes)) {
    throw new Error("reviewed achievement sound is not a valid-looking MP3 asset");
  }
  const actualSha256 = sha256Hex(bytes);
  if (actualSha256 !== EXPECTED_MP3_SHA256) {
    throw new Error(`reviewed achievement MP3 SHA-256 mismatch: expected=${EXPECTED_MP3_SHA256} actual=${actualSha256}`);
  }
  return bytes;
}

function loadAchievementChimeMp3(mp3Path = DEFAULT_MP3_PATH) {
  if (!fs.existsSync(mp3Path)) {
    throw new Error(`reviewed achievement MP3 missing: ${mp3Path}`);
  }
  return validateAchievementChimeMp3(fs.readFileSync(mp3Path));
}

function patchOverlaySoundSource(sourceInput, mp3Bytes = loadAchievementChimeMp3()) {
  const source = String(sourceInput || "");
  if (source.includes(SOUND_MARK)) return source;
  if (!source.includes("try { shell.beep(); } catch {}")) {
    throw new Error("achievement overlay system beep marker missing");
  }
  if (!source.includes("const ACHIEVEMENTS_URL =")) {
    throw new Error("achievement overlay URL marker missing");
  }
  validateAchievementChimeMp3(mp3Bytes);

  const mp3Base64 = mp3Bytes.toString("base64");
  let output = source.replace(
    /const ACHIEVEMENTS_URL = ([^;]+);/,
    (match) => `${match}\nconst ACHIEVEMENT_CHIME_DATA_URL = "data:audio/mpeg;base64,${mp3Base64}";`,
  );
  output = output.replace(
    "default-src 'none'; style-src 'unsafe-inline'",
    "default-src 'none'; style-src 'unsafe-inline'; media-src data:",
  );
  output = output.replace(
    '<div class="arrow">›</div></a></body></html>',
    '<div class="arrow">›</div></a><audio aria-hidden="true" autoplay preload="auto" src="${ACHIEVEMENT_CHIME_DATA_URL}"></audio></body></html>',
  );
  output = output.replace(/^\s*try \{ shell\.beep\(\); \} catch \{\}\r?\n/m, "");

  for (const marker of [SOUND_MARK, "data:audio/mpeg;base64,", "media-src data:", "autoplay preload=\"auto\""]) {
    if (!output.includes(marker)) throw new Error(`achievement MP3 marker missing after patch: ${marker}`);
  }
  if (output.includes("shell.beep()")) throw new Error("system beep remained after achievement MP3 patch");
  return output;
}

module.exports = {
  DEFAULT_MP3_PATH,
  EXPECTED_MP3_BYTES,
  EXPECTED_MP3_SHA256,
  MIN_MP3_BYTES,
  hasMp3Signature,
  loadAchievementChimeMp3,
  patchOverlaySoundSource,
  sha256Hex,
  validateAchievementChimeMp3,
};
