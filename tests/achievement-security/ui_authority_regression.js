"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");

const file = fs.readFileSync("assets/js/achievement-custom-ui.js", "utf8");

const pendingBlock = file.match(/const PENDING_IDS = new Set\(\[([\s\S]*?)\]\);/);
assert.ok(pendingBlock, "PENDING_IDS set missing");
const pendingIds = [...pendingBlock[1].matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1]);
assert.equal(new Set(pendingIds).size, 49, "pending achievement set must be exactly 49 unique codes");
assert.ok(pendingIds.includes("bitcoin-05"), "unimplemented bitcoin-05 must remain pending");
assert.ok(pendingIds.includes("logistics-01"), "unvalidated logistics achievements must remain pending");
assert.ok(!pendingIds.includes("wallet-01"), "server-authoritative wallet achievements must stay active");
assert.ok(!pendingIds.includes("gold-01"), "server-authoritative gold achievements must stay active");
assert.ok(!pendingIds.includes("slot-01"), "server-authoritative slot achievements must stay active");

const isDone = file.match(/function isDone\(item\) \{([\s\S]*?)\n  \}/);
assert.ok(isDone, "isDone missing");
assert.match(isDone[1], /unlocked\(\)\[item\.id\]/, "completion must read server unlocked state");
assert.doesNotMatch(isDone[1], /current_value|progress\(|item\.t|>=/, "completion must not infer unlock from client progress threshold");

assert.match(file, /const pending = PENDING_IDS\.has\(item\.id\) && !earned/, "previously earned pending achievements must remain earned");
assert.match(file, /badge\.textContent = "준비 중"/, "pending achievements need explicit status");
assert.match(file, /card\.querySelector\("\.achievement-progress"\)\?\.remove\(\)/, "pending client progress must not be presented as active progress");
assert.match(file, /등록 업적 \$\{all\.length\}개 · 활성 \$\{active\}개 · 달성 \$\{completed\}개/, "active/pending catalog count missing");

// Preserve pre-existing custom UI functionality while adding authority rules.
for (const marker of ["buildCompletedView", "achievement-drag-handle", "saveRemoteOrder", "loadRemoteOrder"]) {
  assert.ok(file.includes(marker), `existing achievement UI feature lost: ${marker}`);
}

console.log("SD Achievement UI authority regression PASS");
