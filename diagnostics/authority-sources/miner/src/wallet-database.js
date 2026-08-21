"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { ORES, getOre } = require("./mining-engine");

const INVENTORY_COLUMNS = Object.freeze(
  ORES.map((ore) => ore.key),
);

const AUTO_MINING_UPGRADE_PRICE = 500000;

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

function ensureMiningTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mining_inventory (
      account_id TEXT PRIMARY KEY,
      stone INTEGER NOT NULL DEFAULT 0 CHECK (stone >= 0),
      copper INTEGER NOT NULL DEFAULT 0 CHECK (copper >= 0),
      iron INTEGER NOT NULL DEFAULT 0 CHECK (iron >= 0),
      emerald INTEGER NOT NULL DEFAULT 0 CHECK (emerald >= 0),
      diamond INTEGER NOT NULL DEFAULT 0 CHECK (diamond >= 0),
      total_mined INTEGER NOT NULL DEFAULT 0 CHECK (total_mined >= 0),
      updated_at TEXT NOT NULL,
      FOREIGN KEY (account_id)
        REFERENCES accounts(id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mining_upgrades (
      account_id TEXT PRIMARY KEY,
      auto_mining_unlocked INTEGER NOT NULL DEFAULT 0
        CHECK (auto_mining_unlocked IN (0, 1)),
      purchased_at TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (account_id)
        REFERENCES accounts(id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mining_history (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      ore_type TEXT NOT NULL CHECK (
        ore_type IN (
          'stone',
          'copper',
          'iron',
          'emerald',
          'diamond'
        )
      ),
      action_type TEXT NOT NULL CHECK (
        action_type IN ('mine', 'sell')
      ),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
      created_at TEXT NOT NULL,
      FOREIGN KEY (account_id)
        REFERENCES accounts(id)
        ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mining_history_account_created
      ON mining_history(account_id, created_at DESC);
  `);
}

function ensureInventoryRow(db, accountId) {
  const now = new Date().toISOString();

  db.prepare(
    `
      INSERT OR IGNORE INTO mining_inventory (
        account_id,
        updated_at
      )
      VALUES (?, ?)
    `,
  ).run(accountId, now);
}

function ensureUpgradeRow(db, accountId) {
  const now = new Date().toISOString();

  db.prepare(
    `
      INSERT OR IGNORE INTO mining_upgrades (
        account_id,
        updated_at
      )
      VALUES (?, ?)
    `,
  ).run(accountId, now);
}

function mapUpgrade(row) {
  return {
    autoMiningUnlocked: Boolean(
      row?.auto_mining_unlocked,
    ),
    purchasedAt:
      row?.purchased_at
        ? String(row.purchased_at)
        : "",
    updatedAt: String(
      row?.updated_at || "",
    ),
  };
}

function runTransaction(db, callback) {
  db.exec("BEGIN IMMEDIATE");

  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // 원래 오류를 유지합니다.
    }

    throw error;
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
  const db = openDatabase(databasePath, false);

  try {
    ensureMiningTables(db);

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
  const db = openDatabase(databasePath, false);

  try {
    ensureMiningTables(db);

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

function mapInventory(row) {
  return {
    stone: Number(row?.stone || 0),
    copper: Number(row?.copper || 0),
    iron: Number(row?.iron || 0),
    emerald: Number(row?.emerald || 0),
    diamond: Number(row?.diamond || 0),
    totalMined: Number(row?.total_mined || 0),
    updatedAt: String(row?.updated_at || ""),
  };
}

function getInventory(databasePath, accountId) {
  const db = openDatabase(databasePath, false);

  try {
    ensureMiningTables(db);
    ensureInventoryRow(db, accountId);

    const row = db
      .prepare(
        `
          SELECT
            stone,
            copper,
            iron,
            emerald,
            diamond,
            total_mined,
            updated_at
          FROM mining_inventory
          WHERE account_id = ?
        `,
      )
      .get(accountId);

    return mapInventory(row);
  } finally {
    db.close();
  }
}

function getMiningUpgrade(
  databasePath,
  accountId,
) {
  const db = openDatabase(
    databasePath,
    false,
  );

  try {
    ensureMiningTables(db);
    ensureUpgradeRow(db, accountId);

    const row = db
      .prepare(
        `
          SELECT
            auto_mining_unlocked,
            purchased_at,
            updated_at
          FROM mining_upgrades
          WHERE account_id = ?
        `,
      )
      .get(accountId);

    return mapUpgrade(row);
  } finally {
    db.close();
  }
}

function getRecentMiningHistory(
  databasePath,
  accountId,
  limit = 12,
) {
  const db = openDatabase(databasePath, false);

  try {
    ensureMiningTables(db);

    return db
      .prepare(
        `
          SELECT
            id,
            ore_type,
            action_type,
            quantity,
            amount,
            created_at
          FROM mining_history
          WHERE account_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `,
      )
      .all(
        accountId,
        Math.min(30, Math.max(1, Number(limit))),
      )
      .map((row) => {
        const ore = getOre(row.ore_type);

        return {
          id: String(row.id),
          oreKey: String(row.ore_type),
          oreName: ore?.name || String(row.ore_type),
          actionType: String(row.action_type),
          quantity: Number(row.quantity),
          amount: Number(row.amount),
          createdAt: String(row.created_at),
        };
      });
  } finally {
    db.close();
  }
}

function getSalesHistory(
  databasePath,
  accountId,
  limit = 50,
) {
  const db = openDatabase(databasePath, false);

  try {
    ensureMiningTables(db);

    return db
      .prepare(
        `
          SELECT
            id,
            ore_type,
            quantity,
            amount,
            created_at
          FROM mining_history
          WHERE account_id = ?
            AND action_type = 'sell'
          ORDER BY created_at DESC
          LIMIT ?
        `,
      )
      .all(
        accountId,
        Math.min(100, Math.max(1, Number(limit))),
      )
      .map((row) => {
        const ore = getOre(row.ore_type);

        return {
          id: String(row.id),
          oreKey: String(row.ore_type),
          oreName: ore?.name || String(row.ore_type),
          quantity: Number(row.quantity),
          amount: Number(row.amount),
          createdAt: String(row.created_at),
        };
      });
  } finally {
    db.close();
  }
}

function getMiningStatistics(
  databasePath,
  accountId,
) {
  const db = openDatabase(databasePath, false);

  try {
    ensureMiningTables(db);
    ensureInventoryRow(db, accountId);

    const inventory = mapInventory(
      db.prepare(
        `
          SELECT
            stone,
            copper,
            iron,
            emerald,
            diamond,
            total_mined,
            updated_at
          FROM mining_inventory
          WHERE account_id = ?
        `,
      ).get(accountId),
    );

    const saleTotals = db
      .prepare(
        `
          SELECT
            COUNT(*) AS sale_count,
            COALESCE(SUM(quantity), 0) AS sold_quantity,
            COALESCE(SUM(amount), 0) AS sales_revenue
          FROM mining_history
          WHERE account_id = ?
            AND action_type = 'sell'
        `,
      )
      .get(accountId);

    const byOreRows = db
      .prepare(
        `
          SELECT
            ore_type,
            COALESCE(SUM(quantity), 0) AS sold_quantity,
            COALESCE(SUM(amount), 0) AS sales_revenue
          FROM mining_history
          WHERE account_id = ?
            AND action_type = 'sell'
          GROUP BY ore_type
        `,
      )
      .all(accountId);

    const salesByOre = Object.fromEntries(
      ORES.map((ore) => [
        ore.key,
        {
          oreKey: ore.key,
          oreName: ore.name,
          soldQuantity: 0,
          salesRevenue: 0,
        },
      ]),
    );

    for (const row of byOreRows) {
      const key = String(row.ore_type);

      if (!salesByOre[key]) {
        continue;
      }

      salesByOre[key].soldQuantity = Number(
        row.sold_quantity || 0,
      );
      salesByOre[key].salesRevenue = Number(
        row.sales_revenue || 0,
      );
    }

    return {
      totalMined: inventory.totalMined,
      currentInventoryQuantity: INVENTORY_COLUMNS.reduce(
        (total, key) => total + Number(inventory[key] || 0),
        0,
      ),
      saleCount: Number(saleTotals?.sale_count || 0),
      totalSoldQuantity: Number(
        saleTotals?.sold_quantity || 0,
      ),
      totalSalesRevenue: Number(
        saleTotals?.sales_revenue || 0,
      ),
      salesByOre,
    };
  } finally {
    db.close();
  }
}

function addMinedOre({
  databasePath,
  accountId,
  oreKey,
}) {
  if (!INVENTORY_COLUMNS.includes(oreKey)) {
    throw new Error("지원하지 않는 광석입니다.");
  }

  const db = openDatabase(databasePath, false);

  try {
    ensureMiningTables(db);

    return runTransaction(db, () => {
      const account = db
        .prepare(
          `
            SELECT id
            FROM accounts
            WHERE id = ?
          `,
        )
        .get(accountId);

      if (!account) {
        throw new Error("연결 계좌를 찾을 수 없습니다.");
      }

      ensureInventoryRow(db, accountId);

      const now = new Date().toISOString();

      db.prepare(
        `
          UPDATE mining_inventory
          SET
            ${oreKey} = ${oreKey} + 1,
            total_mined = total_mined + 1,
            updated_at = ?
          WHERE account_id = ?
        `,
      ).run(now, accountId);

      db.prepare(
        `
          INSERT INTO mining_history (
            id,
            account_id,
            ore_type,
            action_type,
            quantity,
            amount,
            created_at
          )
          VALUES (?, ?, ?, 'mine', 1, 0, ?)
        `,
      ).run(
        crypto.randomUUID(),
        accountId,
        oreKey,
        now,
      );

      const row = db
        .prepare(
          `
            SELECT
              stone,
              copper,
              iron,
              emerald,
              diamond,
              total_mined,
              updated_at
            FROM mining_inventory
            WHERE account_id = ?
          `,
        )
        .get(accountId);

      return mapInventory(row);
    });
  } finally {
    db.close();
  }
}

function purchaseAutoMiningUpgrade({
  databasePath,
  accountId,
}) {
  const db = openDatabase(
    databasePath,
    false,
  );

  try {
    ensureMiningTables(db);

    return runTransaction(db, () => {
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
        throw new Error(
          "연결 계좌를 찾을 수 없습니다.",
        );
      }

      ensureUpgradeRow(db, accountId);

      const currentUpgrade = db
        .prepare(
          `
            SELECT
              auto_mining_unlocked,
              purchased_at,
              updated_at
            FROM mining_upgrades
            WHERE account_id = ?
          `,
        )
        .get(accountId);

      if (
        Boolean(
          currentUpgrade?.auto_mining_unlocked,
        )
      ) {
        throw new Error(
          "이미 자동 채굴 업그레이드를 구매했습니다.",
        );
      }

      const currentBalance = Number(
        account.balance,
      );

      if (
        currentBalance <
        AUTO_MINING_UPGRADE_PRICE
      ) {
        throw new Error(
          "자동 채굴 업그레이드를 구매할 잔액이 부족합니다.",
        );
      }

      const nextBalance =
        currentBalance -
        AUTO_MINING_UPGRADE_PRICE;

      const now = new Date().toISOString();
      const transactionId =
        crypto.randomUUID();

      db.prepare(
        `
          UPDATE mining_upgrades
          SET
            auto_mining_unlocked = 1,
            purchased_at = ?,
            updated_at = ?
          WHERE account_id = ?
        `,
      ).run(
        now,
        now,
        accountId,
      );

      db.prepare(
        `
          UPDATE accounts
          SET
            balance = ?,
            updated_at = ?
          WHERE id = ?
        `,
      ).run(
        nextBalance,
        now,
        accountId,
      );

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
          VALUES (
            ?,
            ?,
            'withdraw',
            ?,
            ?,
            ?
          )
        `,
      ).run(
        transactionId,
        accountId,
        AUTO_MINING_UPGRADE_PRICE,
        "SD광산 · 자동 채굴 업그레이드",
        now,
      );

      return {
        balance: nextBalance,
        upgrade: {
          autoMiningUnlocked: true,
          purchasedAt: now,
          updatedAt: now,
        },
        transaction: {
          id: transactionId,
          type: "withdraw",
          amount:
            AUTO_MINING_UPGRADE_PRICE,
          memo:
            "SD광산 · 자동 채굴 업그레이드",
          createdAt: now,
        },
      };
    });
  } finally {
    db.close();
  }
}

