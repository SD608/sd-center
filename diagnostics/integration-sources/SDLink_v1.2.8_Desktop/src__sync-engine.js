"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readBitcoinSnapshot } = require("./bitcoin-reader");
const {
  applyRemoteTransaction,
  backupDatabase,
  fingerprintAccount,
  getAccount,
  listTransactionIds,
  listTransactions,
  recordSyntheticTransaction,
  setAccountBalance,
  signedAmount,
} = require("./wallet-db");

function detectCenterVersion() {
  const centerRoot = String(process.env.SD_CENTER_ROOT || "").trim();
  if (!centerRoot) return "0.0.0";
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(centerRoot, "package.json"), "utf8"));
    return String(parsed?.version || "0.0.0");
  } catch {
    return "0.0.0";
  }
}

function unwrapJson(value) {
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === "object") {
    return value[0];
  }
  return value;
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function classifySource(memo) {
  const text = String(memo || "");
  if (text.includes("SD비트코인") || text.includes("BTC")) return "sd_bitcoin";
  if (text.includes("SD광부") || text.includes("광물") || text.includes("채굴 판매")) return "sd_miner";
  if (text.includes("SD슬롯")) return "sd_slot";
  if (text.includes("홀짝")) return "sd_odd_even";
  if (text.includes("SD묵찌빠")) return "sd_mukjippa";
  if (text.includes("STA")) return "sta_operation";
  if (text.includes("물류") || text.includes("SD 기사")) return "sd_logistics";
  if (text.includes("금고") || text.includes("금괴")) return "sd_vault";
  return "sd_wallet";
}

function isInternalNonPushTransaction(transaction) {
  const id = String(transaction?.id || "");
  const memo = String(transaction?.memo || "");
  // sdlink-local-* 은 거래기록을 남기지 않고 잔액만 바꾸는 구형 앱을
  // 서버에 전달하기 위해 만든 합법적인 차액 거래이므로 전송합니다.
  if (id.startsWith("sdlink-local-")) return false;
  if (id.startsWith("sdlink-remote-")) return true;
  if (id.startsWith("sdlink-")) return true;
  return memo === "SD Link 서버 최종 잔액 보정" ||
    memo === "SD Link 최초 온라인 계정 연결";
}

class SyncEngine {
  constructor({ authService, configStore, syncState, userDataDirectory, onStatus }) {
    this.auth = authService;
    this.configStore = configStore;
    this.syncState = syncState;
    this.backupDirectory = path.join(userDataDirectory, "sdlink", "backups");
    this.onStatus = typeof onStatus === "function" ? onStatus : () => {};
    this.centerVersion = detectCenterVersion();
    this.running = false;
  }

  status(message, kind = "info") {
    this.onStatus({ message, kind, at: new Date().toISOString() });
  }

  requireLocalConfig() {
    const config = this.configStore.load();
    if (!config.databasePath || !config.selectedAccountId) {
      throw new Error("먼저 로컬 SD지갑 데이터베이스와 계좌를 선택하세요.");
    }
    return config;
  }

  async registerDevice() {
    const config = this.requireLocalConfig();
    const account = getAccount(config.databasePath, config.selectedAccountId);
    const fingerprint = fingerprintAccount(account);
    const response = unwrapJson(await this.auth.rpc("register_sd_link_device", {
      p_device_key: config.deviceKey,
      p_device_name: config.deviceName,
      p_wallet_fingerprint: fingerprint,
      p_previous_account_number: account.accountNumber,
    }));
    const session = await this.auth.requireSession();
    const updated = this.configStore.update({
      linkedOnlineUserId: session.user.id,
      linkedOnlineEmail: session.email,
      walletFingerprint: fingerprint,
      migrationStatus: String(response?.migration_status || ""),
      migrationId: String(response?.migration_id || ""),
    });
    this.status("이 PC가 홈페이지 계정의 연결 기기로 등록되었습니다.", "success");
    return { config: updated, account, server: response };
  }

