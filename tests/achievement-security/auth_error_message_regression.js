"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("assets/js/auth-common.js", "utf8");

function fakeQuery() {
  return {
    select() { return this; },
    eq() { return this; },
    single: async () => ({ data: null, error: null }),
  };
}

const client = {
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  realtime: { setAuth: async () => {} },
  rpc: async () => ({ data: null, error: null }),
  from: () => fakeQuery(),
  removeChannel: async () => {},
  channel: () => ({
    on() { return this; },
    subscribe() { return this; },
    track: async () => {},
    untrack: async () => {},
    presenceState: () => ({}),
  }),
};

const noop = () => {};
const context = {
  window: {
    SD_SUPABASE_CONFIG: { url: "https://example.invalid", publishableKey: "public-test-key" },
    supabase: { createClient: () => client },
    setTimeout,
    dispatchEvent: noop,
  },
  document: { addEventListener: noop, visibilityState: "hidden" },
  navigator: { userAgent: "Windows", language: "ko-KR" },
  location: { pathname: "/profile.html", search: "", replace: noop },
  localStorage: { getItem: () => null, setItem: noop },
  CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  console: { log: noop, warn: noop, error: noop },
  setTimeout,
  clearTimeout,
  setInterval: () => 1,
  clearInterval: noop,
  encodeURIComponent,
};
context.globalThis = context;

vm.runInNewContext(source, context, { filename: "auth-common.js" });
const messageForError = context.window.SD_AUTH?.messageForError;
assert.equal(typeof messageForError, "function", "auth.messageForError must be exposed");

const GENERIC = "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
const PERMISSION = "이 요청을 수행할 권한이 없습니다.";

// Existing intentionally translated user-facing UX must remain stable.
assert.equal(messageForError(new Error("Invalid login credentials")), "이메일 또는 비밀번호가 맞지 않습니다.");
assert.equal(messageForError(new Error("Email not confirmed")), "이메일 인증이 아직 끝나지 않았습니다. 받은 메일의 인증 버튼을 눌러주세요.");
assert.equal(messageForError(new Error("User already registered")), "이미 가입된 이메일입니다.");
assert.equal(messageForError(new Error("Password should be at least 8 characters")), "비밀번호는 8자 이상으로 입력하세요.");
assert.equal(messageForError(new Error("Database error saving new user")), "가입 정보를 저장하지 못했습니다. 초대 코드와 닉네임을 확인하세요.");
assert.equal(messageForError(new Error("Rate limit exceeded")), "요청이 너무 많습니다. 잠시 뒤 다시 시도하세요.");
assert.equal(messageForError(new Error("Failed to fetch")), "서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.");
assert.equal(messageForError(new Error("NetworkError when attempting to fetch resource")), "서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.");
assert.equal(messageForError({ message: "permission denied for table profiles", code: "42501" }), PERMISSION);
assert.equal(messageForError({ message: "Forbidden", status: 403 }), PERMISSION);
assert.equal(messageForError({ message: "JWT expired", status: 401 }), "로그인 정보가 만료되었습니다. 다시 로그인해 주세요.");

const internalCases = [
  new Error("raw internal error"),
  { message: "Could not find the function public.equip_sd_profile_title(p_achievement_id) in the schema cache", code: "PGRST202", details: "Searched for public.equip_sd_profile_title" },
  { message: "syntax error at or near SELECT", code: "42601", details: "SQL statement failed" },
  { message: "relation public.sd_user_achievements does not exist", code: "42P01" },
  { message: "duplicate key value violates unique constraint sd_user_achievements_user_id_key", code: "23505" },
  { message: "column secret_column of relation profiles does not exist", code: "42703" },
  { message: "function public.get_sd_public_profile(uuid) does not exist", code: "42883" },
  { message: "PostgREST internal failure", code: "PGRST500", hint: "reload schema" },
  { message: "unexpected service failure", stack: "Error: unexpected service failure\n    at secret/internal/path.js:42:3" },
];

for (const error of internalCases) {
  const output = messageForError(error);
  assert.equal(output, GENERIC, `internal error must fail closed: ${String(error?.message || error)}`);
  for (const secret of [
    "raw internal error", "PostgREST", "schema", "constraint", "sd_user_achievements",
    "secret_column", "equip_sd_profile_title", "get_sd_public_profile", "SELECT", "internal/path",
  ]) {
    assert.equal(output.includes(secret), false, `user-visible message leaked internal detail: ${secret}`);
  }
}

// Active Chapter 3-6 UI paths must route user-visible failures through the sanitizer,
// or use fixed safe status text rather than raw DB/RPC errors.
const activeUiFiles = [
  "assets/js/profile-page-v8.js",
  "assets/js/profile-card-edit-v7.js",
  "assets/js/profile-shop.js",
  "assets/js/achievement-sync.js",
  "assets/js/achievements-all.js",
];
for (const file of activeUiFiles) {
  const text = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(text, /(?:setStatus|textContent|innerText|innerHTML)[^\n]{0,160}error\?\.message/i, `${file} must not render error.message directly`);
  assert.doesNotMatch(text, /(?:setStatus|textContent|innerText|innerHTML)[^\n]{0,160}error\.message/i, `${file} must not render error.message directly`);
}

const profile = fs.readFileSync("assets/js/profile-page-v8.js", "utf8");
const editor = fs.readFileSync("assets/js/profile-card-edit-v7.js", "utf8");
const shop = fs.readFileSync("assets/js/profile-shop.js", "utf8");
const achievements = fs.readFileSync("assets/js/achievements-all.js", "utf8");
assert.match(profile, /get_sd_public_profile/);
assert.match(profile, /auth\.messageForError\(error\)/);
assert.match(editor, /equip_sd_profile_title/);
assert.match(editor, /auth\.messageForError\(error\)/);
assert.match(shop, /equip_sd_profile_title/);
assert.match(shop, /auth\.messageForError\(error\)/);
assert.match(achievements, /업적 서버에 연결할 수 없습니다\.|마지막으로 확인된 업적 정보를 표시 중입니다\./);
assert.doesNotMatch(source, /return\s+raw\s*;/, "unknown errors must never return raw message");

console.log("Chapter 3-6 user-visible error fail-closed regression PASS");
