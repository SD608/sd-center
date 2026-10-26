"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { RunAuthorityMock, G60_MS, DAY_MS } = require("./run-authority-mock.cjs");
const make = (props = {}) => new RunAuthorityMock(props);
function lock(run, at = 0) {
  assert.equal(run.disconnect("p1", at), "OFFLINE");
  run.sweep(at + G60_MS);
  return run.player("p1").epoch;
}

test("G60-CONTRACT-01 mock: committed early join defeats stale cleanup/retry", () => {
  const r = make();
  const epoch = lock(r);
  const deadline = r.deadline;
  assert.equal(r.join({ id: "p1", now: deadline - 1, requestId: "a", tokenEpoch: epoch }), "JOIN_COMMIT_SAVED");
  assert.equal(r.join({ id: "p1", now: deadline - 1, requestId: "a", tokenEpoch: epoch }), "JOIN_COMMIT_SAVED");
  assert.equal(r.cleanup(deadline + 100), "NOT_EXPIRED");
  assert.equal(r.closed, false);
});

test("G60-CONTRACT-02 mock: exact deadline expires, earlier Run END rejects", () => {
  const r = make();
  const epoch = lock(r);
  assert.equal(r.join({ id: "p1", now: r.deadline, requestId: "at", tokenEpoch: epoch, clientTime: 0 }), "EXPIRED");
  assert.equal(r.cleanup(r.deadline), "CLEANUP_COMMIT");
  assert.equal(r.join({ id: "p1", now: r.now, requestId: "late", tokenEpoch: epoch }), "RUN_CLOSED");
  const x = make(); const ep = lock(x); x.endRun();
  assert.equal(x.join({ id: "p1", now: x.now, requestId: "b", tokenEpoch: ep }), "RUN_CLOSED");
});

test("G60-CONTRACT-03 mock: trusted fault extension at most once and not canceled by recovery", () => {
  const r = make(); const epoch = lock(r); const prior = r.deadline;
  assert.equal(r.approveServerFaultGrace({ verified: false, now: prior }), "REJECTED");
  assert.equal(r.approveServerFaultGrace({ verified: true, now: prior }), "GRANTED");
  assert.equal(r.deadline, prior + DAY_MS);
  assert.equal(r.approveServerFaultGrace({ verified: true, now: prior + 1 }), "REJECTED");
  assert.equal(r.join({ id: "p1", now: prior + 2, requestId: "c", tokenEpoch: epoch }), "JOIN_COMMIT_SAVED");
});

test("G60-CONTRACT-04 mock: ACK loss and request retry cannot duplicate committed inventory", () => {
  const r = make();
  assert.equal(r.commitInventory({ id: "p1", requestId: "r1", item: "ore", change: 1 }), "COMMITTED");
  assert.equal(r.commitInventory({ id: "p1", requestId: "r1", item: "ore", change: 1 }), "COMMITTED");
  assert.equal(r.revisions.get("p1:ore"), 1);
});

test("G60-CONTRACT-05 mock: uncommitted changes remain absent, no client mint", () => {
  const r = make();
  assert.equal(r.commitInventory({ id: "p1", requestId: "r2", item: "ore", change: 9, committed: false }), "UNKNOWN_NO_COMMIT");
  assert.equal(r.revisions.has("p1:ore"), false);
  assert.equal(r.clientMintReward(), "DENIED_CLIENT_AUTHORITY");
});

test("G60-CONTRACT-06 mock: G60 shipment moves 8 units once and locks delivery", () => {
  const r = make({ tempCargo: { sample: 8 } });
  lock(r);
  assert.equal(r.workshop.get("sample"), 8);
  assert.equal(r.tempCargo.has("sample"), false);
  assert.equal(r.shipments.size, 1);
  r.sweep(r.now + 100);
  assert.equal(r.deliveryCommit(), "DUPLICATE");
  assert.equal(r.workshop.get("sample"), 8);
});

test("G60-CONTRACT-07 mock: unknown shipment holds join without deadline mutation", () => {
  const r = make();
  const epoch = lock(r); const deadline = r.deadline;
  r.setUnknownDelivery(true);
  assert.equal(r.join({ id: "p1", now: deadline - 100, requestId: "hold", tokenEpoch: epoch }), "HOLD_LEDGER");
  assert.equal(r.deadline, deadline);
  r.setUnknownDelivery(false);
  assert.equal(r.join({ id: "p1", now: deadline - 99, requestId: "retry-fresh", tokenEpoch: epoch }), "JOIN_COMMIT_SAVED");
});

