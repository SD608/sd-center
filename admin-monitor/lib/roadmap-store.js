"use strict";

const fs = require("node:fs");
const path = require("node:path");

const STEP_STATES = new Set(["pending", "in_progress", "complete"]);
const CHAPTER_STATES = new Set(["pending", "next", "in_progress", "complete"]);
const SIGNAL_STATES = new Set(["started", "complete"]);
const STEP_RANK = Object.freeze({ pending: 0, in_progress: 1, complete: 2 });
const CHAPTER_RANK = Object.freeze({ pending: 0, next: 1, in_progress: 2, complete: 3 });
const STEP_ID_RE = /^(?:[1-9]|1[0-4])-[1-8]$/;
const EVENT_ID_RE = /^roadmap-(?:[1-9]|1[0-4])-[1-8]-(?:started|complete)-v[1-9][0-9]*$/;
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

function validateRoadmapEvents(data) {
  if (!Array.isArray(data)) throw codedError("ROADMAP_SIGNAL_INVALID");
  const ids = new Set();
  return data.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw codedError("ROADMAP_SIGNAL_INVALID");
    const eventId = String(raw.event_id || "").trim();
    const stepId = String(raw.step_id || "").trim();
    const signal = String(raw.signal || "").trim();
    if (!EVENT_ID_RE.test(eventId) || !STEP_ID_RE.test(stepId) || !SIGNAL_STATES.has(signal) || ids.has(eventId)) throw codedError("ROADMAP_SIGNAL_INVALID");
    const encodedStep = eventId.match(/^roadmap-((?:[1-9]|1[0-4])-[1-8])-/)?.[1];
    const encodedSignal = eventId.match(/-(started|complete)-v[1-9][0-9]*$/)?.[1];
    if (encodedStep !== stepId || encodedSignal !== signal) throw codedError("ROADMAP_SIGNAL_INVALID");
    ids.add(eventId);
    return {
      event_id: eventId,
      step_id: stepId,
      signal,
      occurred_at: raw.occurred_at ? String(raw.occurred_at) : "",
      evidence_type: raw.evidence_type == null ? null : String(raw.evidence_type),
      evidence_ref: raw.evidence_ref == null ? null : String(raw.evidence_ref),
      source: raw.source == null ? "" : String(raw.source),
      created_at: raw.created_at ? String(raw.created_at) : ""
    };
  });
}

