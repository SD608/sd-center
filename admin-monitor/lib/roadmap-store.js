"use strict";

const fs = require("node:fs");
const path = require("node:path");

const STEP_STATES = new Set(["pending", "in_progress", "complete"]);
const CHAPTER_STATES = new Set(["pending", "next", "in_progress", "complete"]);
const STEP_RANK = Object.freeze({ pending: 0, in_progress: 1, complete: 2 });
const CHAPTER_RANK = Object.freeze({ pending: 0, next: 1, in_progress: 2, complete: 3 });
const ALLOWED_REMOTE_URL = "https://raw.githubusercontent.com/SD608/sd-center/data/roadmap-live/admin-monitor/lib/roadmap-live.json";
const MAX_REMOTE_BYTES = 64 * 1024;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function validateRoadmap(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.chapters)) throw codedError("ROADMAP_DATA_INVALID");
  const chapterIds = new Set();
  const stepIds = new Set();
  for (const chapter of data.chapters) {
    const chapterId = String(chapter?.id || "").trim();
    if (!chapterId || chapterIds.has(chapterId) || !Array.isArray(chapter?.steps) || chapter.steps.length !== 8) throw codedError("ROADMAP_DATA_INVALID");
    chapterIds.add(chapterId);
    for (const step of chapter.steps) {
      const stepId = String(step?.id || "").trim();
      if (!stepId || stepIds.has(stepId) || !STEP_STATES.has(step?.status)) throw codedError("ROADMAP_DATA_INVALID");
      stepIds.add(stepId);
    }
  }
  return data;
}

function validateLiveStatus(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw codedError("ROADMAP_LIVE_INVALID");
  if (Number(data.schema_version) !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 1) throw codedError("ROADMAP_LIVE_INVALID");
  if (typeof data.updated_at !== "string" || !data.updated_at.trim()) throw codedError("ROADMAP_LIVE_INVALID");
  if (!data.steps || typeof data.steps !== "object" || Array.isArray(data.steps)) throw codedError("ROADMAP_LIVE_INVALID");
  if (!data.chapters || typeof data.chapters !== "object" || Array.isArray(data.chapters)) throw codedError("ROADMAP_LIVE_INVALID");
  for (const [stepId, status] of Object.entries(data.steps)) {
    if (!String(stepId).trim() || !STEP_STATES.has(status)) throw codedError("ROADMAP_LIVE_INVALID");
  }
  for (const [chapterId, patch] of Object.entries(data.chapters)) {
    if (!String(chapterId).trim() || !patch || typeof patch !== "object" || Array.isArray(patch)) throw codedError("ROADMAP_LIVE_INVALID");
    if (patch.status !== undefined && !CHAPTER_STATES.has(patch.status)) throw codedError("ROADMAP_LIVE_INVALID");
    if (patch.label !== undefined && typeof patch.label !== "string") throw codedError("ROADMAP_LIVE_INVALID");
  }
  return data;
}

function applyLiveStatus(baseRoadmap, liveStatus) {
  const roadmap = clone(validateRoadmap(baseRoadmap));
  const live = validateLiveStatus(liveStatus);
  const chapterMap = new Map(roadmap.chapters.map((chapter) => [String(chapter.id), chapter]));
  const stepMap = new Map();
  for (const chapter of roadmap.chapters) {
    for (const step of chapter.steps) stepMap.set(String(step.id), step);
  }
  for (const [stepId, status] of Object.entries(live.steps)) {
    const step = stepMap.get(String(stepId));
    if (!step) throw codedError("ROADMAP_LIVE_INVALID");
    step.status = status;
  }
  for (const [chapterId, patch] of Object.entries(live.chapters)) {
    const chapter = chapterMap.get(String(chapterId));
    if (!chapter) throw codedError("ROADMAP_LIVE_INVALID");
    if (patch.status !== undefined) chapter.status = patch.status;
    if (patch.label !== undefined) chapter.label = patch.label;
  }
  roadmap.official_revision = live.revision;
  roadmap.official_updated_at = live.updated_at;
  return validateRoadmap(roadmap);
}

function mergeRoadmaps(localRoadmap, officialRoadmap) {
  const local = validateRoadmap(localRoadmap);
  const official = validateRoadmap(officialRoadmap);
  const localChapters = new Map(local.chapters.map((chapter) => [String(chapter.id), chapter]));
  const officialChapterIds = new Set(official.chapters.map((chapter) => String(chapter.id)));
  const chapters = official.chapters.map((officialChapter) => {
    const localChapter = localChapters.get(String(officialChapter.id));
    if (!localChapter) return clone(officialChapter);
    const localSteps = new Map(localChapter.steps.map((step) => [String(step.id), step]));
    const steps = officialChapter.steps.map((officialStep) => {
      const localStep = localSteps.get(String(officialStep.id));
      if (!localStep) return clone(officialStep);
      const localRank = STEP_RANK[localStep.status];
      const officialRank = STEP_RANK[officialStep.status];
      const status = officialRank > localRank ? officialStep.status : localStep.status;
      return { ...officialStep, ...localStep, status };
    });
    const mergedChapter = { ...officialChapter, ...localChapter, steps };
    const localChapterRank = CHAPTER_RANK[localChapter.status] ?? 0;
    const officialChapterRank = CHAPTER_RANK[officialChapter.status] ?? 0;
    if (officialChapterRank > localChapterRank) {
      mergedChapter.status = officialChapter.status;
      if (officialChapter.label) mergedChapter.label = officialChapter.label;
    }
    return mergedChapter;
  });
  for (const localChapter of local.chapters) {
    if (!officialChapterIds.has(String(localChapter.id))) chapters.push(clone(localChapter));
  }
  return validateRoadmap({
    ...official,
    ...local,
    chapters,
    schema_version: official.schema_version,
    official_revision: official.official_revision,
    official_updated_at: official.official_updated_at
  });
}

