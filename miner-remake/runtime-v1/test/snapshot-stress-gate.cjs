"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { RuntimeStorageService } = require("../electron/runtime-storage-service");
const { RecoveryCoordinator } = require("../persistence/recovery-coordinator");
const { RecoveryGeometryAdapter } = require("../physics/recovery-geometry-adapter");

const LOGICAL_RUN_MS = 10 * 60 * 1000;
const JOURNAL_INTERVAL_MS = 1000;
const CRASH_INTERVAL_MS = 60 * 1000;
const FRAME_BUDGET_MS = 1000 / 60;
const SNAPSHOT_P95_LIMIT_MS = FRAME_BUDGET_MS * 0.25;
const CADENCES_MS = [2000, 3000, 5000];

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}
function directoryBytes(root) {
  return fs.readdirSync(root).reduce((sum, name) => {
    const file = path.join(root, name);
    return sum + (fs.statSync(file).isFile() ? fs.statSync(file).size : 0);
  }, 0);
}
function makeGeometry() {
  return new RecoveryGeometryAdapter({
    insideBossRoom:()=>true, overlapsStatic:()=>false, hasValidGround:()=>true, isNavValid:()=>true,
    isWalkableBody:()=>true, overlapsBoss:()=>false, overlapsActivePlayer:()=>false, overlapsImmediateHazard:()=>false,
  });
}
function makeSnapshot({generation,commitSeq,hp}) {
  return {
    schema_version:1, run_id:"stress-run", encounter_id:"abister-stress", boss_id:"abister",
    authority_epoch:0, snapshot_generation:generation, base_commit_seq:commitSeq, commit_seq:commitSeq,
    boss:{hp,phase:"P1",x:0,y:0,seal_committed:false}, participants:{}, hazards:[],
    p3_env:{active:false,remaining_ms:5000}, attack_history:[],
    last_resume_checkpoint_utc:"2026-09-23T00:00:00.000Z",
    clock:{elapsed_ms:0,paused:false,pause_reason:null},
  };
}
async function timedAsyncCall(fn) {
  const dispatchStart = performance.now();
  const promise = fn();
  const dispatchMs = performance.now() - dispatchStart;
  const endStart = performance.now();
  const value = await promise;
  return { value, dispatchMs, endToEndMs: dispatchMs + (performance.now() - endStart) };
}

