"use strict";

const assert = require("node:assert/strict");
const {
  CORE_V1_RPCS,
  SdCoreClient,
  semanticWalletEvent,
  stableEventId,
  uuidFromSeed,
} = require("./sd-core-client");

const calls = [];
const auth = {
  async rpc(name, body) {
    calls.push({ name, body });
    if (name === CORE_V1_RPCS.registerDevice) {
      return { ok: true, device_id: "11111111-1111-4111-8111-111111111111", wallet_balance: 1000000 };
    }
    if (name === CORE_V1_RPCS.getSnapshot) {
      return { ok: true, device_id: body.p_device_id, balance: 900000, latest_sync_seq: 2 };
    }
    if (name === CORE_V1_RPCS.applyWalletEvent) {
      return { ok: true, duplicate: false, event_id: body.p_event_id, type: body.p_event_type, amount: body.p_amount };
    }
    if (name === CORE_V1_RPCS.listTransactions) return [];
    throw new Error(`unexpected rpc ${name}`);
  },
};

const meta = new Map();
const syncState = {
  getMeta(key, fallback = null) { return meta.has(key) ? meta.get(key) : fallback; },
  setMeta(key, value) { meta.set(String(key), String(value)); },
};

(async () => {
  const client = new SdCoreClient({ auth });
  const device = await client.registerDevice({ deviceKey: "a".repeat(64), deviceName: "SD Center Test" });
  assert.equal(device.wallet_balance, 1000000);

  assert.deepEqual(semanticWalletEvent({ memo: "reward" }, 100000), {
    type: "reward",
    amount: 100000,
    targetAccountNumber: null,
    description: "reward",
  });
  assert.deepEqual(semanticWalletEvent({ memo: "spend" }, -200000), {
    type: "spend",
    amount: 200000,
    targetAccountNumber: null,
    description: "spend",
  });

  const localId = "local-tx-77";
  const firstEventId = stableEventId(syncState, localId);
  const retryEventId = stableEventId(syncState, localId);
  assert.equal(firstEventId, retryEventId, "retry must reuse the exact event_id");
  assert.match(firstEventId, /^[0-9a-f-]{36}$/);

  await client.applyLegacyLocalTransaction({
    deviceId: device.device_id,
    deviceKey: "a".repeat(64),
    transaction: { id: localId, transactionType: "deposit", memo: "Delivery reward" },
    signedDelta: 100000,
    syncState,
  });
  const rewardCall = calls.at(-1);
  assert.equal(rewardCall.name, CORE_V1_RPCS.applyWalletEvent);
  assert.equal(rewardCall.body.p_event_type, "reward");
  assert.equal(rewardCall.body.p_amount, 100000);
  assert.equal(rewardCall.body.p_event_id, firstEventId);
  assert.equal(rewardCall.body.p_target_account_number, null);
  assert.equal(rewardCall.body.p_metadata.sd_link_local_transaction_id, localId);

  await client.applyLegacyLocalTransaction({
    deviceId: device.device_id,
    deviceKey: "a".repeat(64),
    transaction: { id: "local-tx-78", transactionType: "withdraw", memo: "Purchase" },
    signedDelta: -200000,
    syncState,
  });
  const spendCall = calls.at(-1);
  assert.equal(spendCall.body.p_event_type, "spend");
  assert.equal(spendCall.body.p_amount, 200000, "Core amount must always be positive");

  await assert.rejects(
    () => client.applyWalletEvent({ deviceId: device.device_id, eventId: firstEventId, type: "reward", amount: -1 }),
    /positive safe integer/,
  );
  await assert.rejects(
    () => client.applyWalletEvent({ deviceId: device.device_id, eventId: firstEventId, type: "spend", amount: 1, targetAccountNumber: "608-X" }),
    /must not include/,
  );

  const deterministicA = uuidFromSeed("reward:123");
  const deterministicB = uuidFromSeed("reward:123");
  assert.equal(deterministicA, deterministicB);
  assert.match(deterministicA, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  await client.getSnapshot(device.device_id);
  await client.listTransactions(device.device_id, 0, 100);
  assert.equal(calls.at(-2).name, CORE_V1_RPCS.getSnapshot);
  assert.equal(calls.at(-1).name, CORE_V1_RPCS.listTransactions);

  console.log("SD Core v1 ↔ SD Link adapter contract tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
