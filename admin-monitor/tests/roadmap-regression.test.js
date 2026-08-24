"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  RoadmapStore,
  validateRoadmap,
  validateLiveStatus,
  applyLiveStatus,
  progressOf,
  ALLOWED_REMOTE_URL
} = require("../lib/roadmap-store");

const root = path.join(__dirname, "..");
const seed = path.join(root, "roadmap.default.json");
const live = path.join(root, "lib", "roadmap-live.json");

function loadSeed() {
  return validateRoadmap(JSON.parse(fs.readFileSync(seed, "utf8")));
}

function loadLive() {
  return validateLiveStatus(JSON.parse(fs.readFileSync(live, "utf8")));
}

function findStep(roadmap, stepId) {
  for (const chapter of roadmap.chapters) {
    const step = chapter.steps.find((item) => item.id === stepId);
    if (step) return step;
  }
  return null;
}

test("official roadmap seed contains 14 chapters and 112 unique subchapters", () => {
  const data = loadSeed();
  assert.equal(data.chapters.length, 14);
  const ids = data.chapters.flatMap((chapter) => chapter.steps.map((step) => step.id));
  assert.equal(ids.length, 112);
  assert.equal(new Set(ids).size, 112);
});

test("live roadmap snapshot marks chapter 2 complete", () => {
  const official = applyLiveStatus(loadSeed(), loadLive());
  const chapter2 = official.chapters.find((chapter) => chapter.id === "2");
  assert.equal(chapter2.status, "complete");
  assert.equal(chapter2.label, "완료 / 공식 Release");
  assert.equal(findStep(official, "2-8").status, "complete");
  const completed = official.chapters.flatMap((chapter) => chapter.steps).filter((step) => step.status === "complete").length;
  assert.equal(completed, 16);
});

test("progress counts completed subchapters only", () => {
  const result = progressOf({ steps: [
    { status: "complete" }, { status: "complete" }, { status: "in_progress" }, { status: "pending" }
  ]});
  assert.deepEqual(result, { complete: 2, total: 4, percent: 50 });
});

test("existing roadmap userData custom values are preserved when official state does not advance them", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-roadmap-"));
  try {
    const store = new RoadmapStore({ userDataPath: dir, seedPath: seed, livePath: live });
    const first = store.read();
    first.roadmap.chapters[0].label = "사용자 수정값";
    fs.writeFileSync(store.filePath, JSON.stringify(first.roadmap), "utf8");
    const second = store.read();
    assert.equal(second.roadmap.chapters[0].label, "사용자 수정값");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("old 2-8 local state advances to official completion without resetting unrelated user data", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-roadmap-advance-"));
  try {
    const store = new RoadmapStore({ userDataPath: dir, seedPath: seed, livePath: live });
    store.ensure();
    const oldLocal = loadSeed();
    oldLocal.chapters[0].label = "사용자 수정값";
    fs.writeFileSync(store.filePath, JSON.stringify(oldLocal), "utf8");
    const result = store.read();
    const chapter2 = result.roadmap.chapters.find((chapter) => chapter.id === "2");
    assert.equal(findStep(result.roadmap, "2-8").status, "complete");
    assert.equal(chapter2.status, "complete");
    assert.equal(chapter2.label, "완료 / 공식 Release");
    assert.equal(result.roadmap.chapters[0].label, "사용자 수정값");
    assert.equal(result.sync.updated, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("chapter-only official next state advances even when no subchapter changes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-roadmap-chapter-next-"));
  try {
    const store = new RoadmapStore({ userDataPath: dir, seedPath: seed, livePath: live });
    store.ensure();
    const oldLocal = loadSeed();
    const chapter3Before = oldLocal.chapters.find((chapter) => chapter.id === "3");
    chapter3Before.status = "pending";
    chapter3Before.label = "대기";
    fs.writeFileSync(store.filePath, JSON.stringify(oldLocal), "utf8");
    const result = store.read();
    const chapter3 = result.roadmap.chapters.find((chapter) => chapter.id === "3");
    assert.equal(chapter3.status, "next");
    assert.equal(chapter3.label, "다음 단계");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("chapter completion advances even when local subchapters are already complete", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-roadmap-chapter-complete-"));
  try {
    const store = new RoadmapStore({ userDataPath: dir, seedPath: seed, livePath: live });
    store.ensure();
    const oldLocal = loadSeed();
    findStep(oldLocal, "2-8").status = "complete";
    const chapter2Before = oldLocal.chapters.find((chapter) => chapter.id === "2");
    assert.notEqual(chapter2Before.status, "complete");
    fs.writeFileSync(store.filePath, JSON.stringify(oldLocal), "utf8");
    const result = store.read();
    const chapter2 = result.roadmap.chapters.find((chapter) => chapter.id === "2");
    assert.equal(chapter2.status, "complete");
    assert.equal(chapter2.label, "완료 / 공식 Release");
    assert.equal(result.sync.updated, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("local completion is never downgraded by an older official pending state", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-roadmap-no-downgrade-"));
  try {
    const store = new RoadmapStore({ userDataPath: dir, seedPath: seed, livePath: live });
    const current = store.read();
    findStep(current.roadmap, "3-1").status = "complete";
    fs.writeFileSync(store.filePath, JSON.stringify(current.roadmap), "utf8");
    const next = store.read();
    assert.equal(findStep(next.roadmap, "3-1").status, "complete");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("remote refresh accepts only a newer validated revision and persists it for offline reads", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-roadmap-remote-"));
  try {
    const remote = {
      schema_version: 1,
      revision: 3,
      updated_at: "2026-08-22T05:00:00+09:00",
      chapters: {
        "2": { status: "complete", label: "완료 / 공식 Release" },
        "3": { status: "in_progress", label: "3-1 완료" }
      },
      steps: { "2-8": "complete", "3-1": "complete" }
    };
    const store = new RoadmapStore({
      userDataPath: dir,
      seedPath: seed,
      livePath: live,
      remoteUrl: ALLOWED_REMOTE_URL,
      fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify(remote) })
    });
    const synced = await store.sync();
    assert.equal(synced.sync.source, "remote");
    assert.equal(synced.sync.revision, 3);
    assert.equal(findStep(synced.roadmap, "3-1").status, "complete");
    assert.equal(fs.existsSync(store.cachePath), true);

    const offlineStore = new RoadmapStore({
      userDataPath: dir,
      seedPath: seed,
      livePath: live,
      remoteUrl: ALLOWED_REMOTE_URL,
      fetchImpl: async () => { throw new TypeError("offline"); }
    });
    const offline = await offlineStore.sync();
    assert.equal(offline.sync.source, "cache");
    assert.equal(offline.sync.revision, 3);
    assert.equal(findStep(offline.roadmap, "3-1").status, "complete");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("malformed roadmap is rejected without silently resetting data", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-roadmap-bad-"));
  try {
    const store = new RoadmapStore({ userDataPath: dir, seedPath: seed, livePath: live });
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
