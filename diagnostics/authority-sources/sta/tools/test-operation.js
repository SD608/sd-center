"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const dbApi = require("../src/wallet-database");
const engine = require("../src/operation-engine");

function createWallet(filePath) {
  const db = new DatabaseSync(filePath);
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      bank_name TEXT NOT NULL,
      account_number TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      transaction_type TEXT NOT NULL CHECK (transaction_type IN ('deposit','withdraw')),
      amount INTEGER NOT NULL CHECK (amount > 0),
      memo TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
  `);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO users (username,password_hash,created_at) VALUES ('tester','x',?)").run(now);
  db.prepare("INSERT INTO accounts (id,user_id,bank_name,account_number,owner_name,balance,created_at,updated_at) VALUES ('a1',1,'SD은행','111-111','테스터',1000000,?,?)").run(now, now);
  db.prepare("INSERT INTO accounts (id,user_id,bank_name,account_number,owner_name,balance,created_at,updated_at) VALUES ('a2',1,'SD은행','222-222','테스터',100000,?,?)").run(now, now);
  db.close();
}

function solveHacking(databasePath, operationId) {
  for (let round = 1; round <= 3; round += 1) {
    for (const color of engine.COLORS) {
      const result = dbApi.hackingConnect({ databasePath, operationId, sourceColor: color, targetColor: color });
      assert.equal(result.connected, true);
    }
  }
}

function getRawRow(databasePath, operationId) {
  const db = new DatabaseSync(databasePath);
  const row = db.prepare("SELECT * FROM sta_operations WHERE id=?").get(operationId);
  db.close();
  return row;
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sta-test-"));
const databasePath = path.join(tempDir, "wallet.sqlite");
createWallet(databasePath);

assert.equal(dbApi.validateWalletDatabase(databasePath).ok, true);

// 1) 참가비 선결제와 해킹 저장
const first = dbApi.startOperation({ databasePath, accountId: "a1" });
assert.equal(first.balance, 950000);
assert.equal(first.operation.phase, "hacking");
const wrong = dbApi.hackingConnect({ databasePath, operationId: first.operation.id, sourceColor: "red", targetColor: "blue" });
assert.equal(wrong.connected, false);
assert.deepEqual(wrong.operation.hackingConnections, []);
solveHacking(databasePath, first.operation.id);
let state = dbApi.getOperationState(databasePath);
assert.equal(state.operation.phase, "raid_ready");

// 2) 레이저는 4회까지 유지, 5번째에 전체 실패
state = dbApi.startRaid({ databasePath, operationId: first.operation.id });
assert.equal(state.operation.phase, "raid_laser");
for (let hit = 1; hit <= 4; hit += 1) {
  const result = dbApi.laserHit({ databasePath, operationId: first.operation.id });
  assert.equal(result.failed, false);
  assert.equal(result.hits, hit);
}
const fifth = dbApi.laserHit({ databasePath, operationId: first.operation.id });
assert.equal(fifth.failed, true);
assert.equal(dbApi.getOperationState(databasePath).operation, null);

// 3) 새 작전은 다시 참가비를 내고 해킹부터 시작
const second = dbApi.startOperation({ databasePath, accountId: "a1" });
assert.equal(second.balance, 900000);
solveHacking(databasePath, second.operation.id);
dbApi.startRaid({ databasePath, operationId: second.operation.id });
dbApi.laserCheckpoint({ databasePath, operationId: second.operation.id, checkpoint: 1 });
dbApi.laserPass({ databasePath, operationId: second.operation.id });

// 4) 금고 게이지 감소, 현금 획득 종료 후 운반 즉시 해금
let baseMs = Date.now();
for (let i = 0; i < 10; i += 1) {
  dbApi.vaultHit({ databasePath, operationId: second.operation.id, nowMs: baseMs });
}
let decay = dbApi.vaultDecay({ databasePath, operationId: second.operation.id, nowMs: baseMs + 1 });
assert.equal(decay.operation.vaultProgress, 9);
for (let i = 9; i < engine.VAULT_REQUIRED_HITS; i += 1) {
  dbApi.vaultHit({ databasePath, operationId: second.operation.id, nowMs: baseMs });
}
state = dbApi.getOperationState(databasePath, baseMs);
assert.equal(state.operation.phase, "raid_loot");
const click1 = dbApi.lootClick({ databasePath, operationId: second.operation.id, nowMs: baseMs + 100 });
assert.equal(click1.accepted, true);
assert.equal(click1.operation.rawCash, 2000);
const rapidClick = dbApi.lootClick({ databasePath, operationId: second.operation.id, nowMs: baseMs + 101 });
assert.equal(rapidClick.accepted, true);
assert.equal(rapidClick.operation.rawCash, 4000);
const click3 = dbApi.lootClick({ databasePath, operationId: second.operation.id, nowMs: baseMs + 102 });
assert.equal(click3.accepted, true);
assert.equal(click3.operation.rawCash, 6000);
const lootEndMs = baseMs + engine.LOOT_DURATION_MS;
state = dbApi.getOperationState(databasePath, lootEndMs + 1);
assert.equal(state.operation.phase, "transport_ready");

// 5) 운반 충돌은 회당 5% 차감, 도착 후 선택 계좌로 한 번만 지급
state = dbApi.startTransport({ databasePath, operationId: second.operation.id, nowMs: lootEndMs + 2 });
assert.equal(state.operation.phase, "transport");
const hit1 = dbApi.transportHit({ databasePath, operationId: second.operation.id, nowMs: baseMs + 30000 });
assert.equal(hit1.accepted, true);
const blockedHit = dbApi.transportHit({ databasePath, operationId: second.operation.id, nowMs: baseMs + 30100 });
assert.equal(blockedHit.accepted, false);
const hit2 = dbApi.transportHit({ databasePath, operationId: second.operation.id, nowMs: baseMs + 31000 });
assert.equal(hit2.accepted, true);
assert.equal(hit2.operation.projectedPayout, 5400);
const arriveMs = baseMs + 39000;
dbApi.transportArrive({ databasePath, operationId: second.operation.id, nowMs: arriveMs });
const payoutMs = baseMs + 40000;
const payout = dbApi.payout({ databasePath, operationId: second.operation.id, accountId: "a2", nowMs: payoutMs });
assert.equal(payout.amount, 5400);
assert.equal(payout.balance, 105400);
assert.equal(payout.operationCooldownRemainingMs, engine.OPERATION_COOLDOWN_MS - 1000);
assert.throws(() => dbApi.payout({ databasePath, operationId: second.operation.id, accountId: "a2", nowMs: payoutMs + 1 }));
state = dbApi.getOperationState(databasePath, payoutMs + 1000);
assert.equal(state.operation, null);
assert.ok(state.operationCooldownRemainingMs > 0);

// 6) 운반과 보수 지급까지 완료한 뒤 5분 동안 새 작전 입장 불가
assert.throws(
  () => dbApi.startOperation({ databasePath, accountId: "a1", nowMs: payoutMs + 1000 }),
  /새 작전 쿨타임/,
);
const afterCooldown = dbApi.startOperation({
  databasePath,
  accountId: "a1",
  nowMs: arriveMs + engine.OPERATION_COOLDOWN_MS + 1,
});
assert.equal(afterCooldown.operation.phase, "hacking");
assert.equal(afterCooldown.balance, 850000);

const finalRow = getRawRow(databasePath, second.operation.id);
assert.equal(finalRow.status, "completed");
assert.equal(finalRow.phase, "completed");
assert.ok(finalRow.next_operation_unlock_at);

console.log("STA Version 6 operation tests passed.");
