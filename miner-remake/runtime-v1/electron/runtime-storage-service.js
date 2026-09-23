"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function checksum(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

class RuntimeStorageService {
  constructor(rootDir) {
    this.rootDir = path.resolve(rootDir);
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  _stem(runId, encounterId) {
    const safe = (value) => String(value).replace(/[^A-Za-z0-9._-]/g, "_");
    return `${safe(runId)}--${safe(encounterId)}`;
  }

  _paths(runId, encounterId) {
    const stem = this._stem(runId, encounterId);
    return {
      latest: path.join(this.rootDir, `${stem}.latest.json`),
      previous: path.join(this.rootDir, `${stem}.previous.json`),
      journal: path.join(this.rootDir, `${stem}.journal.ndjson`),
    };
  }

  async _atomicWriteJson(target, value) {
    const temp = `${target}.tmp-${process.pid}`;
    const handle = await fsp.open(temp, "w", 0o600);
    try {
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsp.rename(temp, target);
  }

  async writeSnapshot(snapshot) {
    if (!snapshot?.run_id || !snapshot?.encounter_id) throw new Error("SNAPSHOT_ID_REQUIRED");
    const paths = this._paths(snapshot.run_id, snapshot.encounter_id);
    const envelope = { checksum: checksum(snapshot), snapshot };
    try {
      await fsp.rename(paths.latest, paths.previous);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await this._atomicWriteJson(paths.latest, envelope);
    return paths.latest;
  }

  _readEnvelope(file) {
    if (!fs.existsSync(file)) return null;
    try {
      const envelope = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!envelope?.snapshot || envelope.checksum !== checksum(envelope.snapshot)) return null;
      return envelope.snapshot;
    } catch {
      return null;
    }
  }

  readSnapshots(runId, encounterId) {
    const paths = this._paths(runId, encounterId);
    return [this._readEnvelope(paths.latest), this._readEnvelope(paths.previous)].filter(Boolean);
  }

  async appendJournal(runId, encounterId, record) {
    const paths = this._paths(runId, encounterId);
    const envelope = { checksum: checksum(record), record };
    const handle = await fsp.open(paths.journal, "a", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(envelope)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return record.commit_seq;
  }

  readJournal(runId, encounterId) {
    const file = this._paths(runId, encounterId).journal;
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
    return lines.map((line) => {
      const envelope = JSON.parse(line);
      if (!envelope?.record || envelope.checksum !== checksum(envelope.record)) throw new Error("RCV_JOURNAL_CHECKSUM_INVALID");
      return envelope.record;
    });
  }
}

module.exports = { RuntimeStorageService, canonicalJson, checksum };
