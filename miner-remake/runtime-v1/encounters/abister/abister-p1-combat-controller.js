"use strict";

const ATTACK = Object.freeze({
  FOREPAW_SLAM: "FOREPAW_SLAM",
  TAIL_SWEEP: "TAIL_SWEEP",
  GEOGEUK_JUMP: "GEOGEUK_JUMP",
  SPIKE_MACHINEGUN: "SPIKE_MACHINEGUN",
});

const STATE = Object.freeze({
  READY: "READY",
  TELEGRAPH: "TELEGRAPH",
  ACTIVE: "ACTIVE",
  RECOVERY: "RECOVERY",
  GROGGY: "GROGGY",
  PHASE_TRANSITION: "PHASE_TRANSITION",
  DEAD: "DEAD",
});

const ATTACK_ORDER = Object.freeze([
  ATTACK.FOREPAW_SLAM,
  ATTACK.TAIL_SWEEP,
  ATTACK.GEOGEUK_JUMP,
  ATTACK.SPIKE_MACHINEGUN,
]);

const ATTACK_SPECS = Object.freeze({
  [ATTACK.FOREPAW_SLAM]: Object.freeze({
    telegraph_ms: 1400,
    lock_at_ms: 1050,
    active_ms: 200,
    recovery_ms: 1200,
    cancel_recovery_ms: 600,
    cooldown_ms: 4500,
    damage_normal: 42,
    laceration: true,
    sword_parry: false,
    greatsword_counter: true,
    shield_guard: true,
  }),
  [ATTACK.TAIL_SWEEP]: Object.freeze({
    telegraph_ms: 1200,
    lock_at_ms: 850,
    active_ms: 600,
    recovery_ms: 1000,
    cancel_recovery_ms: 600,
    cooldown_ms: 3500,
    damage_normal: 32,
    laceration: true,
    sword_parry: true,
    greatsword_counter: true,
    shield_guard: true,
  }),
  [ATTACK.GEOGEUK_JUMP]: Object.freeze({
    telegraph_ms: 1550,
    lock_at_ms: 1150,
    active_ms: 550,
    recovery_ms: 1350,
    cancel_recovery_ms: 600,
    cooldown_ms: 6000,
    damage_normal: 40,
    laceration: false,
    sword_parry: false,
    greatsword_counter: true,
    shield_guard: true,
  }),
  [ATTACK.SPIKE_MACHINEGUN]: Object.freeze({
    telegraph_ms: 1600,
    lock_at_ms: 1250,
    active_ms: 900,
    recovery_ms: 1100,
    cancel_recovery_ms: 600,
    cooldown_ms: 6500,
    projectile_count: 6,
    projectile_interval_ms: 180,
    projectile_damage_normal: 8,
    projectile_speed_units_per_second: 12,
    projectile_max_range_units: 8,
    laceration: true,
    sword_parry: true,
    greatsword_counter: false,
    shield_guard: true,
  }),
});

function normalizeAngleDegrees(value) {
  if (!Number.isFinite(value)) return null;
  let result = value % 360;
  if (result > 180) result -= 360;
  if (result <= -180) result += 360;
  return result;
}

function isTailZone(relativeAngleDegrees) {
  const angle = normalizeAngleDegrees(relativeAngleDegrees);
  return angle != null && Math.abs(angle) > 70;
}

function rawDistanceWeights(distance) {
  if (!Number.isFinite(distance) || distance < 0) return {};
  if (distance < 3) return { [ATTACK.FOREPAW_SLAM]: 60, [ATTACK.TAIL_SWEEP]: 40 };
  if (distance < 4) return { [ATTACK.FOREPAW_SLAM]: 20, [ATTACK.TAIL_SWEEP]: 45, [ATTACK.GEOGEUK_JUMP]: 35 };
  if (distance <= 6) return { [ATTACK.TAIL_SWEEP]: 20, [ATTACK.GEOGEUK_JUMP]: 35, [ATTACK.SPIKE_MACHINEGUN]: 45 };
  if (distance <= 8) return { [ATTACK.SPIKE_MACHINEGUN]: 100 };
  return {};
}

