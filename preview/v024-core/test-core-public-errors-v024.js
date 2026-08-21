"use strict";
const assert = require("node:assert/strict");
const { translateCoreError } = require("./sdlink-core-runtime");

function raw(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
}

const schema = translateCoreError(raw("Could not find the function public.sd_core_register_device in the schema cache", "PGRST202"));
assert.equal(schema.code, "SD_CORE_UNAVAILABLE");
assert.equal(schema.retryable, true);
assert.ok(!/schema cache|PGRST|sd_core_register_device/i.test(schema.message));
assert.equal(schema.cause.code, "PGRST202");

const missing = translateCoreError(raw('function public.sd_core_list_transactions(uuid,bigint,integer) does not exist', "42883"));
assert.equal(missing.code, "SD_CORE_UNAVAILABLE");
assert.ok(!/does not exist|function public/i.test(missing.message));

const network = translateCoreError(new TypeError("fetch failed"));
assert.equal(network.code, "SD_CORE_NETWORK_ERROR");
assert.equal(network.retryable, true);
assert.ok(!/fetch failed/i.test(network.message));

const revoked = translateCoreError(raw("DEVICE_REVOKED", "P1006"));
assert.equal(revoked.code, "SD_CORE_DEVICE_REVOKED");
assert.match(revoked.message, /연결이 해제/);
assert.ok(!/DEVICE_REVOKED/.test(revoked.message));

const funds = translateCoreError(raw("INSUFFICIENT_FUNDS", "P1013"));
assert.equal(funds.code, "SD_CORE_INSUFFICIENT_FUNDS");
assert.equal(funds.message, "온라인 가상잔액이 부족합니다.");

const conflict = translateCoreError(raw("IDEMPOTENCY_CONFLICT", "P1015"));
assert.equal(conflict.retryable, false);
assert.ok(!/IDEMPOTENCY_CONFLICT/.test(conflict.message));

const capability = translateCoreError(raw("REWARD_CAPABILITY_REQUIRED", "P1030"));
assert.equal(capability.code, "SD_CORE_REWARD_CAPABILITY_REQUIRED");
assert.equal(capability.retryable, false);
assert.ok(!/P1030|REWARD_CAPABILITY_REQUIRED/.test(capability.message));
assert.match(capability.message, /서버 검증/);

console.log("Core public-error translation regression PASS");
