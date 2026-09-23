"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const combat = require("../encounters/abister/abister-p1-combat-controller");
const { AbisterP1RuntimeOrchestrator } = require("../encounters/abister/abister-p1-runtime-orchestrator");

function baseObservation(overrides = {}) {
  return {
    target_id: "p1",
    distance: 2.5,
    direct_perception: true,
    relative_angle_degrees: 0,
    front_attack_valid: true,
    forepaw_path_clear: true,
    forepaw_landing_valid: true,
    tail_path_clear: true,
    jump_path_clear: true,
    jump_landing_valid: true,
    projectile_path_clear: true,
    cooldown_ready: {
      [combat.ATTACK.FOREPAW_SLAM]: true,
      [combat.ATTACK.TAIL_SWEEP]: true,
      [combat.ATTACK.GEOGEUK_JUMP]: true,
      [combat.ATTACK.SPIKE_MACHINEGUN]: true,
    },
    ...overrides,
  };
}

function makeExecutionMock() {
  const calls = [];
  return {
    calls,
    executeForepawLanding: (plan) => { calls.push(["forepaw", plan]); return { accepted: true, plan }; },
    executeTailSweepSamples: (samples) => { calls.push(["tail", samples]); return [{ accepted: true }]; },
    executeJumpLanding: (plan) => { calls.push(["jump", plan]); return { accepted: true, plan }; },
    fireSpikeBurst: async (plan) => { calls.push(["spikes", plan]); return { spawned: 6, hits: 3 }; },
    getPlayerState: () => ({ hp: 100, armor: 0, laceration_percent: 0 }),
    getHitLog: () => [],
  };
}

test("orchestrator executes physics adapter only on ATTACK_ACTIVE_ENTER", async () => {
  const execution = makeExecutionMock();
  const orchestrator = new AbisterP1RuntimeOrchestrator({ executionAdapter: execution, rng: () => 0 });
  const decision = orchestrator.decide(baseObservation());
  assert.equal(decision.attack, combat.ATTACK.FOREPAW_SLAM);

  let events = await orchestrator.advance(1050, { direct_perception: true }, {
    [combat.ATTACK.FOREPAW_SLAM]: { centerX: 10, groundY: 20 },
  });
  assert.equal(events[0].type, "ATTACK_LOCK");
  assert.equal(execution.calls.length, 0);

  events = await orchestrator.advance(350, { direct_perception: true }, {
    [combat.ATTACK.FOREPAW_SLAM]: { centerX: 10, groundY: 20 },
  });
  assert.equal(events[0].type, "ATTACK_ACTIVE_ENTER");
  assert.equal(execution.calls.length, 1);
  assert.deepEqual(execution.calls[0], ["forepaw", { centerX: 10, groundY: 20 }]);

  events = await orchestrator.advance(200);
  assert.deepEqual(events.map((event) => event.type), ["ATTACK_ACTIVE_COMPLETE", "RECOVERY_ENTER"]);
  assert.equal(execution.calls.length, 1);
});

test("telegraph perception loss cancels before physics execution", async () => {
  const execution = makeExecutionMock();
  const orchestrator = new AbisterP1RuntimeOrchestrator({ executionAdapter: execution, rng: () => 0 });
  orchestrator.decide(baseObservation());
  const events = await orchestrator.advance(1000, { direct_perception: false }, {
    [combat.ATTACK.FOREPAW_SLAM]: { centerX: 10, groundY: 20 },
  });
  assert.equal(events[0].type, "TELEGRAPH_CANCEL_PERCEPTION_LOST");
  assert.equal(execution.calls.length, 0);
});

test("active phase threshold keeps one execution then transitions without duplicate hit", async () => {
  const execution = makeExecutionMock();
  const orchestrator = new AbisterP1RuntimeOrchestrator({ executionAdapter: execution, rng: () => 0 });
  orchestrator.decide(baseObservation());
  await orchestrator.advance(1400, { direct_perception: true }, {
    [combat.ATTACK.FOREPAW_SLAM]: { centerX: 10, groundY: 20 },
  });
  assert.equal(execution.calls.length, 1);

  let events = await orchestrator.advance(0, { interrupts: { phase_threshold_committed: true } });
  assert.equal(events[0].type, "PHASE_TRANSITION_PENDING_AFTER_ACTIVE");
  events = await orchestrator.advance(200);
  assert.deepEqual(events.map((event) => event.type), ["ATTACK_ACTIVE_COMPLETE", "PHASE_TRANSITION_ENTER"]);
  assert.equal(execution.calls.length, 1);
});

