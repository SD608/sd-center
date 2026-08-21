"use strict";

const path = require("node:path");

module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "SDBitcoinMiner",
    icon: path.join(__dirname, "public", "icons", "icon"),
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "sdbitcoinminer",
        setupExe: "SDBitcoinMiner-Setup.exe",
        setupIcon: path.join(__dirname, "public", "icons", "icon.ico"),
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
      },
    },
  ],
};
