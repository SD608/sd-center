"use strict";
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { chromium } = require(path.resolve(__dirname, "../../../.runtime-ci/node_modules/playwright-core"));

function edgePath() {
  const candidates = [
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

(async () => {
  const executablePath = edgePath();
  assert(executablePath, "Microsoft Edge executable not found");
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
    const url = pathToFileURL(path.join(__dirname, "..", "dev", "index.html")).href;
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector("#runtimeStatus")?.textContent === "READY", null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => window.runtimeHarness.phaserVersion()), "4.2.1");
    assert.equal(await page.evaluate(() => window.runtimeHarness.p1ExecutionAdapterVersion()), true);
    assert.equal(await page.evaluate(() => window.runtimeHarness.p1OrchestrationVersion()), true);
    assert((await page.locator("canvas").count()) >= 1, "Phaser canvas missing");
    assert.equal(await page.evaluate(() => window.runtimeHarness.runCycles(100)), 100);

    const gate = await page.evaluate(() => window.runtimeHarness.runP1ExecutionGate());
    assert.equal(gate.forepaw.hits.length, 1);
    assert.equal(gate.forepaw.state.armor, 0);
    assert.equal(gate.forepaw.state.hp, 88);
    assert.equal(gate.forepaw.state.laceration_percent, 12);

    assert.equal(gate.jumpGuard.hits.length, 1);
    assert.equal(gate.jumpGuard.hits[0].shield_guard_applied, true);
    assert.equal(gate.jumpGuard.state.hp, 92);
    assert.equal(gate.jumpGuard.state.laceration_percent, 0);

    assert.equal(gate.tailParry.hits.length, 1, "tail sweep must apply at most one contact per use");
    assert.equal(gate.tailParry.hits[0].nullified_by, "SWORD_PARRY");
    assert.equal(gate.tailParry.state.hp, 100);

    assert.equal(gate.spikes.burst.spawned, 6);
    assert.equal(gate.spikes.burst.hits, 6);
    assert.equal(gate.spikes.hits.length, 6);
    assert.equal(gate.spikes.state.hp, 52);
    assert.equal(gate.spikes.state.laceration_percent, 48);

    assert.equal(gate.blockedSpikes.burst.spawned, 6);
    assert.equal(gate.blockedSpikes.burst.hits, 0);
    assert.equal(gate.blockedSpikes.hits.length, 0);
    assert.equal(gate.blockedSpikes.state.hp, 100);

    const orchestration = await page.evaluate(() => window.runtimeHarness.runP1OrchestrationGate());
    assert.equal(orchestration.completed.decision.attack, "FOREPAW_SLAM");
    assert.equal(orchestration.completed.locked[0].type, "ATTACK_LOCK");
    assert.equal(orchestration.completed.active[0].type, "ATTACK_ACTIVE_ENTER");
    assert.equal(orchestration.completed.active[0].execution_result.accepted, true);
    assert.deepEqual(
      orchestration.completed.completedEvents.map((event) => event.type),
      ["ATTACK_ACTIVE_COMPLETE", "RECOVERY_ENTER"],
    );
    assert.equal(orchestration.completed.recovered[0].type, "RECOVERY_COMPLETE");
    assert.equal(orchestration.completed.snapshot.controller.state, "READY");
    assert.deepEqual(orchestration.completed.snapshot.controller.attack_history, ["FOREPAW_SLAM"]);
    assert.equal(orchestration.completed.snapshot.player.armor, 0);
    assert.equal(orchestration.completed.snapshot.player.hp, 88);
    assert.equal(orchestration.completed.snapshot.player.laceration_percent, 12);
    assert.equal(orchestration.completed.snapshot.hits.length, 1);

    assert.equal(orchestration.cancelled.events[0].type, "TELEGRAPH_CANCEL_PERCEPTION_LOST");
    assert.equal(orchestration.cancelled.snapshot.hits.length, 0);
    assert.equal(orchestration.cancelled.snapshot.player.hp, 100);

    const allAttack = await page.evaluate(() => window.runtimeHarness.runP1AllAttackOrchestrationGate());
    const expectedAllAttack = {
      FOREPAW_SLAM: { hp: 88, armor: 0, laceration: 12, hits: 1 },
      TAIL_SWEEP: { hp: 68, armor: 0, laceration: 32, hits: 1 },
      GEOGEUK_JUMP: { hp: 60, armor: 0, laceration: 0, hits: 1 },
      SPIKE_MACHINEGUN: { hp: 52, armor: 0, laceration: 48, hits: 6 },
    };
    for (const [attack, expected] of Object.entries(expectedAllAttack)) {
      const result = allAttack[attack];
      assert(result, `missing all-attack result for ${attack}`);
      assert.equal(result.decision.attack, attack);
      assert.equal(result.locked[0].type, "ATTACK_LOCK");
      assert.equal(result.pre_active_hit_count, 0, `${attack} executed before ACTIVE_ENTER`);
      assert.equal(result.active[0].type, "ATTACK_ACTIVE_ENTER");
      assert.deepEqual(
        result.completedEvents.map((event) => event.type),
        ["ATTACK_ACTIVE_COMPLETE", "RECOVERY_ENTER"],
      );
      assert.equal(result.recovered[0].type, "RECOVERY_COMPLETE");
      assert.equal(result.snapshot.controller.state, "READY");
      assert.deepEqual(result.snapshot.controller.attack_history, [attack]);
      assert.equal(result.snapshot.player.hp, expected.hp);
      assert.equal(result.snapshot.player.armor, expected.armor);
      assert.equal(result.snapshot.player.laceration_percent, expected.laceration);
      assert.equal(result.snapshot.hits.length, expected.hits);
    }
    assert.equal(allAttack.FOREPAW_SLAM.active[0].execution_result.accepted, true);
    assert.equal(allAttack.TAIL_SWEEP.active[0].execution_result.length, 1);
    assert.equal(allAttack.TAIL_SWEEP.active[0].execution_result[0].accepted, true);
    assert.equal(allAttack.GEOGEUK_JUMP.active[0].execution_result.accepted, true);
    assert.equal(allAttack.SPIKE_MACHINEGUN.active[0].execution_result.spawned, 6);
    assert.equal(allAttack.SPIKE_MACHINEGUN.active[0].execution_result.hits, 6);

    const outDir = path.resolve(__dirname, "../../../ui-artifacts/miner-runtime-v1");
    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, "runtime-foundation.png"), fullPage: true });
    console.log("miner runtime Phaser 4.2.1 boot/re-enter x100 + Abister P1 execution/damage + orchestration + all-attack Edge E2E Gate PASS");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
