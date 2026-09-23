"use strict";

(function attach(root, factory) {
  let resolver = root?.SDPlayerDamageResolver || null;
  if (typeof module === "object" && module.exports) {
    resolver = require("../../combat/player-damage-resolver");
    module.exports = factory(resolver);
  } else if (root) {
    root.SDAbisterP1Execution = factory(resolver);
  }
})(typeof globalThis !== "undefined" ? globalThis : null, function factory(damageResolver) {
  if (!damageResolver || typeof damageResolver.resolvePlayerHit !== "function") {
    throw new Error("PLAYER_DAMAGE_RESOLVER_REQUIRED");
  }

  const ATTACK = Object.freeze({
    FOREPAW_SLAM: "FOREPAW_SLAM",
    TAIL_SWEEP: "TAIL_SWEEP",
    GEOGEUK_JUMP: "GEOGEUK_JUMP",
    SPIKE_MACHINEGUN: "SPIKE_MACHINEGUN",
  });

  const CANON = Object.freeze({
    [ATTACK.FOREPAW_SLAM]: Object.freeze({
      active_ms: 200,
      max_forward_reach_units: 2.8,
      landing_width_units: 2.2,
      damage_normal: 42,
      guarded_damage_normal: 8,
      max_hits_per_target: 1,
      laceration: true,
      sword_parry: false,
      greatsword_counter: true,
      shield_guard: true,
    }),
    [ATTACK.TAIL_SWEEP]: Object.freeze({
      active_ms: 600,
      max_reach_units: 4.0,
      sweep_degrees: 220,
      front_safe_degrees: 140,
      damage_normal: 32,
      max_hits_per_target: 1,
      laceration: true,
      sword_parry: true,
      greatsword_counter: true,
      shield_guard: true,
    }),
    [ATTACK.GEOGEUK_JUMP]: Object.freeze({
      active_ms: 550,
      landing_width_units: 2.6,
      damage_normal: 40,
      guarded_damage_normal: 8,
      max_hits_per_target: 1,
      laceration: false,
      sword_parry: false,
      greatsword_counter: true,
      shield_guard: true,
    }),
    [ATTACK.SPIKE_MACHINEGUN]: Object.freeze({
      active_ms: 900,
      projectile_count: 6,
      projectile_interval_ms: 180,
      projectile_damage_normal: 8,
      projectile_speed_units_per_second: 12,
      projectile_max_range_units: 8,
      max_hits_per_target: 6,
      laceration: true,
      sword_parry: true,
      greatsword_counter: false,
      shield_guard: true,
    }),
  });

  // Automation fixture dimensions only. Production projectile/foot/tail collider thickness and rig remain CANON TBD.
  const FIXTURE_GEOMETRY = Object.freeze({
    melee_body_height_units: 1.0,
    tail_sample_body_units: 0.45,
    projectile_body_units: 0.25,
  });

  class AbisterP1PhaserExecutionAdapter {
    constructor({ scene, boss, player, unitPx = 40, solids = [], playerState, response = {} } = {}) {
      if (!scene?.physics?.add) throw new TypeError("PHASER_ARCADE_SCENE_REQUIRED");
      if (!boss?.body || !player?.body) throw new TypeError("PHYSICS_BOSS_AND_PLAYER_REQUIRED");
      this.scene = scene;
      this.boss = boss;
      this.player = player;
      this.unitPx = Number(unitPx) || 40;
      this.solids = Array.isArray(solids) ? solids.filter(Boolean) : [solids].filter(Boolean);
      this.playerState = damageResolver.clonePlayerState(playerState || { hp: 100, armor: 0, laceration_percent: 0 });
      this.response = { ...response };
      this.hitLog = [];
      this.hitCounts = new Map();
      this._spawned = new Set();
    }

    setPlayerState(next) {
      this.playerState = damageResolver.clonePlayerState(next);
      return this.getPlayerState();
    }

    getPlayerState() { return { ...this.playerState }; }
    setResponse(next = {}) { this.response = { ...next }; }
    getHitLog() { return this.hitLog.map((entry) => ({ ...entry })); }
    resetExecution() { this.hitCounts.clear(); this.hitLog.length = 0; }

    _maxHits(attack) { return CANON[attack]?.max_hits_per_target ?? 1; }

    _applyContact(attack, normalDamage, extra = {}) {
      const count = this.hitCounts.get(attack) || 0;
      if (count >= this._maxHits(attack)) return { accepted: false, reason: "HIT_CAP" };
      const spec = CANON[attack];
      if (!spec) throw new Error(`UNKNOWN_ATTACK:${attack}`);

      const result = damageResolver.resolvePlayerHit({
        player: this.playerState,
        normal_damage: normalDamage,
        response: this.response,
        attack: spec,
      });
      this.hitCounts.set(attack, count + 1);
      this.playerState = { ...result.player_after };
      const log = { attack, hit_index: count + 1, ...extra, ...result };
      this.hitLog.push(log);
      return { accepted: true, result: log };
    }

    _makeStaticRect(x, y, widthPx, heightPx) {
      const zone = this.scene.add.rectangle(x, y, widthPx, heightPx, 0xff3b30, 0.12);
      this.scene.physics.add.existing(zone, true);
      this._spawned.add(zone);
      return zone;
    }

    _destroyObject(object) {
      if (!object) return;
      this._spawned.delete(object);
      if (object.active !== false && typeof object.destroy === "function") object.destroy();
    }

    _overlapOnce(zone, attack, damage, extra = {}) {
      let contact = null;
      this.scene.physics.overlap(zone, this.player, () => {
        if (!contact) contact = this._applyContact(attack, damage, extra);
      });
      return contact;
    }

    executeForepawLanding({ centerX, groundY } = {}) {
      this.hitCounts.delete(ATTACK.FOREPAW_SLAM);
      const spec = CANON[ATTACK.FOREPAW_SLAM];
      const zone = this._makeStaticRect(
        Number(centerX), Number(groundY),
        spec.landing_width_units * this.unitPx,
        FIXTURE_GEOMETRY.melee_body_height_units * this.unitPx,
      );
      const result = this._overlapOnce(zone, ATTACK.FOREPAW_SLAM, spec.damage_normal, { collider: "FOREPAW_LANDING_FIXTURE" });
      this._destroyObject(zone);
      return result;
    }

    executeJumpLanding({ centerX, groundY } = {}) {
      this.hitCounts.delete(ATTACK.GEOGEUK_JUMP);
      const spec = CANON[ATTACK.GEOGEUK_JUMP];
      const zone = this._makeStaticRect(
        Number(centerX), Number(groundY),
        spec.landing_width_units * this.unitPx,
        FIXTURE_GEOMETRY.melee_body_height_units * this.unitPx,
      );
      const result = this._overlapOnce(zone, ATTACK.GEOGEUK_JUMP, spec.damage_normal, { collider: "JUMP_LANDING_FIXTURE" });
      this._destroyObject(zone);
      return result;
    }

    executeTailSweepSamples(samples = []) {
      this.hitCounts.delete(ATTACK.TAIL_SWEEP);
      const spec = CANON[ATTACK.TAIL_SWEEP];
      const results = [];
      for (let i = 0; i < samples.length; i += 1) {
        const point = samples[i];
        const dx = Number(point.x) - Number(this.boss.x);
        const dy = Number(point.y) - Number(this.boss.y);
        const distanceUnits = Math.hypot(dx, dy) / this.unitPx;
        if (distanceUnits > spec.max_reach_units + 1e-9) throw new RangeError("TAIL_FIXTURE_SAMPLE_EXCEEDS_CANON_REACH");
        const zone = this._makeStaticRect(
          Number(point.x), Number(point.y),
          FIXTURE_GEOMETRY.tail_sample_body_units * this.unitPx,
          FIXTURE_GEOMETRY.tail_sample_body_units * this.unitPx,
        );
        const result = this._overlapOnce(zone, ATTACK.TAIL_SWEEP, spec.damage_normal, { collider: "TAIL_SWEEP_FIXTURE", sample_index: i });
        if (result) results.push(result);
        this._destroyObject(zone);
      }
      return results;
    }

    fireSpikeBurst({ originX, originY, direction = 1 } = {}) {
      this.hitCounts.delete(ATTACK.SPIKE_MACHINEGUN);
      const spec = CANON[ATTACK.SPIKE_MACHINEGUN];
      const sign = direction < 0 ? -1 : 1;
      const flightMs = spec.projectile_max_range_units / spec.projectile_speed_units_per_second * 1000;
      const lastSpawnMs = (spec.projectile_count - 1) * spec.projectile_interval_ms;

      return new Promise((resolve) => {
        let spawned = 0;
        let resolved = false;
        const finish = () => {
          if (resolved) return;
          resolved = true;
          resolve({ spawned, hits: this.getHitLog().filter((entry) => entry.attack === ATTACK.SPIKE_MACHINEGUN).length });
        };

        for (let i = 0; i < spec.projectile_count; i += 1) {
          this.scene.time.delayedCall(i * spec.projectile_interval_ms, () => {
            const size = FIXTURE_GEOMETRY.projectile_body_units * this.unitPx;
            const projectile = this.scene.add.rectangle(Number(originX), Number(originY), size, size, 0xf4d35e, 1);
            this.scene.physics.add.existing(projectile);
            projectile.body.setAllowGravity(false);
            projectile.body.setVelocityX(sign * spec.projectile_speed_units_per_second * this.unitPx);
            this._spawned.add(projectile);
            spawned += 1;

            let consumed = false;
            const consume = () => {
              if (consumed) return;
              consumed = true;
              this._destroyObject(projectile);
            };

            this.scene.physics.add.overlap(projectile, this.player, () => {
              if (consumed) return;
              this._applyContact(ATTACK.SPIKE_MACHINEGUN, spec.projectile_damage_normal, { collider: "SPIKE_PROJECTILE_FIXTURE", projectile_index: i });
              consume();
            });
            for (const solid of this.solids) {
              this.scene.physics.add.collider(projectile, solid, consume);
            }
            this.scene.time.delayedCall(flightMs, consume);
          });
        }
        this.scene.time.delayedCall(lastSpawnMs + flightMs + 250, finish);
      });
    }

    destroy() {
      for (const object of [...this._spawned]) this._destroyObject(object);
      this._spawned.clear();
    }
  }

  return Object.freeze({ ATTACK, CANON, FIXTURE_GEOMETRY, AbisterP1PhaserExecutionAdapter });
});