async function runCadence(cadenceMs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `sd-miner-storage-${cadenceMs}-`));
  const snapshotDispatch = [], snapshotEnd = [], journalDispatch = [], journalEnd = [], recoveryMs = [], failures = [];
  let generation=0, commitSeq=0, hp=3600, nextSnapshot=cadenceMs, nextCrash=CRASH_INTERVAL_MS;
  try {
    let storage = new RuntimeStorageService(root);
    generation += 1;
    await storage.writeSnapshot(makeSnapshot({generation,commitSeq,hp}));

    for (let logicalMs=JOURNAL_INTERVAL_MS; logicalMs<=LOGICAL_RUN_MS; logicalMs+=JOURNAL_INTERVAL_MS) {
      commitSeq += 1;
      hp = Math.max(1, 3600 - (commitSeq % 3000));
      const record={authority_epoch:0,commit_seq:commitSeq,event_type:"BOSS_HP_COMMIT",payload:{hp}};
      try {
        const t=await timedAsyncCall(()=>storage.appendJournal("stress-run","abister-stress",record));
        journalDispatch.push(t.dispatchMs); journalEnd.push(t.endToEndMs);
      } catch(error) { failures.push({stage:"journal",logical_ms:logicalMs,message:error.message}); }

      if (logicalMs >= nextSnapshot) {
        generation += 1;
        try {
          const t=await timedAsyncCall(()=>storage.writeSnapshot(makeSnapshot({generation,commitSeq,hp})));
          snapshotDispatch.push(t.dispatchMs); snapshotEnd.push(t.endToEndMs);
        } catch(error) { failures.push({stage:"snapshot",logical_ms:logicalMs,message:error.message}); }
        nextSnapshot += cadenceMs;
      }

      if (logicalMs >= nextCrash) {
        const r0=performance.now();
        try {
          storage = new RuntimeStorageService(root);
          const recovery=new RecoveryCoordinator().recover({
            trustedNowUtc:"2026-09-23T01:00:00.000Z",
            snapshots:storage.readSnapshots("stress-run","abister-stress"),
            journal:storage.readJournal("stress-run","abister-stress"),
            geometry:makeGeometry(), savedPlayerTransform:{x:1,y:0},
          });
          if (!recovery.ok || recovery.recovered_state.commit_seq!==commitSeq || recovery.recovered_state.boss.hp!==hp) {
            failures.push({stage:"durability",logical_ms:logicalMs,code:recovery.code,
              expected_commit_seq:commitSeq,actual_commit_seq:recovery.recovered_state?.commit_seq??null,
              expected_hp:hp,actual_hp:recovery.recovered_state?.boss?.hp??null});
          }
        } catch(error) { failures.push({stage:"recovery",logical_ms:logicalMs,message:error.message}); }
        recoveryMs.push(performance.now()-r0);
        nextCrash += CRASH_INTERVAL_MS;
      }
    }

    const p95=percentile(snapshotDispatch,0.95);
    const max=Math.max(0,...snapshotDispatch);
    const overFrame=snapshotDispatch.filter(v=>v>FRAME_BUDGET_MS).length;
    const performancePass=p95<=SNAPSHOT_P95_LIMIT_MS && max<=FRAME_BUDGET_MS && overFrame===0;
    const durabilityPass=failures.length===0;
    return {
      cadence_ms:cadenceMs, logical_run_ms:LOGICAL_RUN_MS, snapshot_count:snapshotDispatch.length,
      journal_count:journalDispatch.length, forced_restart_count:recoveryMs.length,
      snapshot_main_thread_block_ms:{p50:percentile(snapshotDispatch,.5),p95,max,limit_p95:SNAPSHOT_P95_LIMIT_MS,limit_max:FRAME_BUDGET_MS,over_frame_count:overFrame},
      snapshot_durable_ack_latency_ms:{p50:percentile(snapshotEnd,.5),p95:percentile(snapshotEnd,.95),max:Math.max(0,...snapshotEnd)},
      journal_main_thread_block_ms:{p50:percentile(journalDispatch,.5),p95:percentile(journalDispatch,.95),max:Math.max(0,...journalDispatch)},
      journal_durable_ack_latency_ms:{p50:percentile(journalEnd,.5),p95:percentile(journalEnd,.95),max:Math.max(0,...journalEnd)},
      recovery_ms:{p50:percentile(recoveryMs,.5),p95:percentile(recoveryMs,.95),max:Math.max(0,...recoveryMs)},
      storage_bytes:directoryBytes(root),failed_write_or_recovery_count:failures.length,failures,
      durability_pass:durabilityPass,automated_storage_performance_pass:performancePass,pass:durabilityPass&&performancePass,
      note:"Main-thread blocking measures synchronous work before the async durable Promise yields; durable ACK latency is reported separately. User input feel and packaged-install E2E remain separate gates.",
    };
  } finally { fs.rmSync(root,{recursive:true,force:true,maxRetries:8,retryDelay:100}); }
}

(async()=>{
  const results=[]; let selected=null;
  for (const cadence of CADENCES_MS) {
    const result=await runCadence(cadence); results.push(result);
    if (result.pass) { selected=cadence; break; }
  }
  const report={gate:"snapshot-durability-performance-v1",generated_at_utc:new Date().toISOString(),
    frame_budget_ms:FRAME_BUDGET_MS,snapshot_p95_limit_ms:SNAPSHOT_P95_LIMIT_MS,
    tested_cadences_ms:results.map(r=>r.cadence_ms),selected_cadence_ms:selected,
    status:selected?"PASS":"FAIL_OPTIMIZATION_REQUIRED",results};
  const outDir=path.resolve(__dirname,"../../../runtime-profiles"); fs.mkdirSync(outDir,{recursive:true});
  fs.writeFileSync(path.join(outDir,"snapshot-stress-v1.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if (!selected) process.exitCode=1;
})().catch(error=>{console.error(error.stack||error);process.exit(1);});
