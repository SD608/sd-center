"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

test("admin wallet mutation stays behind Core server ledger path", () => {
  const baseSql = read("sql/SD608_관리자_접속현황_v1.sql");
  const limitSql = read("sql/SD608_관리자_입출금_1000억_상한.sql");
  for (const sql of [baseSql, limitSql]) {
    assert.match(sql, /sd_core_private\.apply_server_wallet_delta_impl\s*\(/i);
    assert.doesNotMatch(sql, /update\s+public\.wallets\b/i);
    assert.doesNotMatch(sql, /insert\s+into\s+public\.transactions\b/i);
    assert.match(sql, /p_request_id\s+is\s+null/i);
  }
  assert.match(limitSql, /p_amount\s*>\s*100000000000/i);
  assert.match(read("admin-monitor/lib/sd-admin-api.js"), /MAX_ADJUSTMENT_AMOUNT\s*=\s*100000000000/);
  assert.match(read("admin-monitor/renderer/index.html"), /max=["']100000000000["']/i);
});

test("presence storage has no direct authenticated table access", () => {
  const sql = read("sql/SD608_관리자_접속현황_v1.sql");
  assert.match(sql, /alter\s+table\s+public\.sd_presence_sessions\s+enable\s+row\s+level\s+security/i);
  assert.match(sql, /revoke\s+all\s+on\s+table\s+public\.sd_presence_sessions\s+from\s+public,\s*anon,\s*authenticated/i);
  assert.match(sql, /viewer\.role\s*=\s*'admin'|p\.role='admin'|p\.role\s*=\s*'admin'/i);
});

test("public member wallet page stays removed while ranking implementation remains", () => {
  assert.equal(fs.existsSync(path.join(repoRoot, "members.html")), false);
  assert.equal(fs.existsSync(path.join(repoRoot, "assets/js/members-page.js")), false);
  assert.doesNotMatch(read("account.html"), /href=["']members\.html["']/i);
  assert.doesNotMatch(read("ranking.html"), /href=["']members\.html["']/i);
  const ranking = read("assets/js/ranking-page.js");
  assert.match(ranking, /list_sd_member_wallets/);
  assert.match(ranking, /rankingList/);
});

test("member wallet API hides account numbers from unrelated normal users", () => {
  const sql = read("sql/SD608_회원계좌_개인정보보호.sql");
  assert.match(sql, /when\s+p\.id\s*=\s*auth\.uid\(\)/i);
  assert.match(sql, /viewer\.role\s*=\s*'admin'/i);
  assert.match(sql, /else\s+null\s+end\s+as\s+account_number/i);
});
