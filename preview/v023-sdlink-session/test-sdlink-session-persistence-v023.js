"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { patchIntegratedSdLinkAuthSession } = require("./sdlink-session-persistence");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdlink-session-v023-"));
const src = path.join(root, "src");
fs.mkdirSync(src, { recursive: true });
fs.writeFileSync(path.join(src, "auth-service.js"), `
class AuthService {
  constructor() { this.session = null; this.persistedRemember = null; }
  mapSession(_data, email, remember) { return { user: { id: "u1" }, email, accessToken: "a", refreshToken: "r", remember: Boolean(remember) }; }
  persist() { this.persistedRemember = this.session?.remember ?? null; return Boolean(this.session?.remember); }
  loadSession() { return { user: { id: "u1" }, accessToken: "a", refreshToken: "r", remember: false }; }
  async signIn(email, _password, remember) { this.session = this.mapSession({}, email, remember); this.persist(); return this.session; }
  async refresh() { this.session = this.mapSession({}, this.session.email, this.session.remember); this.persist(); return this.session; }
  async signOut() { this.session = null; this.persistedRemember = null; }
}
module.exports = { AuthService };
`, "utf8");

process.env.SD_CENTER_LINK_INTEGRATED = "1";
const result = patchIntegratedSdLinkAuthSession(root);
assert.equal(result.ok, true);
const { AuthService } = require(path.join(src, "auth-service.js"));
const auth = new AuthService();

(async () => {
  const signedIn = await auth.signIn("user@example.com", "pw", false);
  assert.equal(signedIn.remember, true, "integrated login must persist even when old checkbox is off");
  assert.equal(auth.persistedRemember, true);

  const loaded = auth.loadSession();
  assert.equal(loaded.remember, true, "loaded integrated session must remain persistent");

  auth.session = loaded;
  await auth.refresh();
  assert.equal(auth.session.remember, true, "refresh must not downgrade persistence");
  assert.equal(auth.persistedRemember, true);

  await auth.signOut();
  assert.equal(auth.session, null, "explicit logout must still clear the session");

  console.log("SD Link v0.23 integrated session persistence tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
