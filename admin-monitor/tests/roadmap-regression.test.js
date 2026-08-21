"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { RoadmapStore, validateRoadmap, progressOf } = require("../lib/roadmap-store");

const root = path.join(__dirname, "..");
const seed = path.join(root, "roadmap.default.json");

test("official roadmap seed contains 14 chapters and 112 unique subchapters", () => {
  const data = validateRoadmap(JSON.parse(fs.readFileSync(seed, "utf8")));
  assert.equal(data.chapters.length, 14);
  const ids = data.chapters.flatMap((chapter) => chapter.steps.map((step) => step.id));
  assert.equal(ids.length, 112);
  assert.equal(new Set(ids).size, 112);
});

test("progress counts completed subchapters only", () => {
  const result = progressOf({ steps: [
    { status: "complete" }, { status: "complete" }, { status: "in_progress" }, { status: "pending" }
  ]});
  assert.deepEqual(result, { complete: 2, total: 4, percent: 50 });
});

test("existing roadmap userData is preserved instead of overwritten", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-roadmap-"));
  try {
    const store = new RoadmapStore({ userDataPath: dir, seedPath: seed });
    const first = store.read();
    first.roadmap.chapters[0].label = "사용자 수정값";
    fs.writeFileSync(store.filePath, JSON.stringify(first.roadmap), "utf8");
    const second = store.read();
    assert.equal(second.roadmap.chapters[0].label, "사용자 수정값");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("malformed roadmap is rejected without silently resetting data", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-roadmap-bad-"));
  try {
    const store = new RoadmapStore({ userDataPath: dir, seedPath: seed });
    store.ensure();
    fs.writeFileSync(store.filePath, "{broken", "utf8");
    assert.throws(() => store.read(), /ROADMAP_DATA_INVALID/);
    assert.equal(fs.readFileSync(store.filePath, "utf8"), "{broken");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("packaged product name stays stable so existing Electron userData path is preserved", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.build.appId, "com.sd608.adminmonitor");
  assert.equal(pkg.build.productName, "SD 사용자 현황");
});