test("G60-CONTRACT-08 mock: confirmed death persists; locked player cannot take new damage", () => {
  const r = make();
  assert.equal(r.die("p1"), "DEATH_COMMIT");
  assert.equal(r.disconnect("p1", 0), "REJECTED");
  assert.equal(r.join({ id: "p1", now: 0, requestId: "d", tokenEpoch: 1 }), "PARTICIPANT_FINISHED");
  const x = make(); lock(x);
  assert.equal(x.applyDamage("p1", 1000), "OFFLINE_DAMAGE_REJECTED");
  assert.equal(x.player("p1").hp, 100);
});

test("G60-CONTRACT-09 mock: disconnected DoT pause, other party shared simulation continues", () => {
  const r = make({ playerIds: ["p1", "p2"] });
  r.setDot("p1", 10_000, 2_000);
  r.setDot("p2", 10_000, 2_000);
  assert.equal(r.disconnect("p1", 0), "OFFLINE");
  r.sweep(G60_MS);
  r.advanceGame(5_000);
  assert.equal(r.player("p1").dotRemaining, 10_000);
  assert.equal(r.player("p1").nextDotIn, 2_000);
  assert.equal(r.player("p2").dotRemaining, 5_000);
  assert.equal(r.sharedTicks, 5_000);
  assert.equal(r.join({ id: "p1", now: G60_MS, requestId: "e", tokenEpoch: 2 }), "JOIN_COMMIT_SAVED");
  r.advanceGame(1000);
  assert.equal(r.player("p1").dotRemaining, 9000);
  assert.equal(r.player("p1").nextDotIn, 1000);
});

test("G60-CONTRACT-10 mock: stale epoch and revoked device refused; other teammate unaffected", () => {
  const r = make({ playerIds: ["p1", "p2"] });
  assert.equal(r.disconnect("p1", 0), "OFFLINE");
  assert.equal(r.command("p1", 1), "DENY");
  assert.equal(r.join({ id: "p1", now: 1, requestId: "f", tokenEpoch: 1 }), "STALE_OR_REVOKED");
  assert.equal(r.join({ id: "p1", now: 2, requestId: "g", tokenEpoch: 2 }), "JOIN_COMMIT_SAVED");
  assert.equal(r.command("p1", 2), "ACCEPT");
  r.revoke("p1");
  assert.equal(r.command("p1", 2), "DENY");
  assert.equal(r.command("p2", 1), "ACCEPT");
});

test("G60-CONTRACT-11 mock: safe fallback or hold, no timer extension", () => {
  const r = make(); const epoch = lock(r); const deadline = r.deadline;
  assert.equal(r.join({ id: "p1", now: r.now, requestId: "loc1", tokenEpoch: epoch, primarySafe: false, elevatorSafe: false }), "HOLD_LOCATION");
  assert.equal(r.deadline, deadline);
  assert.equal(r.join({ id: "p1", now: r.now, requestId: "loc2", tokenEpoch: epoch, primarySafe: false, elevatorSafe: true }), "JOIN_COMMIT_ELEVATOR");
});

test("G60-CONTRACT-12 mock: valid reconnect before 60s suppresses shipment", () => {
  const r = make({ tempCargo: { sample: 2 } });
  r.disconnect("p1", 0);
  assert.equal(r.join({ id: "p1", now: G60_MS - 1, requestId: "soon", tokenEpoch: 2 }), "JOIN_COMMIT_SAVED");
  r.sweep(G60_MS);
  assert.equal(r.deliveryLocked, false);
  assert.equal(r.workshop.size, 0);
  assert.equal(r.tempCargo.get("sample"), 2);
});

test("G60-CONTRACT-13 mock: only all-locked sets 24h timer, valid join resets next cycle", () => {
  const r = make({ playerIds: ["p1", "p2"] });
  r.disconnect("p1", 0);
  r.sweep(G60_MS);
  assert.equal(r.deadline, null);
  r.disconnect("p2", G60_MS);
  r.sweep(G60_MS * 2);
  assert.equal(r.deadline, G60_MS * 2 + DAY_MS);
  assert.equal(r.join({ id: "p1", now: G60_MS * 2 + 1, requestId: "re", tokenEpoch: 2 }), "JOIN_COMMIT_SAVED");
  assert.equal(r.deadline, null);
  r.disconnect("p1", G60_MS * 2 + 2);
  r.sweep(G60_MS * 3 + 2);
  assert.equal(r.deadline, G60_MS * 3 + 2 + DAY_MS);
});

test("G60-CONTRACT-15 mock: explicitly deny client-side reward/ownership mutation", () => {
  const r = make({ itemOwners: { item: "p1" } });
  assert.equal(r.clientMintReward(), "DENIED_CLIENT_AUTHORITY");
  assert.equal(r.clientChangeOwner(), "DENIED_CLIENT_AUTHORITY");
  assert.equal(r.itemOwners.get("item"), "p1");
});

test("G60-CONTRACT-16 remains BLOCKED for real Center/Unity/Windows, never mock-PASS", { skip: "no executable, installer, auth bridge or Windows user test" }, () => {});
