"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  ENTRY_FEE,
  HACKING_ROUNDS,
  LASER_MAX_HITS,
  LOOT_CLICK_DELAY_MS,
  LOOT_DURATION_MS,
  LOOT_PER_CLICK,
  MAX_LOOT,
  OPERATION_COOLDOWN_MS,
  TRANSPORT_HIT_COOLDOWN_MS,
  VAULT_DECAY_AMOUNT,
  VAULT_REQUIRED_HITS,
  calculateTransportPayout,
  createHackingLayout,
} = require("./operation-engine");

function openDatabase(databasePath, readOnly = false) {
  if (!databasePath || !fs.existsSync(databasePath)) throw new Error("SD지갑 데이터베이스 파일을 찾을 수 없습니다.");
  const db = new DatabaseSync(databasePath, { readOnly });
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  return db;
}

function validateWalletDatabase(databasePath) {
  let db;
  try {
    db = openDatabase(databasePath, true);
    const names = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','accounts','transactions')`)
      .all().map((row) => row.name);
    const missing = ["users", "accounts", "transactions"].filter((name) => !names.includes(name));
    return missing.length ? { ok: false, error: "선택한 파일은 SD지갑 데이터베이스 형식이 아닙니다." } : { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    if (db) db.close();
  }
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sta_operations (
      id TEXT PRIMARY KEY,
      entry_account_id TEXT NOT NULL,
      entry_fee INTEGER NOT NULL,
      status TEXT NOT NULL,
      phase TEXT NOT NULL,
      hacking_round INTEGER NOT NULL DEFAULT 1,
      hacking_layout TEXT NOT NULL,
      hacking_connections TEXT NOT NULL DEFAULT '[]',
      laser_hits INTEGER NOT NULL DEFAULT 0,
      laser_checkpoint INTEGER NOT NULL DEFAULT 0,
      vault_progress INTEGER NOT NULL DEFAULT 0,
      raw_cash INTEGER NOT NULL DEFAULT 0,
      loot_started_at TEXT,
      loot_ends_at TEXT,
      last_loot_click_ms INTEGER NOT NULL DEFAULT 0,
      transport_unlock_at TEXT,
      next_operation_unlock_at TEXT,
      transport_hits INTEGER NOT NULL DEFAULT 0,
      transport_checkpoint INTEGER NOT NULL DEFAULT 0,
      last_transport_hit_ms INTEGER NOT NULL DEFAULT 0,
      payout_account_id TEXT,
      entry_transaction_id TEXT,
      payout_transaction_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      ended_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sta_operations_status ON sta_operations(status, created_at DESC);
  `);
  const columns = db.prepare("PRAGMA table_info(sta_operations)").all().map((row) => String(row.name));
  if (!columns.includes("transport_unlock_at")) {
    db.exec("ALTER TABLE sta_operations ADD COLUMN transport_unlock_at TEXT");
  }
  if (!columns.includes("next_operation_unlock_at")) {
    db.exec("ALTER TABLE sta_operations ADD COLUMN next_operation_unlock_at TEXT");
  }
}

function parseJson(value, fallback) {
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function mapAccount(row) {
  return {
    id: String(row.id),
    bankName: String(row.bank_name),
    accountNumber: String(row.account_number),
    ownerName: String(row.owner_name),
    balance: Number(row.balance),
    updatedAt: String(row.updated_at),
    username: String(row.username || "로컬 사용자"),
  };
}

function listAccounts(databasePath) {
  const db = openDatabase(databasePath, true);
  try {
    return db.prepare(`
      SELECT accounts.id,accounts.bank_name,accounts.account_number,accounts.owner_name,
             accounts.balance,accounts.updated_at,users.username
      FROM accounts LEFT JOIN users ON users.id=accounts.user_id
      ORDER BY accounts.updated_at DESC
    `).all().map(mapAccount);
  } finally { db.close(); }
}

function getAccount(databasePath, accountId) {
  const db = openDatabase(databasePath, true);
  try {
    const row = db.prepare(`
      SELECT accounts.id,accounts.bank_name,accounts.account_number,accounts.owner_name,
             accounts.balance,accounts.updated_at,users.username
      FROM accounts LEFT JOIN users ON users.id=accounts.user_id WHERE accounts.id=?
    `).get(accountId);
    return row ? mapAccount(row) : null;
  } finally { db.close(); }
}

function getRecentTransactions(databasePath, accountId, limit = 10) {
  const db = openDatabase(databasePath, true);
  try {
    return db.prepare(`
      SELECT id,transaction_type,amount,memo,created_at FROM transactions
      WHERE account_id=? ORDER BY created_at DESC LIMIT ?
    `).all(accountId, Math.min(30, Math.max(1, limit))).map((row) => ({
      id: String(row.id), type: String(row.transaction_type), amount: Number(row.amount),
      memo: String(row.memo), createdAt: String(row.created_at),
    }));
  } finally { db.close(); }
}

function activeRow(db) {
  return db.prepare("SELECT * FROM sta_operations WHERE status='active' ORDER BY created_at DESC LIMIT 1").get();
}

function publicOperation(row, nowMs = Date.now()) {
  if (!row) return null;
  const rawCash = Number(row.raw_cash || 0);
  const transportHits = Number(row.transport_hits || 0);
  const lootEndsMs = row.loot_ends_at ? Date.parse(String(row.loot_ends_at)) : null;
  return {
    id: String(row.id),
    entryAccountId: String(row.entry_account_id),
    entryFee: Number(row.entry_fee),
    status: String(row.status),
    phase: String(row.phase),
    hackingRound: Number(row.hacking_round),
    hackingLayout: parseJson(row.hacking_layout, ["red", "blue", "yellow"]),
    hackingConnections: parseJson(row.hacking_connections, []),
    laserHits: Number(row.laser_hits),
    laserCheckpoint: Number(row.laser_checkpoint),
    vaultProgress: Number(row.vault_progress),
    rawCash,
    lootStartedAt: row.loot_started_at ? String(row.loot_started_at) : null,
    lootEndsAt: row.loot_ends_at ? String(row.loot_ends_at) : null,
    lootRemainingMs: lootEndsMs === null ? null : Math.max(0, lootEndsMs - nowMs),
    transportHits,
    transportCheckpoint: Number(row.transport_checkpoint),
    projectedPayout: calculateTransportPayout(rawCash, transportHits),
    payoutAccountId: row.payout_account_id ? String(row.payout_account_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    endedAt: row.ended_at ? String(row.ended_at) : null,
  };
}

function finalizeLootIfExpired(db, row, nowMs = Date.now()) {
  if (!row || row.status !== "active" || row.phase !== "raid_loot" || !row.loot_ends_at) return row;
  const endsMs = Date.parse(String(row.loot_ends_at));
  if (!Number.isFinite(endsMs) || nowMs < endsMs) return row;
  const now = new Date(nowMs).toISOString();
  db.prepare("UPDATE sta_operations SET phase='transport_ready',transport_unlock_at=NULL,updated_at=? WHERE id=? AND phase='raid_loot'")
    .run(now, row.id);
  return db.prepare("SELECT * FROM sta_operations WHERE id=?").get(row.id);
}

function migrateLegacyTransportCooldown(db, row, nowMs = Date.now()) {
  if (!row || row.status !== "active" || row.phase !== "transport_cooldown") return row;
  const now = new Date(nowMs).toISOString();
  db.prepare("UPDATE sta_operations SET phase='transport_ready',transport_unlock_at=NULL,updated_at=? WHERE id=?")
    .run(now, row.id);
  return db.prepare("SELECT * FROM sta_operations WHERE id=?").get(row.id);
}

function latestCompletedCooldown(db, nowMs = Date.now()) {
  const row = db.prepare(`
    SELECT next_operation_unlock_at,ended_at FROM sta_operations
    WHERE status='completed' ORDER BY ended_at DESC,created_at DESC LIMIT 1
  `).get();
  if (!row) return { unlockAt: null, remainingMs: 0 };
  const unlockMs = row.next_operation_unlock_at
    ? Date.parse(String(row.next_operation_unlock_at))
    : NaN;
  if (!Number.isFinite(unlockMs)) return { unlockAt: null, remainingMs: 0 };
  return {
    unlockAt: new Date(unlockMs).toISOString(),
    remainingMs: Math.max(0, unlockMs - nowMs),
  };
}

function getOperationState(databasePath, nowMs = Date.now()) {
  const db = openDatabase(databasePath, false);
  try {
    ensureSchema(db);
    let row = activeRow(db);
    row = finalizeLootIfExpired(db, row, nowMs);
    row = migrateLegacyTransportCooldown(db, row, nowMs);
    const last = db.prepare("SELECT status,phase,raw_cash,transport_hits,ended_at FROM sta_operations WHERE status!='active' ORDER BY created_at DESC LIMIT 1").get();
    const cooldown = latestCompletedCooldown(db, nowMs);
    return {
      operation: publicOperation(row, nowMs),
      operationCooldownUnlockAt: cooldown.unlockAt,
      operationCooldownRemainingMs: cooldown.remainingMs,
      lastResult: last ? {
        status: String(last.status), phase: String(last.phase), rawCash: Number(last.raw_cash || 0),
        transportHits: Number(last.transport_hits || 0), endedAt: last.ended_at ? String(last.ended_at) : null,
      } : null,
    };
  } finally { db.close(); }
}

function startOperation({ databasePath, accountId, nowMs = Date.now() }) {
  const db = openDatabase(databasePath, false);
  try {
    ensureSchema(db);
    db.exec("BEGIN IMMEDIATE");
    if (activeRow(db)) throw new Error("이미 진행 중인 STA 작전이 있습니다.");
    const cooldown = latestCompletedCooldown(db, nowMs);
    if (cooldown.remainingMs > 0) {
      throw new Error(`새 작전 쿨타임이 ${Math.ceil(cooldown.remainingMs / 1000)}초 남았습니다.`);
    }
    const account = db.prepare("SELECT id,balance FROM accounts WHERE id=?").get(accountId);
    if (!account) throw new Error("연결 계좌를 찾을 수 없습니다.");
    if (Number(account.balance) < ENTRY_FEE) throw new Error("STA 작전 입장료 50,000원을 결제할 잔액이 부족합니다.");

    const id = crypto.randomUUID();
    const transactionId = crypto.randomUUID();
    const now = new Date(nowMs).toISOString();
    const nextBalance = Number(account.balance) - ENTRY_FEE;
    db.prepare("UPDATE accounts SET balance=?,updated_at=? WHERE id=?").run(nextBalance, now, accountId);
    db.prepare("INSERT INTO transactions (id,account_id,transaction_type,amount,memo,created_at) VALUES (?,?,'withdraw',?,?,?)")
      .run(transactionId, accountId, ENTRY_FEE, "STA 작전 참가비", now);
    db.prepare(`
      INSERT INTO sta_operations (
        id,entry_account_id,entry_fee,status,phase,hacking_round,hacking_layout,hacking_connections,
        entry_transaction_id,created_at,updated_at
      ) VALUES (?,?,?,'active','hacking',1,?,'[]',?,?,?)
    `).run(id, accountId, ENTRY_FEE, JSON.stringify(createHackingLayout()), transactionId, now, now);
    db.exec("COMMIT");
    return { operation: publicOperation(db.prepare("SELECT * FROM sta_operations WHERE id=?").get(id), nowMs), balance: nextBalance, transactionId };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally { db.close(); }
}

function requireActive(db, operationId, phase = null) {
  const row = db.prepare("SELECT * FROM sta_operations WHERE id=? AND status='active'").get(operationId);
  if (!row) throw new Error("진행 중인 STA 작전을 찾을 수 없습니다.");
  if (phase && row.phase !== phase) throw new Error("현재 단계에서는 이 작업을 수행할 수 없습니다.");
  return row;
}

function hackingConnect({ databasePath, operationId, sourceColor, targetColor }) {
  const source = String(sourceColor || "");
  const target = String(targetColor || "");
  const db = openDatabase(databasePath, false);
  try {
    ensureSchema(db);
    db.exec("BEGIN IMMEDIATE");
    const row = requireActive(db, operationId, "hacking");
    const connections = parseJson(row.hacking_connections, []);
    if (source !== target) {
      db.exec("COMMIT");
      return { connected: false, reason: "색상이 다릅니다.", operation: publicOperation(row) };
    }
    if (!["red", "blue", "yellow"].includes(source)) throw new Error("알 수 없는 전선 색상입니다.");
    if (!connections.includes(source)) connections.push(source);
    let roundCompleted = false;
    let hackingCompleted = false;
    let round = Number(row.hacking_round);
    let phase = "hacking";
    let layout = parseJson(row.hacking_layout, []);
    let nextConnections = connections;
    if (connections.length >= 3) {
      roundCompleted = true;
      if (round >= HACKING_ROUNDS) {
        hackingCompleted = true;
        phase = "raid_ready";
        nextConnections = [];
      } else {
        round += 1;
        layout = createHackingLayout();
        nextConnections = [];
      }
    }
    const now = new Date().toISOString();
    db.prepare(`UPDATE sta_operations SET phase=?,hacking_round=?,hacking_layout=?,hacking_connections=?,updated_at=? WHERE id=?`)
      .run(phase, round, JSON.stringify(layout), JSON.stringify(nextConnections), now, operationId);
    db.exec("COMMIT");
    return {
      connected: true, roundCompleted, hackingCompleted,
      operation: publicOperation(db.prepare("SELECT * FROM sta_operations WHERE id=?").get(operationId)),
    };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally { db.close(); }
}

function startRaid({ databasePath, operationId }) {
  const db = openDatabase(databasePath, false);
  try {
    ensureSchema(db); db.exec("BEGIN IMMEDIATE");
    requireActive(db, operationId, "raid_ready");
    const now = new Date().toISOString();
    db.prepare("UPDATE sta_operations SET phase='raid_laser',laser_hits=0,laser_checkpoint=0,updated_at=? WHERE id=?").run(now, operationId);
    db.exec("COMMIT");
    return { operation: publicOperation(db.prepare("SELECT * FROM sta_operations WHERE id=?").get(operationId)) };
  } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  finally { db.close(); }
}

function laserCheckpoint({ databasePath, operationId, checkpoint }) {
  const value = Math.min(2, Math.max(0, Math.trunc(Number(checkpoint) || 0)));
  const db = openDatabase(databasePath, false);
  try {
    ensureSchema(db); const row = requireActive(db, operationId, "raid_laser");
    if (value <= Number(row.laser_checkpoint)) return { operation: publicOperation(row) };
    const now = new Date().toISOString();
    db.prepare("UPDATE sta_operations SET laser_checkpoint=?,updated_at=? WHERE id=?").run(value, now, operationId);
    return { operation: publicOperation(db.prepare("SELECT * FROM sta_operations WHERE id=?").get(operationId)) };
  } finally { db.close(); }
}

function laserHit({ databasePath, operationId }) {
  const db = openDatabase(databasePath, false);
  try {
    ensureSchema(db); db.exec("BEGIN IMMEDIATE");
    const row = requireActive(db, operationId, "raid_laser");
    const hits = Number(row.laser_hits) + 1;
    const now = new Date().toISOString();
    if (hits >= LASER_MAX_HITS) {
      db.prepare("UPDATE sta_operations SET laser_hits=?,status='failed',phase='failed',updated_at=?,ended_at=? WHERE id=?")
        .run(hits, now, now, operationId);
      db.exec("COMMIT");
      return { failed: true, hits, operation: null };
    }
    db.prepare("UPDATE sta_operations SET laser_hits=?,updated_at=? WHERE id=?").run(hits, now, operationId);
    db.exec("COMMIT");
    return { failed: false, hits, operation: publicOperation(db.prepare("SELECT * FROM sta_operations WHERE id=?").get(operationId)) };
  } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  finally { db.close(); }
}

function laserPass({ databasePath, operationId }) {
  const db = openDatabase(databasePath, false);
  try {
    ensureSchema(db); db.exec("BEGIN IMMEDIATE"); requireActive(db, operationId, "raid_laser");
    const now = new Date().toISOString();
    db.prepare("UPDATE sta_operations SET phase='raid_vault',vault_progress=0,updated_at=? WHERE id=?").run(now, operationId);
    db.exec("COMMIT");
    return { operation: publicOperation(db.prepare("SELECT * FROM sta_operations WHERE id=?").get(operationId)) };
  } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  finally { db.close(); }
}

function vaultHit({ databasePath, operationId, nowMs = Date.now() }) {
  const db = openDatabase(databasePath, false);
  try {
    ensureSchema(db); db.exec("BEGIN IMMEDIATE");
    const row = requireActive(db, operationId, "raid_vault");
    const progress = Math.min(VAULT_REQUIRED_HITS, Number(row.vault_progress) + 1);
    let phase = "raid_vault";
    let startedAt = null;
    let endsAt = null;
    if (progress >= VAULT_REQUIRED_HITS) {
      phase = "raid_loot";
      startedAt = new Date(nowMs).toISOString();
      endsAt = new Date(nowMs + LOOT_DURATION_MS).toISOString();
    }
    const now = new Date(nowMs).toISOString();
    db.prepare(`UPDATE sta_operations SET phase=?,vault_progress=?,loot_started_at=?,loot_ends_at=?,last_loot_click_ms=0,updated_at=? WHERE id=?`)
      .run(phase, progress, startedAt, endsAt, now, operationId);
    db.exec("COMMIT");
    return { opened: phase === "raid_loot", operation: publicOperation(db.prepare("SELECT * FROM sta_operations WHERE id=?").get(operationId), nowMs) };
  } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  finally { db.close(); }
}

function vaultDecay({ databasePath, operationId, nowMs = Date.now() }) {
  const db = openDatabase(databasePath, false);
  try {
    ensureSchema(db); db.exec("BEGIN IMMEDIATE");
    const row = requireActive(db, operationId, "raid_vault");
    const progress = Math.max(0, Number(row.vault_progress) - VAULT_DECAY_AMOUNT);
    const now = new Date(nowMs).toISOString();
    db.prepare("UPDATE sta_operations SET vault_progress=?,updated_at=? WHERE id=?")
      .run(progress, now, operationId);
    db.exec("COMMIT");
    return { operation: publicOperation(db.prepare("SELECT * FROM sta_operations WHERE id=?").get(operationId), nowMs) };
  } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  finally { db.close(); }
}

function lootClick({ databasePath, operationId, nowMs = Date.now() }) {
  const db = openDatabase(databasePath, false);
  try {
    ensureSchema(db); db.exec("BEGIN IMMEDIATE");
    let row = requireActive(db, operationId, "raid_loot");
    row = finalizeLootIfExpired(db, row, nowMs);
    if (row.phase !== "raid_loot") {
      db.exec("COMMIT");
      return { accepted: false, expired: true, operation: publicOperation(row, nowMs) };
    }
    const rawCash = Math.min(Number.MAX_SAFE_INTEGER, Number(row.raw_cash) + LOOT_PER_CLICK);
    const now = new Date(nowMs).toISOString();
    db.prepare("UPDATE sta_operations SET raw_cash=?,last_loot_click_ms=?,updated_at=? WHERE id=?")
      .run(rawCash, nowMs, now, operationId);
    db.exec("COMMIT");
    return { accepted: true, expired: false, operation: publicOperation(db.prepare("SELECT * FROM sta_operations WHERE id=?").get(operationId), nowMs) };
  } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  finally { db.close(); }
}

function finalizeLoot({ databasePath, operationId, nowMs = Date.now() }) {
  const db = openDatabase(databasePath, false);
  try {
    ensureSchema(db); db.exec("BEGIN IMMEDIATE");
    const row = requireActive(db, operationId, "raid_loot");
    const ends = Date.parse(String(row.loot_ends_at));
    if (Number.isFinite(ends) && nowMs < ends) throw new Error("현금 획득 시간이 아직 남아 있습니다.");
    const now = new Date(nowMs).toISOString();
    db.prepare("UPDATE sta_operations SET phase='transport_ready',transport_unlock_at=NULL,updated_at=? WHERE id=?")
      .run(now, operationId);
    db.exec("COMMIT");
    return { operation: publicOperation(db.prepare("SELECT * FROM sta_operations WHERE id=?").get(operationId), nowMs) };
  } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  finally { db.close(); }
}

function startTransport({ databasePath, operationId, nowMs = Date.now() }) {
  const db = openDatabase(databasePath, false);
  try {
    ensureSchema(db); db.exec("BEGIN IMMEDIATE");
    const row = requireActive(db, operationId, "transport_ready");
    const now = new Date(nowMs).toISOString();
    db.prepare("UPDATE sta_operations SET phase='transport',transport_hits=0,transport_checkpoint=0,last_transport_hit_ms=0,updated_at=? WHERE id=?")
      .run(now, operationId);
    db.exec("COMMIT");
    return { operation: publicOperation(db.prepare("SELECT * FROM sta_operations WHERE id=?").get(operationId)) };
  } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  finally { db.close(); }
}

function transportCheckpoint({ databasePath, operationId, checkpoint }) {
  const value = Math.min(2, Math.max(0, Math.trunc(Number(checkpoint) || 0)));
  const db = openDatabase(databasePath, false);
  try {
    ensureSchema(db); const row = requireActive(db, operationId, "transport");
    if (value <= Number(row.transport_checkpoint)) return { operation: publicOperation(row) };
    const now = new Date().toISOString();
    db.prepare("UPDATE sta_operations SET transport_checkpoint=?,updated_at=? WHERE id=?").run(value, now, operationId);
    return { operation: publicOperation(db.prepare("SELECT * FROM sta_operations WHERE id=?").get(operationId)) };
  } finally { db.close(); }
}

function transportHit({ databasePath, operationId, nowMs = Date.now() }) {
  const db = openDatabase(databasePath, false);
  try {
    ensureSchema(db); db.exec("BEGIN IMMEDIATE");
    const row = requireActive(db, operationId, "transport");
    const last = Number(row.last_transport_hit_ms || 0);
    if (last > 0 && nowMs - last < TRANSPORT_HIT_COOLDOWN_MS) {
      db.exec("COMMIT");
      return { accepted: false, operation: publicOperation(row, nowMs) };
    }
    const hits = Number(row.transport_hits) + 1;
    const now = new Date(nowMs).toISOString();
    db.prepare("UPDATE sta_operations SET transport_hits=?,last_transport_hit_ms=?,updated_at=? WHERE id=?")
      .run(hits, nowMs, now, operationId);
    db.exec("COMMIT");
    return { accepted: true, operation: publicOperation(db.prepare("SELECT * FROM sta_operations WHERE id=?").get(operationId), nowMs) };
  } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  finally { db.close(); }
}

function transportArrive({ databasePath, operationId, nowMs = Date.now() }) {
  const db = openDatabase(databasePath, false);
  try {
    ensureSchema(db); db.exec("BEGIN IMMEDIATE"); requireActive(db, operationId, "transport");
    const now = new Date(nowMs).toISOString();
    const nextOperationUnlockAt = new Date(nowMs + OPERATION_COOLDOWN_MS).toISOString();
    db.prepare("UPDATE sta_operations SET phase='payout',next_operation_unlock_at=?,updated_at=? WHERE id=?")
      .run(nextOperationUnlockAt, now, operationId);
    db.exec("COMMIT");
    return { operation: publicOperation(db.prepare("SELECT * FROM sta_operations WHERE id=?").get(operationId)) };
  } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  finally { db.close(); }
}

function payout({ databasePath, operationId, accountId, nowMs = Date.now() }) {
  const db = openDatabase(databasePath, false);
  try {
    ensureSchema(db); db.exec("BEGIN IMMEDIATE");
    const row = requireActive(db, operationId, "payout");
    const account = db.prepare("SELECT id,balance FROM accounts WHERE id=?").get(accountId);
    if (!account) throw new Error("보수를 지급받을 계좌를 찾을 수 없습니다.");
    const amount = calculateTransportPayout(row.raw_cash, row.transport_hits);
    const now = new Date(nowMs).toISOString();
    const storedUnlockMs = Date.parse(String(row.next_operation_unlock_at || ""));
    const nextOperationUnlockAt = Number.isFinite(storedUnlockMs)
      ? new Date(storedUnlockMs).toISOString()
      : new Date(nowMs + OPERATION_COOLDOWN_MS).toISOString();
    const cooldownRemainingMs = Math.max(0, Date.parse(nextOperationUnlockAt) - nowMs);
    let transactionId = null;
    let balance = Number(account.balance);
    if (amount > 0) {
      balance += amount;
      transactionId = crypto.randomUUID();
      db.prepare("UPDATE accounts SET balance=?,updated_at=? WHERE id=?").run(balance, now, accountId);
      db.prepare("INSERT INTO transactions (id,account_id,transaction_type,amount,memo,created_at) VALUES (?,?,'deposit',?,?,?)")
        .run(transactionId, accountId, amount, "STA 작전 최종 보수", now);
    }
    db.prepare(`UPDATE sta_operations SET status='completed',phase='completed',payout_account_id=?,payout_transaction_id=?,next_operation_unlock_at=?,updated_at=?,ended_at=? WHERE id=?`)
      .run(accountId, transactionId, nextOperationUnlockAt, now, now, operationId);
    db.exec("COMMIT");
    return { amount, balance, transactionId, completed: true, operationCooldownUnlockAt: nextOperationUnlockAt, operationCooldownRemainingMs: cooldownRemainingMs };
  } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  finally { db.close(); }
}

function uniqueExisting(paths) {
  const seen = new Set();
  return paths.filter((candidate) => {
    if (!candidate) return false;
    const normalized = path.resolve(candidate).toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return fs.existsSync(candidate);
  });
}

function autoFindWalletDatabase({ appDataPath, homePath }) {
  const candidates = [
    path.join(appDataPath, "SD지갑", "data", "sdwallet.sqlite"),
    path.join(appDataPath, "sdwallet-desktop", "data", "sdwallet.sqlite"),
    path.join(appDataPath, "SDWallet", "data", "sdwallet.sqlite"),
    path.join(homePath, "Downloads", "SDWallet_Stage9_Desktop", "data", "sdwallet.sqlite"),
    path.join(homePath, "Desktop", "SDWallet_Stage9_Desktop", "data", "sdwallet.sqlite"),
  ];
  for (const candidate of uniqueExisting(candidates)) if (validateWalletDatabase(candidate).ok) return candidate;
  try {
    for (const entry of fs.readdirSync(appDataPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(appDataPath, entry.name, "data", "sdwallet.sqlite");
      if (fs.existsSync(candidate) && validateWalletDatabase(candidate).ok) return candidate;
    }
  } catch { return null; }
  return null;
}

module.exports = {
  autoFindWalletDatabase,
  finalizeLoot,
  getAccount,
  getOperationState,
  getRecentTransactions,
  hackingConnect,
  laserCheckpoint,
  laserHit,
  laserPass,
  listAccounts,
  lootClick,
  payout,
  startOperation,
  startRaid,
  startTransport,
  transportArrive,
  transportCheckpoint,
  transportHit,
  validateWalletDatabase,
  vaultDecay,
  vaultHit,
};