function deriveRepeatState(history = []) {
  if (!Array.isArray(history) || history.length === 0) return { last_attack: null, streak: 0 };
  const last = history[history.length - 1];
  if (!ATTACK_ORDER.includes(last)) return { last_attack: null, streak: 0 };
  let streak = 0;
  for (let i = history.length - 1; i >= 0 && history[i] === last; i -= 1) streak += 1;
  return { last_attack: last, streak };
}

function candidateEligibility(observation, attack) {
  const d = Number(observation?.distance);
  const perceived = observation?.direct_perception === true;
  const cdReady = observation?.cooldown_ready?.[attack] === true;
  if (!Number.isFinite(d) || d < 0 || !perceived || !cdReady) return false;

  switch (attack) {
    case ATTACK.FOREPAW_SLAM:
      return d <= 3 &&
        observation.front_attack_valid === true &&
        observation.forepaw_path_clear === true &&
        observation.forepaw_landing_valid === true;
    case ATTACK.TAIL_SWEEP:
      return d <= 4 && isTailZone(observation.relative_angle_degrees) && observation.tail_path_clear === true;
    case ATTACK.GEOGEUK_JUMP:
      return d >= 3 && d <= 6 && observation.jump_path_clear === true && observation.jump_landing_valid === true;
    case ATTACK.SPIKE_MACHINEGUN:
      return d >= 4 && d <= 8 && observation.projectile_path_clear === true;
    default:
      return false;
  }
}

function buildWeightedCandidates(observation, history = []) {
  const raw = rawDistanceWeights(Number(observation?.distance));
  const eligible = ATTACK_ORDER
    .filter((attack) => Number(raw[attack] || 0) > 0 && candidateEligibility(observation, attack))
    .map((attack) => ({ attack, raw_weight: Number(raw[attack]) }));

  const repeat = deriveRepeatState(history);
  const hasAlternative = eligible.some((entry) => entry.attack !== repeat.last_attack);
  for (const entry of eligible) {
    entry.adjusted_weight = entry.raw_weight;
    if (hasAlternative && entry.attack === repeat.last_attack) {
      entry.adjusted_weight = repeat.streak >= 2 ? 0 : entry.raw_weight * 0.35;
    }
  }

  const positive = eligible.filter((entry) => entry.adjusted_weight > 0);
  const total = positive.reduce((sum, entry) => sum + entry.adjusted_weight, 0);
  return positive.map((entry) => ({
    ...entry,
    normalized_weight: total > 0 ? entry.adjusted_weight / total : 0,
  }));
}

function chooseP1Attack(observation, { history = [], rng = Math.random } = {}) {
  if (!observation?.target_id) return { attack: null, reason: "NO_VALID_TARGET", candidates: [] };
  const candidates = buildWeightedCandidates(observation, history);
  if (candidates.length === 0) return { attack: null, reason: "CHASE_REPOSITION", candidates };

  const roll = Number(rng());
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new RangeError("RNG_MUST_RETURN_0_TO_LT_1");
  let cursor = 0;
  for (const entry of candidates) {
    cursor += entry.normalized_weight;
    if (roll < cursor) return { attack: entry.attack, reason: "SELECTED", candidates, roll };
  }
  return { attack: candidates[candidates.length - 1].attack, reason: "SELECTED", candidates, roll };
}

function resolveTailSweepDirection(targetSide, rng = Math.random) {
  if (targetSide === "LEFT") return "RIGHT_TO_LEFT";
  if (targetSide === "RIGHT") return "LEFT_TO_RIGHT";
  const roll = Number(rng());
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new RangeError("RNG_MUST_RETURN_0_TO_LT_1");
  return roll < 0.5 ? "LEFT_TO_RIGHT" : "RIGHT_TO_LEFT";
}

class AbisterP1CombatController {
  constructor({ rng = Math.random, attackHistory = [] } = {}) {
    if (typeof rng !== "function") throw new TypeError("RNG_FUNCTION_REQUIRED");
    this.rng = rng;
    this.attackHistory = Array.isArray(attackHistory) ? [...attackHistory] : [];
    this.phase = "P1";
    this.state = STATE.READY;
    this.stateElapsedMs = 0;
    this.activeAttack = null;
    this.targetId = null;
    this.locked = false;
    this.pendingPhaseTransition = false;
    this.recoveryDurationMs = 0;
  }

