"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

class SyncState {
  constructor(userDataDirectory) {
    const directory = path.join(userDataDirectory, "sdlink");
    fs.mkdirSync(directory, { recursive: true });
    this.filePath = path.join(directory, "sync-state.sqlite");
    this.db = new DatabaseSync(this.filePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS processed_local (
        transaction_id TEXT PRIMARY KEY,
        processed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS applied_remote (
        server_transaction_id TEXT PRIMARY KEY,
        sync_seq INTEGER NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
  }

  getMeta(key, fallback = null) {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(String(key));
    return row ? row.value : fallback;
  }

  setMeta(key, value) {
    this.db.prepare(`
      INSERT INTO meta(key, value) VALUES(?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(key), String(value));
  }


  getProcessedLocalSet() {
    return new Set(
      this.db.prepare("SELECT transaction_id FROM processed_local").all()
        .map((row) => String(row.transaction_id)),
    );
  }

  isLocalProcessed(transactionId) {
    return Boolean(
      this.db.prepare("SELECT 1 FROM processed_local WHERE transaction_id = ?").get(String(transactionId)),
    );
  }

  markLocalProcessed(transactionId) {
    this.db.prepare(`
      INSERT OR IGNORE INTO processed_local(transaction_id, processed_at)
      VALUES(?, ?)
    `).run(String(transactionId), new Date().toISOString());
  }

  markManyLocalProcessed(transactionIds) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const statement = this.db.prepare(`
        INSERT OR IGNORE INTO processed_local(transaction_id, processed_at)
        VALUES(?, ?)
      `);
      const now = new Date().toISOString();
      for (const id of transactionIds) {
        statement.run(String(id), now);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  isRemoteApplied(serverTransactionId) {
    return Boolean(
      this.db.prepare("SELECT 1 FROM applied_remote WHERE server_transaction_id = ?")
        .get(String(serverTransactionId)),
    );
  }

  markRemoteApplied(serverTransactionId, syncSeq) {
    this.db.prepare(`
      INSERT OR IGNORE INTO applied_remote(server_transaction_id, sync_seq, applied_at)
      VALUES(?, ?, ?)
    `).run(String(serverTransactionId), Number(syncSeq), new Date().toISOString());
  }

  clearSynchronizationMarks() {
    this.db.exec(`
      DELETE FROM processed_local;
      DELETE FROM applied_remote;
      DELETE FROM meta;
    `);
  }

  close() {
    this.db.close();
  }
}

module.exports = { SyncState };
