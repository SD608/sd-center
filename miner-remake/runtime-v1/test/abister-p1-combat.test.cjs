"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ATTACK, STATE, buildWeightedCandidates, chooseP1Attack,
  resolveTailSweepDirection, AbisterP1CombatController,
} = require("../encounters/abister/abister-p1-combat-controller");

function baseObs(overrides = {}) {
  return {
    target_id: "p1",
    distance: 3,
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
      [ATTACK.FOREPAW_SLAM]: true,
      [ATTACK.TAIL_SWEEP]: true,
      [ATTACK.GEOGEUK_JUMP]: true,
      [ATTACK.SPIKE_MACHINEGUN]: true,
    },
    ...overrides,
  };
}

test("P1 candidate filter obeys exact distance/angle/path gates before weights", () => {
  let candidates = buildWeightedCandidates(baseObs({ distance: 2.5, relative_angle_degrees: 0 }), []);
  assert.deepEqual(candidates.map((entry) => entry.attack), [ATTACK.FOREPAW_SLAM]);

  candidates = buildWeightedCandidates(baseObs({
    distance: 3.5,
    relative_angle_degrees: 120,
    front_attack_valid: false,
  }), []);
  assert.deepEqual(candidates.map((entry) => entry.attack), [ATTACK.TAIL_SWEEP, ATTACK.GEOGEUK_JUMP]);
  assert.deepEqual(
    candidates.map((entry) => Math.round(entry.normalized_weight * 1000) / 1000),
    [0.563, 0.438],
  );

  candidates = buildWeightedCandidates(baseObs({
    distance: 5,
    relative_angle_degrees: 0,
    front_attack_valid: false,
  }), []);
  assert.deepEqual(candidates.map((entry) => entry.attack), [ATTACK.GEOGEUK_JUMP, ATTACK.SPIKE_MACHINEGUN]);

  candidates = buildWeightedCandidates(baseObs({
    distance: 7,
    relative_angle_degrees: 150,
    projectile_path_clear: false,
  }), []);
  assert.equal(candidates.length, 0);
});

test("P1 anti-repeat applies x0.35 then zero after two executions only when alternatives exist", () => {
  const observation = baseObs({
    distance: 3.5,
    relative_angle_degrees: 120,
    front_attack_valid: false,
  });
  let candidates = buildWeightedCandidates(observation, [ATTACK.TAIL_SWEEP]);
  const tail = candidates.find((entry) => entry.attack === ATTACK.TAIL_SWEEP);
  const jump = candidates.find((entry) => entry.attack === ATTACK.GEOGEUK_JUMP);
  assert.equal(tail.adjusted_weight, 45 * 0.35);
  assert.equal(jump.adjusted_weight, 35);

  candidates = buildWeightedCandidates(observation, [ATTACK.TAIL_SWEEP, ATTACK.TAIL_SWEEP]);
  assert.deepEqual(candidates.map((entry) => entry.attack), [ATTACK.GEOGEUK_JUMP]);

  candidates = buildWeightedCandidates(
    baseObs({ distance: 7 }),
    [ATTACK.SPIKE_MACHINEGUN, ATTACK.SPIKE_MACHINEGUN],
  );
  assert.deepEqual(candidates.map((entry) => entry.attack), [ATTACK.SPIKE_MACHINEGUN]);
});

test("P1 selection is deterministic with injected RNG and never chooses filtered attacks", () => {
  const observation = baseObs({
    distance: 4,
    relative_angle_degrees: 150,
    front_attack_valid: false,
  });
  assert.equal(chooseP1Attack(observation, { rng: () => 0, history: [] }).attack, ATTACK.TAIL_SWEEP);
  assert.equal(chooseP1Attack(observation, { rng: () => 0.21, history: [] }).attack, ATTACK.GEOGEUK_JUMP);
  assert.equal(chooseP1Attack(observation, { rng: () => 0.99, history: [] }).attack, ATTACK.SPIKE_MACHINEGUN);
  assert.equal(chooseP1Attack(baseObs({ distance: 9 }), { rng: () => 0.5 }).reason, "CHASE_REPOSITION");
});

test("tail sweep direction follows target side and rear-center tie uses 50:50 RNG", () => {
  assert.equal(resolveTailSweepDirection("LEFT", () => 0.99), "RIGHT_TO_LEFT");
  assert.equal(resolveTailSweepDirection("RIGHT", () => 0), "LEFT_TO_RIGHT");
  assert.equal(resolveTailSweepDirection("CENTER", () => 0.49), "LEFT_TO_RIGHT");
  assert.equal(resolveTailSweepDirection("CENTER", () => 0.5), "RIGHT_TO_LEFT");
});

