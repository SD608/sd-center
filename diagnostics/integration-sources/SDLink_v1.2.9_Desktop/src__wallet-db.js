"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function openDatabase(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error("SD지갑 데이터베이스 파일을 찾지 못했습니다.");
  }
  const db = new DatabaseSync(path.resolve(filePath));
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 900;");
  return db;
}

function requiredTables(db) {
  const rows = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('users', 'accounts', 'transactions')
  `).all();
  const names = new Set(rows.map((row) => row.name));
  return ["users", "accounts", "transactions"].every((name) => names.has(name));
}

function normalizeAccount(row) {
  return {
    id: String(row.id),
    userId: Number(row.user_id),
    username: String(row.username || ""),
    bankName: String(row.bank_name || ""),
    accountNumber: String(row.account_number || ""),
    ownerName: String(row.owner_name || ""),
    balance: Number(row.balance || 0),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

function inspectDatabase(filePath, options = {}) {
  const db = openDatabase(filePath);
  try {
    if (!requiredTables(db)) {
      throw new Error("선택한 파일은 지원되는 SD지갑 데이터베이스가 아닙니다.");
    }
    // 전체 integrity_check는 거래가 많거나 다른 SD 앱이 DB를 쓰는 동안
    // Electron 메인 스레드를 수 초간 막아 Windows의 “응답 없음”을 유발할 수 있습니다.
    // 자동 새로고침에서는 생략하고, 사용자가 DB를 새로 선택/탐색할 때만 quick_check를 1회 실행합니다.
    if (options.deepCheck) {
      const integrity = db.prepare("PRAGMA quick_check(1)").get();
      if (String(integrity?.quick_check || "").toLowerCase() !== "ok") {
        throw new Error("SD지갑 데이터베이스 무결성 검사에 실패했습니다.");
      }
    }
    const accounts = db.prepare(`
      SELECT a.*, u.username
      FROM accounts a
      JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at ASC
    `).all().map(normalizeAccount);
    if (accounts.length === 0) {
      throw new Error("연결할 로컬 계좌가 없습니다.");
    }
    const transactionCount = Number(
      db.prepare("SELECT COUNT(*) AS count FROM transactions").get()?.count || 0,
    );
    return {
      path: path.resolve(filePath),
      accounts,
      transactionCount,
      integrity: options.deepCheck ? "ok" : "not_checked",
    };
  } finally {
    db.close();
  }
}

function getAccount(filePath, accountId) {
  const db = openDatabase(filePath);
  try {
    const row = db.prepare(`
      SELECT a.*, u.username
      FROM accounts a
      JOIN users u ON u.id = a.user_id
      WHERE a.id = ?
      LIMIT 1
    `).get(String(accountId));
    if (!row) throw new Error("선택한 로컬 계좌를 찾지 못했습니다.");
    return normalizeAccount(row);
  } finally {
    db.close();
  }
}

function fingerprintAccount(account) {
  const source = [
    "sd608-wallet-v1",
    account.id,
    account.userId,
    account.username.toLowerCase(),
    account.bankName,
    account.accountNumber,
    account.ownerName,
  ].join("\u001f");
  return crypto.createHash("sha256").update(source, "utf8").digest("hex");
}

function listTransactionIds(filePath, accountId) {
  const db = openDatabase(filePath);
  try {
    return db.prepare(
      "SELECT id FROM transactions WHERE account_id = ? ORDER BY created_at ASC, rowid ASC",
    ).all(String(accountId)).map((row) => String(row.id));
  } finally {
    db.close();
  }
}

function listTransactions(filePath, accountId) {
  const db = openDatabase(filePath);
  try {
    return db.prepare(`
      SELECT id, account_id, transaction_type, amount, memo, created_at
      FROM transactions
      WHERE account_id = ?
      ORDER BY created_at ASC, rowid ASC
    `).all(String(accountId)).map((row) => ({
      id: String(row.id),
      accountId: String(row.account_id),
      transactionType: String(row.transaction_type),
      amount: Number(row.amount),
      memo: String(row.memo || ""),
      createdAt: String(row.created_at || ""),
    }));
  } finally {
    db.close();
  }
}

function backupDatabase(filePath, backupDirectory) {
  fs.mkdirSync(backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = path.join(backupDirectory, `sdwallet-before-link-${stamp}.sqlite`);
  const db = openDatabase(filePath);
  try {
    db.exec("PRAGMA wal_checkpoint(FULL)");
    const escaped = destination.replaceAll("'", "''");
    db.exec(`VACUUM INTO '${escaped}'`);
  } finally {
    db.close();
  }
  return destination;
}

function signedAmount(transaction) {
  const amount = Math.abs(Number(transaction.amount || 0));
  return transaction.transactionType === "withdraw" ? -amount : amount;
}

function setAccountBalance(filePath, accountId, targetBalance, memo) {
  const db = openDatabase(filePath);
  try {
    const current = db.prepare("SELECT balance FROM accounts WHERE id = ?").get(String(accountId));
    if (!current) throw new Error("로컬 계좌를 찾지 못했습니다.");
    const before = Number(current.balance);
    const after = Number(targetBalance);
    if (!Number.isSafeInteger(after) || after < 0) {
      throw new Error("서버 잔액이 로컬 지갑 허용 범위를 벗어났습니다.");
    }
    if (before === after) return null;
    const difference = after - before;
    const id = `sdlink-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`
        UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ?
      `).run(after, now, String(accountId));
      db.prepare(`
        INSERT INTO transactions(id, account_id, transaction_type, amount, memo, created_at)
        VALUES(?, ?, ?, ?, ?, ?)
      `).run(
        id,
        String(accountId),
        difference >= 0 ? "deposit" : "withdraw",
        Math.abs(difference),
        String(memo || "SD Link 서버 잔액 동기화"),
        now,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { id, difference, before, after };
  } finally {
    db.close();
  }
}

