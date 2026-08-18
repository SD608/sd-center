"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function openDatabase(databasePath, readOnly = false) {
  if (!databasePath || !fs.existsSync(databasePath)) {
    throw new Error("SD지갑 데이터베이스 파일을 찾을 수 없습니다.");
  }
  const db = new DatabaseSync(databasePath, { readOnly });
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  return db;
}

function validateWalletDatabase(databasePath) {
  let db;
  try {
    db = openDatabase(databasePath, true);
    const names = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name IN ('users','accounts','transactions')
    `).all().map((row) => row.name);
    const missing = ["users", "accounts", "transactions"].filter((name) => !names.includes(name));
    return missing.length
      ? { ok: false, error: "선택한 파일은 SD지갑 데이터베이스 형식이 아닙니다." }
      : { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    if (db) db.close();
  }
}

function ensureSlotSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sd_slot_rounds (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      stake INTEGER NOT NULL CHECK (stake > 0),
      roll INTEGER NOT NULL CHECK (roll BETWEEN 1 AND 100000),
      result_key TEXT NOT NULL,
      result_name TEXT NOT NULL,
      multiplier INTEGER NOT NULL CHECK (multiplier >= 0),
      payout INTEGER NOT NULL CHECK (payout >= 0),
      reels_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','settled')),
      created_at TEXT NOT NULL,
      settled_at TEXT,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sd_slot_rounds_account_created
      ON sd_slot_rounds(account_id, created_at DESC);
  `);
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
  const db = openDatabase(databasePath, false);
  try {
    ensureSlotSchema(db);
    recoverPendingRoundsInDatabase(db);
    return db.prepare(`
      SELECT accounts.id, accounts.bank_name, accounts.account_number,
             accounts.owner_name, accounts.balance, accounts.updated_at,
             users.username
      FROM accounts
      LEFT JOIN users ON users.id = accounts.user_id
      ORDER BY accounts.updated_at DESC
    `).all().map(mapAccount);
  } finally {
    db.close();
  }
}

function getAccount(databasePath, accountId) {
  const db = openDatabase(databasePath, false);
  try {
    ensureSlotSchema(db);
    recoverPendingRoundsInDatabase(db);
    const row = db.prepare(`
      SELECT accounts.id, accounts.bank_name, accounts.account_number,
             accounts.owner_name, accounts.balance, accounts.updated_at,
             users.username
      FROM accounts
      LEFT JOIN users ON users.id = accounts.user_id
      WHERE accounts.id = ?
    `).get(accountId);
    return row ? mapAccount(row) : null;
  } finally {
    db.close();
  }
}

