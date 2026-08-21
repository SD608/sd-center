"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { patchIntegratedSdLinkCoreRuntime, semanticFromLegacyAmount, stableCoreEventId } = require("./sdlink-core-runtime");

async function main() {
  assert.deepEqual(semanticFromLegacyAmount(100), { type: "reward", amount: 100 });
  assert.deepEqual(semanticFromLegacyAmount(-200), { type: "spend", amount: 200 });
  assert.throws(() => semanticFromLegacyAmount(0));

  const meta = new Map();
  const syncState = {
    getMeta(key, fallback = "") { return meta.has(key) ? meta.get(key) : fallback; },
    setMeta(key, value) { meta.set(key, value); },
  };
  const stableA = stableCoreEventId(syncState, "a".repeat(64), "local-1");
  const stableB = stableCoreEventId(syncState, "a".repeat(64), "local-1");
  assert.equal(stableA, stableB);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sdlink-core-runtime-"));
  try {
    fs.mkdirSync(path.join(temp, "src"), { recursive: true });
    fs.writeFileSync(path.join(temp, "src", "sync-engine.js"), `
class SyncEngine {
  constructor({ auth, syncState }) { this.auth = auth; this.syncState = syncState; }
  async pushLocalTransactions(config) {
    try {
      const response = await this.auth.rpc("push_sd_link_transaction", {
        p_device_key: config.deviceKey,
        p_local_transaction_id: config.localId || "tx-1",
        p_transaction_type: config.signedAmount > 0 ? "deposit" : "withdraw",
        p_description: "runtime bridge test",
        p_amount: config.signedAmount,
        p_metadata: { from_original_engine: true },
      });
      return { pushed: 1, response };
    } catch (error) {
      if (String(error.message).includes("온라인 가상잔액이 부족합니다")) {
        return { pushed: 0, rejected: 1 };
      }
      throw error;
    }
  }
  async pullRemoteTransactions(config, cursor) {
    const rows = await this.auth.rpc("pull_sd_link_transactions", { p_after_seq: cursor, p_limit: 200, p_device_key: config.deviceKey });
    return { pulled: rows.length, cursor: rows.length ? rows[rows.length - 1].sync_seq : cursor, rows };
  }
}
module.exports = { SyncEngine };
`, "utf8");

    process.env.SD_CENTER_LINK_INTEGRATED = "1";
    const patched = patchIntegratedSdLinkCoreRuntime(temp);
    assert.equal(patched.ok, true);
    assert.equal(patched.patched, true);
    assert.equal(patchIntegratedSdLinkCoreRuntime(temp).reason, "already-patched");

    const { SyncEngine } = require(path.join(temp, "src", "sync-engine.js"));
    const calls = [];
    let failSpend = false;
    let failUnavailable = false;
    const originalRpcFunction = async function rpc(name, body) {
      calls.push({ name, body });
      if (name === "sd_core_register_device") {
        if (failUnavailable) {
          const e = new Error("Could not find the function public.sd_core_register_device in the schema cache");
          e.code = "PGRST202";
          throw e;
        }
        return { device_id: "11111111-1111-4111-8111-111111111111" };
      }
      if (name === "sd_core_apply_sd_link_event") {
        if (failSpend) {
          const error = new Error("INSUFFICIENT_FUNDS");
          error.details = { code: "P1013", message: "INSUFFICIENT_FUNDS" };
          throw error;
        }
        return { ok: true, duplicate: false, balance_after: 1100000 };
      }
      if (name === "sd_core_list_transactions") {
        return [{ sync_seq: 77, transaction_id: "remote-1", amount: 5, balance_after: 1100005, metadata: {} }];
      }
      throw new Error(`legacy RPC escaped bridge: ${name}`);
    };
    const auth = { rpc: originalRpcFunction };
    const stateMap = new Map();
    const state = {
      getMeta(k, f = "") { return stateMap.has(k) ? stateMap.get(k) : f; },
      setMeta(k, v) { stateMap.set(k, v); },
    };
    const engine = new SyncEngine({ auth, syncState: state });
    const config = { deviceKey: "c".repeat(64), deviceName: "Core Bridge Test", signedAmount: 100000, localId: "local-reward-1" };

    const first = await engine.pushLocalTransactions(config, 1000000);
    assert.equal(first.pushed, 1);
    assert.equal(auth.rpc, originalRpcFunction, "auth.rpc must be restored after push");
    const apply1 = calls.find((call) => call.name === "sd_core_apply_sd_link_event");
    assert.ok(apply1);
    assert.equal(apply1.body.p_event_type, "reward");
    assert.equal(apply1.body.p_amount, 100000);
    assert.equal(apply1.body.p_local_transaction_id, "local-reward-1");
    assert.equal(apply1.body.p_metadata.sd_link_device_key, "c".repeat(64));
    const firstEventId = apply1.body.p_event_id;

    calls.length = 0;
    await engine.pushLocalTransactions(config, 1000000);
    const apply2 = calls.find((call) => call.name === "sd_core_apply_sd_link_event");
    assert.equal(apply2.body.p_event_id, firstEventId, "retry must reuse persisted event_id");

    failSpend = true;
    calls.length = 0;
    const rejected = await engine.pushLocalTransactions({ ...config, signedAmount: -200000, localId: "local-spend-1" }, 1100000);
    assert.equal(rejected.rejected, 1, "Core insufficient funds must preserve legacy rejection flow");
    failSpend = false;

    calls.length = 0;
    const pulled = await engine.pullRemoteTransactions(config, 70);
    assert.equal(pulled.pulled, 1);
    const list = calls.find((call) => call.name === "sd_core_list_transactions");
    assert.ok(list);
    assert.equal(list.body.p_after_seq, 70);
    assert.equal(list.body.p_device_id, "11111111-1111-4111-8111-111111111111");
    assert.equal(auth.rpc, originalRpcFunction, "auth.rpc must be restored after pull");

    const freshEngine = new SyncEngine({ auth, syncState: state });
    failUnavailable = true;
    await assert.rejects(
      () => freshEngine.pushLocalTransactions({ ...config, localId: "local-core-missing" }, 1100000),
      (error) => error.code === "SD_CORE_UNAVAILABLE"
        && /거래는 보존/.test(error.message)
        && !/schema cache|PGRST|sd_core_register_device/i.test(error.message),
      "raw PostgREST/schema-cache error must not escape to UI",
    );
    failUnavailable = false;

    console.log("SD Link integrated Core runtime v0.24 regression PASS");
  } finally {
    delete process.env.SD_CENTER_LINK_INTEGRATED;
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
