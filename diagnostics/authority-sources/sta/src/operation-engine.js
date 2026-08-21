"use strict";

const crypto = require("node:crypto");

const ENTRY_FEE = 50_000;
const HACKING_ROUNDS = 3;
const LASER_MAX_HITS = 5;
const VAULT_REQUIRED_HITS = 100;
const VAULT_DECAY_AMOUNT = 1;
const VAULT_DECAY_IDLE_MS = 800;
const VAULT_DECAY_INTERVAL_MS = 400;
const LOOT_DURATION_MS = 25_000;
const LOOT_CLICK_DELAY_MS = 0;
const LOOT_PER_CLICK = 2_000;
const OPERATION_COOLDOWN_MS = 5 * 60 * 1_000;
const MAX_LOOT = Number.MAX_SAFE_INTEGER;
const TRANSPORT_LOSS_PER_HIT = 0.05;
const TRANSPORT_HIT_COOLDOWN_MS = 1_000;
const COLORS = Object.freeze(["red", "blue", "yellow"]);

function secureShuffle(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = crypto.randomInt(index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  if (result.every((value, index) => value === values[index])) {
    [result[0], result[1]] = [result[1], result[0]];
  }
  return result;
}

function createHackingLayout() {
  return secureShuffle(COLORS);
}

function calculateTransportPayout(rawCash, hits) {
  const cash = Math.max(0, Math.trunc(Number(rawCash) || 0));
  const collisionCount = Math.max(0, Math.trunc(Number(hits) || 0));
  const rate = Math.max(0, 1 - collisionCount * TRANSPORT_LOSS_PER_HIT);
  return Math.floor(cash * rate);
}

module.exports = {
  COLORS,
  ENTRY_FEE,
  HACKING_ROUNDS,
  LASER_MAX_HITS,
  LOOT_CLICK_DELAY_MS,
  LOOT_DURATION_MS,
  LOOT_PER_CLICK,
  MAX_LOOT,
  OPERATION_COOLDOWN_MS,
  TRANSPORT_HIT_COOLDOWN_MS,
  TRANSPORT_LOSS_PER_HIT,
  VAULT_DECAY_AMOUNT,
  VAULT_DECAY_IDLE_MS,
  VAULT_DECAY_INTERVAL_MS,
  VAULT_REQUIRED_HITS,
  calculateTransportPayout,
  createHackingLayout,
};
