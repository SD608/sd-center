"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ROOM_PRICES = Object.freeze({
  A: 500000,
  B: 1000000,
  C: 1500000,
  D: 2000000,
  E: 2500000,
});

const FRAME_PRICE = 1000000;
const GPU_PRICE = 1550000;
const BTC_PRICE_KRW = 4500000;
const ELECTRICITY_FEE_PER_GPU_KRW = 100000;
const MAX_FRAMES_PER_ROOM = 3;
const GPUS_PER_FRAME = 5;

function openDatabase(databasePath, readOnly = false) {
  if (!databasePath || !fs.existsSync(databasePath)) {
    throw new Error("SD지갑 데이터베이스 파일을 찾을 수 없습니다.");
  }

  const db = new DatabaseSync(databasePath, { readOnly });
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  return db;
}

function validateWalletDatabase(databasePath) {
  let db;

  try {
    db = openDatabase(databasePath, true);
  } catch (error) {
    return { ok: false, error: error.message };
  }

  try {
    const names = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('users', 'accounts', 'transactions')
    `).all().map((row) => row.name);

    const missing = ["users", "accounts", "transactions"].filter(
      (name) => !names.includes(name),
    );

    if (missing.length > 0) {
      return {
        ok: false,
        error: "선택한 파일은 SD지갑 데이터베이스 형식이 아닙니다.",
      };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    db.close();
  }
}

function ensureTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bitcoin_account_stats (
      account_id TEXT PRIMARY KEY,
      btc_balance REAL NOT NULL DEFAULT 0 CHECK (btc_balance >= 0),
      total_sold_btc REAL NOT NULL DEFAULT 0 CHECK (total_sold_btc >= 0),
      total_sales_krw INTEGER NOT NULL DEFAULT 0 CHECK (total_sales_krw >= 0),
      updated_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bitcoin_rooms (
      account_id TEXT NOT NULL,
      room_key TEXT NOT NULL CHECK (room_key IN ('A','B','C','D','E')),
      owned INTEGER NOT NULL DEFAULT 0 CHECK (owned IN (0,1)),
      frames INTEGER NOT NULL DEFAULT 0 CHECK (frames BETWEEN 0 AND 3),
      gpus INTEGER NOT NULL DEFAULT 0 CHECK (gpus BETWEEN 0 AND 15),
      mined_btc REAL NOT NULL DEFAULT 0 CHECK (mined_btc >= 0),
      wall_theme TEXT NOT NULL DEFAULT 'concrete',
      floor_theme TEXT NOT NULL DEFAULT 'dark',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (account_id, room_key),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bitcoin_gpu_units (
      account_id TEXT NOT NULL,
      room_key TEXT NOT NULL CHECK (room_key IN ('A','B','C','D','E')),
      slot_index INTEGER NOT NULL CHECK (slot_index BETWEEN 0 AND 14),
      durability INTEGER NOT NULL DEFAULT 100 CHECK (durability BETWEEN 0 AND 100),
      installed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (account_id, room_key, slot_index),
      FOREIGN KEY (account_id, room_key)
        REFERENCES bitcoin_rooms(account_id, room_key) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_bitcoin_gpu_units_account_room
      ON bitcoin_gpu_units(account_id, room_key, slot_index);

    CREATE TABLE IF NOT EXISTS bitcoin_mining_clock (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_tick_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bitcoin_schema_meta (
      meta_key TEXT PRIMARY KEY,
      meta_value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bitcoin_history (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      room_key TEXT,
      action_type TEXT NOT NULL CHECK (
        action_type IN ('buy_room','buy_frame','buy_gpu','mine','sell','decorate')
      ),
      quantity REAL NOT NULL DEFAULT 0,
      amount INTEGER NOT NULL DEFAULT 0,
      memo TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bitcoin_electricity (
      account_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
      debt_krw INTEGER NOT NULL DEFAULT 0 CHECK (debt_krw >= 0),
      last_billed_utc_date TEXT,
      unpaid_utc_date TEXT,
      suspended_at TEXT,
      reactivated_at TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bitcoin_electricity_history (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      action_type TEXT NOT NULL CHECK (action_type IN ('charge','suspend','reactivate')),
      amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
      memo TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_bitcoin_electricity_history_account_created
      ON bitcoin_electricity_history(account_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_bitcoin_history_account_created
      ON bitcoin_history(account_id, created_at DESC);
  `);

  ensureRoomCurrentBtcColumn(db);
  migrateRoomCurrentBtc(db);
  migrateGpuUnitsV1(db);
  syncRoomGpuCounts(db);
}

function nowIso() {
  return new Date().toISOString();
}

function utcDateKey(value = Date.now()) {
  return new Date(value).toISOString().slice(0, 10);
}

function nextUtcDateKey(dateKey) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function utcMidnightAfter(dateKey) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

function roundBtc(value) {
  return (
    Math.round(
      Number(value || 0) * 100000000,
    ) / 100000000
  );
}

function tableHasColumn(
  db,
  tableName,
  columnName,
) {
  return db
    .prepare(
      `PRAGMA table_info(${tableName})`,
    )
    .all()
    .some(
      (column) =>
        String(column.name) ===
        columnName,
    );
}

function ensureRoomCurrentBtcColumn(db) {
  if (
    tableHasColumn(
      db,
      "bitcoin_rooms",
      "current_btc",
    )
  ) {
    return;
  }

  db.exec(`
    ALTER TABLE bitcoin_rooms
    ADD COLUMN current_btc REAL
      NOT NULL DEFAULT 0
      CHECK (current_btc >= 0);
  `);
}