function getRecentTransactions(databasePath, accountId, limit = 10) {
  const db = openDatabase(databasePath, true);
  try {
    return db.prepare(`
      SELECT id, transaction_type, amount, memo, created_at
      FROM transactions
      WHERE account_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(accountId, Math.min(30, Math.max(1, Math.trunc(limit)))).map((row) => ({
      id: String(row.id),
      type: String(row.transaction_type),
      amount: Number(row.amount),
      memo: String(row.memo),
      createdAt: String(row.created_at),
    }));
  } finally {
    db.close();
  }
}

function beginSpin({ databasePath, accountId, spin }) {
  const db = openDatabase(databasePath, false);
  try {
    ensureSlotSchema(db);
    db.exec("BEGIN IMMEDIATE");
    const account = db.prepare("SELECT id, balance FROM accounts WHERE id = ?").get(accountId);
    if (!account) throw new Error("연결 계좌를 찾을 수 없습니다.");
    const balance = Number(account.balance);
    if (balance < spin.stake) {
      throw new Error(`잔액이 부족합니다. ${spin.stake.toLocaleString("ko-KR")}원이 필요합니다.`);
    }

    const roundId = crypto.randomUUID();
    const transactionId = crypto.randomUUID();
    const now = new Date().toISOString();
    const nextBalance = balance - spin.stake;

    db.prepare(`UPDATE accounts SET balance=?, updated_at=? WHERE id=?`)
      .run(nextBalance, now, accountId);
    db.prepare(`
      INSERT INTO transactions (id, account_id, transaction_type, amount, memo, created_at)
      VALUES (?, ?, 'withdraw', ?, ?, ?)
    `).run(transactionId, accountId, spin.stake, "SD슬롯 베팅", now);
    db.prepare(`
      INSERT INTO sd_slot_rounds (
        id, account_id, stake, roll, result_key, result_name,
        multiplier, payout, reels_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      roundId, accountId, spin.stake, spin.roll, spin.resultKey,
      spin.resultName, spin.multiplier, spin.payout,
      JSON.stringify(spin.reels), now,
    );
    db.exec("COMMIT");

    return { roundId, balance: nextBalance, betTransactionId: transactionId };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally {
    db.close();
  }
}

function settleRound({ databasePath, roundId }) {
  const db = openDatabase(databasePath, false);
  try {
    ensureSlotSchema(db);
    db.exec("BEGIN IMMEDIATE");
    const round = db.prepare("SELECT * FROM sd_slot_rounds WHERE id = ?").get(roundId);
    if (!round) throw new Error("슬롯 게임 정보를 찾을 수 없습니다.");

    const account = db.prepare("SELECT id, balance FROM accounts WHERE id = ?").get(round.account_id);
    if (!account) throw new Error("연결 계좌를 찾을 수 없습니다.");

    if (round.status === "settled") {
      db.exec("COMMIT");
      return {
        alreadySettled: true,
        balance: Number(account.balance),
        payout: Number(round.payout),
      };
    }

    const now = new Date().toISOString();
    let nextBalance = Number(account.balance);
    let transaction = null;
    const payout = Number(round.payout);

    if (payout > 0) {
      nextBalance += payout;
      const transactionId = crypto.randomUUID();
      db.prepare("UPDATE accounts SET balance=?, updated_at=? WHERE id=?")
        .run(nextBalance, now, round.account_id);
      db.prepare(`
        INSERT INTO transactions (id, account_id, transaction_type, amount, memo, created_at)
        VALUES (?, ?, 'deposit', ?, ?, ?)
      `).run(
        transactionId,
        round.account_id,
        payout,
        `SD슬롯 당첨금 (${round.result_name} x${round.multiplier})`,
        now,
      );
      transaction = {
        id: transactionId,
        type: "deposit",
        amount: payout,
        memo: `SD슬롯 당첨금 (${round.result_name} x${round.multiplier})`,
        createdAt: now,
      };
    }

    db.prepare("UPDATE sd_slot_rounds SET status='settled', settled_at=? WHERE id=?")
      .run(now, roundId);
    db.exec("COMMIT");

    return { alreadySettled: false, balance: nextBalance, payout, transaction };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally {
    db.close();
  }
}

function recoverPendingRoundsInDatabase(db) {
  const pending = db.prepare(`
    SELECT id FROM sd_slot_rounds
    WHERE status='pending'
    ORDER BY created_at ASC
  `).all();

  for (const row of pending) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const round = db.prepare("SELECT * FROM sd_slot_rounds WHERE id=? AND status='pending'").get(row.id);
      if (!round) {
        db.exec("COMMIT");
        continue;
      }
      const account = db.prepare("SELECT id, balance FROM accounts WHERE id=?").get(round.account_id);
      const now = new Date().toISOString();
      if (account && Number(round.payout) > 0) {
        const transactionId = crypto.randomUUID();
        const nextBalance = Number(account.balance) + Number(round.payout);
        db.prepare("UPDATE accounts SET balance=?, updated_at=? WHERE id=?")
          .run(nextBalance, now, round.account_id);
        db.prepare(`
          INSERT INTO transactions (id, account_id, transaction_type, amount, memo, created_at)
          VALUES (?, ?, 'deposit', ?, ?, ?)
        `).run(
          transactionId,
          round.account_id,
          Number(round.payout),
          `SD슬롯 미정산 당첨금 복구 (${round.result_name} x${round.multiplier})`,
          now,
        );
      }
      db.prepare("UPDATE sd_slot_rounds SET status='settled', settled_at=? WHERE id=?")
        .run(now, round.id);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }
}

function uniqueExisting(paths) {
  const seen = new Set();
  return paths.filter((candidate) => {
    if (!candidate) return false;
    const normalized = path.resolve(candidate).toLowerCase();
    if (seen.has(normalized) || !fs.existsSync(candidate)) return false;
    seen.add(normalized);
    return true;
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

  for (const candidate of uniqueExisting(candidates)) {
    if (validateWalletDatabase(candidate).ok) return candidate;
  }

  try {
    for (const entry of fs.readdirSync(appDataPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(appDataPath, entry.name, "data", "sdwallet.sqlite");
      if (fs.existsSync(candidate) && validateWalletDatabase(candidate).ok) return candidate;
    }
  } catch {}

  return null;
}

module.exports = {
  autoFindWalletDatabase,
  beginSpin,
  getAccount,
  getRecentTransactions,
  listAccounts,
  settleRound,
  validateWalletDatabase,
};