test("all four selected attacks route exactly once through ACTIVE_ENTER", async () => {
  const scenarios = [
    {
      attack: combat.ATTACK.FOREPAW_SLAM,
      observation: { distance: 2.5, relative_angle_degrees: 0, front_attack_valid: true },
      plan: { centerX: 10, groundY: 20 },
      call: "forepaw",
    },
    {
      attack: combat.ATTACK.TAIL_SWEEP,
      observation: { distance: 3.2, relative_angle_degrees: 120, front_attack_valid: false },
      plan: { samples: [{ x: 1, y: 2 }] },
      call: "tail",
    },
    {
      attack: combat.ATTACK.GEOGEUK_JUMP,
      observation: { distance: 4.5, relative_angle_degrees: 0, front_attack_valid: false },
      plan: { centerX: 10, groundY: 20 },
      call: "jump",
    },
    {
      attack: combat.ATTACK.SPIKE_MACHINEGUN,
      observation: { distance: 7, relative_angle_degrees: 0, front_attack_valid: false },
      plan: { originX: 1, originY: 2, direction: 1 },
      call: "spikes",
    },
  ];

  for (const scenario of scenarios) {
    const execution = makeExecutionMock();
    const orchestrator = new AbisterP1RuntimeOrchestrator({ executionAdapter: execution, rng: () => 0 });
    const cooldown_ready = Object.fromEntries(
      Object.values(combat.ATTACK).map((attack) => [attack, attack === scenario.attack]),
    );
    const observation = baseObservation({ ...scenario.observation, cooldown_ready });
    const decision = orchestrator.decide(observation);
    assert.equal(decision.attack, scenario.attack);

    const spec = combat.ATTACK_SPECS[scenario.attack];
    const lockEvents = await orchestrator.advance(spec.lock_at_ms, { direct_perception: true }, {
      [scenario.attack]: scenario.plan,
    });
    assert.equal(lockEvents[0].type, "ATTACK_LOCK");
    assert.equal(execution.calls.length, 0);

    const activeEvents = await orchestrator.advance(
      spec.telegraph_ms - spec.lock_at_ms,
      { direct_perception: true },
      { [scenario.attack]: scenario.plan },
    );
    const active = activeEvents.find((event) => event.type === "ATTACK_ACTIVE_ENTER");
    assert(active);
    assert.equal(execution.calls.length, 1);
    assert.equal(execution.calls[0][0], scenario.call);

    const completed = await orchestrator.advance(spec.active_ms, { direct_perception: true });
    assert.deepEqual(completed.map((event) => event.type), ["ATTACK_ACTIVE_COMPLETE", "RECOVERY_ENTER"]);
    assert.equal(execution.calls.length, 1);
  }
});

test("spike execution is awaited and attached to ACTIVE event result", async () => {
  const execution = makeExecutionMock();
  const orchestrator = new AbisterP1RuntimeOrchestrator({ executionAdapter: execution, rng: () => 0 });
  const obs = baseObservation({
    distance: 7,
    front_attack_valid: false,
    relative_angle_degrees: 0,
  });
  assert.equal(orchestrator.decide(obs).attack, combat.ATTACK.SPIKE_MACHINEGUN);
  const events = await orchestrator.advance(1600, { direct_perception: true }, {
    [combat.ATTACK.SPIKE_MACHINEGUN]: { originX: 1, originY: 2, direction: -1 },
  });
  const active = events.find((event) => event.type === "ATTACK_ACTIVE_ENTER");
  assert.deepEqual(active.execution_result, { spawned: 6, hits: 3 });
  assert.deepEqual(execution.calls[0], ["spikes", { originX: 1, originY: 2, direction: -1 }]);
});
