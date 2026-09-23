"use strict";

const DEFAULT_ANCHORS = Object.freeze([
  Object.freeze({ name: "RECOVERY_LEFT", x: -16, y: 0, priority: 0 }),
  Object.freeze({ name: "RECOVERY_CENTER", x: 0, y: 0, priority: 1 }),
  Object.freeze({ name: "RECOVERY_RIGHT", x: 16, y: 0, priority: 2 }),
]);
const ROOM_CENTER = Object.freeze({ x: 0, y: 0 });

class RecoveryGeometryAdapter {
  constructor(query) {
    this.query = query || {};
  }

  _bool(name, position, fallback = false) {
    const fn = this.query[name];
    return typeof fn === "function" ? Boolean(fn(position)) : fallback;
  }

  isValidPlayer(position) {
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return false;
    return this._bool("isWalkableBody", position) &&
      !this._bool("overlapsStatic", position) &&
      !this._bool("overlapsBoss", position) &&
      !this._bool("overlapsActivePlayer", position) &&
      !this._bool("overlapsImmediateHazard", position) &&
      this._bool("hasValidGround", position);
  }

  isValidBoss(position) {
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return false;
    return this._bool("insideBossRoom", position) &&
      !this._bool("overlapsStatic", position) &&
      this._bool("hasValidGround", position) &&
      this._bool("isNavValid", position);
  }

  findPlayerPlacement(saved, anchors = DEFAULT_ANCHORS, step = 0.5, maxDistance = 3) {
    if (this.isValidPlayer(saved)) return { ok: true, source: "SAVED", position: { ...saved } };
    const originX = Number.isFinite(saved?.x) ? saved.x : 0;
    const ranked = [...anchors].sort((a, b) => {
      const distance = Math.abs(a.x - originX) - Math.abs(b.x - originX);
      return distance || (a.priority - b.priority);
    });
    for (const anchor of ranked) {
      if (this.isValidPlayer(anchor)) return { ok: true, source: anchor.name, position: { x: anchor.x, y: anchor.y } };
    }
    const primary = ranked[0] || DEFAULT_ANCHORS[1];
    for (let distance = step; distance <= maxDistance + 1e-9; distance += step) {
      for (const sign of [-1, 1]) {
        const candidate = { x: primary.x + sign * distance, y: primary.y };
        if (this.isValidPlayer(candidate)) return { ok: true, source: "BOUNDED_SEARCH", position: candidate };
      }
    }
    return { ok: false, code: "PLAYER_PLACEMENT_BLOCKED" };
  }

  recoverBossTransform(saved, roomCenter = ROOM_CENTER) {
    if (this.isValidBoss(saved)) return { ok: true, source: "SAVED", position: { ...saved } };
    if (this.isValidBoss(roomCenter)) return { ok: true, source: "ROOM_CENTER", position: { ...roomCenter } };
    return { ok: false, code: "BOSS_TRANSFORM_BLOCKED" };
  }
}

module.exports = { RecoveryGeometryAdapter, DEFAULT_ANCHORS, ROOM_CENTER };
