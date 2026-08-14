"use strict";

module.exports = {
  packagerConfig: {
    asar: false,
    icon: "public/icons/icon",
    executableName: "SDCenter",
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "SDCenter",
        authors: "SDWallet",
        description: "필수 확장팩 업데이트와 SD 앱을 통합 관리하는 Windows 데스크톱 센터",
        setupExe: "SDCenterSetup.exe",
        setupIcon: "public/icons/icon.ico",
        noMsi: true,
      },
    },
  ],
};
