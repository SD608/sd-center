"use strict";
// IMPLEMENTATION_PROPOSAL: deterministic in-memory mock only.
// Not a server, not a DB transaction, not a Core/Center/Unity adapter.
// Never use for live ownership, reward, achievement or authentication.
const G60_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

class RunAuthorityMock {
  constructor({ playerIds = ["p1"], itemOwners = {}, tempCargo = {}, serverStart = 0 } = {}) {
    this.now = serverStart;
    this.closed = false;
    this.closedReason = null;
    this.deadline = null;
    this.faultGraceApplied = false;
    this.shipments = new Map();
    this.itemOwners = new Map(Object.entries(itemOwners));
    this.workshop = new Map();
    this.tempCargo = new Map(Object.entries(tempCargo));
    this.deliveryLocked = false;
    this.deliveryUnknown = false;
    this.revisions = new Map();
    this.requestResults = new Map();
    this.participants = new Map(playerIds.map(id => [id, {
      status: "active", disconnectAt: null, lockAt: null, dead: false, returned: false,
      epoch: 1, revoked: false, hp: 100, dotRemaining: 0, nextDotIn: 0,
    }]));
    this.sharedTicks = 0;
  }

  clock(now) {
    if (!Number.isSafeInteger(now) || now < this.now) throw Error("UNTRUSTED_CLOCK");
    this.now = now;
  }

  player(id) {
    const p = this.participants.get(id);
    if (!p) throw Error("UNKNOWN_PARTICIPANT");
    return p;
  }

  disconnect(id, now) {
    this.clock(now);
    const p = this.player(id);
    if (this.closed || p.dead || p.returned || p.revoked || p.status !== "active") return "REJECTED";
    p.status = "offline";
    p.disconnectAt = now;
    p.lockAt = now + G60_MS;
    p.epoch++;
    return "OFFLINE";
  }

  deliveryCommit() {
    if (this.deliveryLocked) return "DUPLICATE";
    if (this.deliveryUnknown) return "UNKNOWN";
    const shipmentId = "run:temp:once";
    if (this.shipments.has(shipmentId)) return "DUPLICATE";
    const cargo = [...this.tempCargo.entries()];
    for (const [item, qty] of cargo) {
      if (!Number.isSafeInteger(qty) || qty < 0) throw Error("INVALID_CARGO");
    }
    for (const [item, qty] of cargo) {
      this.workshop.set(item, (this.workshop.get(item) || 0) + qty);
      this.tempCargo.delete(item);
    }
    this.shipments.set(shipmentId, { itemCount: cargo.reduce((n, x) => n + x[1], 0) });
    this.deliveryLocked = true;
    return "COMMITTED";
  }

  sweep(now) {
    this.clock(now);
    if (this.closed) return "CLOSED";
    for (const p of this.participants.values()) {
      if (p.status === "offline" && now >= p.lockAt) p.status = "locked";
    }
    if ([...this.participants.values()].some(p => p.status === "locked")) {
      this.deliveryCommit(); // mock uses one Run-wide temporary shipment only
    }
    const allLocked = [...this.participants.values()].every(p => p.status === "locked" || p.dead || p.returned);
    if (allLocked && this.deadline === null) {
      const locks = [...this.participants.values()].filter(p => p.status === "locked").map(p => p.lockAt);
      this.deadline = (locks.length ? Math.max(...locks) : now) + DAY_MS;
    }
    return "SWEPT";
  }

  approveServerFaultGrace({ verified, now }) {
    this.clock(now);
    if (!verified || this.faultGraceApplied || this.deadline === null || this.closed) return "REJECTED";
    // Mock input verified=true is a trusted test fixture, not client evidence.
    this.deadline += DAY_MS;
    this.faultGraceApplied = true;
    return "GRANTED";
  }

  setUnknownDelivery(unknown) { this.deliveryUnknown = Boolean(unknown); }

