"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  DURATION_SECONDS,
  SAMPLE_RATE,
  patchOverlaySoundSource,
  synthesizeAchievementChimeWav,
} = require("./achievement-overlay-sound-v2");

const wav1 = synthesizeAchievementChimeWav();
const wav2 = synthesizeAchievementChimeWav();
assert.deepEqual(wav1, wav2, "achievement chime synthesis must be deterministic");
assert.equal(wav1.toString("ascii", 0, 4), "RIFF");
assert.equal(wav1.toString("ascii", 8, 12), "WAVE");
assert.equal(wav1.readUInt16LE(20), 1, "custom chime must be PCM");
assert.equal(wav1.readUInt16LE(22), 1, "custom chime must be mono");
assert.equal(wav1.readUInt32LE(24), SAMPLE_RATE);
assert.equal(wav1.readUInt16LE(34), 16, "custom chime must be 16-bit PCM");
assert.equal(wav1.length, 44 + Math.floor(SAMPLE_RATE * DURATION_SECONDS) * 2);
assert.ok(wav1.length < 30000, "achievement chime should stay lightweight");
let nonZero = false;
for (let i = 44; i < wav1.length; i += 2) {
  if (wav1.readInt16LE(i) !== 0) { nonZero = true; break; }
}
assert.equal(nonZero, true, "achievement chime must contain audible PCM samples");

const sourcePath = path.join(__dirname, "..", "preview", "v024-core", "sdlink-achievement-overlay.js");
const source = fs.readFileSync(sourcePath, "utf8");
assert.match(source, /shell\.beep\(\)/, "v1 source fixture should expose the old system beep marker for deterministic replacement");
const patched = patchOverlaySoundSource(source);
const patchedTwice = patchOverlaySoundSource(patched);
assert.equal(patched, patchedTwice, "achievement sound polish must be idempotent");
assert.doesNotMatch(patched, /shell\.beep\(\)/, "Windows system beep must be removed");
assert.match(patched, /ACHIEVEMENT_CHIME_DATA_URL/);
assert.match(patched, /data:audio\/wav;base64,/);
assert.match(patched, /media-src data:/, "CSP should allow only embedded media for the chime");
assert.match(patched, /<audio[^>]+autoplay[^>]+preload="auto"/, "overlay should autoplay the embedded chime");
assert.doesNotMatch(patched, /child_process|powershell|cmd\.exe|https?:\/\/[^\s"']+\.(wav|mp3)/i, "sound playback must not spawn processes or fetch remote audio");
new vm.Script(patched, { filename: "sdlink-achievement-overlay-polished.js" });

const dataMatch = patched.match(/const ACHIEVEMENT_CHIME_DATA_URL = "data:audio\/wav;base64,([A-Za-z0-9+/=]+)";/);
assert.ok(dataMatch, "embedded chime data URL missing");
assert.deepEqual(Buffer.from(dataMatch[1], "base64"), wav1, "embedded runtime sound must equal deterministic reviewed synthesis");

console.log("Chapter 3-7 custom achievement chime v2 regression PASS");
