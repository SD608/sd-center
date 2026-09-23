"use strict";

(function attach(root, factory) {
  let combat = root?.SDAbisterP1Combat || null;
  let execution = root?.SDAbisterP1Execution || null;
  if (typeof module === "object" && module.exports) {
    combat = require("./abister-p1-combat-controller");
    execution = require("./abister-p1-phaser-execution-adapter");
    module.exports = factory(combat, execution);
  } else if (root) {
    root.SDAbisterP1Orchestration = factory(combat, execution);
  }
})(typeof globalThis !== "undefined" ? globalThis : null, function factory(combat, execution) {
  if (!combat?.AbisterP1CombatController) throw new Error("ABISTER_P1_COMBAT_CONTROLLER_REQUIRED");
  if (!execution?.AbisterP1PhaserExecutionAdapter) throw new Error("ABISTER_P1_EXECUTION_ADAPTER_REQUIRED");

  const { ATTACK, STATE, AbisterP1CombatController } = combat;

  class AbisterP1RuntimeOrchestrator {
    constructor({ controller, executionAdapter, rng = Math.random } = {}) {
      if (!executionAdapter) throw new TypeError("P1_EXECUTION_ADAPTER_REQUIRED");
      this.controller = controller || new AbisterP1CombatController({ rng });
      this.execution = executionAdapter;
      this.timeline = [];
    }

    decide(observation) {
      const decision = this.controller.decide(observation);
      this.timeline.push({ type: "DECISION", attack: decision.attack || null, reason: decision.reason });
      return decision;
    }

    async advance(deltaMs, observation = {}, executionPlan = {}) {
      const controllerEvents = this.controller.step(deltaMs, observation);
      const emitted = [];
      for (const event of controllerEvents) {
        let executionResult = null;
        if (event.type === "ATTACK_ACTIVE_ENTER") {
          executionResult = await this._executeActive(event.attack, executionPlan[event.attack] || executionPlan);
        }
        const combined = executionResult === null ? { ...event } : { ...event, execution_result: executionResult };
        this.timeline.push(combined);
        emitted.push(combined);
      }
      return emitted;
    }

    async _executeActive(attack, plan = {}) {
      switch (attack) {
        case ATTACK.FOREPAW_SLAM:
          this._requireFinite(plan.centerX, "FOREPAW_CENTER_X_REQUIRED");
          this._requireFinite(plan.groundY, "FOREPAW_GROUND_Y_REQUIRED");
          return this.execution.executeForepawLanding({ centerX: plan.centerX, groundY: plan.groundY });
        case ATTACK.TAIL_SWEEP:
          if (!Array.isArray(plan.samples)) throw new TypeError("TAIL_SWEEP_SAMPLES_REQUIRED");
          return this.execution.executeTailSweepSamples(plan.samples);
        case ATTACK.GEOGEUK_JUMP:
          this._requireFinite(plan.centerX, "JUMP_CENTER_X_REQUIRED");
          this._requireFinite(plan.groundY, "JUMP_GROUND_Y_REQUIRED");
          return this.execution.executeJumpLanding({ centerX: plan.centerX, groundY: plan.groundY });
        case ATTACK.SPIKE_MACHINEGUN:
          this._requireFinite(plan.originX, "SPIKE_ORIGIN_X_REQUIRED");
          this._requireFinite(plan.originY, "SPIKE_ORIGIN_Y_REQUIRED");
          return this.execution.fireSpikeBurst({
            originX: plan.originX,
            originY: plan.originY,
            direction: Number(plan.direction) < 0 ? -1 : 1,
          });
        default:
          throw new Error(`UNKNOWN_P1_ATTACK:${attack}`);
      }
    }

    _requireFinite(value, code) {
      if (!Number.isFinite(Number(value))) throw new TypeError(code);
    }

    getSnapshot() {
      return {
        controller: this.controller.getSnapshot(),
        player: this.execution.getPlayerState(),
        hits: this.execution.getHitLog(),
        timeline: this.timeline.map((entry) => ({ ...entry })),
      };
    }

    resetTimeline() {
      this.timeline.length = 0;
    }

    isReady() {
      return this.controller.getSnapshot().state === STATE.READY;
    }
  }

  return Object.freeze({ ATTACK, STATE, AbisterP1RuntimeOrchestrator });
});
