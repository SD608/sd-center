"use strict";

const crypto = require("node:crypto");

const SYMBOLS = Object.freeze([
  { key: "miss", name: "꽝", multiplier: 0, from: 1, to: 75000, probability: "75%" },
  { key: "stone", name: "돌", multiplier: 1, from: 75001, to: 87000, probability: "12%" },
  { key: "coal", name: "석탄", multiplier: 2, from: 87001, to: 93000, probability: "6%" },
  { key: "copper", name: "구리", multiplier: 3, from: 93001, to: 96500, probability: "3.5%" },
  { key: "iron", name: "철", multiplier: 5, from: 96501, to: 98500, probability: "2%" },
  { key: "gold", name: "금", multiplier: 10, from: 98501, to: 99500, probability: "1%" },
  { key: "emerald", name: "에메랄드", multiplier: 25, from: 99501, to: 99850, probability: "0.35%" },
  { key: "diamond", name: "다이아", multiplier: 50, from: 99851, to: 99950, probability: "0.1%" },
  { key: "seven", name: "7", multiplier: 100, from: 99951, to: 99990, probability: "0.04%" },
  { key: "red-seven", name: "빨간 7", multiplier: 250, from: 99991, to: 99999, probability: "0.009%" },
  { key: "gold-seven", name: "황금색 7", multiplier: 500, from: 100000, to: 100000, probability: "0.001%" }
]);

const REEL_SYMBOLS = SYMBOLS.filter((symbol) => symbol.key !== "miss");

function resultForRoll(roll) {
  const normalized = Math.trunc(Number(roll));
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 100000) {
    throw new Error("슬롯 난수는 1부터 100,000 사이여야 합니다.");
  }
  return SYMBOLS.find((symbol) => normalized >= symbol.from && normalized <= symbol.to);
}

function randomMissReels() {
  const reels = Array.from({ length: 3 }, () => {
    return REEL_SYMBOLS[crypto.randomInt(0, REEL_SYMBOLS.length)].key;
  });

  if (reels[0] === reels[1] && reels[1] === reels[2]) {
    const currentIndex = REEL_SYMBOLS.findIndex((symbol) => symbol.key === reels[2]);
    reels[2] = REEL_SYMBOLS[(currentIndex + 1) % REEL_SYMBOLS.length].key;
  }

  return reels;
}

function createSpinResult(betAmount, forcedRoll) {
  const stake = Math.trunc(Number(betAmount));
  if (!Number.isSafeInteger(stake) || stake < 100) {
    throw new Error("베팅금은 100원 이상의 정수로 입력하세요.");
  }
  if (stake > 1_000_000_000) {
    throw new Error("한 번에 베팅할 수 있는 최대 금액은 10억원입니다.");
  }

  const roll = forcedRoll === undefined
    ? crypto.randomInt(1, 100001)
    : Math.trunc(Number(forcedRoll));
  const result = resultForRoll(roll);
  const won = result.multiplier > 0;
  const reels = won ? [result.key, result.key, result.key] : randomMissReels();
  const payout = stake * result.multiplier;

  if (!Number.isSafeInteger(payout)) {
    throw new Error("당첨금이 처리 가능한 범위를 초과했습니다.");
  }

  return {
    roll,
    resultKey: result.key,
    resultName: result.name,
    multiplier: result.multiplier,
    probability: result.probability,
    won,
    reels,
    stake,
    payout,
    jackpot: result.key === "gold-seven",
  };
}

module.exports = {
  SYMBOLS,
  createSpinResult,
  resultForRoll,
};
