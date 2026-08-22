"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const rendererDir = path.join(__dirname, "..", "renderer");
const hookPath = path.join(rendererDir, "post-login-roadmap-sync.js");
const indexPath = path.join(rendererDir, "index.html");

test("login success triggers exactly one authenticated roadmap sync hook", () => {
  const listeners = new Map();
  const loginForm = { addEventListener(type, fn) { listeners.set(type, fn); } };
  const appView = { hidden: true };
  let observer = null;
  let roadmapLoads = 0;

  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; observer = this; }
    observe() {}
    disconnect() { this.disconnected = true; }
  }

  global.document = {
    getElementById(id) {
      if (id === "loginForm") return loginForm;
      if (id === "appView") return appView;
      return null;
    }
  };
  global.window = { loadRoadmap() { roadmapLoads += 1; return Promise.resolve(); } };
  global.MutationObserver = FakeMutationObserver;

  delete require.cache[require.resolve(hookPath)];
  require(hookPath);

  assert.equal(typeof listeners.get("submit"), "function");
  listeners.get("submit")();
  assert.equal(roadmapLoads, 0, "로그인 완료 전에는 서버 로드맵을 다시 읽지 않아야 함");
  assert.ok(observer, "로그인 완료 표시를 기다려야 함");

  appView.hidden = false;
  observer.callback();
  assert.equal(roadmapLoads, 1, "로그인 완료 시 로드맵을 정확히 한 번 동기화해야 함");
  assert.equal(observer.disconnected, true);

  delete global.document;
  delete global.window;
  delete global.MutationObserver;
  delete require.cache[require.resolve(hookPath)];
});

test("post-login roadmap hook is loaded after the main renderer script", () => {
  const html = fs.readFileSync(indexPath, "utf8");
  const appIndex = html.indexOf('<script src="app.js"></script>');
  const hookIndex = html.indexOf('<script src="post-login-roadmap-sync.js"></script>');
  assert.ok(appIndex >= 0);
  assert.ok(hookIndex > appIndex, "loadRoadmap 전역 함수가 정의된 뒤 hook이 로드되어야 함");
});