function migrateRoomCurrentBtc(db) {
  const migrationKey =
    "room_current_btc_v1";

  const migrated = db
    .prepare(
      `
        SELECT meta_value
        FROM bitcoin_schema_meta
        WHERE meta_key = ?
      `,
    )
    .get(migrationKey);

  if (migrated) {
    return;
  }

  const accounts = db
    .prepare(
      `
        SELECT
          account_id,
          btc_balance
        FROM bitcoin_account_stats
      `,
    )
    .all();

  for (const account of accounts) {
    const accountId = String(
      account.account_id,
    );

    const currentAccountBtc =
      roundBtc(account.btc_balance);

    const rooms = db
      .prepare(
        `
          SELECT
            room_key,
            owned,
            mined_btc
          FROM bitcoin_rooms
          WHERE account_id = ?
          ORDER BY room_key
        `,
      )
      .all(accountId);

    db.prepare(
      `
        UPDATE bitcoin_rooms
        SET current_btc = 0
        WHERE account_id = ?
      `,
    ).run(accountId);

    if (
      currentAccountBtc <= 0 ||
      rooms.length === 0
    ) {
      continue;
    }

    const totalMined = rooms.reduce(
      (total, room) =>
        total +
        Math.max(
          0,
          Number(room.mined_btc || 0),
        ),
      0,
    );

    const eligibleRooms =
      totalMined > 0
        ? rooms.filter(
            (room) =>
              Number(room.mined_btc || 0) >
              0,
          )
        : rooms.filter(
            (room) =>
              Boolean(room.owned),
          );

    const destinationRooms =
      eligibleRooms.length > 0
        ? eligibleRooms
        : [rooms[0]];

    let remaining =
      currentAccountBtc;

    destinationRooms.forEach(
      (room, index) => {
        const isLast =
          index ===
          destinationRooms.length - 1;

        let assigned = 0;

        if (isLast) {
          assigned = remaining;
        } else if (totalMined > 0) {
          assigned = roundBtc(
            currentAccountBtc *
              (
                Number(
                  room.mined_btc || 0,
                ) / totalMined
              ),
          );
        } else {
          assigned = roundBtc(
            currentAccountBtc /
              destinationRooms.length,
          );
        }

        assigned = Math.min(
          remaining,
          Math.max(0, assigned),
        );

        db.prepare(
          `
            UPDATE bitcoin_rooms
            SET current_btc = ?
            WHERE
              account_id = ?
              AND room_key = ?
          `,
        ).run(
          assigned,
          accountId,
          String(room.room_key),
        );

        remaining = roundBtc(
          remaining - assigned,
        );
      },
    );
  }

  const now = nowIso();

  db.prepare(
    `
      INSERT INTO bitcoin_schema_meta (
        meta_key,
        meta_value,
        updated_at
      )
      VALUES (?, 'complete', ?)
    `,
  ).run(migrationKey, now);
}

function migrateGpuUnitsV1(db) {
  const migrationKey = "gpu_units_v1";
  const migrated = db.prepare(`
    SELECT meta_value
    FROM bitcoin_schema_meta
    WHERE meta_key = ?
  `).get(migrationKey);

  if (migrated) {
    return;
  }

  const rooms = db.prepare(`
    SELECT account_id, room_key, gpus
    FROM bitcoin_rooms
    WHERE gpus > 0
  `).all();
  const now = nowIso();

  for (const room of rooms) {
    const gpuCount = Math.max(0, Math.min(15, Math.trunc(Number(room.gpus || 0))));
    for (let slotIndex = 0; slotIndex < gpuCount; slotIndex += 1) {
      db.prepare(`
        INSERT OR IGNORE INTO bitcoin_gpu_units (
          account_id, room_key, slot_index, durability, installed_at, updated_at
        ) VALUES (?, ?, ?, 100, ?, ?)
      `).run(String(room.account_id), String(room.room_key), slotIndex, now, now);
    }
  }

  db.prepare(`
    INSERT INTO bitcoin_schema_meta (meta_key, meta_value, updated_at)
    VALUES (?, 'complete', ?)
    ON CONFLICT(meta_key) DO UPDATE SET
      meta_value = excluded.meta_value,
      updated_at = excluded.updated_at
  `).run(migrationKey, now);
}

