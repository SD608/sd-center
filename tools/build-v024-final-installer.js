"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createWindowsInstaller } = require("electron-winstaller");

const appDirectory = process.env.APP_DIR;
const outputDirectory = process.env.BUILD_OUTPUT;
const installerVersion = process.env.INSTALLER_VERSION;

if (!appDirectory || !outputDirectory || !installerVersion) {
  throw new Error("APP_DIR, BUILD_OUTPUT and INSTALLER_VERSION are required");
}

if (!/^\d+\.\d+\.\d+$/.test(installerVersion)) {
  throw new Error(`INSTALLER_VERSION must be a three-part numeric version: ${installerVersion}`);
}

const exePath = path.join(appDirectory, "SDCenter.exe");
const packagePath = path.join(appDirectory, "resources", "app", "package.json");
const iconPath = path.join(appDirectory, "resources", "app", "public", "icons", "icon.ico");
for (const required of [exePath, packagePath, iconPath]) {
  if (!fs.existsSync(required)) throw new Error(`required installer input missing: ${required}`);
}

// Windows PowerShell 5.1 may write UTF-8 files with a BOM. The staging
// pipeline now writes package.json without one, but strip it defensively so
// a BOM can never make the Final Gate builder fail before validation.
const packageJson = fs.readFileSync(packagePath, "utf8").replace(/^\uFEFF/, "");
const pkg = JSON.parse(packageJson);
if (pkg.version !== installerVersion) {
  throw new Error(`staged package version ${pkg.version} does not match installer version ${installerVersion}`);
}

createWindowsInstaller({
  appDirectory,
  outputDirectory,
  name: "SDCenter",
  productName: "SD종합센터",
  version: installerVersion,
  authors: "SDWallet",
  description: "SD종합센터 · SD Core · Theme Store · SD Link 통합",
  exe: "SDCenter.exe",
  setupExe: "SDCenterSetup.exe",
  noMsi: true,
  setupIcon: iconPath,
}).then(() => {
  console.log(`Squirrel Final Gate installer build complete: ${installerVersion}`);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
