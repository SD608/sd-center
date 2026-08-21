"use strict";

const ERROR_MESSAGES = Object.freeze({
  AUTH_REQUIRED: "로그인이 필요합니다.", ADMIN_REQUIRED: "관리자 권한이 필요합니다.", ACCOUNT_INACTIVE: "사용할 수 없는 계정입니다.",
  INVALID_AMOUNT: "금액은 1 이상 1,000억 이하의 정수로 입력하세요.", INSUFFICIENT_FUNDS: "잔액이 부족합니다.", WALLET_TARGET_NOT_FOUND: "대상 지갑을 찾지 못했습니다.",
  USER_NOT_FOUND: "사용자를 찾지 못했습니다.", NOTE_TOO_LONG: "사유는 80자 이하로 입력하세요.", INVALID_DIRECTION: "입금/출금 방향이 올바르지 않습니다.",
  REQUEST_ID_REQUIRED: "거래 요청 ID가 없습니다.", SERVER_EVENT_IDEMPOTENCY_CONFLICT: "같은 요청 ID가 다른 거래에 사용되었습니다.", SERVER_EVENT_INCOMPLETE: "이전 거래 처리 상태를 확인할 수 없습니다.",
  DEVICE_NOT_FOUND_OR_INACTIVE: "연결된 기기를 확인할 수 없습니다.", INSTANCE_ID_CONFLICT: "접속 인스턴스 ID가 충돌했습니다.", INSTANCE_ALREADY_ENDED: "이미 종료된 실행 인스턴스입니다.",
  INSTANCE_APP_CONFLICT: "실행 인스턴스의 앱 정보가 일치하지 않습니다.", INSTANCE_DEVICE_CONFLICT: "실행 인스턴스의 기기 정보가 일치하지 않습니다.",
  PENDING_ADJUSTMENT_EXISTS: "확인되지 않은 입출금 요청을 먼저 처리하세요.", PENDING_ADJUSTMENT_CONFLICT: "미확정 입출금 요청 정보가 일치하지 않습니다.",
  PENDING_ADJUSTMENT_CORRUPT: "미확정 입출금 기록을 읽을 수 없습니다. 추가 거래를 중지하고 확인이 필요합니다.",
  invalid_credentials: "이메일 또는 비밀번호가 올바르지 않습니다.", email_not_confirmed: "이메일 인증이 완료되지 않았습니다.", user_banned: "사용할 수 없는 계정입니다.",
  PGRST202: "관리자 서버 기능이 아직 준비되지 않았습니다.", PGRST203: "관리자 서버 기능 구성이 올바르지 않습니다."
});

function errorText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return [value.code, value.message, value.error_code, value.error_description, value.error, value.body?.code, value.body?.message, value.body?.error_code, value.body?.error_description, value.body?.error]
    .filter(Boolean).map(String).join(" ");
}
function extractCode(value) {
  const text = errorText(value);
  for (const code of Object.keys(ERROR_MESSAGES)) if (text.includes(code)) return code;
  return "";
}
function friendlyError(value, fallback = "요청을 처리하지 못했습니다.") {
  const code = extractCode(value); if (code) return ERROR_MESSAGES[code];
  const text = errorText(value).toLowerCase();
  if (text.includes("invalid login credentials")) return ERROR_MESSAGES.invalid_credentials;
  if (text.includes("could not find the function") && text.includes("sd_admin_v1_")) return ERROR_MESSAGES.PGRST202;
  const status = Number(value?.status || value?.statusCode || 0);
  if (status === 401) return "로그인 세션이 만료되었습니다."; if (status === 403) return "권한이 없습니다."; if (status === 429) return "요청이 너무 많습니다. 잠시 후 다시 시도하세요."; if (status >= 500) return "서버 연결에 문제가 있습니다.";
  const name = String(value?.name || ""); if (name === "AbortError") return "서버 응답 시간이 초과되었습니다.";
  if (value instanceof TypeError || String(value?.code || "").includes("NETWORK") || String(value?.message || "").includes("socket")) return "네트워크 연결을 확인하세요.";
  return fallback;
}
module.exports = { ERROR_MESSAGES, extractCode, friendlyError };
