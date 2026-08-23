"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  DEFAULT_MP3_PATH,
  EXPECTED_MP3_BYTES,
  EXPECTED_MP3_SHA256,
  MIN_MP3_BYTES,
  hasMp3Signature,
  loadAchievementChimeMp3,
  patchOverlaySoundSource,
} = require("./achievement-overlay-sound-v2");

assert.equal(path.basename(DEFAULT_MP3_PATH), "achievement-unlock-13.mp3");
assert.equal(fs.existsSync(DEFAULT_MP3_PATH), true, "reviewed 13.mp3 asset must exist");
const mp3 = loadAchievementChimeMp3();
assert.ok(mp3.length >= MIN_MP3_BYTES, "reviewed 13.mp3 must not be a placeholder");
assert.equal(mp3.length, EXPECTED_MP3_BYTES, "repository MP3 byte size must equal the reviewed 13.mp3");
assert.equal(crypto.createHash("sha256").update(mp3).digest("hex"), EXPECTED_MP3_SHA256, "repository MP3 SHA-256 must equal the reviewed 13.mp3");
assert.equal(hasMp3Signature(mp3), true, "reviewed sound asset must look like MP3 data");
assert.notEqual(mp3.toString("utf8"), "TEMP", "TEMP placeholder must never pass the release gate");

const sourcePath = path.join(__dirname, "..", "preview", "v024-core", "sdlink-achievement-overlay.js");
const source = fs.readFileSync(sourcePath, "utf8");
assert.match(source, /shell\.beep\(\)/, "v1 source fixture should expose the old system beep marker for deterministic replacement");
const patched = patchOverlaySoundSource(source, mp3);
const patchedTwice = patchOverlaySoundSource(patched, mp3);
assert.equal(patched, patchedTwice, "achievement sound patch must be idempotent");
assert.doesNotMatch(patched, /shell\.beep\(\)/, "Windows system beep must be removed");
assert.match(patched, /ACHIEVEMENT_CHIME_DATA_URL/);
assert.match(patched, /data:audio\/mpeg;base64,/);
assert.match(patched, /media-src data:/, "CSP should allow only embedded media for the chime");
assert.match(patched, /<audio[^>]+autoplay[^>]+preload="auto"/, "overlay should autoplay the embedded chime");
assert.doesNotMatch(patched, /child_process|powershell|cmd\.exe|https?:\/\/[^\s"']+\.(wav|mp3)/i, "sound playback must not spawn processes or fetch remote audio");
new vm.Script(patched, { filename: "sdlink-achievement-overlay-polished.js" });

const dataMatch = patched.match(/const ACHIEVEMENT_CHIME_DATA_URL = "data:audio\/mpeg;base64,([A-Za-z0-9+/=]+)";/);
assert.ok(dataMatch, "embedded reviewed MP3 data URL missing");
const embedded = Buffer.from(dataMatch[1], "base64");
assert.deepEqual(embedded, mp3, "runtime sound must exactly equal the reviewed repository 13.mp3 bytes");
assert.equal(embedded.length, EXPECTED_MP3_BYTES, "embedded runtime MP3 size must remain exact");
assert.equal(crypto.createHash("sha256").update(embedded).digest("hex"), EXPECTED_MP3_SHA256, "embedded runtime MP3 SHA-256 must remain exact");

console.log("Chapter 3-7 reviewed achievement MP3 integrity regression PASS");
