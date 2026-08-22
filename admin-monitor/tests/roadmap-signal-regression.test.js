"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  RoadmapStore,
  validateRoadmap,
  validateRoadmapEvents,
  applyRoadmapEvents,
  progressOf
} = require("../lib/roadmap-store");

const root = path.join(__dirname, "..");
const seed = path.join(root, "roadmap.default.json");
const live = path.join(root, "lib", "roadmap-live.json");

function loadSeed() {
  return validateRoadmap(JSON.parse(fs.readFileSync(seed, "utf8")));
}

function signal(stepId, state, version = 1, extra = {}) {
  return {
    event_id: `roadmap-${stepId}-${state}-v${version}`,
    step_id: stepId,
    signal: state,
    occurred_at: "2026-08-22T16:00:00+09:00",
    evidence_type: "test",
    evidence_ref: "fixture",
    source: "test",
    created_at: "2026-08-22T16:00:00+09:00",
    ...extra
  };
}

function completedSteps(chapters) {
  return chapters.flatMap((chapter) => chapter.steps).filter((step) => step.status === "complete").length;
}

function completeChapter(chapterId) {
  return Array.from({ length: 8 }, (_, index) => signal(`${chapterId}-${index + 1}`, "complete"));
}

test("signal validation rejects forged event id and duplicate event id", () => {
  assert.throws(() => validateRoadmapEvents([
    signal("3-1", "complete", 1, { event_id: "roadmap-3-2-complete-v1" })
  ]), /ROADMAP_SIGNAL_INVALID/);
  assert.throws(() => validateRoadmapEvents([
    signal("3-1", "complete"), signal("3-1", "complete")
  ]), /ROADMAP_SIGNAL_INVALID/);
});

test("server signals derive chapter progress without hand-edited chapter status", () => {
  const events = [
    ...completeChapter("1"),
    ...completeChapter("2"),
    ...Array.from({ length: 6 }, (_, index) => signal(`3-${index + 1}`, "complete"))
  ];
  const roadmap = applyRoadmapEvents(loadSeed(), events);
  const chapter1 = roadmap.chapters.find((chapter) => chapter.id === "1");
  const chapter2 = roadmap.chapters.find((chapter) => chapter.id === "2");
  const chapter3 = roadmap.chapters.find((chapter) => chapter.id === "3");
  assert.equal(chapter1.status, "complete");
  assert.equal(chapter2.status, "complete");
  assert.equal(chapter3.status, "in_progress");
  assert.equal(chapter3.label, "6/8 완료");
  assert.deepEqual(progressOf(chapter3), { complete: 6, total: 8, percent: 75 });
  assert.equal(completedSteps(roadmap.chapters), 22);
});

test("started signal shows in progress and never counts as completed", () => {
  const roadmap = applyRoadmapEvents(loadSeed(), [
    ...completeChapter("1"), ...completeChapter("2"),
    signal("3-1", "complete"), signal("3-2", "started")
  ]);
  const chapter3 = roadmap.chapters.find((chapter) => chapter.id === "3");
  assert.equal(chapter3.steps.find((step) => step.id === "3-2").status, "in_progress");
  assert.deepEqual(progressOf(chapter3), { complete: 1, total: 8, percent: 12.5 });
});

test("complete wins over any started retry order for the same step", () => {
  const roadmap = applyRoadmapEvents(loadSeed(), [
    signal("3-1", "complete", 1),
    signal("3-1", "started", 2)
  ]);
  assert.equal(roadmap.chapters.find((chapter) => chapter.id === "3").steps[0].status, "complete");
});

test("first untouched chapter becomes next only after all prior chapters are complete", () => {
  const roadmap = applyRoadmapEvents(loadSeed(), [
    ...completeChapter("1"), ...completeChapter("2")
  ]);
  assert.equal(roadmap.chapters.find((chapter) => chapter.id === "3").status, "next");
  assert.equal(roadmap.chapters.find((chapter) => chapter.id === "4").status, "pending");
});

test("successful signal refresh persists cache and offline refresh reuses it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-roadmap-signal-"));
  try {
    const events = [...completeChapter("1"), ...completeChapter("2"), signal("3-1", "complete")];
    const store = new RoadmapStore({
      userDataPath: dir,
      seedPath: seed,
      livePath: live,
      eventProvider: async () => events
    });
    const online = await store.sync();
    assert.equal(online.sync.source, "signals");
    assert.equal(online.sync.signal_count, 17);
    assert.equal(fs.existsSync(store.signalCachePath), true);

    const offline = new RoadmapStore({
      userDataPath: dir,
      seedPath: seed,
      livePath: live,
      eventProvider: async () => { const error = new Error("offline"); error.code = "NETWORK_ERROR"; throw error; }
    });
    const cached = await offline.sync();
    assert.equal(cached.sync.source, "signal_cache");
    assert.equal(cached.sync.signal_count, 17);
    assert.equal(cached.roadmap.chapters.find((chapter) => chapter.id === "3").steps[0].status, "complete");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("signal source failure without cache falls back instead of resetting user roadmap", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-roadmap-signal-fallback-"));
  try {
    const store = new RoadmapStore({
      userDataPath: dir,
      seedPath: seed,
      livePath: live,
      eventProvider: async () => { const error = new Error("auth"); error.code = "AUTH_REQUIRED"; throw error; }
    });
    store.ensure();
    const local = loadSeed();
    local.chapters[0].label = "사용자 보존값";
    fs.writeFileSync(store.filePath, JSON.stringify(local), "utf8");
    const result = await store.sync();
    assert.equal(result.roadmap.chapters[0].label, "사용자 보존값");
    assert.equal(result.sync.remote_error, "ROADMAP_SIGNAL_REMOTE_FAILED");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
