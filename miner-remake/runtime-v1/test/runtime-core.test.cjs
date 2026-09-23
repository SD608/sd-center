"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { SimulationClock } = require("../core/simulation-clock");
const { EncounterCore } = require("../core/encounter-core");
const { AbisterFoundationController } = require("../encounters/abister/abister-foundation-controller");
const { RecoveryGeometryAdapter } = require("../physics/recovery-geometry-adapter");
const { RecoveryCoordinator } = require("../persistence/recovery-coordinator");
const { RuntimePersistenceClient } = require("../bridge/runtime-persistence-client");
const { registerRuntimeStorageIpc } = require("../electron/register-runtime-storage-ipc");

test("fixed-step 10 minute clock stays deterministic and HOLD blocks catch-up", () => {
  const clock = new SimulationClock();
  const step = 1000 / 60;
  for (let i = 0; i < 36000; i += 1) clock.advance(step);
  assert.ok(Math.abs(clock.elapsedMs - 600000) < 0.01);
  clock.hold("ZERO_CONNECTED_HOLD");
  for (let i = 0; i < 300; i += 1) clock.advance(step);
  assert.ok(Math.abs(clock.elapsedMs - 600000) < 0.01);
  clock.resume();
  clock.advance(5000);
  assert.ok(Math.abs(clock.elapsedMs - 605000) < 0.01);
});

test("EncounterCore confirms journal ACK before commit sequence advances", async () => {
  const core = new EncounterCore({ run_id: "r", encounter_id: "e" });
  const seen = [];
  await core.commit("TARGET_ACQUIRE", { target_id: "p1" }, { appendJournal: async (r) => seen.push(r) });
  assert.equal(seen[0].commit_seq, 1);
  assert.equal(core.snapshot().commit_seq, 1);
  assert.equal(core.snapshot().base_commit_seq, 1);
  assert.equal(core.snapshot().boss.target_id, "p1");
});

test("foundation Abister dummy target/movement wires to EncounterCore without combat authority", () => {
  const core = new EncounterCore({ boss: { hp:3600, phase:"P1", x:0, y:0, seal_committed:false } });
  const controller = new AbisterFoundationController({ core, moveSpeedUnitsPerSecond: 2 });
  assert.equal(controller.acquireSingleDevTarget("dev-player"), "dev-player");
  assert.equal(controller.stepToward(10, 500), 1);
});

test("player recovery uses saved, anchors, then bounded search and blocks if none valid", () => {
  const validX = new Set([-15.5]);
  const geometry = new RecoveryGeometryAdapter({
    isWalkableBody: (p) => validX.has(p.x), overlapsStatic: () => false, overlapsBoss: () => false,
    overlapsActivePlayer: () => false, overlapsImmediateHazard: () => false, hasValidGround: (p) => validX.has(p.x),
    insideBossRoom: () => true, isNavValid: () => true,
  });
  const result = geometry.findPlayerPlacement({ x: -15.9, y: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.source, "BOUNDED_SEARCH");
  assert.equal(result.position.x, -15.5);
  const blocked = new RecoveryGeometryAdapter({isWalkableBody:()=>false,hasValidGround:()=>false}).findPlayerPlacement({x:0,y:0});
  assert.deepEqual(blocked, { ok: false, code: "PLAYER_PLACEMENT_BLOCKED" });
});

test("boss transform falls back only to ROOM_CENTER and otherwise blocks", () => {
  const geometry = new RecoveryGeometryAdapter({
    insideBossRoom: (p) => p.x === 0 && p.y === 0,
    overlapsStatic: () => false,
    hasValidGround: (p) => p.x === 0 && p.y === 0,
    isNavValid: (p) => p.x === 0 && p.y === 0,
  });
  assert.equal(geometry.recoverBossTransform({ x: 99, y: 99 }).source, "ROOM_CENTER");
  const blocked = new RecoveryGeometryAdapter({insideBossRoom:()=>false,hasValidGround:()=>false,isNavValid:()=>false}).recoverBossTransform({x:99,y:99});
  assert.equal(blocked.code, "BOSS_TRANSFORM_BLOCKED");
});

test("recovery fails closed and replays journal before geometry", () => {
  const base = { schema_version:1, snapshot_generation:2, base_commit_seq:4, commit_seq:4, authority_epoch:0, run_id:"r", encounter_id:"e", last_resume_checkpoint_utc:"2026-09-23T00:00:00Z", boss:{hp:3600,phase:"P1",x:0,y:0,seal_committed:false}, clock:{elapsed_ms:1000,paused:false,pause_reason:null} };
  const geometry = new RecoveryGeometryAdapter({
    insideBossRoom:()=>true,overlapsStatic:()=>false,hasValidGround:()=>true,isNavValid:()=>true,
    isWalkableBody:()=>true,overlapsBoss:()=>false,overlapsActivePlayer:()=>false,overlapsImmediateHazard:()=>false,
  });
  const rc = new RecoveryCoordinator();
  assert.equal(rc.recover({snapshots:[base],journal:[],geometry,savedPlayerTransform:{x:1,y:0}}).code,"TIME_VALIDATION_PENDING");
  assert.equal(rc.recover({trustedNowUtc:"2026-09-27T00:00:01Z",snapshots:[base],journal:[],geometry,savedPlayerTransform:{x:1,y:0}}).code,"RUN_RECOVERY_EXPIRED");
  assert.equal(rc.recover({trustedNowUtc:"2026-09-23T01:00:00Z",snapshots:[base],journal:[{commit_seq:6,authority_epoch:0,event_type:"BOSS_HP_COMMIT",payload:{hp:3000}}],geometry,savedPlayerTransform:{x:1,y:0}}).code,"RCV_JOURNAL_GAP");
  const ready = rc.recover({trustedNowUtc:"2026-09-23T01:00:00Z",snapshots:[base],journal:[{commit_seq:5,authority_epoch:0,event_type:"BOSS_HP_COMMIT",payload:{hp:3000}}],geometry,savedPlayerTransform:{x:1,y:0}});
  assert.equal(ready.code,"READY");
  assert.equal(ready.recovered_state.boss.hp,3000);
  assert.equal(ready.recovered_state.commit_seq,5);
});

test("renderer persistence client carries run/encounter ids over fixed IPC channels", async () => {
  const calls=[];
  const client = new RuntimePersistenceClient({invoke:async (channel,payload)=>{calls.push([channel,payload]);return 1;},runId:"r",encounterId:"e"});
  await client.appendJournal({commit_seq:1});
  assert.equal(calls[0][0],"miner-runtime:append-journal");
  assert.equal(calls[0][1].run_id,"r");
  assert.equal(calls[0][1].encounter_id,"e");
});

test("main-process IPC registrar keeps storage authority outside renderer", async () => {
  const handlers=new Map();
  const ipcMain={handle:(channel,fn)=>handlers.set(channel,fn)};
  const storage={
    appendJournal:(r,e,record)=>`${r}:${e}:${record.commit_seq}`,
    writeSnapshot:()=>"snapshot",
    readSnapshots:()=>[{snapshot_generation:1}],
    readJournal:()=>[{commit_seq:1}],
  };
  registerRuntimeStorageIpc(ipcMain,storage);
  assert.equal(handlers.size,3);
  assert.equal(await handlers.get("miner-runtime:append-journal")({}, {run_id:"r",encounter_id:"e",record:{commit_seq:1}}),"r:e:1");
  const recovery=await handlers.get("miner-runtime:read-recovery")({}, {run_id:"r",encounter_id:"e"});
  assert.equal(recovery.snapshots[0].snapshot_generation,1);
});