function applyLiveStatus(baseRoadmap, liveStatus) {
  const roadmap = clone(validateRoadmap(baseRoadmap));
  const live = validateLiveStatus(liveStatus);
  const chapterMap = new Map(roadmap.chapters.map((chapter) => [String(chapter.id), chapter]));
  const stepMap = new Map();
  for (const chapter of roadmap.chapters) for (const step of chapter.steps) stepMap.set(String(step.id), step);
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

function applyRoadmapEvents(baseRoadmap, rawEvents) {
  const roadmap = clone(validateRoadmap(baseRoadmap));
  const events = validateRoadmapEvents(rawEvents);
  const stepMap = new Map();
  for (const chapter of roadmap.chapters) {
    for (const step of chapter.steps) {
      step.status = "pending";
      stepMap.set(String(step.id), step);
    }
  }

  for (const event of events) {
    const step = stepMap.get(event.step_id);
    if (!step) throw codedError("ROADMAP_SIGNAL_INVALID");
    if (event.signal === "complete") step.status = "complete";
    else if (step.status !== "complete") step.status = "in_progress";
  }

  for (const chapter of roadmap.chapters) {
    const complete = chapter.steps.filter((step) => step.status === "complete").length;
    const active = chapter.steps.some((step) => step.status !== "pending");
    if (complete === chapter.steps.length) {
      chapter.status = "complete";
      chapter.label = "완료";
    } else if (active) {
      chapter.status = "in_progress";
      chapter.label = `${complete}/8 완료`;
    } else {
      chapter.status = "pending";
      chapter.label = "대기";
    }
  }

  const firstIncomplete = roadmap.chapters.findIndex((chapter) => chapter.status !== "complete");
  if (firstIncomplete >= 0) {
    const chapter = roadmap.chapters[firstIncomplete];
    if (chapter.status === "pending" && roadmap.chapters.slice(0, firstIncomplete).every((item) => item.status === "complete")) {
      chapter.status = "next";
      chapter.label = "다음 단계";
    }
  }

  roadmap.signal_count = events.length;
  roadmap.official_updated_at = events.reduce((latest, event) => {
    const value = event.occurred_at || event.created_at || "";
    return value > latest ? value : latest;
  }, "");
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
  for (const localChapter of local.chapters) if (!officialChapterIds.has(String(localChapter.id))) chapters.push(clone(localChapter));
  return validateRoadmap({
    ...official,
    ...local,
    chapters,
    schema_version: official.schema_version,
    official_revision: official.official_revision,
    official_updated_at: official.official_updated_at,
    signal_count: official.signal_count
  });
}

function progressOf(chapter) {
  const total = Array.isArray(chapter?.steps) ? chapter.steps.length : 0;
  const complete = Array.isArray(chapter?.steps) ? chapter.steps.filter((step) => step.status === "complete").length : 0;
  return { complete, total, percent: total ? (complete / total) * 100 : 0 };
}

function readJson(filePath, code) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch (_error) { throw codedError(code); }
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
  constructor({ userDataPath, seedPath, livePath, remoteUrl = "", fetchImpl = globalThis.fetch, eventProvider = null }) {
    this.filePath = path.join(userDataPath, "roadmap.json");
    this.cachePath = path.join(userDataPath, "roadmap-live-cache.json");
    this.signalCachePath = path.join(userDataPath, "roadmap-signal-cache.json");
    this.seedPath = seedPath;
    this.livePath = livePath || path.join(path.dirname(seedPath), "lib", "roadmap-live.json");
    this.remoteUrl = remoteUrl;
    this.fetchImpl = fetchImpl;
    this.eventProvider = eventProvider;
  }

  ensure() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) fs.copyFileSync(this.seedPath, this.filePath);
    return this.filePath;
  }

  _base() { return validateRoadmap(readJson(this.seedPath, "ROADMAP_DATA_INVALID")); }
  _packagedLive() { return validateLiveStatus(readJson(this.livePath, "ROADMAP_LIVE_INVALID")); }
  _cachedLive() {
    if (!fs.existsSync(this.cachePath)) return null;
    try { return validateLiveStatus(readJson(this.cachePath, "ROADMAP_LIVE_INVALID")); }
    catch (_error) { return null; }
  }
  _cachedSignals() {
    if (!fs.existsSync(this.signalCachePath)) return null;
    try { return validateRoadmapEvents(readJson(this.signalCachePath, "ROADMAP_SIGNAL_INVALID")); }
    catch (_error) { return null; }
  }
  _currentLive() {
    const packaged = this._packagedLive();
    const cached = this._cachedLive();
    const live = higherRevision(packaged, cached);
    return { live, source: cached && live === cached ? "cache" : "packaged" };
  }

  _mergeOfficial(official, sync) {
    this.ensure();
    const local = validateRoadmap(readJson(this.filePath, "ROADMAP_DATA_INVALID"));
    const merged = mergeRoadmaps(local, official);
    const changed = JSON.stringify(local) !== JSON.stringify(merged);
    if (changed) writeJsonAtomic(this.filePath, merged);
    return { roadmap: merged, path: this.filePath, sync: { ...sync, updated: changed } };
  }

  _mergeLive(live, source, remoteError = "") {
    const official = applyLiveStatus(this._base(), live);
    return this._mergeOfficial(official, {
      source,
      revision: live.revision,
      updated_at: live.updated_at,
      remote_ok: source === "remote",
      remote_error: remoteError
    });
  }

  _mergeSignals(events, source, signalError = "") {
    const official = applyRoadmapEvents(this._base(), events);
    return this._mergeOfficial(official, {
      source,
      signal_count: events.length,
      updated_at: official.official_updated_at || "",
      remote_ok: source === "signals",
      remote_error: signalError
    });
  }

  read() {
    const cachedSignals = this._cachedSignals();
    if (cachedSignals) return this._mergeSignals(cachedSignals, "signal_cache");
    const current = this._currentLive();
    return this._mergeLive(current.live, current.source);
  }

  async _fetchRemoteLive() {
    if (!this.remoteUrl) throw codedError("ROADMAP_LIVE_REMOTE_DISABLED");
    if (this.remoteUrl !== ALLOWED_REMOTE_URL) throw codedError("ROADMAP_LIVE_REMOTE_INVALID");
    if (typeof this.fetchImpl !== "function") throw codedError("ROADMAP_LIVE_REMOTE_UNAVAILABLE");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await this.fetchImpl(this.remoteUrl, { method: "GET", cache: "no-store", redirect: "error", headers: { Accept: "application/json" }, signal: controller.signal });
      if (!response?.ok) throw codedError("ROADMAP_LIVE_REMOTE_FAILED");
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MAX_REMOTE_BYTES) throw codedError("ROADMAP_LIVE_REMOTE_FAILED");
      return validateLiveStatus(JSON.parse(text));
    } catch (error) {
      if (error?.code) throw error;
      throw codedError("ROADMAP_LIVE_REMOTE_FAILED");
    } finally { clearTimeout(timeout); }
  }

  async sync() {
    if (typeof this.eventProvider === "function") {
      try {
        const events = validateRoadmapEvents(await this.eventProvider());
        writeJsonAtomic(this.signalCachePath, events);
        return this._mergeSignals(events, "signals");
      } catch (error) {
        const cachedSignals = this._cachedSignals();
        if (cachedSignals) return this._mergeSignals(cachedSignals, "signal_cache", error?.code || "ROADMAP_SIGNAL_REMOTE_FAILED");
      }
    }

    const current = this._currentLive();
    if (!this.remoteUrl) return this._mergeLive(current.live, current.source, this.eventProvider ? "ROADMAP_SIGNAL_REMOTE_FAILED" : "");
    try {
      const remote = await this._fetchRemoteLive();
      const live = higherRevision(current.live, remote);
      const source = live === remote ? "remote" : current.source;
      if (live === remote && Number(remote.revision) >= Number(current.live.revision)) writeJsonAtomic(this.cachePath, remote);
      return this._mergeLive(live, source, this.eventProvider ? "ROADMAP_SIGNAL_REMOTE_FAILED" : "");
    } catch (error) {
      return this._mergeLive(current.live, current.source, error?.code || "ROADMAP_LIVE_REMOTE_FAILED");
    }
  }
}

module.exports = {
  RoadmapStore,
  validateRoadmap,
  validateLiveStatus,
  validateRoadmapEvents,
  applyLiveStatus,
  applyRoadmapEvents,
  mergeRoadmaps,
  progressOf,
  ALLOWED_REMOTE_URL
};
