"use strict";

class CommitJournal {
  constructor({ commitSeq = 0, authorityEpoch = 0 } = {}) {
    this.commitSeq = Number(commitSeq) || 0;
    this.authorityEpoch = Number(authorityEpoch) || 0;
  }

  prepare(type, payload = {}) {
    if (!type || typeof type !== "string") throw new TypeError("EVENT_TYPE_REQUIRED");
    return Object.freeze({
      authority_epoch: this.authorityEpoch,
      commit_seq: this.commitSeq + 1,
      event_type: type,
      payload: JSON.parse(JSON.stringify(payload)),
    });
  }

  acknowledge(record) {
    if (!record || record.authority_epoch !== this.authorityEpoch) throw new Error("STALE_AUTHORITY_EPOCH");
    if (record.commit_seq !== this.commitSeq + 1) throw new Error("COMMIT_SEQ_GAP");
    this.commitSeq = record.commit_seq;
    return this.commitSeq;
  }
}

module.exports = { CommitJournal };
