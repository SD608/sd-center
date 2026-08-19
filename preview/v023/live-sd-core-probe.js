"use strict";

const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { SdCoreClient, SdCoreHttpAuth, uuidFromSeed } = require("./sd-core-client");

const SUPABASE_URL = process.env.SD_CORE_DEV_URL || "https://rwjueffaziiawdebbwpf.supabase.co";
const PUBLISHABLE_KEY = process.env.SD_CORE_DEV_PUBLISHABLE_KEY || "sb_publishable_bEI7U7RzZpMB92xM9nXx3A_rTG8R--2";
const runId = String(process.env.GITHUB_RUN_ID || "local-probe");
const email = `sdcore-link-${runId}@example.com`;
const password = `SdCoreLink!${runId}Aa9`;
const deviceKey = crypto.createHash("sha256").update(`sdcore-link-device:${runId}`).digest("hex");
const rewardEventId = uuidFromSeed(`sdcore-link:${runId}:reward`);
const spendEventId = uuidFromSeed(`sdcore-link:${runId}:spend`);

function printError(error) {
  console.error("SD_CORE_PROBE_ERROR", {
    message: error?.message || String(error),
    code: error?.code || "",
    statusCode: error?.statusCode || 0,
    details: error?.details || null,
  });
}

async function signInOrCreate(auth) {
  try {
    return await auth.signIn(email, password);
  } catch (signInError) {
    const payload = await auth.signUp(email, password);
    const userId = payload?.user?.id || "";
    if (userId) console.log(`SD_CORE_TEST_USER_ID=${userId}`);
    if (!auth.session?.accessToken) {
      const error = new Error(`AUTH_CONFIRM_REQUIRED user_id=${userId || "unknown"}`);
      error.code = "AUTH_CONFIRM_REQUIRED";
      throw error;
    }
    return auth.session;
  }
}

(async () => {
  const auth = new SdCoreHttpAuth({ supabaseUrl: SUPABASE_URL, publishableKey: PUBLISHABLE_KEY });
  await signInOrCreate(auth);
  const userId = auth.session?.user?.id || "";
  console.log(`SD_CORE_TEST_USER_ID=${userId}`);
  console.log(`SD_CORE_TEST_EMAIL=${email}`);

  const client = new SdCoreClient({ auth });
  let device;
  try {
    device = await client.registerDevice({ deviceKey, deviceName: "SD Link GitHub E2E", platform: "windows" });
  } catch (error) {
    if (error?.code === "P1016" || String(error?.message || "").includes("WALLET_NOT_FOUND")) {
      console.error(`SD_CORE_PROVISION_REQUIRED user_id=${userId}`);
    }
    throw error;
  }
  assert.equal(device.ok, true);
  assert.ok(device.device_id);
  const deviceId = device.device_id;

  const initial = await client.getSnapshot(deviceId);
  const initialBalance = Number(initial.balance);
  assert.ok(initialBalance === 1000000 || initialBalance === 900000, `unexpected initial balance ${initialBalance}`);

  const rewardPayload = {
    deviceId,
    eventId: rewardEventId,
    type: "reward",
    amount: 100000,
    targetAccountNumber: null,
    sourceApp: "sd_link",
    description: "SD Link Core integration reward",
    metadata: { probe: "sdlink-core-v1", run_id: runId, local_transaction_id: "probe-reward" },
  };
  const spendPayload = {
    deviceId,
    eventId: spendEventId,
    type: "spend",
    amount: 200000,
    targetAccountNumber: null,
    sourceApp: "sd_link",
    description: "SD Link Core integration spend",
    metadata: { probe: "sdlink-core-v1", run_id: runId, local_transaction_id: "probe-spend" },
  };

  const reward = await client.applyWalletEvent(rewardPayload);
  if (!reward.duplicate) {
    assert.equal(Number(reward.balance_before), 1000000);
    assert.equal(Number(reward.balance_after), 1100000);
  }

  const spend = await client.applyWalletEvent(spendPayload);
  if (!spend.duplicate) {
    assert.equal(Number(spend.balance_before), 1100000);
    assert.equal(Number(spend.balance_after), 900000);
  }

  const replay = await client.applyWalletEvent(rewardPayload);
  assert.equal(replay.duplicate, true, "exact reward replay must be idempotent");
  assert.equal(Number(replay.current_balance), 900000, "reward replay must not change current balance");

  const after = await client.getSnapshot(deviceId);
  assert.equal(Number(after.balance), 900000);

  const rows = await client.listTransactions(deviceId, 0, 100);
  assert.ok(Array.isArray(rows));
  const probeRows = rows.filter((row) => row?.metadata?.probe === "sdlink-core-v1" && row?.metadata?.run_id === runId);
  assert.equal(probeRows.length, 2, "Core ledger must contain exactly reward + spend for the probe");
  assert.ok(probeRows.some((row) => row.transaction_type === "sd_core_reward" && Number(row.amount) === 100000));
  assert.ok(probeRows.some((row) => row.transaction_type === "sd_core_spend" && Number(row.amount) === -200000));

  // Simulate a fresh process / re-login. No local wallet database is used for this read.
  const auth2 = new SdCoreHttpAuth({ supabaseUrl: SUPABASE_URL, publishableKey: PUBLISHABLE_KEY });
  await auth2.signIn(email, password);
  const client2 = new SdCoreClient({ auth: auth2 });
  const serverOnly = await client2.getSnapshot(deviceId);
  assert.equal(Number(serverOnly.balance), 900000, "server state must remain readable after re-login without local DB");

  console.log("SD_CORE_LINK_LIVE_PASS", {
    userId,
    deviceId,
    initialBalance,
    finalBalance: Number(serverOnly.balance),
    rewardDuplicateOnReplay: replay.duplicate,
    ledgerRows: probeRows.length,
  });
})().catch((error) => {
  printError(error);
  process.exitCode = 1;
});