function recordSyntheticTransaction(filePath, accountId, difference, memo) {
  const signed = Number(difference);
  if (!Number.isSafeInteger(signed) || signed === 0) return null;
  const db = openDatabase(filePath);
  try {
    const id = `sdlink-local-${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO transactions(id, account_id, transaction_type, amount, memo, created_at)
      VALUES(?, ?, ?, ?, ?, ?)
    `).run(
      id,
      String(accountId),
      signed > 0 ? "deposit" : "withdraw",
      Math.abs(signed),
      String(memo || "SD Link 로컬 잔액 차액 감지"),
      new Date().toISOString(),
    );
    return id;
  } finally {
    db.close();
  }
}

function applyRemoteTransaction(filePath, accountId, remote) {
  const localId = `sdlink-remote-${String(remote.transaction_id)}`;
  const amount = Number(remote.amount);
  if (!Number.isSafeInteger(amount) || amount === 0) {
    throw new Error("서버 거래 데이터가 올바르지 않습니다.");
  }
  const db = openDatabase(filePath);
  try {
    // 같은 서버 거래를 두 번 적용하지 않습니다. 이미 적용된 경우 잔액도 건드리지 않습니다.
    if (db.prepare("SELECT 1 FROM transactions WHERE id = ?").get(localId)) {
      return { localId, inserted: false };
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = db.prepare("SELECT balance FROM accounts WHERE id = ?")
        .get(String(accountId));
      if (!current) throw new Error("로컬 계좌를 찾지 못했습니다.");

      // 중요: remote.balance_after 절대값으로 덮어쓰지 않고 서버 거래 금액만 더합니다.
      // 이렇게 해야 동기화 중 다른 로컬 앱이 만든 최신 잔액 변경이 보존됩니다.
      const before = Number(current.balance);
      const after = before + amount;
      if (!Number.isSafeInteger(after) || after < 0) {
        throw new Error("서버 거래를 반영한 로컬 잔액이 허용 범위를 벗어났습니다.");
      }

      db.prepare(`
        INSERT INTO transactions(id, account_id, transaction_type, amount, memo, created_at)
        VALUES(?, ?, ?, ?, ?, ?)
      `).run(
        localId,
        String(accountId),
        amount > 0 ? "deposit" : "withdraw",
        Math.abs(amount),
        `[SD Link] ${String(remote.description || "온라인 거래")}`,
        String(remote.created_at || new Date().toISOString()),
      );
      db.prepare("UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ?")
        .run(after, new Date().toISOString(), String(accountId));
      db.exec("COMMIT");
      return { localId, inserted: true, before, after };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

function updateBalanceOnly(filePath, accountId, targetBalance) {
  const after = Number(targetBalance);
  if (!Number.isSafeInteger(after) || after < 0) {
    throw new Error("서버 잔액이 올바르지 않습니다.");
  }
  const db = openDatabase(filePath);
  try {
    db.prepare("UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ?")
      .run(after, new Date().toISOString(), String(accountId));
  } finally {
    db.close();
  }
}

module.exports = {
  applyRemoteTransaction,
  backupDatabase,
  fingerprintAccount,
  getAccount,
  inspectDatabase,
  listTransactionIds,
  listTransactions,
  recordSyntheticTransaction,
  setAccountBalance,
  signedAmount,
  updateBalanceOnly,
};
