"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { RuntimeStorageService } = require("../persistence/runtime-storage-service");

test("latest corruption falls back to previous valid generation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-runtime-storage-"));
  try {
    const storage = new RuntimeStorageService(dir);
    const a = {schema_version:1,run_id:"r",encounter_id:"e",snapshot_generation:1,commit_seq:1,authority_epoch:0,last_resume_checkpoint_utc:"2026-09-23T00:00:00Z",boss:{x:0,y:0}};
    const b = {...a,snapshot_generation:2,commit_seq:2};
    storage.writeSnapshot(a); storage.writeSnapshot(b);
    const latest = path.join(dir,"r--e.latest.json");
    fs.writeFileSync(latest,"{broken");
    const snapshots = storage.readSnapshots("r","e");
    assert.equal(snapshots.length,1);
    assert.equal(snapshots[0].snapshot_generation,1);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test("journal checksum and append order survive reopen", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-runtime-journal-"));
  try {
    const storage = new RuntimeStorageService(dir);
    storage.appendJournal("r","e",{authority_epoch:0,commit_seq:1,event_type:"A",payload:{}});
    storage.appendJournal("r","e",{authority_epoch:0,commit_seq:2,event_type:"B",payload:{}});
    const rows = new RuntimeStorageService(dir).readJournal("r","e");
    assert.deepEqual(rows.map((r)=>r.commit_seq),[1,2]);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