function syncRoomGpuCounts(db, accountId = "", roomKey = "") {
  const conditions = [];
  const params = [];
  if (accountId) {
    conditions.push("account_id = ?");
    params.push(accountId);
  }
  if (roomKey) {
    conditions.push("room_key = ?");
    params.push(roomKey);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  db.prepare(`
    UPDATE bitcoin_rooms
    SET gpus = (
      SELECT COUNT(*)
      FROM bitcoin_gpu_units AS gpu
      WHERE gpu.account_id = bitcoin_rooms.account_id
        AND gpu.room_key = bitcoin_rooms.room_key
        AND gpu.durability > 0
    )
    ${where}
  `).run(...params);
}

function listGpuUnitsForAccount(db, accountId) {
  return db.prepare(`
    SELECT room_key, slot_index, durability, installed_at, updated_at
    FROM bitcoin_gpu_units
    WHERE account_id = ?
    ORDER BY room_key, slot_index
  `).all(accountId).map((row) => ({
    roomKey: String(row.room_key),
    slotIndex: Number(row.slot_index),
    durability: Number(row.durability),
    broken: Number(row.durability) <= 0,
    installedAt: String(row.installed_at || ""),
    updatedAt: String(row.updated_at || ""),
  }));
}

function deductCurrentBtcFromRooms(
  db,
  accountId,
  btcAmount,
) {
  const normalizedAmount =
    roundBtc(btcAmount);

  const rooms = db
    .prepare(
      `
        SELECT
          room_key,
          current_btc
        FROM bitcoin_rooms
        WHERE
          account_id = ?
          AND current_btc > 0
        ORDER BY room_key
      `,
    )
    .all(accountId);

  const totalCurrent = roundBtc(
    rooms.reduce(
      (total, room) =>
        total +
        Number(room.current_btc || 0),
      0,
    ),
  );

  if (
    totalCurrent + 0.00000001 <
    normalizedAmount
  ) {
    throw new Error(
      "원룸별 현재 비트코인 수량이 일치하지 않습니다. F5로 새로고침한 뒤 다시 시도하세요.",
    );
  }

  let remaining =
    normalizedAmount;

  rooms.forEach((room, index) => {
    if (remaining <= 0) {
      return;
    }

    const roomCurrent = roundBtc(
      room.current_btc,
    );

    const isLast =
      index === rooms.length - 1;

    let deduction = isLast
      ? remaining
      : roundBtc(
          normalizedAmount *
            (
              roomCurrent /
              totalCurrent
            ),
        );

    deduction = Math.min(
      roomCurrent,
      remaining,
      Math.max(0, deduction),
    );

    const nextRoomCurrent =
      roundBtc(
        roomCurrent - deduction,
      );

    db.prepare(
      `
        UPDATE bitcoin_rooms
        SET current_btc = ?
        WHERE
          account_id = ?
          AND room_key = ?
      `,
    ).run(
      nextRoomCurrent,
      accountId,
      String(room.room_key),
    );

    remaining = roundBtc(
      remaining - deduction,
    );
  });

  if (remaining > 0.00000001) {
    throw new Error(
      "원룸별 비트코인 차감 중 오류가 발생했습니다.",
    );
  }
}


function ensureAccountRows(db, accountId) {
  const now = nowIso();

  db.prepare(`
    INSERT OR IGNORE INTO bitcoin_account_stats (
      account_id,
      updated_at
    ) VALUES (?, ?)
  `).run(accountId, now);

  for (const roomKey of ["A", "B", "C", "D", "E"]) {
    db.prepare(`
      INSERT OR IGNORE INTO bitcoin_rooms (
        account_id,
        room_key,
        updated_at
      ) VALUES (?, ?, ?)
    `).run(accountId, roomKey, now);
  }

  db.prepare(`
    INSERT OR IGNORE INTO bitcoin_electricity (
      account_id,
      updated_at
    ) VALUES (?, ?)
  `).run(accountId, now);
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
    } catch {}
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

function mapRoom(row) {
  return {
    roomKey: String(row.room_key),
    price: ROOM_PRICES[row.room_key],
    owned: Boolean(row.owned),
    frames: Number(row.frames),
    gpus: Number(row.gpus),
    minedBtc: Number(row.mined_btc),
    currentBtc: Number(
      row.current_btc || 0,
    ),
    wallTheme: String(row.wall_theme),
    floorTheme: String(row.floor_theme),
    updatedAt: String(row.updated_at),
  };
}

function mapStats(row) {
  return {
    btcBalance: Number(row?.btc_balance || 0),
    totalSoldBtc: Number(row?.total_sold_btc || 0),
    totalSalesKrw: Number(row?.total_sales_krw || 0),
    updatedAt: String(row?.updated_at || ""),
  };
}

function mapElectricity(row, activeGpuCount = 0) {
  const status = String(row?.status || "active");
  const currentUtcDate = utcDateKey();
  const lastBilledUtcDate = String(
    row?.last_billed_utc_date || "",
  );

  return {
    status,
    suspended: status === "suspended",
    debtKrw: Number(row?.debt_krw || 0),
    feePerGpuKrw: ELECTRICITY_FEE_PER_GPU_KRW,
    dailyFeeKrw: Number(activeGpuCount || 0) * ELECTRICITY_FEE_PER_GPU_KRW,
    billingTimezone: "UTC",
    lastBilledUtcDate,
    unpaidUtcDate: String(row?.unpaid_utc_date || ""),
    suspendedAt: String(row?.suspended_at || ""),
    reactivatedAt: String(row?.reactivated_at || ""),
    updatedAt: String(row?.updated_at || ""),
    activeGpuCount: Number(activeGpuCount || 0),
    hasActiveGpus: Number(activeGpuCount || 0) > 0,
    nextBillingAt: status === "active" && Number(activeGpuCount || 0) > 0
      ? utcMidnightAfter(
          lastBilledUtcDate || currentUtcDate,
        )
      : "",
  };
}

function insertElectricityHistory(
  db,
  accountId,
  actionType,
  amount,
  memo,
  createdAt,
) {
  db.prepare(`
    INSERT INTO bitcoin_electricity_history (
      id, account_id, action_type, amount, memo, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    accountId,
    actionType,
    amount,
    memo,
    createdAt,
  );
}

function chargeElectricityForAccount(
  db,
  accountId,
  currentTimeMs = Date.now(),
) {
  ensureAccountRows(db, accountId);

  const activeGpuCount = Number(
    db.prepare(`
      SELECT COUNT(*) AS gpu_count
      FROM bitcoin_gpu_units AS gpu
      JOIN bitcoin_rooms AS room
        ON room.account_id = gpu.account_id
       AND room.room_key = gpu.room_key
      WHERE gpu.account_id = ?
        AND room.owned = 1
        AND gpu.durability > 0
    `).get(accountId)?.gpu_count || 0,
  );

  let row = db.prepare(`
    SELECT *
    FROM bitcoin_electricity
    WHERE account_id = ?
  `).get(accountId);

  if (activeGpuCount <= 0 || String(row.status) === "suspended") {
    return {
      electricity: mapElectricity(row, activeGpuCount),
      events: [],
    };
  }

  const currentUtcDate = utcDateKey(currentTimeMs);
  let dueDate = row.last_billed_utc_date
    ? nextUtcDateKey(String(row.last_billed_utc_date))
    : currentUtcDate;
  const events = [];
  const dailyFeeKrw = activeGpuCount * ELECTRICITY_FEE_PER_GPU_KRW;

  while (dueDate <= currentUtcDate) {
    const account = db.prepare(`
      SELECT balance
      FROM accounts
      WHERE id = ?
    `).get(accountId);

    if (!account) {
      throw new Error("연결 계좌를 찾을 수 없습니다.");
    }

    const balance = Number(account.balance || 0);
    const now = new Date(currentTimeMs).toISOString();

    if (balance < dailyFeeKrw) {
      db.prepare(`
        UPDATE bitcoin_electricity
        SET
          status = 'suspended',
          debt_krw = ?,
          unpaid_utc_date = ?,
          suspended_at = ?,
          updated_at = ?
        WHERE account_id = ?
      `).run(
        dailyFeeKrw,
        dueDate,
        now,
        now,
        accountId,
      );

      const memo = `SD비트코인 · UTC ${dueDate} 전기세 미납으로 채굴 중지`;
      insertElectricityHistory(
        db, accountId, "suspend",
        dailyFeeKrw, memo, now,
      );
      events.push({
        accountId,
        type: "suspended",
        amount: dailyFeeKrw,
        utcDate: dueDate,
      });
      row = db.prepare(`SELECT * FROM bitcoin_electricity WHERE account_id = ?`).get(accountId);
      return {
        electricity: mapElectricity(row, activeGpuCount),
        events,
      };
    }

    const nextBalance = balance - dailyFeeKrw;
    const memo = `SD비트코인 · UTC ${dueDate} 일일 전기세`;

    db.prepare(`
      UPDATE accounts
      SET balance = ?, updated_at = ?
      WHERE id = ?
    `).run(nextBalance, now, accountId);

    db.prepare(`
      INSERT INTO transactions (
        id, account_id, transaction_type, amount, memo, created_at
      ) VALUES (?, ?, 'withdraw', ?, ?, ?)
    `).run(
      crypto.randomUUID(), accountId,
      dailyFeeKrw, memo, now,
    );

    db.prepare(`
      UPDATE bitcoin_electricity
      SET
        last_billed_utc_date = ?,
        debt_krw = 0,
        unpaid_utc_date = NULL,
        updated_at = ?
      WHERE account_id = ?
    `).run(dueDate, now, accountId);

    insertElectricityHistory(
      db, accountId, "charge",
      dailyFeeKrw, memo, now,
    );
    events.push({
      accountId,
      type: "charged",
      amount: dailyFeeKrw,
      utcDate: dueDate,
      balance: nextBalance,
    });

    dueDate = nextUtcDateKey(dueDate);
  }

  row = db.prepare(`SELECT * FROM bitcoin_electricity WHERE account_id = ?`).get(accountId);
  return {
    electricity: mapElectricity(row, activeGpuCount),
    events,
  };
}

function reactivateElectricity(
  databasePath,
  accountId,
  currentTimeMs = Date.now(),
) {
  const db = openDatabase(databasePath, false);

  try {
    ensureTables(db);

    return runTransaction(db, () => {
      ensureAccountRows(db, accountId);

      const row = db.prepare(`
        SELECT *
        FROM bitcoin_electricity
        WHERE account_id = ?
      `).get(accountId);

      if (String(row?.status || "active") !== "suspended") {
        throw new Error("현재 채굴장은 전기세로 중지된 상태가 아닙니다.");
      }

      const debt = Number(row?.debt_krw || 0);
      const account = db.prepare(`
        SELECT balance
        FROM accounts
        WHERE id = ?
      `).get(accountId);

      if (!account) {
        throw new Error("연결 계좌를 찾을 수 없습니다.");
      }

      if (Number(account.balance || 0) < debt) {
        throw new Error(`밀린 전기세 ${debt.toLocaleString("ko-KR")}원을 납부할 잔액이 부족합니다.`);
      }

      const now = new Date(currentTimeMs).toISOString();
      const nextBalance = Number(account.balance) - debt;
      const currentUtcDate = utcDateKey(currentTimeMs);
      const memo = "SD비트코인 · 밀린 전기세 납부 및 채굴 재가동";

      db.prepare(`
        UPDATE accounts
        SET balance = ?, updated_at = ?
        WHERE id = ?
      `).run(nextBalance, now, accountId);

      db.prepare(`
        INSERT INTO transactions (
          id, account_id, transaction_type, amount, memo, created_at
        ) VALUES (?, ?, 'withdraw', ?, ?, ?)
      `).run(crypto.randomUUID(), accountId, debt, memo, now);

      db.prepare(`
        UPDATE bitcoin_electricity
        SET
          status = 'active',
          debt_krw = 0,
          last_billed_utc_date = ?,
          unpaid_utc_date = NULL,
          suspended_at = NULL,
          reactivated_at = ?,
          updated_at = ?
        WHERE account_id = ?
      `).run(currentUtcDate, now, now, accountId);

      insertElectricityHistory(
        db, accountId, "reactivate", debt, memo, now,
      );

      const activeGpuCount = Number(
        db.prepare(`
          SELECT COUNT(*) AS gpu_count
          FROM bitcoin_gpu_units AS gpu
          JOIN bitcoin_rooms AS room
            ON room.account_id = gpu.account_id
           AND room.room_key = gpu.room_key
          WHERE gpu.account_id = ?
            AND room.owned = 1
            AND gpu.durability > 0
        `).get(accountId)?.gpu_count || 0,
      );
      const updated = db.prepare(`SELECT * FROM bitcoin_electricity WHERE account_id = ?`).get(accountId);

      return {
        balance: nextBalance,
        paidAmount: debt,
        electricity: mapElectricity(updated, activeGpuCount),
      };
    });
  } finally {
    db.close();
  }
}

function listAccounts(databasePath) {
  const db = openDatabase(databasePath, false);

  try {
    ensureTables(db);

    return db.prepare(`
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
    `).all().map(mapAccount);
  } finally {
    db.close();
  }
}

function getAccountState(databasePath, accountId) {
  const db = openDatabase(databasePath, false);

  try {
    ensureTables(db);
    ensureAccountRows(db, accountId);

    const accountRow = db.prepare(`
      SELECT
        accounts.id,
        accounts.bank_name,
        accounts.account_number,
        accounts.owner_name,
        accounts.balance,
        accounts.updated_at,
        users.username
      FROM accounts
      LEFT JOIN users ON users.id = accounts.user_id
      WHERE accounts.id = ?
    `).get(accountId);

    if (!accountRow) {
      return null;
    }

    const rooms = db.prepare(`
      SELECT
        room_key,
        owned,
        frames,
        gpus,
        mined_btc,
        current_btc,
        wall_theme,
        floor_theme,
        updated_at
      FROM bitcoin_rooms
      WHERE account_id = ?
      ORDER BY room_key
    `).all(accountId).map(mapRoom);

    const gpuUnits = listGpuUnitsForAccount(db, accountId);
    for (const room of rooms) {
      room.gpuUnits = gpuUnits.filter((unit) => unit.roomKey === room.roomKey);
    }

    const stats = mapStats(db.prepare(`
      SELECT
        btc_balance,
        total_sold_btc,
        total_sales_krw,
        updated_at
      FROM bitcoin_account_stats
      WHERE account_id = ?
    `).get(accountId));

    const appHistory = db.prepare(`
      SELECT
        id, room_key, action_type, quantity, amount, memo, created_at
      FROM bitcoin_history
      WHERE account_id = ?
      ORDER BY created_at DESC
      LIMIT 30
    `).all(accountId).map((row) => ({
      id: String(row.id),
      roomKey: row.room_key ? String(row.room_key) : "",
      actionType: String(row.action_type),
      quantity: Number(row.quantity),
      amount: Number(row.amount),
      memo: String(row.memo),
      createdAt: String(row.created_at),
    }));

    const electricityHistory = db.prepare(`
      SELECT id, action_type, amount, memo, created_at
      FROM bitcoin_electricity_history
      WHERE account_id = ?
      ORDER BY created_at DESC
      LIMIT 30
    `).all(accountId).map((row) => ({
      id: String(row.id),
      roomKey: "",
      actionType: `electricity_${String(row.action_type)}`,
      quantity: 0,
      amount: Number(row.amount),
      memo: String(row.memo),
      createdAt: String(row.created_at),
    }));

    const history = [...appHistory, ...electricityHistory]
      .sort((left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime(),
      )
      .slice(0, 20);

    const activeGpuCount = gpuUnits.reduce(
      (total, unit) => total + (unit.durability > 0 ? 1 : 0),
      0,
    );
    const electricityRow = db.prepare(`
      SELECT *
      FROM bitcoin_electricity
      WHERE account_id = ?
    `).get(accountId);

    return {
      account: mapAccount(accountRow),
      rooms,
      stats,
      electricity: mapElectricity(electricityRow, activeGpuCount),
      history,
    };
  } finally {
    db.close();
  }
}

function deductAndRecord(db, {
  accountId,
  amount,
  memo,
  roomKey,
  actionType,
  quantity = 1,
}) {
  const account = db.prepare(`
    SELECT balance
    FROM accounts
    WHERE id = ?
  `).get(accountId);

  if (!account) {
    throw new Error("연결 계좌를 찾을 수 없습니다.");
  }

  const balance = Number(account.balance);

  if (balance < amount) {
    throw new Error("가상계좌 잔액이 부족합니다.");
  }

  const nextBalance = balance - amount;
  const now = nowIso();

  db.prepare(`
    UPDATE accounts
    SET balance = ?, updated_at = ?
    WHERE id = ?
  `).run(nextBalance, now, accountId);

  db.prepare(`
    INSERT INTO transactions (
      id,
      account_id,
      transaction_type,
      amount,
      memo,
      created_at
    ) VALUES (?, ?, 'withdraw', ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    accountId,
    amount,
    memo,
    now,
  );

  db.prepare(`
    INSERT INTO bitcoin_history (
      id,
      account_id,
      room_key,
      action_type,
      quantity,
      amount,
      memo,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    accountId,
    roomKey,
    actionType,
    quantity,
    amount,
    memo,
    now,
  );

  return { nextBalance, now };
}

function buyRoom(databasePath, accountId, roomKey) {
  const price = ROOM_PRICES[roomKey];

  if (!price) {
    throw new Error("지원하지 않는 원룸입니다.");
  }

  const db = openDatabase(databasePath, false);

  try {
    ensureTables(db);

    return runTransaction(db, () => {
      ensureAccountRows(db, accountId);

      const room = db.prepare(`
        SELECT owned
        FROM bitcoin_rooms
        WHERE account_id = ? AND room_key = ?
      `).get(accountId, roomKey);

      if (Boolean(room?.owned)) {
        throw new Error("이미 소유한 원룸입니다.");
      }

      const payment = deductAndRecord(db, {
        accountId,
        amount: price,
        memo: `SD비트코인 · ${roomKey} 원룸 구매`,
        roomKey,
        actionType: "buy_room",
      });

      db.prepare(`
        UPDATE bitcoin_rooms
        SET owned = 1, updated_at = ?
        WHERE account_id = ? AND room_key = ?
      `).run(payment.now, accountId, roomKey);

      return {
        balance: payment.nextBalance,
      };
    });
  } finally {
    db.close();
  }
}

function buyFrame(databasePath, accountId, roomKey) {
  const db = openDatabase(databasePath, false);

  try {
    ensureTables(db);

    return runTransaction(db, () => {
      ensureAccountRows(db, accountId);

      const room = db.prepare(`
        SELECT owned, frames
        FROM bitcoin_rooms
        WHERE account_id = ? AND room_key = ?
      `).get(accountId, roomKey);

      if (!room || !Boolean(room.owned)) {
        throw new Error("먼저 원룸을 구매하세요.");
      }

      if (Number(room.frames) >= MAX_FRAMES_PER_ROOM) {
        throw new Error("이 원룸에는 틀을 최대 3개까지 설치할 수 있습니다.");
      }

      const payment = deductAndRecord(db, {
        accountId,
        amount: FRAME_PRICE,
        memo: `SD비트코인 · ${roomKey} 원룸 채굴 틀 구매`,
        roomKey,
        actionType: "buy_frame",
      });

      db.prepare(`
        UPDATE bitcoin_rooms
        SET frames = frames + 1, updated_at = ?
        WHERE account_id = ? AND room_key = ?
      `).run(payment.now, accountId, roomKey);

      return { balance: payment.nextBalance };
    });
  } finally {
    db.close();
  }
}

function buyGpu(databasePath, accountId, roomKey) {
  const db = openDatabase(databasePath, false);

  try {
    ensureTables(db);

    return runTransaction(db, () => {
      ensureAccountRows(db, accountId);

      const room = db.prepare(`
        SELECT owned, frames
        FROM bitcoin_rooms
        WHERE account_id = ? AND room_key = ?
      `).get(accountId, roomKey);

      if (!room || !Boolean(room.owned)) {
        throw new Error("먼저 원룸을 구매하세요.");
      }

      const capacity = Number(room.frames) * GPUS_PER_FRAME;
      if (capacity <= 0) {
        throw new Error("그래픽카드를 설치할 채굴 틀을 먼저 구매하세요.");
      }

      const activeSlots = new Set(
        db.prepare(`
          SELECT slot_index
          FROM bitcoin_gpu_units
          WHERE account_id = ? AND room_key = ? AND durability > 0
        `).all(accountId, roomKey).map((row) => Number(row.slot_index)),
      );

      if (activeSlots.size >= capacity) {
        throw new Error("현재 채굴 틀의 그래픽카드 자리가 가득 찼습니다.");
      }

      let slotIndex = -1;
      for (let index = 0; index < capacity; index += 1) {
        if (!activeSlots.has(index)) {
          slotIndex = index;
          break;
        }
      }

      if (slotIndex < 0) {
        throw new Error("새 그래픽카드를 설치할 빈 슬롯을 찾지 못했습니다.");
      }

      const payment = deductAndRecord(db, {
        accountId,
        amount: GPU_PRICE,
        memo: `SD비트코인 · ${roomKey} 원룸 그래픽카드 구매`,
        roomKey,
        actionType: "buy_gpu",
      });

      db.prepare(`
        INSERT INTO bitcoin_gpu_units (
          account_id, room_key, slot_index, durability, installed_at, updated_at
        ) VALUES (?, ?, ?, 100, ?, ?)
        ON CONFLICT(account_id, room_key, slot_index) DO UPDATE SET
          durability = 100,
          installed_at = excluded.installed_at,
          updated_at = excluded.updated_at
      `).run(accountId, roomKey, slotIndex, payment.now, payment.now);

      syncRoomGpuCounts(db, accountId, roomKey);
      db.prepare(`
        UPDATE bitcoin_rooms SET updated_at = ?
        WHERE account_id = ? AND room_key = ?
      `).run(payment.now, accountId, roomKey);

      return {
        balance: payment.nextBalance,
        slotIndex,
        durability: 100,
      };
    });
  } finally {
    db.close();
  }
}

function decorateRoom(databasePath, accountId, roomKey, wallTheme, floorTheme) {
  const wallThemes = new Set(["concrete", "brick", "neon", "clean"]);
  const floorThemes = new Set(["dark", "wood", "tile"]);

  if (!wallThemes.has(wallTheme) || !floorThemes.has(floorTheme)) {
    throw new Error("지원하지 않는 인테리어입니다.");
  }

  const db = openDatabase(databasePath, false);

  try {
    ensureTables(db);

    return runTransaction(db, () => {
      ensureAccountRows(db, accountId);

      const room = db.prepare(`
        SELECT owned
        FROM bitcoin_rooms
        WHERE account_id = ? AND room_key = ?
      `).get(accountId, roomKey);

      if (!room || !Boolean(room.owned)) {
        throw new Error("소유한 원룸만 꾸밀 수 있습니다.");
      }

      const now = nowIso();

      db.prepare(`
        UPDATE bitcoin_rooms
        SET wall_theme = ?, floor_theme = ?, updated_at = ?
        WHERE account_id = ? AND room_key = ?
      `).run(wallTheme, floorTheme, now, accountId, roomKey);

      db.prepare(`
        INSERT INTO bitcoin_history (
          id,
          account_id,
          room_key,
          action_type,
          quantity,
          amount,
          memo,
          created_at
        ) VALUES (?, ?, ?, 'decorate', 1, 0, ?, ?)
      `).run(
        crypto.randomUUID(),
        accountId,
        roomKey,
        `SD비트코인 · ${roomKey} 원룸 인테리어 변경`,
        now,
      );

      return { ok: true };
    });
  } finally {
    db.close();
  }
}

function sellBitcoin(databasePath, accountId, btcAmount) {
  const amount = Number(btcAmount);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("판매할 비트코인 수량이 올바르지 않습니다.");
  }

  const normalized = Math.round(amount * 100000000) / 100000000;
  const db = openDatabase(databasePath, false);

  try {
    ensureTables(db);

    return runTransaction(db, () => {
      ensureAccountRows(db, accountId);

      const stats = db.prepare(`
        SELECT btc_balance, total_sold_btc, total_sales_krw
        FROM bitcoin_account_stats
        WHERE account_id = ?
      `).get(accountId);

      const currentBtc = Number(stats?.btc_balance || 0);

      if (currentBtc + 1e-9 < normalized) {
        throw new Error("보유 비트코인이 부족합니다.");
      }

      const saleKrw = Math.round(normalized * BTC_PRICE_KRW);
      const account = db.prepare(`
        SELECT balance
        FROM accounts
        WHERE id = ?
      `).get(accountId);

      if (!account) {
        throw new Error("연결 계좌를 찾을 수 없습니다.");
      }

      deductCurrentBtcFromRooms(
        db,
        accountId,
        normalized,
      );

      const nextBalance =
        Number(account.balance) +
        saleKrw;

      const nextBtc = roundBtc(
        Math.max(
          0,
          currentBtc - normalized,
        ),
      );

      const now = nowIso();
      const memo = `SD비트코인 · ${normalized.toFixed(2)} BTC 판매`;

      db.prepare(`
        UPDATE bitcoin_account_stats
        SET
          btc_balance = ?,
          total_sold_btc = total_sold_btc + ?,
          total_sales_krw = total_sales_krw + ?,
          updated_at = ?
        WHERE account_id = ?
      `).run(nextBtc, normalized, saleKrw, now, accountId);

      db.prepare(`
        UPDATE accounts
        SET balance = ?, updated_at = ?
        WHERE id = ?
      `).run(nextBalance, now, accountId);

      db.prepare(`
        INSERT INTO transactions (
          id,
          account_id,
          transaction_type,
          amount,
          memo,
          created_at
        ) VALUES (?, ?, 'deposit', ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        accountId,
        saleKrw,
        memo,
        now,
      );

      db.prepare(`
        INSERT INTO bitcoin_history (
          id,
          account_id,
          room_key,
          action_type,
          quantity,
          amount,
          memo,
          created_at
        ) VALUES (?, ?, NULL, 'sell', ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        accountId,
        normalized,
        saleKrw,
        memo,
        now,
      );

      return {
        balance: nextBalance,
        btcBalance: nextBtc,
        saleKrw,
        soldBtc: normalized,
      };
    });
  } finally {
    db.close();
  }
}

function applyRewardRows(
  db,
  rewards,
  createdAt,
) {
  for (const reward of rewards) {
    const amount = Number(reward.btc || 0);

    if (amount <= 0) {
      continue;
    }

    ensureAccountRows(db, reward.accountId);

    let brokenGpuCount = 0;
    const gpuDurabilityChanges = [];
    for (const gpuResult of Array.isArray(reward.gpuSuccesses) ? reward.gpuSuccesses : []) {
      const slotIndex = Math.max(0, Math.trunc(Number(gpuResult.slotIndex)));
      const successes = Math.max(0, Math.trunc(Number(gpuResult.successes)));
      if (successes <= 0) {
        continue;
      }

      const current = db.prepare(`
        SELECT durability
        FROM bitcoin_gpu_units
        WHERE account_id = ? AND room_key = ? AND slot_index = ?
      `).get(reward.accountId, reward.roomKey, slotIndex);

      const before = Math.max(0, Math.min(100, Math.trunc(Number(current?.durability || 0))));
      if (before <= 0) {
        continue;
      }

      const appliedSuccesses = Math.min(before, successes);
      const after = Math.max(0, before - appliedSuccesses);
      db.prepare(`
        UPDATE bitcoin_gpu_units
        SET durability = ?, updated_at = ?
        WHERE account_id = ? AND room_key = ? AND slot_index = ?
      `).run(after, createdAt, reward.accountId, reward.roomKey, slotIndex);

      if (after === 0) {
        brokenGpuCount += 1;
      }
      gpuDurabilityChanges.push({
        slotIndex,
        successes: appliedSuccesses,
        durabilityBefore: before,
        durabilityAfter: after,
        broke: after === 0,
      });
    }

    if (gpuDurabilityChanges.length > 0) {
      syncRoomGpuCounts(db, reward.accountId, reward.roomKey);
    }

    reward.gpuDurabilityChanges = gpuDurabilityChanges;
    reward.brokenGpuCount = brokenGpuCount;

    db.prepare(`
      UPDATE bitcoin_rooms
      SET
        mined_btc = mined_btc + ?,
        current_btc = current_btc + ?,
        updated_at = ?
      WHERE account_id = ? AND room_key = ?
    `).run(amount, amount, createdAt, reward.accountId, reward.roomKey);

    db.prepare(`
      UPDATE bitcoin_account_stats
      SET btc_balance = btc_balance + ?, updated_at = ?
      WHERE account_id = ?
    `).run(amount, createdAt, reward.accountId);

    const elapsedSeconds = Math.max(1, Math.trunc(Number(reward.elapsedSeconds || 1)));
    const periodText = elapsedSeconds > 1
      ? ` · ${elapsedSeconds.toLocaleString("ko-KR")}초 누적`
      : "";
    const breakText = brokenGpuCount > 0
      ? ` · GPU ${brokenGpuCount}개 내구도 0%로 파손`
      : "";

    db.prepare(`
      INSERT INTO bitcoin_history (
        id, account_id, room_key, action_type, quantity, amount, memo, created_at
      ) VALUES (?, ?, ?, 'mine', ?, 0, ?, ?)
    `).run(
      crypto.randomUUID(),
      reward.accountId,
      reward.roomKey,
      amount,
      `SD비트코인 · ${reward.roomKey} 원룸 ${amount.toFixed(2)} BTC 채굴${periodText}${breakText}`,
      createdAt,
    );
  }
}

function processMiningWindow(
  databasePath,
  rewardCalculator,
  currentTimeMs = Date.now(),
  miningIntervalSeconds = 10,
) {
  const db = openDatabase(databasePath, false);

  try {
    ensureTables(db);

    return runTransaction(db, () => {
      const currentTime = Number(currentTimeMs);
      const safeCurrentTime = Number.isFinite(
        currentTime,
      )
        ? currentTime
        : Date.now();

      let clock = db
        .prepare(
          `
            SELECT last_tick_at
            FROM bitcoin_mining_clock
            WHERE id = 1
          `,
        )
        .get();

      if (!clock) {
        const initializedAt = new Date(
          safeCurrentTime,
        ).toISOString();

        db.prepare(
          `
            INSERT INTO bitcoin_mining_clock (
              id,
              last_tick_at
            )
            VALUES (1, ?)
          `,
        ).run(initializedAt);

        return {
          elapsedSeconds: 0,
          rewards: [],
          initialized: true,
        };
      }

      let lastTickMs = new Date(
        clock.last_tick_at,
      ).getTime();

      if (
        !Number.isFinite(lastTickMs) ||
        lastTickMs > safeCurrentTime
      ) {
        lastTickMs = safeCurrentTime;
      }

      const normalizedIntervalSeconds =
        Math.max(
          1,
          Math.trunc(
            Number(
              miningIntervalSeconds,
            ),
          ),
        );

      const elapsedIntervals =
        Math.floor(
          (
            safeCurrentTime -
            lastTickMs
          ) /
            (
              normalizedIntervalSeconds *
              1000
            ),
        );

      if (elapsedIntervals <= 0) {
        return {
          elapsedSeconds: 0,
          elapsedIntervals: 0,
          rewards: [],
          initialized: false,
        };
      }

      const elapsedSeconds =
        elapsedIntervals *
        normalizedIntervalSeconds;

      const activeGpuRows = db.prepare(`
        SELECT gpu.account_id, gpu.room_key, gpu.slot_index, gpu.durability
        FROM bitcoin_gpu_units AS gpu
        JOIN bitcoin_rooms AS room
          ON room.account_id = gpu.account_id
         AND room.room_key = gpu.room_key
        WHERE room.owned = 1 AND gpu.durability > 0
        ORDER BY gpu.account_id, gpu.room_key, gpu.slot_index
      `).all();

      const activeRoomMap = new Map();
      for (const row of activeGpuRows) {
        const accountId = String(row.account_id);
        const roomKey = String(row.room_key);
        const key = `${accountId}:${roomKey}`;
        if (!activeRoomMap.has(key)) {
          activeRoomMap.set(key, { accountId, roomKey, gpus: 0, gpuUnits: [] });
        }
        const room = activeRoomMap.get(key);
        room.gpus += 1;
        room.gpuUnits.push({
          slotIndex: Number(row.slot_index),
          durability: Number(row.durability),
        });
      }
      const allActiveRooms = [...activeRoomMap.values()];

      const activeAccountIds = [...new Set(
        allActiveRooms.map((room) => room.accountId),
      )];
      const billingEvents = [];
      const processedUntilMs =
        lastTickMs +
        elapsedSeconds * 1000;
      const intervalMs =
        normalizedIntervalSeconds * 1000;
      const rewards = [];

      for (const accountId of activeAccountIds) {
        const billing = chargeElectricityForAccount(
          db, accountId, safeCurrentTime,
        );
        billingEvents.push(...billing.events);

        let eligibleIntervals = elapsedIntervals;

        if (billing.electricity.suspended) {
          const unpaidUtcDate =
            billing.electricity.unpaidUtcDate;
          const suspensionBoundaryMs = unpaidUtcDate
            ? Date.parse(`${unpaidUtcDate}T00:00:00.000Z`)
            : lastTickMs;
          const eligibleUntilMs = Math.min(
            processedUntilMs,
            Number.isFinite(suspensionBoundaryMs)
              ? suspensionBoundaryMs
              : lastTickMs,
          );
          eligibleIntervals = Math.max(
            0,
            Math.floor(
              (eligibleUntilMs - lastTickMs) / intervalMs,
            ),
          );
        }

        if (eligibleIntervals <= 0) {
          continue;
        }

        const accountRooms = allActiveRooms.filter(
          (room) => room.accountId === accountId,
        );
        rewards.push(
          ...rewardCalculator(
            accountRooms,
            eligibleIntervals,
          ),
        );
      }

      const processedAt = new Date(
        processedUntilMs,
      ).toISOString();

      applyRewardRows(
        db,
        rewards,
        processedAt,
      );

      db.prepare(
        `
          UPDATE bitcoin_mining_clock
          SET last_tick_at = ?
          WHERE id = 1
        `,
      ).run(processedAt);

      return {
        elapsedSeconds,
        elapsedIntervals,
        rewards,
        billingEvents,
        initialized: false,
      };
    });
  } finally {
    db.close();
  }
}

function resetMiningClock(
  databasePath,
  currentTimeMs = Date.now(),
) {
  const db = openDatabase(databasePath, false);

  try {
    ensureTables(db);

    const currentTime = Number(currentTimeMs);
    const timestamp = new Date(
      Number.isFinite(currentTime)
        ? currentTime
        : Date.now(),
    ).toISOString();

    db.prepare(
      `
        INSERT INTO bitcoin_mining_clock (
          id,
          last_tick_at
        )
        VALUES (1, ?)
        ON CONFLICT(id)
        DO UPDATE SET
          last_tick_at = excluded.last_tick_at
      `,
    ).run(timestamp);
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

    const normalized = path.resolve(candidate).toLowerCase();

    if (seen.has(normalized)) {
      return false;
    }

    seen.add(normalized);
    return fs.existsSync(candidate);
  });
}

function autoFindWalletDatabase({ appDataPath, homePath }) {
  const candidates = [
    path.join(appDataPath, "SD지갑", "data", "sdwallet.sqlite"),
    path.join(appDataPath, "sdwallet-desktop", "data", "sdwallet.sqlite"),
    path.join(appDataPath, "SDWallet", "data", "sdwallet.sqlite"),
    path.join(homePath, "Downloads", "SDWallet_Stage8_Desktop", "data", "sdwallet.sqlite"),
    path.join(homePath, "Desktop", "SDWallet_Stage8_Desktop", "data", "sdwallet.sqlite"),
  ];

  for (const candidate of uniqueExisting(candidates)) {
    if (validateWalletDatabase(candidate).ok) {
      return candidate;
    }
  }

  try {
    const entries = fs.readdirSync(appDataPath, { withFileTypes: true });

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

      if (fs.existsSync(candidate) && validateWalletDatabase(candidate).ok) {
        return candidate;
      }
    }
  } catch {
    return null;
  }

  return null;
}

module.exports = {
  BTC_PRICE_KRW,
  ELECTRICITY_FEE_PER_GPU_KRW,
  FRAME_PRICE,
  GPU_PRICE,
  GPUS_PER_FRAME,
  MAX_FRAMES_PER_ROOM,
  ROOM_PRICES,
  autoFindWalletDatabase,
  buyFrame,
  buyGpu,
  buyRoom,
  decorateRoom,
  getAccountState,
  listAccounts,
  processMiningWindow,
  reactivateElectricity,
  resetMiningClock,
  sellBitcoin,
  validateWalletDatabase,
};