function progressOf(chapter) {
  const total = Array.isArray(chapter?.steps) ? chapter.steps.length : 0;
  const complete = Array.isArray(chapter?.steps) ? chapter.steps.filter((step) => step.status === "complete").length : 0;
  return { complete, total, percent: total ? (complete / total) * 100 : 0 };
}

function readJson(filePath, code) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    throw codedError(code);
  }
}

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(data), "utf8");
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
  }
}

function higherRevision(a, b) {
  if (!a) return b;
  if (!b) return a;
  return Number(b.revision) > Number(a.revision) ? b : a;
}

class RoadmapStore {
  constructor({ userDataPath, seedPath, livePath, remoteUrl = "", fetchImpl = globalThis.fetch }) {
    this.filePath = path.join(userDataPath, "roadmap.json");
    this.cachePath = path.join(userDataPath, "roadmap-live-cache.json");
    this.seedPath = seedPath;
    this.livePath = livePath || path.join(path.dirname(seedPath), "lib", "roadmap-live.json");
    this.remoteUrl = remoteUrl;
    this.fetchImpl = fetchImpl;
  }

  ensure() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) fs.copyFileSync(this.seedPath, this.filePath);
    return this.filePath;
  }

  _packagedLive() {
    return validateLiveStatus(readJson(this.livePath, "ROADMAP_LIVE_INVALID"));
  }

  _cachedLive() {
    if (!fs.existsSync(this.cachePath)) return null;
    try {
      return validateLiveStatus(readJson(this.cachePath, "ROADMAP_LIVE_INVALID"));
    } catch (_error) {
      return null;
    }
  }

  _currentLive() {
    const packaged = this._packagedLive();
    const cached = this._cachedLive();
    const live = higherRevision(packaged, cached);
    return { live, source: cached && live === cached ? "cache" : "packaged" };
  }

  _merge(live, source, remoteError = "") {
    this.ensure();
    const local = validateRoadmap(readJson(this.filePath, "ROADMAP_DATA_INVALID"));
    const base = validateRoadmap(readJson(this.seedPath, "ROADMAP_DATA_INVALID"));
    const official = applyLiveStatus(base, live);
    const merged = mergeRoadmaps(local, official);
    const changed = JSON.stringify(local) !== JSON.stringify(merged);
    if (changed) writeJsonAtomic(this.filePath, merged);
    return {
      roadmap: merged,
      path: this.filePath,
      sync: {
        source,
        updated: changed,
        revision: live.revision,
        updated_at: live.updated_at,
        remote_ok: source === "remote",
        remote_error: remoteError
      }
    };
  }

  read() {
    const current = this._currentLive();
    return this._merge(current.live, current.source);
  }

  async _fetchRemoteLive() {
    if (!this.remoteUrl) throw codedError("ROADMAP_LIVE_REMOTE_DISABLED");
    if (this.remoteUrl !== ALLOWED_REMOTE_URL) throw codedError("ROADMAP_LIVE_REMOTE_INVALID");
    if (typeof this.fetchImpl !== "function") throw codedError("ROADMAP_LIVE_REMOTE_UNAVAILABLE");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await this.fetchImpl(this.remoteUrl, {
        method: "GET",
        cache: "no-store",
        redirect: "error",
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      if (!response?.ok) throw codedError("ROADMAP_LIVE_REMOTE_FAILED");
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MAX_REMOTE_BYTES) throw codedError("ROADMAP_LIVE_REMOTE_FAILED");
      return validateLiveStatus(JSON.parse(text));
    } catch (error) {
      if (error?.code) throw error;
      throw codedError("ROADMAP_LIVE_REMOTE_FAILED");
    } finally {
      clearTimeout(timeout);
    }
  }

  async sync() {
    const current = this._currentLive();
    if (!this.remoteUrl) return this._merge(current.live, current.source);
    try {
      const remote = await this._fetchRemoteLive();
      const live = higherRevision(current.live, remote);
      const source = live === remote ? "remote" : current.source;
      if (live === remote && Number(remote.revision) >= Number(current.live.revision)) writeJsonAtomic(this.cachePath, remote);
      return this._merge(live, source);
    } catch (error) {
      return this._merge(current.live, current.source, error?.code || "ROADMAP_LIVE_REMOTE_FAILED");
    }
  }
}

module.exports = {
  RoadmapStore,
  validateRoadmap,
  validateLiveStatus,
  applyLiveStatus,
  mergeRoadmaps,
  progressOf,
  ALLOWED_REMOTE_URL
};
