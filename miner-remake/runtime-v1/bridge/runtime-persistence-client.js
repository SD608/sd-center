"use strict";

class RuntimePersistenceClient {
  constructor({ invoke, runId, encounterId }) {
    if (typeof invoke !== "function") throw new TypeError("IPC_INVOKE_REQUIRED");
    if (!runId || !encounterId) throw new TypeError("RUNTIME_IDS_REQUIRED");
    this.invoke = invoke;
    this.runId = runId;
    this.encounterId = encounterId;
  }

  appendJournal(record) {
    return this.invoke("miner-runtime:append-journal", {
      run_id: this.runId, encounter_id: this.encounterId, record,
    });
  }

  writeSnapshot(snapshot) {
    return this.invoke("miner-runtime:write-snapshot", {
      run_id: this.runId, encounter_id: this.encounterId, snapshot,
    });
  }

  readRecovery() {
    return this.invoke("miner-runtime:read-recovery", {
      run_id: this.runId, encounter_id: this.encounterId,
    });
  }
}

module.exports = { RuntimePersistenceClient };
