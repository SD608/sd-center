"use strict";

const crypto = require("node:crypto");

const VALID_MULTIPLIERS = new Set([
  1,
  10,
  50,
  100,
]);

class GameEngine {
  constructor() {
    this.rounds = new Map();
  }

  startRound({
    accountId,
    betAmountKrw,
    multiplier,
    allIn,
    balance,
  }) {
    const normalizedBalance = Math.trunc(Number(balance));
    const normalizedMultiplier = Number(multiplier);
    const isAllIn = allIn === true;

    if (
      !Number.isSafeInteger(normalizedBalance) ||
      normalizedBalance < 0
    ) {
      throw new Error("계좌 잔액이 올바르지 않습니다.");
    }

    let normalizedBetAmount = Math.trunc(
      Number(betAmountKrw),
    );
    let stake;

    if (isAllIn) {
      if (normalizedBalance <= 0) {
        throw new Error("올인할 수 있는 잔액이 없습니다.");
      }

      normalizedBetAmount = normalizedBalance;
      stake = normalizedBalance;
    } else {
      if (!VALID_MULTIPLIERS.has(normalizedMultiplier)) {
        throw new Error("지원하지 않는 배팅 배수입니다.");
      }

      if (
        !Number.isSafeInteger(normalizedBetAmount) ||
        normalizedBetAmount < 100
      ) {
        throw new Error("배팅금은 100원 이상이어야 합니다.");
      }

      stake = normalizedBetAmount * normalizedMultiplier;
    }

    if (!Number.isSafeInteger(stake) || stake <= 0) {
      throw new Error("배팅 금액이 너무 크거나 올바르지 않습니다.");
    }

    if (normalizedBalance < stake) {
      throw new Error(
        `잔액이 부족합니다. 최소 ${stake.toLocaleString(
          "ko-KR",
        )}원이 필요합니다.`,
      );
    }

    const roundId = crypto.randomUUID();

    this.rounds.set(roundId, {
      roundId,
      accountId: String(accountId),
      betAmountKrw: normalizedBetAmount,
      multiplier: isAllIn ? 1 : normalizedMultiplier,
      allIn: isAllIn,
      stake,
      status: "shaking",
      dice: null,
      createdAt: Date.now(),
    });

    this.#cleanup();

    return {
      roundId,
      stake,
      multiplier: isAllIn ? 1 : normalizedMultiplier,
      allIn: isAllIn,
    };
  }

  stopRound(roundId) {
    const round = this.#getRound(roundId);

    if (round.status !== "shaking") {
      throw new Error("멈출 수 없는 게임 상태입니다.");
    }

    round.dice = [
      crypto.randomInt(1, 7),
      crypto.randomInt(1, 7),
    ];
    round.status = "choosing";
    round.stoppedAt = Date.now();

    return {
      roundId: round.roundId,
      stake: round.stake,
      status: round.status,
    };
  }

  resolveRound({
    roundId,
    choice,
  }) {
    const round = this.#getRound(roundId);

    if (round.status !== "choosing") {
      throw new Error("이미 처리됐거나 선택할 수 없는 게임입니다.");
    }

    if (!["odd", "even"].includes(choice)) {
      throw new Error("홀 또는 짝을 선택하세요.");
    }

    const sum = round.dice[0] + round.dice[1];
    const parity = sum % 2 === 0
      ? "even"
      : "odd";
    const won = choice === parity;

    round.status = "resolved";
    round.choice = choice;
    round.parity = parity;
    round.sum = sum;
    round.won = won;
    round.resolvedAt = Date.now();

    return {
      accountId: round.accountId,
      dice: [...round.dice],
      sum,
      parity,
      choice,
      won,
      stake: round.stake,
      multiplier: round.multiplier,
    };
  }

  cancelRound(roundId) {
    if (this.rounds.has(roundId)) {
      this.rounds.delete(roundId);
    }
  }

  finishRound(roundId) {
    this.rounds.delete(roundId);
  }

  #getRound(roundId) {
    const round = this.rounds.get(String(roundId));

    if (!round) {
      throw new Error("게임 정보를 찾을 수 없습니다.");
    }

    return round;
  }

  #cleanup() {
    const now = Date.now();

    for (const [roundId, round] of this.rounds) {
      if (now - round.createdAt > 10 * 60 * 1000) {
        this.rounds.delete(roundId);
      }
    }
  }
}

module.exports = {
  GameEngine,
};
