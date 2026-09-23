"use strict";

class SimulationClock {
  constructor(input = {}) {
    const elapsedMs = input.elapsedMs ?? input.elapsed_ms ?? 0;
    const paused = input.paused ?? false;
    const pauseReason = input.pauseReason ?? input.pause_reason ?? null;
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new TypeError("INVALID_ELAPSED_MS");
    this.elapsedMs = elapsedMs;
    this.paused = Boolean(paused);
    this.pauseReason = this.paused ? String(pauseReason || "HOLD") : null;
  }

  advance(deltaMs) {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new TypeError("INVALID_DELTA_MS");
    if (!this.paused) this.elapsedMs += deltaMs;
    return this.elapsedMs;
  }

  hold(reason) {
    this.paused = true;
    this.pauseReason = String(reason || "HOLD");
  }

  resume() {
    this.paused = false;
    this.pauseReason = null;
  }

  snapshot() {
    return { elapsed_ms: this.elapsedMs, paused: this.paused, pause_reason: this.pauseReason };
  }
}

module.exports = { SimulationClock };