  async requestMigration() {
    const config = this.requireLocalConfig();
    const account = getAccount(config.databasePath, config.selectedAccountId);
    const fingerprint = fingerprintAccount(account);
    const response = unwrapJson(await this.auth.rpc("request_sd_wallet_migration", {
      p_local_wallet_fingerprint: fingerprint,
      p_previous_account_number: account.accountNumber,
      p_local_username: account.username,
      p_local_owner_name: account.ownerName,
      p_migrated_balance: account.balance,
      p_source_summary: {
        app: "SD Link",
        version: "1.2.3",
        bank_name: account.bankName,
        account_id_hash: fingerprint.slice(0, 16),
        local_transaction_count: listTransactionIds(config.databasePath, account.id).length,
      },
    }));
    const updated = this.configStore.update({
      walletFingerprint: fingerprint,
      migrationId: String(response?.migration_id || ""),
      migrationStatus: String(response?.status || ""),
    });
    this.status(String(response?.message || "잔액 이전 신청을 접수했습니다."), "success");
    return { config: updated, response };
  }

  async snapshot() {
    const config = this.requireLocalConfig();
    const response = unwrapJson(await this.auth.rpc("get_sd_link_snapshot", {
      p_device_key: config.deviceKey,
    }));
    const updated = this.configStore.update({
      migrationStatus: String(response?.migration_status || ""),
      migrationId: String(response?.migration_id || ""),
    });
    return { config: updated, snapshot: response };
  }

  async activate(config, snapshot) {
    const account = getAccount(config.databasePath, config.selectedAccountId);
    const backupPath = backupDatabase(config.databasePath, this.backupDirectory);

    // 최초 이전 승인 전까지의 로컬 거래는 서버에 잔액으로 이미 합산되었으므로 재전송하지 않습니다.
    this.syncState.markManyLocalProcessed(
      listTransactionIds(config.databasePath, account.id),
    );

    const serverBalance = asNumber(snapshot.wallet_balance);
    const adjustment = setAccountBalance(
      config.databasePath,
      account.id,
      serverBalance,
      "SD Link 최초 온라인 계정 연결",
    );
    if (adjustment?.id) this.syncState.markLocalProcessed(adjustment.id);

    const latestSeq = asNumber(snapshot.latest_sync_seq);
    this.syncState.setMeta("server_cursor", latestSeq);
    this.syncState.setMeta("expected_local_balance", serverBalance);
    this.syncState.setMeta("activation_backup", backupPath);
    this.syncState.setMeta("activated_at", new Date().toISOString());

    const updated = this.configStore.update({
      activated: true,
      lastServerCursor: latestSeq,
      lastExpectedLocalBalance: serverBalance,
      migrationStatus: "completed",
    });
    this.status("잔액 이전 승인 완료: PC·홈페이지·모바일 동기화를 시작했습니다.", "success");
    return updated;
  }

  async pushLocalTransactions(config, expectedBalance) {
    const account = getAccount(config.databasePath, config.selectedAccountId);
    let allTransactions = listTransactions(config.databasePath, account.id);

    // processed_local을 거래마다 SQLite 조회/INSERT하면 거래가 누적될수록
    // Electron 메인 스레드가 오래 막힙니다. 한 번에 Set으로 읽고,
    // 새 내부 거래만 묶어서 기록합니다.
    let processedLocal = this.syncState.getProcessedLocalSet();
    const internalUnmarked = allTransactions
      .filter((transaction) =>
        isInternalNonPushTransaction(transaction) && !processedLocal.has(transaction.id))
      .map((transaction) => transaction.id);
    if (internalUnmarked.length > 0) {
      this.syncState.markManyLocalProcessed(internalUnmarked);
      for (const id of internalUnmarked) processedLocal.add(id);
    }

    // SD Link가 과거 버전에서 직접 만든 보정/원격 반영 거래는 절대 서버로
    // 되돌려 보내지 않습니다. sync-state가 초기화된 경우에도 echo loop를 차단합니다.
    let pending = allTransactions.filter((transaction) =>
      !processedLocal.has(transaction.id) &&
      !isInternalNonPushTransaction(transaction),
    );

    const pendingNet = pending.reduce((sum, transaction) => sum + signedAmount(transaction), 0);
    const unexplainedDifference = account.balance - (expectedBalance + pendingNet);
    if (unexplainedDifference !== 0) {
      const syntheticId = recordSyntheticTransaction(
        config.databasePath,
        account.id,
        unexplainedDifference,
        "SD Link: 다른 로컬 앱의 잔액 변경 감지",
      );
      if (syntheticId) {
        allTransactions = listTransactions(config.databasePath, account.id);
        processedLocal = this.syncState.getProcessedLocalSet();
        pending = allTransactions.filter((transaction) =>
          !processedLocal.has(transaction.id) &&
          !isInternalNonPushTransaction(transaction),
        );
      }
    }

    let pushed = 0;
    let latestServerBalance = expectedBalance;
    const rejected = [];
    for (const transaction of pending) {
      try {
        const response = unwrapJson(await this.auth.rpc("push_sd_link_transaction", {
          p_device_key: config.deviceKey,
          p_local_transaction_id: transaction.id,
          p_transaction_type: transaction.transactionType,
          p_description: transaction.memo ||
            (transaction.transactionType === "withdraw" ? "PC 로컬 출금" : "PC 로컬 입금"),
          p_amount: signedAmount(transaction),
          p_local_created_at: transaction.createdAt || new Date().toISOString(),
          p_metadata: {
            local_account_id: account.id,
            source_app: classifySource(transaction.memo),
            local_memo: transaction.memo || "",
            sd_link_version: "1.2.4",
            center_version: this.centerVersion,
          },
        }));
        this.syncState.markLocalProcessed(transaction.id);
        latestServerBalance = asNumber(response?.balance_after, latestServerBalance);
        pushed += 1;
      } catch (error) {
        const message = String(error?.message || "");
        if (message.includes("온라인 가상잔액이 부족합니다")) {
          // 잔액 부족 거래 한 건이 전체 동기화를 영구적으로 막지 않도록 취소 처리합니다.
          // 마지막 서버 잔액 보정 단계에서 PC 잔액도 서버 기준으로 복구됩니다.
          this.syncState.markLocalProcessed(transaction.id);
          rejected.push({
            id: transaction.id,
            amount: signedAmount(transaction),
            memo: transaction.memo || "PC 로컬 출금",
          });
          continue;
        }
        throw error;
      }
    }
    return { pushed, rejected, latestServerBalance };
  }