test("telegraph cancels on perception loss before lock without execution history", () => {
  const controller = new AbisterP1CombatController({ rng: () => 0 });
  assert.equal(controller.decide(baseObs({ distance: 2.5 })).attack, ATTACK.FOREPAW_SLAM);
  controller.step(1000, { direct_perception: true });
  const events = controller.step(1, { direct_perception: false });
  assert.equal(events[0].type, "TELEGRAPH_CANCEL_PERCEPTION_LOST");
  assert.equal(controller.getSnapshot().state, STATE.RECOVERY);
  assert.equal(controller.getSnapshot().attack_history.length, 0);
  controller.step(600, {});
  assert.equal(controller.getSnapshot().state, STATE.READY);
});

test("lock prevents perception-loss cancel and ACTIVE entry records anti-repeat history", () => {
  const controller = new AbisterP1CombatController({ rng: () => 0 });
  controller.decide(baseObs({ distance: 2.5 }));
  let events = controller.step(1050, { direct_perception: true });
  assert.ok(events.some((event) => event.type === "ATTACK_LOCK"));

  events = controller.step(350, { direct_perception: false });
  assert.ok(events.some((event) => event.type === "ATTACK_ACTIVE_ENTER"));
  assert.deepEqual(controller.getSnapshot().attack_history, [ATTACK.FOREPAW_SLAM]);
  assert.equal(controller.getSnapshot().state, STATE.ACTIVE);
});

test("same-step HP0 > phase threshold > groggy priority is enforced", () => {
  let controller = new AbisterP1CombatController();
  let events = controller.step(0, {
    interrupts: { hp_zero: true, phase_threshold_committed: true, groggy_triggered: true },
  });
  assert.equal(events[0].type, "BOSS_DEAD");
  assert.equal(controller.getSnapshot().state, STATE.DEAD);

  controller = new AbisterP1CombatController();
  events = controller.step(0, {
    interrupts: { phase_threshold_committed: true, groggy_triggered: true },
  });
  assert.equal(events[0].type, "PHASE_TRANSITION_ENTER");
  assert.equal(controller.getSnapshot().state, STATE.PHASE_TRANSITION);

  controller = new AbisterP1CombatController();
  events = controller.step(0, { interrupts: { groggy_triggered: true } });
  assert.equal(events[0].type, "GROGGY_ENTER");
  assert.equal(controller.getSnapshot().state, STATE.GROGGY);
});

test("phase threshold during ACTIVE lets ACTIVE finish, skips recovery, then resets P1 history", () => {
  const controller = new AbisterP1CombatController({ rng: () => 0 });
  controller.decide(baseObs({ distance: 2.5 }));
  controller.step(1400, { direct_perception: true });
  assert.equal(controller.getSnapshot().state, STATE.ACTIVE);

  let events = controller.step(0, { interrupts: { phase_threshold_committed: true } });
  assert.equal(events[0].type, "PHASE_TRANSITION_PENDING_AFTER_ACTIVE");

  events = controller.step(200, {});
  assert.ok(events.some((event) => event.type === "PHASE_TRANSITION_ENTER"));
  assert.equal(controller.getSnapshot().state, STATE.PHASE_TRANSITION);
  assert.ok(!events.some((event) => event.type === "RECOVERY_ENTER"));

  controller.step(2500, {});
  assert.equal(controller.getSnapshot().phase, "P2");
  assert.deepEqual(controller.getSnapshot().attack_history, []);
  assert.equal(controller.decide(baseObs({ distance: 2.5 })).reason, "NOT_P1");
});

test("groggy during ACTIVE preserves execution history and cancels future ACTIVE", () => {
  const controller = new AbisterP1CombatController({ rng: () => 0 });
  controller.decide(baseObs({ distance: 2.5 }));
  controller.step(1400, { direct_perception: true });

  const events = controller.step(0, { interrupts: { groggy_triggered: true } });
  assert.equal(events[0].type, "GROGGY_ENTER");
  assert.equal(events[0].active_history_preserved, true);
  assert.deepEqual(controller.getSnapshot().attack_history, [ATTACK.FOREPAW_SLAM]);

  controller.step(1500, {});
  assert.equal(controller.getSnapshot().state, STATE.READY);
});
