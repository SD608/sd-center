"use strict";

const crypto = require("node:crypto");

const MOVES = Object.freeze([
  Object.freeze({ key: "rock", label: "묵", name: "바위", emoji: "✊" }),
  Object.freeze({ key: "scissors", label: "찌", name: "가위", emoji: "✌️" }),
  Object.freeze({ key: "paper", label: "빠", name: "보", emoji: "✋" }),
]);

const MOVE_KEYS = new Set(MOVES.map((move) => move.key));
const MAX_STREAK = 8;
const MIN_BET = 100;
const MAX_BET = 1_000_000_000;

function normalizeBet(value) {
  const amount = Math.trunc(Number(value));
  if (!Number.isSafeInteger(amount) || amount < MIN_BET) {
    throw new Error(`베팅금은 ${MIN_BET.toLocaleString("ko-KR")}원 이상의 정수여야 합니다.`);
  }
  return Math.min(MAX_BET, amount);
}

function normalizeMove(value) {
  const move = String(value || "");
  if (!MOVE_KEYS.has(move)) throw new Error("묵, 찌, 빠 중 하나를 선택하세요.");
  return move;
}

function randomMove() {
  return MOVES[crypto.randomInt(0, MOVES.length)].key;
}

function winnerOfDifferentMoves(playerMove, computerMove) {
  const player = normalizeMove(playerMove);
  const computer = normalizeMove(computerMove);
  if (player === computer) return "tie";
  const playerWins = (
    (player === "rock" && computer === "scissors") ||
    (player === "scissors" && computer === "paper") ||
    (player === "paper" && computer === "rock")
  );
  return playerWins ? "player" : "computer";
}

function calculateReward(stakeValue, streakValue) {
  const stake = BigInt(normalizeBet(stakeValue));
  const streak = Math.trunc(Number(streakValue));
  if (!Number.isInteger(streak) || streak < 1 || streak > MAX_STREAK) {
    throw new Error("연승 수가 올바르지 않습니다.");
  }
  const exponent = BigInt(streak - 1);
  const numerator = stake * 19n * (3n ** exponent);
  const denominator = 10n * (2n ** exponent);
  const payout = numerator / denominator;
  if (payout > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("정산 금액이 너무 큽니다.");
  return Number(payout);
}

function multiplierForStreak(streakValue) {
  const streak = Math.trunc(Number(streakValue));
  if (!Number.isInteger(streak) || streak < 1 || streak > MAX_STREAK) return 0;
  return 1.9 * (1.5 ** (streak - 1));
}

function createComputerCommitment({ sessionId, handNumber, move = randomMove(), nonce = crypto.randomBytes(18).toString("hex") }) {
  const normalizedMove = normalizeMove(move);
  const payload = `${sessionId}:${handNumber}:${normalizedMove}:${nonce}`;
  return {
    move: normalizedMove,
    nonce,
    commitment: crypto.createHash("sha256").update(payload).digest("hex"),
  };
}

function verifyComputerCommitment({ sessionId, handNumber, move, nonce, commitment }) {
  const expected = createComputerCommitment({ sessionId, handNumber, move, nonce }).commitment;
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(String(commitment || ""), "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function moveInfo(key) {
  return MOVES.find((move) => move.key === key) || null;
}

module.exports = {
  MAX_BET,
  MAX_STREAK,
  MIN_BET,
  MOVES,
  calculateReward,
  createComputerCommitment,
  moveInfo,
  multiplierForStreak,
  normalizeBet,
  normalizeMove,
  randomMove,
  verifyComputerCommitment,
  winnerOfDifferentMoves,
};