  async pullRemoteTransactions(config, initialCursor) {
    let cursor = Math.max(0, asNumber(initialCursor));
    let pulled = 0;
    let latestBalance = null;

    while (true) {
      const rows = await this.auth.rpc("pull_sd_link_transactions", {
        p_device_key: config.deviceKey,
        p_after_seq: cursor,
        p_limit: 200,
      });
      const transactions = Array.isArray(rows) ? rows : [];
      if (transactions.length === 0) break;

      for (const remote of transactions) {
        const seq = asNumber(remote.sync_seq, cursor);
        const transactionId = String(remote.transaction_id || remote.id || "");
        const metadata = safeMetadata(remote.metadata);
        const ownTransaction =
          metadata.sd_link_device_key === config.deviceKey &&
          Boolean(metadata.sd_link_local_transaction_id);

        if (!this.syncState.isRemoteApplied(transactionId)) {
          if (ownTransaction) {
            // 이 거래는 이미 PC 앱이 로컬 지갑에 반영한 뒤 서버로 보낸 거래입니다.
            // 서버의 balance_after를 로컬에 절대값으로 다시 쓰면 그 사이 STA/광산 등
            // 다른 앱이 만든 최신 수익을 덮어쓸 수 있으므로 잔액은 건드리지 않습니다.
          } else {
            const applied = applyRemoteTransaction(
              config.databasePath,
              config.selectedAccountId,
              remote,
            );
            if (applied?.localId) this.syncState.markLocalProcessed(applied.localId);
          }
          this.syncState.markRemoteApplied(transactionId, seq);
          pulled += 1;
        }
        latestBalance = asNumber(remote.balance_after, latestBalance ?? 0);
        cursor = Math.max(cursor, seq);
      }
      if (transactions.length < 200) break;
    }

    this.syncState.setMeta("server_cursor", cursor);
    return { pulled, cursor, latestBalance };
  }


  async syncBitcoinSnapshot(config) {
    try {
      const snapshot = readBitcoinSnapshot({
        walletDatabasePath: config.databasePath,
        accountId: config.selectedAccountId,
        configuredPath: config.bitcoinSourcePath || "",
      });
      if (!snapshot) {
        return { found: false };
      }

      const response = unwrapJson(await this.auth.rpc("upsert_sd_bitcoin_snapshot", {
        p_device_key: config.deviceKey,
        p_btc_quantity: snapshot.quantity,
        p_source_hint: snapshot.sourceHint,
        p_local_updated_at: snapshot.localUpdatedAt,
      }));

      this.configStore.update({
        bitcoinSourcePath: snapshot.sourcePath,
        lastBitcoinQuantity: snapshot.quantity,
        lastBitcoinSyncAt: new Date().toISOString(),
        lastBitcoinSourceHint: snapshot.sourceHint || "",
      });

      return {
        found: true,
        quantity: snapshot.quantity,
        sourcePath: snapshot.sourcePath,
        response,
      };
    } catch (error) {
      return {
        found: false,
        error: String(error?.message || error),
      };
    }
  }

