"use strict";

const fs = require("node:fs");
const path = require("node:path");

const STEP_STATES = new Set(["pending", "in_progress", "complete"]);

function validateRoadmap(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.chapters)) throw new Error("ROADMAP_DATA_INVALID");
  const chapterIds = new Set();
  const stepIds = new Set();
  for (const chapter of data.chapters) {
    const chapterId = String(chapter?.id || "").trim();
    if (!chapterId || chapterIds.has(chapterId) || !Array.isArray(chapter?.steps) || chapter.steps.length !== 8) throw new Error("ROADMAP_DATA_INVALID");
    chapterIds.add(chapterId);
    for (const step of chapter.steps) {
      const stepId = String(step?.id || "").trim();
      if (!stepId || stepIds.has(stepId) || !STEP_STATES.has(step?.status)) throw new Error("ROADMAP_DATA_INVALID");
      stepIds.add(stepId);
    }
  }
  return data;
}

function progressOf(chapter) {
  const total = Array.isArray(chapter?.steps) ? chapter.steps.length : 0;
  const complete = Array.isArray(chapter?.steps) ? chapter.steps.filter((step) => step.status === "complete").length : 0;
  return { complete, total, percent: total ? (complete / total) * 100 : 0 };
}

class RoadmapStore {
  constructor({ userDataPath, seedPath }) {
    this.filePath = path.join(userDataPath, "roadmap.json");
    this.seedPath = seedPath;
  }

  ensure() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) fs.copyFileSync(this.seedPath, this.filePath);
    return this.filePath;
  }

  read() {
    this.ensure();
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch (_error) {
      const error = new Error("ROADMAP_DATA_INVALID");
      error.code = "ROADMAP_DATA_INVALID";
      throw error;
    }
    return { roadmap: validateRoadmap(parsed), path: this.filePath };
  }
}

module.exports = { RoadmapStore, validateRoadmap, progressOf };