  getSnapshot() {
    return {
      phase: this.phase,
      state: this.state,
      state_elapsed_ms: this.stateElapsedMs,
      active_attack: this.activeAttack,
      target_id: this.targetId,
      locked: this.locked,
      pending_phase_transition: this.pendingPhaseTransition,
      attack_history: [...this.attackHistory],
    };
  }

  decide(observation) {
    if (this.phase !== "P1") return { attack: null, reason: "NOT_P1", candidates: [] };
    if (this.state !== STATE.READY) return { attack: null, reason: "NOT_READY", candidates: [] };
    const selected = chooseP1Attack(observation, { history: this.attackHistory, rng: this.rng });
    if (!selected.attack) return selected;

    this.state = STATE.TELEGRAPH;
    this.stateElapsedMs = 0;
    this.activeAttack = selected.attack;
    this.targetId = String(observation.target_id);
    this.locked = false;
    this.pendingPhaseTransition = false;
    this.recoveryDurationMs = 0;
    return selected;
  }

  _clearAttack() {
    this.activeAttack = null;
    this.targetId = null;
    this.locked = false;
    this.pendingPhaseTransition = false;
    this.recoveryDurationMs = 0;
    this.stateElapsedMs = 0;
  }

  _enterPhaseTransition(events) {
    this.activeAttack = null;
    this.targetId = null;
    this.locked = false;
    this.pendingPhaseTransition = false;
    this.recoveryDurationMs = 0;
    this.state = STATE.PHASE_TRANSITION;
    this.stateElapsedMs = 0;
    events.push({ type: "PHASE_TRANSITION_ENTER", from_phase: this.phase, to_phase: "P2", duration_ms: 2500 });
  }

  _enterGroggy(events) {
    const interruptedAttack = this.activeAttack;
    const wasActive = this.state === STATE.ACTIVE;
    this.activeAttack = null;
    this.targetId = null;
    this.locked = false;
    this.pendingPhaseTransition = false;
    this.recoveryDurationMs = 0;
    this.state = STATE.GROGGY;
    this.stateElapsedMs = 0;
    events.push({ type: "GROGGY_ENTER", duration_ms: 1500, interrupted_attack: interruptedAttack, active_history_preserved: wasActive });
  }

