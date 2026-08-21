"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  createSdLinkBackgroundWindowGuard,
} = require("./sdlink-background-window-guard");

function makeWindow() {
  return {
    showCount: 0,
    hideCount: 0,
    isDestroyed() { return false; },
    show() { this.showCount += 1; return "shown"; },
    hide() { this.hideCount += 1; },
  };
}

{
  const app = new EventEmitter();
  const guard = createSdLinkBackgroundWindowGuard({
    app,
    argv: ["SDCenter.exe", "--sd-child-app=sdlink-desktop", "--sd-link-auto-start"],
  });
  const window = makeWindow();
  app.emit("browser-window-created", {}, window);

  assert.equal(guard.background, true);
  assert.equal(guard.isManagerWindowAllowed(), false);
  assert.equal(window.hideCount, 1);

  // SD Link's legacy ready-to-show handler may still call show().
  // Background mode must intercept it before any visible flash occurs.
  window.show();
  assert.equal(window.showCount, 0);
  assert.equal(window.hideCount, 2);

  // An explicit manager-open request re-enables the same hidden window.
  guard.allowManagerWindow();
  assert.equal(guard.isManagerWindowAllowed(), true);
  assert.equal(window.show(), "shown");
  assert.equal(window.showCount, 1);
}

{
  const app = new EventEmitter();
  const guard = createSdLinkBackgroundWindowGuard({
    app,
    argv: ["SDCenter.exe", "--sd-child-app=sdlink-desktop"],
  });
  const window = makeWindow();
  app.emit("browser-window-created", {}, window);
  assert.equal(guard.background, false);
  assert.equal(window.show(), "shown");
  assert.equal(window.showCount, 1);
  assert.equal(window.hideCount, 0);
}

console.log("SD Link background window guard v0.24 regression PASS");