  join({ id, now, requestId, tokenEpoch, primarySafe = true, elevatorSafe = true, clientTime = null }) {
    this.clock(now);
    const key = id + ":join:" + requestId;
    const prior = this.requestResults.get(key);
    if (prior) {
      if (prior.epoch !== tokenEpoch) return "IDEMPOTENCY_CONFLICT";
      return prior.result;
    }
    const p = this.player(id);
    let result;
    if (this.closed) result = "RUN_CLOSED";
    else if (p.dead || p.returned) result = "PARTICIPANT_FINISHED";
    else if (p.revoked || tokenEpoch !== p.epoch) result = "STALE_OR_REVOKED";
    else if (this.deadline !== null && now >= this.deadline) result = "EXPIRED";
    else if (this.deliveryUnknown) result = "HOLD_LEDGER";
    else if (!primarySafe && !elevatorSafe) result = "HOLD_LOCATION";
    else if (p.status === "active") result = "ALREADY_ACTIVE";
    else {
      p.status = "active";
      p.disconnectAt = null;
      p.lockAt = null;
      this.deadline = null; // old cleanup can no longer close active run
      result = primarySafe ? "JOIN_COMMIT_SAVED" : "JOIN_COMMIT_ELEVATOR";
    }
    // Persist only terminal, successfully committed join; HOLD/UNKNOWN must be re-queryable.
    // ClientTime deliberately ignored. Token epoch binds the committed request.
    if (result.startsWith("JOIN_COMMIT_")) this.requestResults.set(key, { result, epoch: tokenEpoch });
    return result;
  }

  cleanup(now) {
    this.clock(now);
    if (this.closed) return "DUPLICATE_END";
    if (this.deadline === null || now < this.deadline) return "NOT_EXPIRED";
    this.closed = true;
    this.closedReason = "CLEANUP_COMMIT";
    return "CLEANUP_COMMIT";
  }

  commitInventory({ id, requestId, item, change, committed = true }) {
    this.player(id);
    const key = id + ":inventory:" + requestId;
    const prior = this.requestResults.get(key);
    if (prior) return prior.item === item && prior.change === change ? prior.result : "IDEMPOTENCY_CONFLICT";
    if (!committed) return "UNKNOWN_NO_COMMIT";
    if (!Number.isSafeInteger(change) || change === 0) throw Error("INVALID_CHANGE");
    const oldQty = this.revisions.get(id + ":" + item) || 0;
    if (oldQty + change < 0) return "INSUFFICIENT_ITEMS";
    this.revisions.set(id + ":" + item, oldQty + change);
    const outcome = "COMMITTED";
    this.requestResults.set(key, { result: outcome, item, change });
    return outcome;
  }

  die(id) {
    const p = this.player(id);
    if (p.status === "locked") return "OFFLINE_DAMAGE_REJECTED";
    if (p.dead) return "DUPLICATE_DEATH";
    p.hp = 0; p.dead = true;
    return "DEATH_COMMIT";
  }

  applyDamage(id, points) {
    const p = this.player(id);
    if (p.status === "locked") return "OFFLINE_DAMAGE_REJECTED";
    if (p.dead) return "ALREADY_DEAD";
    p.hp = Math.max(0, p.hp - points);
    return p.hp === 0 ? this.die(id) : "DAMAGE_COMMIT";
  }

  setDot(id, remainingMs, nextTickMs) {
    const p = this.player(id);
    p.dotRemaining = remainingMs; p.nextDotIn = nextTickMs;
  }

  advanceGame(deltaMs) {
    if (!Number.isSafeInteger(deltaMs) || deltaMs < 0) throw Error("INVALID_TICK");
    this.sharedTicks += deltaMs;
    for (const p of this.participants.values()) {
      if (p.status !== "active") continue;
      p.dotRemaining = Math.max(0, p.dotRemaining - deltaMs);
      p.nextDotIn = Math.max(0, p.nextDotIn - deltaMs);
    }
  }

  command(id, tokenEpoch) {
    const p = this.player(id);
    return !this.closed && !p.dead && !p.returned && !p.revoked &&
      p.status === "active" && tokenEpoch === p.epoch ? "ACCEPT" : "DENY";
  }

  revoke(id) { this.player(id).revoked = true; }
  returnNormally(id) { const p = this.player(id); p.returned = true; p.status = "returned"; }
  endRun() { this.closed = true; this.closedReason = "RUN_END"; }
  // Explicitly never expose client-write rewards or ownership.
  clientMintReward() { return "DENIED_CLIENT_AUTHORITY"; }
  clientChangeOwner() { return "DENIED_CLIENT_AUTHORITY"; }
}

module.exports = { RunAuthorityMock, G60_MS, DAY_MS };