  step(deltaMs, observation = {}) {
    let remaining = Number(deltaMs);
    if (!Number.isFinite(remaining) || remaining < 0) throw new RangeError("DELTA_MS_MUST_BE_NONNEGATIVE");
    const events = [];
    const interrupts = observation.interrupts || {};

    if (interrupts.hp_zero === true) {
      const attack = this.activeAttack;
      this._clearAttack();
      this.state = STATE.DEAD;
      events.push({ type: "BOSS_DEAD", interrupted_attack: attack });
      return events;
    }

    if (interrupts.phase_threshold_committed === true && this.phase === "P1") {
      if (this.state === STATE.ACTIVE) {
        this.pendingPhaseTransition = true;
        events.push({ type: "PHASE_TRANSITION_PENDING_AFTER_ACTIVE", attack: this.activeAttack });
      } else if (this.state !== STATE.PHASE_TRANSITION && this.state !== STATE.DEAD) {
        this._enterPhaseTransition(events);
        return events;
      }
    }

    if (interrupts.groggy_triggered === true && this.state !== STATE.PHASE_TRANSITION && this.state !== STATE.DEAD) {
      if (!(interrupts.phase_threshold_committed === true && this.phase === "P1")) {
        this._enterGroggy(events);
        return events;
      }
    }

    let guard = 0;
    while (remaining > 0 && guard++ < 8) {
      if (this.state === STATE.TELEGRAPH) {
        const spec = ATTACK_SPECS[this.activeAttack];
        if (!this.locked && this.stateElapsedMs < spec.lock_at_ms && observation.direct_perception === false) {
          const cancelled = this.activeAttack;
          this.state = STATE.RECOVERY;
          this.stateElapsedMs = 0;
          this.recoveryDurationMs = spec.cancel_recovery_ms;
          this.activeAttack = null;
          this.targetId = null;
          events.push({ type: "TELEGRAPH_CANCEL_PERCEPTION_LOST", attack: cancelled, recovery_ms: spec.cancel_recovery_ms });
          continue;
        }

        const nextBoundary = this.locked ? spec.telegraph_ms : spec.lock_at_ms;
        const toBoundary = Math.max(0, nextBoundary - this.stateElapsedMs);
        const consumed = Math.min(remaining, toBoundary);
        this.stateElapsedMs += consumed;
        remaining -= consumed;

        if (!this.locked && this.stateElapsedMs >= spec.lock_at_ms) {
          this.locked = true;
          events.push({ type: "ATTACK_LOCK", attack: this.activeAttack, target_id: this.targetId });
          if (this.stateElapsedMs < spec.telegraph_ms) continue;
        }
        if (this.stateElapsedMs >= spec.telegraph_ms) {
          const attack = this.activeAttack;
          this.state = STATE.ACTIVE;
          this.stateElapsedMs = 0;
          this.attackHistory.push(attack);
          events.push({ type: "ATTACK_ACTIVE_ENTER", attack, cooldown_ms: spec.cooldown_ms, spec });
          continue;
        }
        break;
      }

      if (this.state === STATE.ACTIVE) {
        const spec = ATTACK_SPECS[this.activeAttack];
        const toEnd = Math.max(0, spec.active_ms - this.stateElapsedMs);
        const consumed = Math.min(remaining, toEnd);
        this.stateElapsedMs += consumed;
        remaining -= consumed;
        if (this.stateElapsedMs >= spec.active_ms) {
          const finished = this.activeAttack;
          events.push({ type: "ATTACK_ACTIVE_COMPLETE", attack: finished });
          if (this.pendingPhaseTransition) {
            this._enterPhaseTransition(events);
          } else {
            this.state = STATE.RECOVERY;
            this.stateElapsedMs = 0;
            this.recoveryDurationMs = spec.recovery_ms;
            this.activeAttack = null;
            this.targetId = null;
            this.locked = false;
            events.push({ type: "RECOVERY_ENTER", attack: finished, recovery_ms: spec.recovery_ms });
          }
          continue;
        }
        break;
      }

      if (this.state === STATE.RECOVERY) {
        const toEnd = Math.max(0, this.recoveryDurationMs - this.stateElapsedMs);
        const consumed = Math.min(remaining, toEnd);
        this.stateElapsedMs += consumed;
        remaining -= consumed;
        if (this.stateElapsedMs >= this.recoveryDurationMs) {
          this.state = STATE.READY;
          this.stateElapsedMs = 0;
          this.recoveryDurationMs = 0;
          events.push({ type: "RECOVERY_COMPLETE", next: "EVALUATE" });
          continue;
        }
        break;
      }

      if (this.state === STATE.GROGGY) {
        const toEnd = Math.max(0, 1500 - this.stateElapsedMs);
        const consumed = Math.min(remaining, toEnd);
        this.stateElapsedMs += consumed;
        remaining -= consumed;
        if (this.stateElapsedMs >= 1500) {
          this.state = STATE.READY;
          this.stateElapsedMs = 0;
          events.push({ type: "GROGGY_COMPLETE", next: "TARGET_ACQUIRE_OR_EVALUATE" });
          continue;
        }
        break;
      }

      if (this.state === STATE.PHASE_TRANSITION) {
        const toEnd = Math.max(0, 2500 - this.stateElapsedMs);
        const consumed = Math.min(remaining, toEnd);
        this.stateElapsedMs += consumed;
        remaining -= consumed;
        if (this.stateElapsedMs >= 2500) {
          this.phase = "P2";
          this.state = STATE.READY;
          this.stateElapsedMs = 0;
          this.attackHistory = [];
          events.push({ type: "PHASE_TRANSITION_COMPLETE", phase: "P2", next: "TARGET_ACQUIRE" });
          continue;
        }
        break;
      }

      break;
    }
    return events;
  }
}

const API = Object.freeze({
  ATTACK,
  STATE,
  ATTACK_SPECS,
  rawDistanceWeights,
  isTailZone,
  deriveRepeatState,
  buildWeightedCandidates,
  chooseP1Attack,
  resolveTailSweepDirection,
  AbisterP1CombatController,
});

if (typeof module === "object" && module.exports) module.exports = API;
if (typeof globalThis !== "undefined") globalThis.SDAbisterP1Combat = API;
