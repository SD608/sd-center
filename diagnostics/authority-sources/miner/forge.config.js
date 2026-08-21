"use strict";

const path = require("node:path");

module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "SDMiner",
    icon: path.join(__dirname, "public", "icons", "icon"),
  },

  rebuildConfig: {},

  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "sdminer",
        setupExe: "SDMiner-Setup.exe",
        setupIcon: path.join(
          __dirname,
          "public",
          "icons",
          "icon.ico",
        ),
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
      },
    },
  ],
};
