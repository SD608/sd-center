"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { resolvePlayerHit } = require("../combat/player-damage-resolver");
const execution = require("../encounters/abister/abister-p1-phaser-execution-adapter");
const combat = require("../encounters/abister/abister-p1-combat-controller");

const { ATTACK, CANON, FIXTURE_GEOMETRY } = execution;

test("P1 damage resolver applies armor first and laceration only from actual HP damage", () => {
  const result = resolvePlayerHit({
    player: { hp: 100, armor: 30, laceration_percent: 0 },
    normal_damage: 42,
    attack: CANON[ATTACK.FOREPAW_SLAM],
  });
  assert.equal(result.valid_hit, true);
  assert.equal(result.armor_damage, 30);
  assert.equal(result.hp_damage, 12);
  assert.equal(result.laceration_added_percent, 12);
  assert.deepEqual(result.player_after, {
    hp: 88, max_hp: 100, armor: 0, max_armor: 30, laceration_percent: 12,
  });
});

test("P1 jump shield guard uses documented 40 -> 8 Normal and adds no laceration", () => {
  const result = resolvePlayerHit({
    player: { hp: 100, armor: 0, laceration_percent: 0 },
    normal_damage: 40,
    attack: CANON[ATTACK.GEOGEUK_JUMP],
    response: { shield_guard: true, shield_in_front_arc: true },
  });
  assert.equal(result.shield_guard_applied, true);
  assert.equal(result.normal_damage_applied, 8);
  assert.equal(result.hp_damage, 8);
  assert.equal(result.laceration_added_percent, 0);
  assert.equal(result.player_after.hp, 92);
});

test("evade/parry/counter nullify only when the attack contract allows them", () => {
  const base = { hp: 100, armor: 0, laceration_percent: 0 };
  const evade = resolvePlayerHit({ player: base, normal_damage: 42, attack: CANON[ATTACK.FOREPAW_SLAM], response: { evade_invulnerable: true } });
  assert.equal(evade.nullified_by, "EVADE_INVULNERABLE");

  const tailParry = resolvePlayerHit({ player: base, normal_damage: 32, attack: CANON[ATTACK.TAIL_SWEEP], response: { sword_parry: true } });
  assert.equal(tailParry.nullified_by, "SWORD_PARRY");

  const forepawParry = resolvePlayerHit({ player: base, normal_damage: 42, attack: CANON[ATTACK.FOREPAW_SLAM], response: { sword_parry: true } });
  assert.equal(forepawParry.valid_hit, true);

  const forepawCounter = resolvePlayerHit({ player: base, normal_damage: 42, attack: CANON[ATTACK.FOREPAW_SLAM], response: { greatsword_counter: true } });
  assert.equal(forepawCounter.nullified_by, "GREATSWORD_COUNTER");
});

test("six spike projectile contacts independently produce 48 HP damage and 48% laceration with no armor", () => {
  let player = { hp: 100, armor: 0, laceration_percent: 0 };
  for (let i = 0; i < 6; i += 1) {
    const result = resolvePlayerHit({
      player,
      normal_damage: CANON[ATTACK.SPIKE_MACHINEGUN].projectile_damage_normal,
      attack: CANON[ATTACK.SPIKE_MACHINEGUN],
    });
    player = result.player_after;
  }
  assert.equal(player.hp, 52);
  assert.equal(player.laceration_percent, 48);
});

test("execution contract matches the already-implemented P1 state-machine timing/damage contract", () => {
  for (const attack of Object.values(ATTACK)) {
    const stateSpec = combat.ATTACK_SPECS[attack];
    const executionSpec = CANON[attack];
    assert(stateSpec, `missing state spec ${attack}`);
    assert.equal(executionSpec.active_ms, stateSpec.active_ms);
    if (attack === ATTACK.SPIKE_MACHINEGUN) {
      assert.equal(executionSpec.projectile_count, stateSpec.projectile_count);
      assert.equal(executionSpec.projectile_interval_ms, stateSpec.projectile_interval_ms);
      assert.equal(executionSpec.projectile_damage_normal, stateSpec.projectile_damage_normal);
      assert.equal(executionSpec.projectile_speed_units_per_second, stateSpec.projectile_speed_units_per_second);
      assert.equal(executionSpec.projectile_max_range_units, stateSpec.projectile_max_range_units);
    } else {
      assert.equal(executionSpec.damage_normal, stateSpec.damage_normal);
    }
    assert.equal(executionSpec.laceration, stateSpec.laceration);
    assert.equal(executionSpec.sword_parry, stateSpec.sword_parry);
    assert.equal(executionSpec.greatsword_counter, stateSpec.greatsword_counter);
    assert.equal(executionSpec.shield_guard, stateSpec.shield_guard);
  }
});

test("non-canonical production collider thickness remains fixture-only", () => {
  assert.equal(FIXTURE_GEOMETRY.melee_body_height_units, 1.0);
  assert.equal(FIXTURE_GEOMETRY.tail_sample_body_units, 0.45);
  assert.equal(FIXTURE_GEOMETRY.projectile_body_units, 0.25);
  assert.ok(!CANON[ATTACK.FOREPAW_SLAM].collider_height_units);
  assert.ok(!CANON[ATTACK.SPIKE_MACHINEGUN].projectile_body_units);
});
