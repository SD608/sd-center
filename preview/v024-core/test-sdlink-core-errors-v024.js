"use strict";

const assert = require("node:assert/strict");
const { publicCoreError, coreErrorCode } = require("./sdlink-core-runtime");

function fake(message, code, details = {}) {
  const error = new Error(message);
  if (code) error.code = code;
  error.details = details;
  return error;
}

const cases = [
  [fake("INSUFFICIENT_FUNDS", "P1013"), "온라인 가상잔액이 부족합니다."],
  [fake("REWARD_CAPABILITY_REQUIRED", "P1030"), "이 보상은 아직 SD Core 서버 검증을 지원하지 않습니다."],
  [fake("DEVICE_REVOKED", "P1006"), "연결 해제된 기기입니다. 기기를 다시 등록해 주세요."],
  [fake("Could not find the function public.sd_core_apply_sd_link_event in the schema cache", "PGRST202"), "SD Core 서버 기능을 준비 중입니다. 다시 동기화해 주세요."],
  [fake("function sd_core_apply_sd_link_event(uuid) does not exist", "42883"), "SD Core 서버 기능을 준비 중입니다. 다시 동기화해 주세요."],
  [fake("Failed to fetch", "TypeError"), "네트워크 연결을 확인한 뒤 다시 시도해 주세요."],
  [fake("sensitive SQL stack trace: select * from wallets", "XX000"), "SD Core 동기화 중 오류가 발생했습니다. 다시 시도해 주세요."],
];

for (const [source, expected] of cases) {
  const translated = publicCoreError(source);
  assert.equal(translated.message, expected);
  assert.equal(translated.cause, source, "raw error must be preserved only as internal cause");
  assert.ok(translated.code, "translated error keeps an internal code");
  assert.doesNotMatch(translated.message, /schema cache|function .* does not exist|select \*|SQL|PGRST/i, "user message leaked internal database details");
}

const nested = fake("wrapper", "", { code: "P1001", message: "AUTH_REQUIRED" });
assert.equal(coreErrorCode(nested), "P1001");
assert.equal(publicCoreError(nested).message, "로그인이 필요합니다. 다시 로그인해 주세요.");

console.log("SD Link integrated Core user-facing error regression PASS");
