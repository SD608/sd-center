"use strict";

const path = require("node:path");
const { spawn } = require("node:child_process");

function isSdCenterUrl(value) {
  return String(value || "").startsWith("sdcenter://open");
}

function openSdCenter(app) {
  const executable =
    process.env.SD_CENTER_EXECUTABLE || process.execPath;
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;

  const centerRoot =
    process.env.SD_CENTER_ROOT ||
    path.resolve(__dirname, "..");
  const args = app.isPackaged
    ? ["--sd-center-show"]
    : [centerRoot, "--sd-center-show"];

  const child = spawn(executable, args, {
    env: environment,
    stdio: "ignore",
    windowsHide: false,
    detached: true,
  });

  child.unref();
}

module.exports = {
  isSdCenterUrl,
  openSdCenter,
};
