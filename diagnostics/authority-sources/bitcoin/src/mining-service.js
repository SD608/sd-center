"use strict";

const crypto = require("node:crypto");

const MINING_INTERVAL_SECONDS = 10;
const SUCCESS_PROBABILITY = 0.0002;
const SUCCESS_THRESHOLD = 2;
const ROLL_RANGE = 10000;
const BTC_REWARD = 0.05;
const EXACT_TRIAL_LIMIT = 100000;

function randomUnit() {
  return (
    crypto.randomInt(0, 0x100000000) /
    0x100000000
  );
}

function sampleStandardNormal() {
  let first = 0;
  let second = 0;

  while (first <= Number.EPSILON) {
    first = randomUnit();
  }

  while (second <= Number.EPSILON) {
    second = randomUnit();
  }

  return (
    Math.sqrt(-2 * Math.log(first)) *
    Math.cos(2 * Math.PI * second)
  );
}

function sampleBinomial(trials) {
  const normalizedTrials = Math.max(
    0,
    Math.trunc(Number(trials)),
  );

  if (normalizedTrials <= 0) {
    return 0;
  }

  if (normalizedTrials <= EXACT_TRIAL_LIMIT) {
    let successes = 0;

    for (
      let index = 0;
      index < normalizedTrials;
      index += 1
    ) {
      if (
        crypto.randomInt(0, ROLL_RANGE) <
        SUCCESS_THRESHOLD
      ) {
        successes += 1;
      }
    }

    return successes;
  }

  const mean =
    normalizedTrials * SUCCESS_PROBABILITY;

  const standardDeviation = Math.sqrt(
    normalizedTrials *
      SUCCESS_PROBABILITY *
      (1 - SUCCESS_PROBABILITY),
  );

  const sampled = Math.round(
    mean +
      standardDeviation *
        sampleStandardNormal(),
  );

  return Math.min(
    normalizedTrials,
    Math.max(0, sampled),
  );
}

function calculateRewards(
  activeRooms,
  elapsedIntervals = 1,
) {
  const normalizedIntervals = Math.max(
    0,
    Math.trunc(Number(elapsedIntervals)),
  );

  if (normalizedIntervals <= 0) {
    return [];
  }

  const rewards = [];

  for (const room of activeRooms) {
    const gpuUnits = Array.isArray(room.gpuUnits)
      ? room.gpuUnits
          .map((unit) => ({
            slotIndex: Math.max(0, Math.trunc(Number(unit.slotIndex))),
            durability: Math.max(0, Math.min(100, Math.trunc(Number(unit.durability)))),
          }))
          .filter((unit) => unit.durability > 0)
      : Array.from(
          { length: Math.max(0, Math.trunc(Number(room.gpus || 0))) },
          (_, slotIndex) => ({ slotIndex, durability: 100 }),
        );

    let successes = 0;
    const gpuSuccesses = [];

    for (const unit of gpuUnits) {
      const sampledSuccesses = sampleBinomial(normalizedIntervals);
      const acceptedSuccesses = Math.min(
        unit.durability,
        sampledSuccesses,
      );

      if (acceptedSuccesses <= 0) {
        continue;
      }

      successes += acceptedSuccesses;
      gpuSuccesses.push({
        slotIndex: unit.slotIndex,
        successes: acceptedSuccesses,
        durabilityBefore: unit.durability,
        durabilityAfter: Math.max(0, unit.durability - acceptedSuccesses),
        broke: acceptedSuccesses >= unit.durability,
      });
    }

    if (successes <= 0) {
      continue;
    }

    rewards.push({
      accountId: room.accountId,
      roomKey: room.roomKey,
      successes,
      gpuSuccesses,
      brokenGpuCount: gpuSuccesses.filter((entry) => entry.broke).length,
      elapsedIntervals: normalizedIntervals,
      elapsedSeconds: normalizedIntervals * MINING_INTERVAL_SECONDS,
      btc: successes * BTC_REWARD,
    });
  }

  return rewards;
}

module.exports = {
  BTC_REWARD,
  MINING_INTERVAL_SECONDS,
  SUCCESS_PROBABILITY,
  calculateRewards,
  sampleBinomial,
};
