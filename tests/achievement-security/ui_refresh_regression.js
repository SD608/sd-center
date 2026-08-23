"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("assets/js/achievement-sync.js", "utf8");

(async () => {
  const domListeners = new Map();
  const dispatched = [];
  let payload = {
    schema_version: 1,
    achievements: [{
      code: "wallet-02",
      category: "wallet",
      sort_order: 2,
      name: "테스트",
      description: "테스트 설명",
      icon: "🏆",
      hidden: false,
      current_value: 10,
      unlocked: false,
      unlocked_at: null,
      title_owned: false,
      title_equipped: false,
    }],
  };
  let rpcError = null;

  const channel = {
    on() { return this; },
    subscribe() { return this; },
  };

  const client = {
    auth: {
      async getSession() {
        return { data: { session: { user: { id: "00000000-0000-4000-8000-000000000001" } } }, error: null };
      },
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    async rpc(name) {
      assert.equal(name, "get_sd_achievement_center_v1");
      if (rpcError) return { data: null, error: rpcError };
      return { data: JSON.parse(JSON.stringify(payload)), error: null };
    },
    channel() { return channel; },
    async removeChannel() {},
  };

  class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }

  const window = {
    SD_AUTH: { client },
    addEventListener() {},
    dispatchEvent(event) {
      dispatched.push(event);
      return true;
    },
    setTimeout() { return 1; },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
  };

  const document = {
    readyState: "loading",
    visibilityState: "visible",
    addEventListener(name, callback) {
      domListeners.set(name, callback);
    },
  };

  const context = vm.createContext({
    window,
    document,
    CustomEvent,
    console,
    JSON,
    Object,
    Array,
    Number,
    String,
    Boolean,
    Math,
    Promise,
    Set,
    Map,
  });

  vm.runInContext(source, context, { filename: "achievement-sync.js" });
  const boot = domListeners.get("DOMContentLoaded");
  assert.equal(typeof boot, "function", "achievement sync boot handler missing");

  await boot();
  assert.equal(dispatched.length, 1, "initial canonical snapshot must emit once");
  assert.equal(dispatched[0].detail.synced, true);

  await window.SD_ACHIEVEMENT_SYNC.refresh();
  await window.SD_ACHIEVEMENT_SYNC.refresh();
  assert.equal(dispatched.length, 1, "unchanged polling snapshots must not rebuild achievement UI");

  payload.achievements[0].current_value = 11;
  await window.SD_ACHIEVEMENT_SYNC.refresh();
  assert.equal(dispatched.length, 2, "changed canonical data must emit");
  assert.equal(dispatched[1].detail.catalog[0].current_value, 11);

  rpcError = new Error("offline");
  await window.SD_ACHIEVEMENT_SYNC.refresh();
  assert.equal(dispatched.length, 3, "first transition to unavailable state must emit");
  assert.equal(dispatched[2].detail.synced, false);

  await window.SD_ACHIEVEMENT_SYNC.refresh();
  assert.equal(dispatched.length, 3, "repeated identical unavailable state must not rebuild achievement UI");

  rpcError = null;
  await window.SD_ACHIEVEMENT_SYNC.refresh();
  assert.equal(dispatched.length, 4, "recovery to synced state must emit even when data is unchanged");
  assert.equal(dispatched[3].detail.synced, true);

  console.log("SD Achievement UI refresh dedupe regression PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
