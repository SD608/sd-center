"use strict";

const { SimulationClock } = require("./simulation-clock");
const { CommitJournal } = require("./commit-journal");

const deepClone = (value) => JSON.parse(JSON.stringify(value));

class EncounterCore {
  constructor(input = {}) {
    this.state = {
      schema_version: 1,
      run_id: input.run_id || "dev-run",
      encounter_id: input.encounter_id || "abister-dev",
      boss_id: input.boss_id || "abister",
      authority_epoch: Number(input.authority_epoch || 0),
      snapshot_generation: Number(input.snapshot_generation || 0),
      commit_seq: Number(input.commit_seq ?? input.base_commit_seq ?? 0),
      boss: deepClone(input.boss || { hp: 3600, phase: "P1", x: 0, y: 0, seal_committed: false }),
      participants: deepClone(input.participants || {}),
      hazards: deepClone(input.hazards || []),
      p3_env: deepClone(input.p3_env || { active: false, remaining_ms: 5000 }),
      attack_history: deepClone(input.attack_history || []),
      last_resume_checkpoint_utc: input.last_resume_checkpoint_utc || null,
    };
    this.clock = new SimulationClock(input.clock || {});
    this.journal = new CommitJournal({ commitSeq: this.state.commit_seq, authorityEpoch: this.state.authority_epoch });
  }

  tick(deltaMs) { return this.clock.advance(deltaMs); }
  hold(reason) { this.clock.hold(reason); }
  resume() { this.clock.resume(); }

  async commit(type, payload, persistence) {
    if (!persistence || typeof persistence.appendJournal !== "function") throw new TypeError("PERSISTENCE_REQUIRED");
    const record = this.journal.prepare(type, payload);
    await persistence.appendJournal(record);
    this.applyRecord(record);
    this.journal.acknowledge(record);
    this.state.commit_seq = this.journal.commitSeq;
    return record;
  }

  replayRecord(record) {
    if (!record || record.authority_epoch !== this.state.authority_epoch) throw new Error("STALE_AUTHORITY_EPOCH");
    if (record.commit_seq !== this.journal.commitSeq + 1) throw new Error("COMMIT_SEQ_GAP");
    this.applyRecord(record);
    this.journal.acknowledge(record);
    this.state.commit_seq = this.journal.commitSeq;
  }

  applyRecord(record) {
    if (record.authority_epoch !== this.state.authority_epoch) throw new Error("STALE_AUTHORITY_EPOCH");
    switch (record.event_type) {
      case "TARGET_ACQUIRE":
        this.state.boss.target_id = record.payload.target_id || null;
        break;
      case "BOSS_TRANSFORM":
        this.state.boss.x = Number(record.payload.x);
        this.state.boss.y = Number(record.payload.y);
        if (record.payload.facing != null) this.state.boss.facing = record.payload.facing;
        break;
      case "BOSS_HP_COMMIT":
        this.state.boss.hp = Math.max(0, Number(record.payload.hp));
        break;
      case "PHASE_COMMIT":
        this.state.boss.phase = String(record.payload.phase);
        break;
      case "PARTICIPANT_STATE":
        this.state.participants[record.payload.player_id] = deepClone(record.payload.state);
        break;
      case "BOSS_SEAL_COMMIT":
        this.state.boss.seal_committed = true;
        break;
      case "BOSS_SEAL_RELEASE":
        this.state.boss.seal_committed = false;
        break;
      default:
        break;
    }
  }

  snapshot() {
    const commitSeq = this.journal.commitSeq;
    return deepClone({
      ...this.state,
      clock: this.clock.snapshot(),
      base_commit_seq: commitSeq,
      commit_seq: commitSeq,
    });
  }
}

module.exports = { EncounterCore };
