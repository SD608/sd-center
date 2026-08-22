"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const custom = fs.readFileSync("assets/js/achievement-custom-ui.js", "utf8");
const renderer = fs.readFileSync("assets/js/achievements-all.js", "utf8");
const sync = fs.readFileSync("assets/js/achievement-sync.js", "utf8");

// Chapter 3-6 removes the historical 49-code pending workaround. All official
// acquisition state must come from the canonical server/Core read model.
assert.doesNotMatch(custom, /PENDING_IDS/, "stale pending achievement authority list must be removed");
assert.match(renderer, /Boolean\(item\?\.unlocked\)/, "completion must read canonical server unlocked state");
assert.doesNotMatch(renderer, /current_value[^\n]*(?:>=|>)\s*(?:target|item\.)/, "renderer must not infer unlock from numeric progress");
assert.match(sync, /get_sd_achievement_center_v1/, "canonical achievement center RPC missing");
assert.doesNotMatch(sync, /sync_sd_achievement_progress/, "client achievement sync submission must not return");
assert.match(sync, /Client-derived achievement claims are never submitted/, "read-only compatibility contract missing");

// Preserve established UI functionality while replacing the obsolete pending model.
for (const marker of ["achievement-drag-handle", "saveRemoteOrder", "loadRemoteOrder", "achievement-completed-tab"]) {
  assert.ok(custom.includes(marker), `existing achievement UI feature lost: ${marker}`);
}
assert.ok(custom.includes("sd_user_preferences"), "category ordering must remain account-synced");
assert.ok(custom.includes("기본 순서"), "category order reset control missing");

console.log("SD Achievement UI authority regression PASS");
