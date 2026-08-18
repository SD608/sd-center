"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function openDatabase(databasePath, readOnly = false) {
  if (!databasePath || !fs.existsSync(databasePath)) {
    throw new Error(
      "SD지갑 데이터베이스 파일을 찾을 수 없습니다.",
    );
  }

  const database = new DatabaseSync(databasePath, {
    readOnly,
  });

  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);

  return database;
}

function validateWalletDatabase(databasePath) {
  let db;

  try {
    db = openDatabase(databasePath, true);
  } catch (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  try {
    const tables = db
      .prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
            AND name IN ('users', 'accounts', 'transactions')
        `,
      )
      .all()
      .map((row) => row.name);

    const required = [
      "users",
      "accounts",
      "transactions",
    ];

    const missing = required.filter(
      (tableName) => !tables.includes(tableName),
    );

    if (missing.length > 0) {
      return {
        ok: false,
        error:
          "선택한 파일은 SD지갑 데이터베이스 형식이 아닙니다.",
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
    };
  } finally {
    db.close();
  }
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
    const rows = db
      .prepare(
        `
          SELECT
            accounts.id,
            accounts.bank_name,
            accounts.account_number,
            accounts.owner_name,
            accounts.balance,
            accounts.updated_at,
            users.username
          FROM accounts
          LEFT JOIN users
            ON users.id = accounts.user_id
          ORDER BY accounts.updated_at DESC
        `,
      )
      .all();

    return rows.map(mapAccount);
  } finally {
    db.close();
  }
}

function getAccount(databasePath, accountId) {
  const db = openDatabase(databasePath, true);

  try {
    const row = db
      .prepare(
        `
          SELECT
            accounts.id,
            accounts.bank_name,
            accounts.account_number,
            accounts.owner_name,
            accounts.balance,
            accounts.updated_at,
            users.username
          FROM accounts
          LEFT JOIN users
            ON users.id = accounts.user_id
          WHERE accounts.id = ?
        `,
      )
      .get(accountId);

    return row ? mapAccount(row) : null;
  } finally {
    db.close();
  }
}

function getRecentTransactions(
  databasePath,
  accountId,
  limit = 10,
) {
  const db = openDatabase(databasePath, true);

  try {
    return db
      .prepare(
        `
          SELECT
            id,
            transaction_type,
            amount,
            memo,
            created_at
          FROM transactions
          WHERE account_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `,
      )
      .all(accountId, Math.min(30, Math.max(1, limit)))
      .map((row) => ({
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

function applyGameResult({
  databasePath,
  accountId,
  won,
  stake,
}) {
  const amount = Math.trunc(Number(stake));

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("배팅 금액이 올바르지 않습니다.");
  }

  const db = openDatabase(databasePath, false);

  try {
    db.exec("BEGIN IMMEDIATE");

    const account = db
      .prepare(
        `
          SELECT
            id,
            balance
          FROM accounts
          WHERE id = ?
        `,
      )
      .get(accountId);

    if (!account) {
      throw new Error("연결 계좌를 찾을 수 없습니다.");
    }

    const currentBalance = Number(account.balance);

    if (!won && currentBalance < amount) {
      throw new Error(
        "게임 결과를 반영할 잔액이 부족합니다.",
      );
    }

    const transactionType = won
      ? "deposit"
      : "withdraw";

    const nextBalance = won
      ? currentBalance + amount
      : currentBalance - amount;

    const now = new Date().toISOString();
    const transactionId = crypto.randomUUID();

    const updateResult = db
      .prepare(
        `
          UPDATE accounts
          SET
            balance = ?,
            updated_at = ?
          WHERE id = ?
        `,
      )
      .run(nextBalance, now, accountId);

    if (Number(updateResult.changes) !== 1) {
      throw new Error("계좌 잔액을 변경하지 못했습니다.");
    }

    db.prepare(
      `
        INSERT INTO transactions (
          id,
          account_id,
          transaction_type,
          amount,
          memo,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
    ).run(
      transactionId,
      accountId,
      transactionType,
      amount,
      "홀짝 게임",
      now,
    );

    db.exec("COMMIT");

    return {
      transaction: {
        id: transactionId,
        type: transactionType,
        amount,
        memo: "홀짝 게임",
        createdAt: now,
      },
      balance: nextBalance,
      updatedAt: now,
    };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // 원래 오류를 유지합니다.
    }

    throw error;
  } finally {
    db.close();
  }
}

function uniqueExisting(paths) {
  const seen = new Set();

  return paths.filter((candidate) => {
    if (!candidate) {
      return false;
    }

    const normalized =
      path.resolve(candidate).toLowerCase();

    if (seen.has(normalized)) {
      return false;
    }

    seen.add(normalized);
    return fs.existsSync(candidate);
  });
}

function autoFindWalletDatabase({
  appDataPath,
  homePath,
}) {
  const candidates = [
    path.join(
      appDataPath,
      "SD지갑",
      "data",
      "sdwallet.sqlite",
    ),
    path.join(
      appDataPath,
      "sdwallet-desktop",
      "data",
      "sdwallet.sqlite",
    ),
    path.join(
      appDataPath,
      "SDWallet",
      "data",
      "sdwallet.sqlite",
    ),
    path.join(
      homePath,
      "Downloads",
      "SDWallet_Stage7_Desktop",
      "data",
      "sdwallet.sqlite",
    ),
    path.join(
      homePath,
      "Desktop",
      "SDWallet_Stage7_Desktop",
      "data",
      "sdwallet.sqlite",
    ),
  ];

  for (const candidate of uniqueExisting(candidates)) {
    if (validateWalletDatabase(candidate).ok) {
      return candidate;
    }
  }

  try {
    const entries = fs.readdirSync(appDataPath, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const candidate = path.join(
        appDataPath,
        entry.name,
        "data",
        "sdwallet.sqlite",
      );

      if (
        fs.existsSync(candidate) &&
        validateWalletDatabase(candidate).ok
      ) {
        return candidate;
      }
    }
  } catch {
    return null;
  }

  return null;
}

module.exports = {
  applyGameResult,
  autoFindWalletDatabase,
  getAccount,
  getRecentTransactions,
  listAccounts,
  validateWalletDatabase,
};
