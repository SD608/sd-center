"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const JSON_KEYS = [
  "btcQuantity", "btc_quantity", "btcBalance", "btc_balance",
  "bitcoinQuantity", "bitcoin_quantity", "bitcoinBalance", "bitcoin_balance",
  "currentBTC", "currentBtc", "current_btc",
  "minedBTC", "minedBtc", "mined_btc",
  "currentMinedBTC", "currentMinedBtc", "current_mined_btc",
  "totalBTC", "totalBtc", "total_btc"
];

function numberOrNull(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1000000000) return null;
  return Math.round(number * 1e8) / 1e8;
}

function statUpdatedAt(filePath) {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return null;
  }
}

function findJsonQuantity(value, depth = 0) {
  if (!value || depth > 8 || typeof value !== "object") return null;
  for (const key of JSON_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const quantity = numberOrNull(value[key]);
      if (quantity !== null) return { quantity, key };
    }
  }
  for (const [key, child] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if ((lower.includes("btc") || lower.includes("bitcoin")) && !lower.includes("price")) {
      if (typeof child !== "object") {
        const quantity = numberOrNull(child);
        if (quantity !== null) return { quantity, key };
      }
    }
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      const found = findJsonQuantity(child, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function readJson(filePath) {
  try {
    if (fs.statSync(filePath).size > 8 * 1024 * 1024) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const found = findJsonQuantity(parsed);
    if (!found) return null;
    return {
      quantity: found.quantity,
      sourcePath: filePath,
      sourceHint: `JSON:${found.key}`,
      localUpdatedAt: statUpdatedAt(filePath),
    };
  } catch {
    return null;
  }
}

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function readSqlite(filePath) {
  let db;
  try {
    db = new DatabaseSync(filePath, { open: true, readOnly: true });
    db.exec("PRAGMA busy_timeout = 500;");
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map((row) => String(row.name));

    const candidates = [];
    for (const table of tables) {
      const columns = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all()
        .map((row) => String(row.name));
      for (const column of columns) {
        const lowerTable = table.toLowerCase();
        const lower = column.toLowerCase();
        if (lower.includes("price")) continue;
        let score = 0;
        if (lower.includes("btc") || lower.includes("bitcoin")) score += 10;
        if (/(quantity|balance|amount|mined|current|holding)/.test(lower)) score += 5;
        if (lowerTable.includes("btc") || lowerTable.includes("bitcoin")) score += 6;
        if (score >= 10) candidates.push({ table, column, score });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    for (const candidate of candidates) {
      try {
        const sql = `SELECT ${quoteIdent(candidate.column)} AS value FROM ${quoteIdent(candidate.table)}
                     WHERE ${quoteIdent(candidate.column)} IS NOT NULL
                     ORDER BY rowid DESC LIMIT 1`;
        const row = db.prepare(sql).get();
        const quantity = numberOrNull(row?.value);
        if (quantity !== null) {
          return {
            quantity,
            sourcePath: filePath,
            sourceHint: `SQLite:${candidate.table}.${candidate.column}`,
            localUpdatedAt: statUpdatedAt(filePath),
          };
        }
      } catch {
        // WITHOUT ROWID 등 특수 테이블은 다음 후보로 넘어갑니다.
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch {}
  }
}

function readExactWalletBitcoin(filePath, accountId) {
  let db;
  try {
    if (!filePath || !accountId || !fs.existsSync(filePath)) return null;
    db = new DatabaseSync(filePath, { open: true, readOnly: true });
    db.exec("PRAGMA busy_timeout = 500;");

    const table = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = 'bitcoin_account_stats'
      LIMIT 1
    `).get();
    if (!table) return null;

    const row = db.prepare(`
      SELECT btc_balance, updated_at
      FROM bitcoin_account_stats
      WHERE account_id = ?
      LIMIT 1
    `).get(String(accountId));

    if (!row) {
      return {
        quantity: 0,
        sourcePath: filePath,
        sourceHint: 'SDBitcoinMiner:bitcoin_account_stats.btc_balance',
        localUpdatedAt: statUpdatedAt(filePath),
        exactAccount: true,
      };
    }

    const quantity = numberOrNull(row.btc_balance);
    if (quantity === null) return null;

    let roomCurrentBtc = null;
    try {
      const roomRow = db.prepare(`
        SELECT SUM(COALESCE(current_btc, 0)) AS total
        FROM bitcoin_rooms
        WHERE account_id = ?
      `).get(String(accountId));
      roomCurrentBtc = numberOrNull(roomRow?.total);
    } catch {
      roomCurrentBtc = null;
    }

    const updatedAt = String(row.updated_at || '').trim();
    const parsedUpdatedAt = updatedAt && !Number.isNaN(Date.parse(updatedAt))
      ? new Date(updatedAt).toISOString()
      : statUpdatedAt(filePath);

    return {
      quantity,
      sourcePath: filePath,
      sourceHint: 'SDBitcoinMiner:bitcoin_account_stats.btc_balance',
      localUpdatedAt: parsedUpdatedAt,
      exactAccount: true,
      roomCurrentBtc,
    };
  } catch (error) {
    const message = String(error?.message || error || "");
    if (/SQLITE_BUSY|database is locked|database table is locked/i.test(message)) {
      const busyError = new Error("SD지갑 BTC 데이터를 다른 앱이 사용 중입니다. 다음 동기화에서 다시 확인합니다.");
      busyError.code = "SQLITE_BUSY";
      throw busyError;
    }
    return null;
  } finally {
    try { db?.close(); } catch {}
  }
}

function likelyFile(filePath) {
  const lower = path.basename(filePath).toLowerCase();
  const ext = path.extname(lower);
  if (![".json", ".sqlite", ".db"].includes(ext)) return false;
  if (/(bitcoin|btc|mining|miner|save|state|data)/.test(lower)) return true;
  return ext === ".sqlite" || ext === ".db";
}

function collectRoots(walletDatabasePath) {
  const roots = new Set();
  let current = path.dirname(path.resolve(walletDatabasePath));
  for (let index = 0; index < 5; index += 1) {
    roots.add(current);
    roots.add(path.join(current, "apps"));
    roots.add(path.join(current, "data"));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return [...roots].filter((value) => {
    try { return fs.statSync(value).isDirectory(); } catch { return false; }
  });
}

function walk(root, maxDepth = 5, maxFiles = 800) {
  const output = [];
  const skip = new Set(["node_modules", ".git", "cache", "caches", "logs", "temp", "tmp", "assets"]);
  const queue = [{ dir: root, depth: 0 }];
  const seen = new Set();

  while (queue.length && output.length < maxFiles) {
    const { dir, depth } = queue.shift();
    let real;
    try { real = fs.realpathSync(dir); } catch { continue; }
    if (seen.has(real)) continue;
    seen.add(real);

    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth && !skip.has(entry.name.toLowerCase())) {
          queue.push({ dir: full, depth: depth + 1 });
        }
      } else if (entry.isFile() && likelyFile(full)) {
        output.push(full);
        if (output.length >= maxFiles) break;
      }
    }
  }
  return output;
}

function inspect(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return readJson(filePath);
  if (ext === ".sqlite" || ext === ".db") return readSqlite(filePath);
  return null;
}

function readBitcoinSnapshot({ walletDatabasePath, accountId, configuredPath }) {
  // SDBitcoinMiner는 선택한 SD지갑의 같은 SQLite 안에
  // 계좌별 보유 BTC를 bitcoin_account_stats.btc_balance로 저장합니다.
  // 이 값이 실제 판매 가능 보유량의 기준이므로 다른 BTC 컬럼보다 항상 우선합니다.
  const exact = readExactWalletBitcoin(walletDatabasePath, accountId);
  if (exact) return exact;

  // 구형/다른 채굴장 호환은 사용자가 직접 지정한 파일만 확인합니다.
  // 자동 동기화마다 상위 폴더를 재귀 탐색하면 디스크가 느린 PC에서 Electron
  // 메인 스레드가 수 초간 막혀 “응답 없음”이 발생할 수 있으므로 자동 탐색은 제거합니다.
  if (configuredPath) {
    const configured = inspect(configuredPath);
    if (configured) return configured;
  }

  return null;
}

module.exports = { readBitcoinSnapshot, inspectBitcoinSource: inspect, readExactWalletBitcoin };
