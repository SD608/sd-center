"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  MAX_STREAK,
  calculateReward,
  createComputerCommitment,
  normalizeBet,
  normalizeMove,
  verifyComputerCommitment,
  winnerOfDifferentMoves,
} = require("./game-engine");

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
    CREATE TABLE IF NOT EXISTS sd_mukjippa_sessions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      stake INTEGER NOT NULL CHECK(stake >= 100),
      streak INTEGER NOT NULL DEFAULT 0 CHECK(streak BETWEEN 0 AND 8),
      potential_payout INTEGER NOT NULL DEFAULT 0 CHECK(potential_payout >= 0),
      status TEXT NOT NULL CHECK(status IN ('active','cashed_out','lost')),
      phase TEXT NOT NULL CHECK(phase IN ('rps','mjp','decision','complete')),
      attacker TEXT CHECK(attacker IS NULL OR attacker IN ('player','computer')),
      hand_number INTEGER NOT NULL DEFAULT 1 CHECK(hand_number >= 1),
      computer_move TEXT,
      computer_nonce TEXT,
      computer_commitment TEXT,
      result TEXT,
      paid_transaction_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      ended_at TEXT,
      FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sd_mukjippa_one_active
      ON sd_mukjippa_sessions(account_id) WHERE status='active';
    CREATE INDEX IF NOT EXISTS idx_sd_mukjippa_sessions_account_created
      ON sd_mukjippa_sessions(account_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS sd_mukjippa_hands (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      hand_number INTEGER NOT NULL,
      phase_before TEXT NOT NULL,
      attacker_before TEXT,
      player_move TEXT NOT NULL,
      computer_move TEXT NOT NULL,
      comparison TEXT NOT NULL,
      attacker_after TEXT,
      match_result TEXT,
      commitment TEXT NOT NULL,
      nonce TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sd_mukjippa_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sd_mukjippa_hands_session
      ON sd_mukjippa_hands(session_id, hand_number DESC);
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

function publicSession(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    stake: Number(row.stake),
    streak: Number(row.streak),
    potentialPayout: Number(row.potential_payout),
    status: String(row.status),
    phase: String(row.phase),
    attacker: row.attacker ? String(row.attacker) : null,
    handNumber: Number(row.hand_number),
    commitment: row.computer_commitment ? String(row.computer_commitment) : "",
    result: row.result ? String(row.result) : "",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    endedAt: row.ended_at ? String(row.ended_at) : null,
  };
}

function publicHand(row) {
  return {
    id: String(row.id),
    handNumber: Number(row.hand_number),
    phaseBefore: String(row.phase_before),
    attackerBefore: row.attacker_before ? String(row.attacker_before) : null,
    playerMove: String(row.player_move),
    computerMove: String(row.computer_move),
    comparison: String(row.comparison),
    attackerAfter: row.attacker_after ? String(row.attacker_after) : null,
    matchResult: row.match_result ? String(row.match_result) : null,
    commitment: String(row.commitment),
    nonce: String(row.nonce),
    createdAt: String(row.created_at),
  };
}

function listAccounts(databasePath) {
  const db = openDatabase(databasePath, false);
  try {
    ensureSchema(db);
    return db.prepare(`
      SELECT accounts.id, accounts.bank_name, accounts.account_number,
             accounts.owner_name, accounts.balance, accounts.updated_at, users.username
      FROM accounts LEFT JOIN users ON users.id=accounts.user_id
      ORDER BY accounts.updated_at DESC
    `).all().map(mapAccount);
  } finally { db.close(); }
}

function getAccount(databasePath, accountId) {
  const db = openDatabase(databasePath, false);
  try {
    ensureSchema(db);
    const row = db.prepare(`
      SELECT accounts.id, accounts.bank_name, accounts.account_number,
             accounts.owner_name, accounts.balance, accounts.updated_at, users.username
      FROM accounts LEFT JOIN users ON users.id=accounts.user_id WHERE accounts.id=?
    `).get(accountId);
    return row ? mapAccount(row) : null;
  } finally { db.close(); }
}

function getRecentTransactions(databasePath, accountId, limit = 12) {
  const db = openDatabase(databasePath, true);
  try {
    return db.prepare(`
      SELECT id, transaction_type, amount, memo, created_at
      FROM transactions WHERE account_id=? ORDER BY created_at DESC LIMIT ?
    `).all(accountId, Math.min(30, Math.max(1, Math.trunc(limit)))).map((row) => ({
      id: String(row.id), type: String(row.transaction_type), amount: Number(row.amount),
      memo: String(row.memo), createdAt: String(row.created_at),
    }));
  } finally { db.close(); }
}

function activeSessionRow(db, accountId) {
  return db.prepare(`SELECT * FROM sd_mukjippa_sessions WHERE account_id=? AND status='active' ORDER BY created_at DESC LIMIT 1`).get(accountId);
}

function getGameState(databasePath, accountId) {
  const db = openDatabase(databasePath, false);
  try {
    ensureSchema(db);
    const session = activeSessionRow(db, accountId);
    const hands = session ? db.prepare(`SELECT * FROM sd_mukjippa_hands WHERE session_id=? ORDER BY hand_number DESC LIMIT 20`)
      .all(session.id).map(publicHand) : [];
    const history = db.prepare(`
      SELECT id, stake, streak, potential_payout, status, result, created_at, ended_at
      FROM sd_mukjippa_sessions WHERE account_id=? AND status!='active'
      ORDER BY COALESCE(ended_at, updated_at) DESC LIMIT 12
    `).all(accountId).map((row) => ({
      id: String(row.id), stake: Number(row.stake), streak: Number(row.streak),
      payout: row.status === "cashed_out" ? Number(row.potential_payout) : 0,
      status: String(row.status), result: String(row.result || ""),
      createdAt: String(row.created_at), endedAt: row.ended_at ? String(row.ended_at) : null,
    }));
    const stats = db.prepare(`
      SELECT COUNT(*) AS games,
             SUM(CASE WHEN status='cashed_out' THEN 1 ELSE 0 END) AS wins,
             SUM(CASE WHEN status='lost' THEN 1 ELSE 0 END) AS losses,
             COALESCE(MAX(streak),0) AS best_streak,
             COALESCE(SUM(stake),0) AS total_stake,
             COALESCE(SUM(CASE WHEN status='cashed_out' THEN potential_payout ELSE 0 END),0) AS total_payout
      FROM sd_mukjippa_sessions WHERE account_id=? AND status!='active'
    `).get(accountId);
    return {
      session: publicSession(session), hands, history,
      stats: {
        games: Number(stats.games || 0), wins: Number(stats.wins || 0), losses: Number(stats.losses || 0),
        bestStreak: Number(stats.best_streak || 0), totalStake: Number(stats.total_stake || 0),
        totalPayout: Number(stats.total_payout || 0),
      },
    };
  } finally { db.close(); }
}

function startSession({ databasePath, accountId, betAmount }) {
  const stake = normalizeBet(betAmount);
  const db = openDatabase(databasePath, false);
  try {
    ensureSchema(db);
    db.exec("BEGIN IMMEDIATE");
    if (activeSessionRow(db, accountId)) throw new Error("이 계좌에는 진행 중인 묵찌빠가 있습니다.");
    const account = db.prepare("SELECT id,balance FROM accounts WHERE id=?").get(accountId);
    if (!account) throw new Error("연결 계좌를 찾을 수 없습니다.");
    if (Number(account.balance) < stake) throw new Error(`잔액이 부족합니다. ${stake.toLocaleString("ko-KR")}원이 필요합니다.`);

    const id = crypto.randomUUID();
    const handNumber = 1;
    const computer = createComputerCommitment({ sessionId: id, handNumber });
    const now = new Date().toISOString();
    const nextBalance = Number(account.balance) - stake;
    const transactionId = crypto.randomUUID();
    db.prepare("UPDATE accounts SET balance=?, updated_at=? WHERE id=?").run(nextBalance, now, accountId);
    db.prepare(`INSERT INTO transactions (id,account_id,transaction_type,amount,memo,created_at) VALUES (?,?,'withdraw',?,?,?)`)
      .run(transactionId, accountId, stake, "SD묵찌빠 도전금", now);
    db.prepare(`
      INSERT INTO sd_mukjippa_sessions (
        id,account_id,stake,streak,potential_payout,status,phase,attacker,
        hand_number,computer_move,computer_nonce,computer_commitment,created_at,updated_at
      ) VALUES (?,?,?,0,0,'active','rps',NULL,?,?,?,?,?,?)
    `).run(id, accountId, stake, handNumber, computer.move, computer.nonce, computer.commitment, now, now);
    db.exec("COMMIT");
    return { session: getSessionById(databasePath, id), balance: nextBalance, transactionId };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally { db.close(); }
}

function getSessionById(databasePath, sessionId) {
  const db = openDatabase(databasePath, false);
  try { ensureSchema(db); return publicSession(db.prepare("SELECT * FROM sd_mukjippa_sessions WHERE id=?").get(sessionId)); }
  finally { db.close(); }
}

function nextComputerFor(sessionId, handNumber) {
  return createComputerCommitment({ sessionId, handNumber });
}

function playHand({ databasePath, accountId, sessionId, playerMove }) {
  const selected = normalizeMove(playerMove);
  const db = openDatabase(databasePath, false);
  try {
    ensureSchema(db);
    db.exec("BEGIN IMMEDIATE");
    const session = db.prepare("SELECT * FROM sd_mukjippa_sessions WHERE id=? AND account_id=?").get(sessionId, accountId);
    if (!session || session.status !== "active") throw new Error("진행 중인 게임을 찾을 수 없습니다.");
    if (!["rps", "mjp"].includes(session.phase)) throw new Error("현재는 손을 선택할 단계가 아닙니다.");
    if (!session.computer_move || !session.computer_nonce || !session.computer_commitment) throw new Error("컴퓨터 선택 정보가 손상되었습니다.");
    const verified = verifyComputerCommitment({
      sessionId: session.id, handNumber: session.hand_number, move: session.computer_move,
      nonce: session.computer_nonce, commitment: session.computer_commitment,
    });
    if (!verified) throw new Error("컴퓨터 선택 검증에 실패했습니다.");

    const now = new Date().toISOString();
    const phaseBefore = session.phase;
    const attackerBefore = session.attacker || null;
    const comparison = winnerOfDifferentMoves(selected, session.computer_move);
    let phase = session.phase;
    let attacker = attackerBefore;
    let status = "active";
    let streak = Number(session.streak);
    let potentialPayout = Number(session.potential_payout);
    let result = session.result || null;
    let endedAt = null;
    let matchResult = null;
    let paidTransactionId = session.paid_transaction_id || null;
    let balance = null;
    let autoCashedOut = false;

    if (phaseBefore === "rps") {
      if (comparison === "tie") {
        phase = "rps";
        attacker = null;
      } else {
        phase = "mjp";
        attacker = comparison;
      }
    } else if (selected === session.computer_move) {
      matchResult = attackerBefore === "player" ? "player_win" : "computer_win";
      if (matchResult === "player_win") {
        streak += 1;
        potentialPayout = calculateReward(session.stake, streak);
        if (streak >= MAX_STREAK) {
          const account = db.prepare("SELECT id,balance FROM accounts WHERE id=?").get(accountId);
          if (!account) throw new Error("연결 계좌를 찾을 수 없습니다.");
          balance = Number(account.balance) + potentialPayout;
          paidTransactionId = crypto.randomUUID();
          db.prepare("UPDATE accounts SET balance=?,updated_at=? WHERE id=?").run(balance, now, accountId);
          db.prepare(`INSERT INTO transactions (id,account_id,transaction_type,amount,memo,created_at) VALUES (?,?,'deposit',?,?,?)`)
            .run(paidTransactionId, accountId, potentialPayout, `SD묵찌빠 8연승 자동 정산 (${streak}연승)`, now);
          status = "cashed_out";
          phase = "complete";
          result = "max_streak";
          endedAt = now;
          autoCashedOut = true;
        } else {
          phase = "decision";
          result = "player_win";
        }
      } else {
        status = "lost";
        phase = "complete";
        potentialPayout = 0;
        result = "streak_lost";
        endedAt = now;
      }
    } else {
      attacker = comparison;
      phase = "mjp";
    }

    const historyId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO sd_mukjippa_hands (
        id,session_id,hand_number,phase_before,attacker_before,player_move,computer_move,
        comparison,attacker_after,match_result,commitment,nonce,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      historyId, session.id, session.hand_number, phaseBefore, attackerBefore,
      selected, session.computer_move, comparison, attacker, matchResult,
      session.computer_commitment, session.computer_nonce, now,
    );

    const nextHandNumber = Number(session.hand_number) + 1;
    let next = { move: null, nonce: null, commitment: null };
    if (status === "active" && ["rps", "mjp"].includes(phase)) next = nextComputerFor(session.id, nextHandNumber);

    db.prepare(`
      UPDATE sd_mukjippa_sessions SET
        streak=?, potential_payout=?, status=?, phase=?, attacker=?, hand_number=?,
        computer_move=?, computer_nonce=?, computer_commitment=?, result=?, paid_transaction_id=?,
        updated_at=?, ended_at=? WHERE id=?
    `).run(
      streak, potentialPayout, status, phase, attacker, nextHandNumber,
      next.move, next.nonce, next.commitment, result, paidTransactionId,
      now, endedAt, session.id,
    );
    db.exec("COMMIT");

    return {
      session: getSessionById(databasePath, session.id),
      reveal: {
        handNumber: Number(session.hand_number), playerMove: selected, computerMove: String(session.computer_move),
        nonce: String(session.computer_nonce), commitment: String(session.computer_commitment), verified,
        phaseBefore, attackerBefore, comparison, attackerAfter: attacker, matchResult,
      },
      balance, autoCashedOut,
    };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally { db.close(); }
}

function continueStreak({ databasePath, accountId, sessionId }) {
  const db = openDatabase(databasePath, false);
  try {
    ensureSchema(db);
    db.exec("BEGIN IMMEDIATE");
    const session = db.prepare("SELECT * FROM sd_mukjippa_sessions WHERE id=? AND account_id=?").get(sessionId, accountId);
    if (!session || session.status !== "active" || session.phase !== "decision") throw new Error("연승 도전을 계속할 수 없는 상태입니다.");
    const handNumber = Number(session.hand_number);
    const next = nextComputerFor(session.id, handNumber);
    const now = new Date().toISOString();
    db.prepare(`UPDATE sd_mukjippa_sessions SET phase='rps',attacker=NULL,hand_number=?,computer_move=?,computer_nonce=?,computer_commitment=?,result=NULL,updated_at=? WHERE id=?`)
      .run(handNumber, next.move, next.nonce, next.commitment, now, session.id);
    db.exec("COMMIT");
    return { session: getSessionById(databasePath, session.id) };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally { db.close(); }
}

function cashOut({ databasePath, accountId, sessionId }) {
  const db = openDatabase(databasePath, false);
  try {
    ensureSchema(db);
    db.exec("BEGIN IMMEDIATE");
    const session = db.prepare("SELECT * FROM sd_mukjippa_sessions WHERE id=? AND account_id=?").get(sessionId, accountId);
    if (!session) throw new Error("게임 정보를 찾을 수 없습니다.");
    if (session.status === "cashed_out") {
      const account = db.prepare("SELECT balance FROM accounts WHERE id=?").get(accountId);
      db.exec("COMMIT");
      return { alreadyPaid: true, payout: Number(session.potential_payout), balance: Number(account?.balance || 0), session: publicSession(session) };
    }
    if (session.status !== "active" || session.phase !== "decision" || Number(session.streak) < 1) throw new Error("현재 정산할 수 있는 보상이 없습니다.");
    const account = db.prepare("SELECT id,balance FROM accounts WHERE id=?").get(accountId);
    if (!account) throw new Error("연결 계좌를 찾을 수 없습니다.");
    const payout = Number(session.potential_payout);
    const balance = Number(account.balance) + payout;
    const transactionId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare("UPDATE accounts SET balance=?,updated_at=? WHERE id=?").run(balance, now, accountId);
    db.prepare(`INSERT INTO transactions (id,account_id,transaction_type,amount,memo,created_at) VALUES (?,?,'deposit',?,?,?)`)
      .run(transactionId, accountId, payout, `SD묵찌빠 연승 정산 (${session.streak}연승)`, now);
    db.prepare(`UPDATE sd_mukjippa_sessions SET status='cashed_out',phase='complete',result='cashout',paid_transaction_id=?,updated_at=?,ended_at=? WHERE id=?`)
      .run(transactionId, now, now, session.id);
    db.exec("COMMIT");
    return { alreadyPaid: false, payout, balance, transactionId, session: getSessionById(databasePath, session.id) };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally { db.close(); }
}

function uniqueExisting(paths) {
  const seen = new Set();
  return paths.filter((candidate) => {
    if (!candidate) return false;
    const normalized = path.resolve(candidate).toLowerCase();
    if (seen.has(normalized) || !fs.existsSync(candidate)) return false;
    seen.add(normalized); return true;
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
  } catch {}
  return null;
}

module.exports = {
  autoFindWalletDatabase,
  cashOut,
  continueStreak,
  getAccount,
  getGameState,
  getRecentTransactions,
  getSessionById,
  listAccounts,
  playHand,
  startSession,
  validateWalletDatabase,
};
