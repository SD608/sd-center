"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  calculateReward, createComputerCommitment, verifyComputerCommitment,
  winnerOfDifferentMoves,
} = require("../src/game-engine");
const {
  cashOut, continueStreak, getAccount, getGameState, playHand, startSession,
} = require("../src/wallet-database");

assert.equal(winnerOfDifferentMoves("rock", "scissors"), "player");
assert.equal(winnerOfDifferentMoves("scissors", "rock"), "computer");
assert.equal(winnerOfDifferentMoves("paper", "paper"), "tie");
assert.deepEqual(
  Array.from({ length: 8 }, (_, index) => calculateReward(10000, index + 1)),
  [19000, 28500, 42750, 64125, 96187, 144281, 216421, 324632],
);
const commitment = createComputerCommitment({ sessionId: "s", handNumber: 1, move: "rock", nonce: "abc" });
assert.equal(verifyComputerCommitment({ sessionId: "s", handNumber: 1, ...commitment }), true);
assert.equal(verifyComputerCommitment({ sessionId: "s", handNumber: 1, ...commitment, move: "paper" }), false);

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "sdmjp-test-"));
const databasePath = path.join(temporary, "wallet.sqlite");
const db = new DatabaseSync(databasePath);
db.exec(`
  PRAGMA foreign_keys=ON;
  CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, bank_name TEXT NOT NULL,
    account_number TEXT NOT NULL, owner_name TEXT NOT NULL,
    balance INTEGER NOT NULL CHECK(balance >= 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE transactions (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
    transaction_type TEXT NOT NULL CHECK(transaction_type IN ('deposit','withdraw')),
    amount INTEGER NOT NULL CHECK(amount > 0), memo TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );
`);
const now = new Date().toISOString();
db.prepare("INSERT INTO users VALUES (1,'tester','x',?)").run(now);
db.prepare("INSERT INTO accounts VALUES (?,?,?,?,?,?,?,?)").run("account-1", 1, "SD은행", "100-000", "테스터", 1000000, now, now);
db.close();

function currentComputerMove(sessionId) {
  const local = new DatabaseSync(databasePath, { readOnly: true });
  try { return local.prepare("SELECT computer_move FROM sd_mukjippa_sessions WHERE id=?").get(sessionId).computer_move; }
  finally { local.close(); }
}
function winningMove(move) {
  return { rock: "paper", scissors: "rock", paper: "scissors" }[move];
}
function losingMove(move) {
  return { rock: "scissors", scissors: "paper", paper: "rock" }[move];
}
function winOneMatch(sessionId) {
  let computer = currentComputerMove(sessionId);
  let result = playHand({ databasePath, accountId: "account-1", sessionId, playerMove: winningMove(computer) });
  assert.equal(result.session.phase, "mjp");
  assert.equal(result.session.attacker, "player");
  computer = currentComputerMove(sessionId);
  result = playHand({ databasePath, accountId: "account-1", sessionId, playerMove: computer });
  assert.equal(result.reveal.matchResult, "player_win");
  return result;
}

let started = startSession({ databasePath, accountId: "account-1", betAmount: 10000 });
assert.equal(started.balance, 990000);
assert.equal(getGameState(databasePath, "account-1").session.id, started.session.id);
let result = winOneMatch(started.session.id);
assert.equal(result.session.streak, 1);
assert.equal(result.session.potentialPayout, 19000);
result = continueStreak({ databasePath, accountId: "account-1", sessionId: started.session.id });
assert.equal(result.session.phase, "rps");
result = winOneMatch(started.session.id);
assert.equal(result.session.streak, 2);
assert.equal(result.session.potentialPayout, 28500);
let paid = cashOut({ databasePath, accountId: "account-1", sessionId: started.session.id });
assert.equal(paid.payout, 28500);
assert.equal(paid.balance, 1018500);
assert.equal(getAccount(databasePath, "account-1").balance, 1018500);
const duplicate = cashOut({ databasePath, accountId: "account-1", sessionId: started.session.id });
assert.equal(duplicate.alreadyPaid, true);
assert.equal(duplicate.balance, 1018500);

started = startSession({ databasePath, accountId: "account-1", betAmount: 1000 });
let computer = currentComputerMove(started.session.id);
result = playHand({ databasePath, accountId: "account-1", sessionId: started.session.id, playerMove: losingMove(computer) });
assert.equal(result.session.attacker, "computer");
computer = currentComputerMove(started.session.id);
result = playHand({ databasePath, accountId: "account-1", sessionId: started.session.id, playerMove: computer });
assert.equal(result.reveal.matchResult, "computer_win");
assert.equal(result.session.status, "lost");
assert.equal(getGameState(databasePath, "account-1").session, null);
assert.equal(getAccount(databasePath, "account-1").balance, 1017500);

started = startSession({ databasePath, accountId: "account-1", betAmount: 1000 });
for (let streak = 1; streak <= 8; streak += 1) {
  result = winOneMatch(started.session.id);
  assert.equal(result.session.streak, streak);
  if (streak < 8) {
    assert.equal(result.session.phase, "decision");
    continueStreak({ databasePath, accountId: "account-1", sessionId: started.session.id });
  } else {
    assert.equal(result.autoCashedOut, true);
    assert.equal(result.session.status, "cashed_out");
    assert.equal(result.session.potentialPayout, 32463);
  }
}
assert.equal(getAccount(databasePath, "account-1").balance, 1048963);

const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
const ui = fs.readFileSync(path.join(__dirname, "..", "public", "js", "app.js"), "utf8");
assert.match(html, /다음 연승 도전/);
assert.match(html, /data-move="rock"/);
assert.match(html, /효과음/);
assert.match(ui, /event\.key === "F5"/);
assert.match(ui, /1\.5 \*\* \(streak - 1\)/);

fs.rmSync(temporary, { recursive: true, force: true });
console.log("Mukjippa engine, persistence, prepayment, streak and settlement tests OK");
