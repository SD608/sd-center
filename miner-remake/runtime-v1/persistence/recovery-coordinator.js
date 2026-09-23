"use strict";

const { EncounterCore } = require("../core/encounter-core");
const RECOVERY_WINDOW_MS = 72 * 60 * 60 * 1000;

class RecoveryCoordinator {
  constructor({ supportedSchemaVersion = 1 } = {}) {
    this.supportedSchemaVersion = supportedSchemaVersion;
  }

  selectSnapshot(snapshots) {
    const supported = (snapshots || []).filter((s) => s && s.schema_version === this.supportedSchemaVersion);
    if (!supported.length) return null;
    return supported.sort((a, b) => (b.snapshot_generation || 0) - (a.snapshot_generation || 0))[0];
  }

  validateJournal(snapshot, records) {
    let expected = Number(snapshot.base_commit_seq ?? snapshot.commit_seq ?? 0) + 1;
    const replay = [];
    for (const record of (records || []).filter((r) => r.commit_seq >= expected).sort((a, b) => a.commit_seq - b.commit_seq)) {
      if (record.commit_seq !== expected) return { ok: false, code: "RCV_JOURNAL_GAP" };
      if (record.authority_epoch !== snapshot.authority_epoch) return { ok: false, code: "RCV_AUTHORITY_EPOCH_MISMATCH" };
      replay.push(record);
      expected += 1;
    }
    return { ok: true, replay };
  }

  recover({ trustedNowUtc, snapshots, journal, geometry, savedPlayerTransform }) {
    if (!trustedNowUtc) return { ok: false, code: "TIME_VALIDATION_PENDING" };
    const snapshot = this.selectSnapshot(snapshots);
    if (!snapshot) return { ok: false, code: "RECOVERY_BLOCKED" };
    const checkpoint = Date.parse(snapshot.last_resume_checkpoint_utc || "");
    const trusted = Date.parse(trustedNowUtc);
    if (!Number.isFinite(checkpoint) || !Number.isFinite(trusted)) return { ok: false, code: "TIME_VALIDATION_PENDING" };
    if (trusted - checkpoint > RECOVERY_WINDOW_MS) return { ok: false, code: "RUN_RECOVERY_EXPIRED" };

    const continuity = this.validateJournal(snapshot, journal);
    if (!continuity.ok) return continuity;

    const core = new EncounterCore(snapshot);
    try {
      continuity.replay.forEach((record) => core.replayRecord(record));
    } catch (error) {
      return { ok: false, code: error.message === "STALE_AUTHORITY_EPOCH" ? "RCV_AUTHORITY_EPOCH_MISMATCH" : "RCV_JOURNAL_GAP" };
    }
    const recovered = core.snapshot();
    const boss = geometry.recoverBossTransform(recovered.boss);
    if (!boss.ok) return boss;
    recovered.boss = { ...recovered.boss, ...boss.position };

    const player = geometry.findPlayerPlacement(savedPlayerTransform);
    if (!player.ok) return player;
    return { ok: true, code: "READY", recovered_state: recovered, replay: continuity.replay, boss, player };
  }
}

module.exports = { RecoveryCoordinator, RECOVERY_WINDOW_MS };