  async syncOnce() {
    if (this.running) {
      return { skipped: true, message: "이미 동기화 중입니다." };
    }
    this.running = true;
    try {
      this.status("온라인 계정과 동기화 중입니다.");
      let { config, snapshot } = await this.snapshot();
      if (snapshot?.migration_status !== "completed") {
        const message = snapshot?.migration_status === "pending"
          ? "기존 잔액 이전이 관리자 승인 대기 중입니다."
          : "먼저 기존 로컬 잔액 이전을 신청하세요.";
        this.configStore.update({ lastSyncAt: new Date().toISOString(), lastSyncMessage: message });
        this.status(message, "warning");
        return { waiting: true, snapshot, message };
      }

      if (!config.activated) {
        config = await this.activate(config, snapshot);
      }

      const expectedBalance = asNumber(
        this.syncState.getMeta(
          "expected_local_balance",
          config.lastExpectedLocalBalance ?? snapshot.wallet_balance,
        ),
      );
      const cursor = asNumber(
        this.syncState.getMeta("server_cursor", config.lastServerCursor || 0),
      );

      const pushResult = await this.pushLocalTransactions(config, expectedBalance);
      const pullResult = await this.pullRemoteTransactions(config, cursor);
      ({ snapshot } = await this.snapshot());
      const bitcoinResult = await this.syncBitcoinSnapshot(config);

      const serverBalance = asNumber(snapshot.wallet_balance);

      // v1.2.4: 정기 동기화에서는 서버 잔액을 로컬에 절대값으로 강제 보정하지 않습니다.
      // 동기화 도중 다른 PC 앱(STA, SD광부, 물류센터 등)이 새 수익을 만들 수 있기 때문에
      // 강제 보정은 정상 수익을 삭제하는 데이터 손실을 만들 수 있습니다.
      // 새 로컬 변경은 그대로 보존하고 다음 주기에 거래 단위로 서버에 반영합니다.
      this.syncState.setMeta("expected_local_balance", serverBalance);
      const now = new Date().toISOString();
      const rejectedCount = Array.isArray(pushResult.rejected) ? pushResult.rejected.length : 0;
      const rejectedText = rejectedCount > 0
        ? ` / 잔액 부족 출금 ${rejectedCount}건 취소`
        : "";
      const bitcoinText = bitcoinResult.found
        ? ` / BTC ${Number(bitcoinResult.quantity).toLocaleString("ko-KR", { maximumFractionDigits: 8 })} 동기화`
        : bitcoinResult.error
          ? " / BTC 동기화 건너뜀"
          : " / BTC 원본 미감지";
      const message = `완료 · PC ${pushResult.pushed}건 전송 / 온라인 ${pullResult.pulled}건 반영${rejectedText}${bitcoinText}`;
      const updated = this.configStore.update({
        activated: true,
        lastServerCursor: pullResult.cursor,
        lastExpectedLocalBalance: serverBalance,
        lastSyncAt: now,
        lastSyncMessage: message,
        migrationStatus: String(snapshot.migration_status || "completed"),
      });
      this.status(message, "success");
      return {
        ok: true,
        config: updated,
        snapshot,
        pushed: pushResult.pushed,
        pulled: pullResult.pulled,
      };
    } catch (error) {
      const raw = String(error?.message || "동기화에 실패했습니다.");
      const busy = /SQLITE_BUSY|database is locked|database table is locked/i.test(raw);
      const message = busy
        ? "SD지갑을 다른 앱이 사용 중입니다. 이번 동기화는 건너뛰고 다음 주기에 자동 재시도합니다."
        : raw;
      this.configStore.update({
        lastSyncAt: new Date().toISOString(),
        lastSyncMessage: message,
      });
      this.status(message, busy ? "warning" : "error");
      if (busy) return { skipped: true, busy: true, message };
      throw error;
    } finally {
      this.running = false;
    }
  }
}

module.exports = { SyncEngine };
