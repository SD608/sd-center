"use strict";

// Foundation-only dummy controller. It proves scene/core wiring and is not a combat-balance authority.
class AbisterFoundationController {
  constructor({ core, moveSpeedUnitsPerSecond = 2 } = {}) {
    if (!core) throw new TypeError("ENCOUNTER_CORE_REQUIRED");
    this.core = core;
    this.moveSpeed = Number(moveSpeedUnitsPerSecond) || 2;
  }

  acquireSingleDevTarget(playerId) {
    if (!playerId) return null;
    this.core.state.boss.target_id = String(playerId);
    return this.core.state.boss.target_id;
  }

  stepToward(targetX, deltaMs) {
    const boss = this.core.state.boss;
    if (!Number.isFinite(targetX) || !Number.isFinite(deltaMs) || deltaMs <= 0) return boss.x;
    const maxStep = this.moveSpeed * deltaMs / 1000;
    const diff = targetX - Number(boss.x || 0);
    boss.x += Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
    return boss.x;
  }
}

module.exports = { AbisterFoundationController };