function sellOre({
  databasePath,
  accountId,
  oreKey,
  quantity,
}) {
  const ore = getOre(oreKey);

  if (!ore) {
    throw new Error("지원하지 않는 광석입니다.");
  }

  const normalizedQuantity = Math.trunc(
    Number(quantity),
  );

  if (
    !Number.isSafeInteger(normalizedQuantity) ||
    normalizedQuantity <= 0
  ) {
    throw new Error("판매 수량이 올바르지 않습니다.");
  }

  const db = openDatabase(databasePath, false);

  try {
    ensureMiningTables(db);

    return runTransaction(db, () => {
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

      ensureInventoryRow(db, accountId);

      const inventory = db
        .prepare(
          `
            SELECT ${oreKey} AS quantity
            FROM mining_inventory
            WHERE account_id = ?
          `,
        )
        .get(accountId);

      const currentQuantity = Number(
        inventory?.quantity || 0,
      );

      if (currentQuantity < normalizedQuantity) {
        throw new Error(
          `${ore.name} 보유 수량이 부족합니다.`,
        );
      }

      const amount =
        ore.price * normalizedQuantity;
      const nextBalance =
        Number(account.balance) + amount;
      const now = new Date().toISOString();
      const transactionId = crypto.randomUUID();

      db.prepare(
        `
          UPDATE mining_inventory
          SET
            ${oreKey} = ${oreKey} - ?,
            updated_at = ?
          WHERE account_id = ?
        `,
      ).run(
        normalizedQuantity,
        now,
        accountId,
      );

      db.prepare(
        `
          UPDATE accounts
          SET
            balance = ?,
            updated_at = ?
          WHERE id = ?
        `,
      ).run(
        nextBalance,
        now,
        accountId,
      );

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
          VALUES (?, ?, 'deposit', ?, ?, ?)
        `,
      ).run(
        transactionId,
        accountId,
        amount,
        `SD광산 · ${ore.name} 판매`,
        now,
      );

      db.prepare(
        `
          INSERT INTO mining_history (
            id,
            account_id,
            ore_type,
            action_type,
            quantity,
            amount,
            created_at
          )
          VALUES (?, ?, ?, 'sell', ?, ?, ?)
        `,
      ).run(
        crypto.randomUUID(),
        accountId,
        oreKey,
        normalizedQuantity,
        amount,
        now,
      );

      const row = db
        .prepare(
          `
            SELECT
              stone,
              copper,
              iron,
              emerald,
              diamond,
              total_mined,
              updated_at
            FROM mining_inventory
            WHERE account_id = ?
          `,
        )
        .get(accountId);

      return {
        inventory: mapInventory(row),
        balance: nextBalance,
        transaction: {
          id: transactionId,
          type: "deposit",
          amount,
          memo: `SD광산 · ${ore.name} 판매`,
          createdAt: now,
        },
      };
    });
  } finally {
    db.close();
  }
}

function sellAllOre({
  databasePath,
  accountId,
}) {
  const db = openDatabase(databasePath, false);

  try {
    ensureMiningTables(db);

    return runTransaction(db, () => {
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

      ensureInventoryRow(db, accountId);

      const inventoryRow = db
        .prepare(
          `
            SELECT
              stone,
              copper,
              iron,
              emerald,
              diamond,
              total_mined,
              updated_at
            FROM mining_inventory
            WHERE account_id = ?
          `,
        )
        .get(accountId);

      const inventory = mapInventory(inventoryRow);
      let amount = 0;
      let totalQuantity = 0;

      for (const ore of ORES) {
        const quantity = Number(
          inventory[ore.key] || 0,
        );
        amount += quantity * ore.price;
        totalQuantity += quantity;
      }

      if (totalQuantity <= 0) {
        throw new Error("판매할 광석이 없습니다.");
      }

      const nextBalance =
        Number(account.balance) + amount;
      const now = new Date().toISOString();
      const transactionId = crypto.randomUUID();

      db.prepare(
        `
          UPDATE mining_inventory
          SET
            stone = 0,
            copper = 0,
            iron = 0,
            emerald = 0,
            diamond = 0,
            updated_at = ?
          WHERE account_id = ?
        `,
      ).run(now, accountId);

      db.prepare(
        `
          UPDATE accounts
          SET
            balance = ?,
            updated_at = ?
          WHERE id = ?
        `,
      ).run(
        nextBalance,
        now,
        accountId,
      );

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
          VALUES (?, ?, 'deposit', ?, ?, ?)
        `,
      ).run(
        transactionId,
        accountId,
        amount,
        "SD광산 · 광석 전체 판매",
        now,
      );

      for (const ore of ORES) {
        const quantity = Number(
          inventory[ore.key] || 0,
        );

        if (quantity <= 0) {
          continue;
        }

        db.prepare(
          `
            INSERT INTO mining_history (
              id,
              account_id,
              ore_type,
              action_type,
              quantity,
              amount,
              created_at
            )
            VALUES (?, ?, ?, 'sell', ?, ?, ?)
          `,
        ).run(
          crypto.randomUUID(),
          accountId,
          ore.key,
          quantity,
          quantity * ore.price,
          now,
        );
      }

      return {
        inventory: {
          stone: 0,
          copper: 0,
          iron: 0,
          emerald: 0,
          diamond: 0,
          totalMined: inventory.totalMined,
          updatedAt: now,
        },
        balance: nextBalance,
        transaction: {
          id: transactionId,
          type: "deposit",
          amount,
          memo: "SD광산 · 광석 전체 판매",
          createdAt: now,
        },
      };
    });
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
      "SDWallet_Stage8_Desktop",
      "data",
      "sdwallet.sqlite",
    ),
    path.join(
      homePath,
      "Desktop",
      "SDWallet_Stage8_Desktop",
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
  AUTO_MINING_UPGRADE_PRICE,
  addMinedOre,
  autoFindWalletDatabase,
  getAccount,
  getInventory,
  getMiningStatistics,
  getMiningUpgrade,
  getRecentMiningHistory,
  getSalesHistory,
  listAccounts,
  purchaseAutoMiningUpgrade,
  sellAllOre,
  sellOre,
  validateWalletDatabase,
};
