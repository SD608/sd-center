"use strict";

const CHANNELS = Object.freeze({
  APPEND_JOURNAL: "miner-runtime:append-journal",
  WRITE_SNAPSHOT: "miner-runtime:write-snapshot",
  READ_RECOVERY: "miner-runtime:read-recovery",
});

function assertIds(payload) {
  if (!payload?.run_id || !payload?.encounter_id) throw new Error("RUNTIME_IDS_REQUIRED");
}

function registerRuntimeStorageIpc(ipcMain, storage) {
  if (!ipcMain || typeof ipcMain.handle !== "function") throw new TypeError("IPC_MAIN_REQUIRED");
  if (!storage) throw new TypeError("RUNTIME_STORAGE_REQUIRED");

  ipcMain.handle(CHANNELS.APPEND_JOURNAL, (_event, payload) => {
    assertIds(payload);
    return storage.appendJournal(payload.run_id, payload.encounter_id, payload.record);
  });
  ipcMain.handle(CHANNELS.WRITE_SNAPSHOT, (_event, payload) => {
    assertIds(payload);
    if (!payload.snapshot || payload.snapshot.run_id !== payload.run_id || payload.snapshot.encounter_id !== payload.encounter_id) {
      throw new Error("SNAPSHOT_ID_MISMATCH");
    }
    return storage.writeSnapshot(payload.snapshot);
  });
  ipcMain.handle(CHANNELS.READ_RECOVERY, (_event, payload) => {
    assertIds(payload);
    return {
      snapshots: storage.readSnapshots(payload.run_id, payload.encounter_id),
      journal: storage.readJournal(payload.run_id, payload.encounter_id),
    };
  });

  return CHANNELS;
}

module.exports = { registerRuntimeStorageIpc, CHANNELS };
