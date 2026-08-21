"use strict";

const path = require("node:path");
const { isSdCenterUrl, openSdCenter } = require("./shared/open-center");
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  session,
  Tray,
} = require("electron");

const { SettingsStore } = require("./src/settings");
const {
  BTC_PRICE_KRW,
  ELECTRICITY_FEE_PER_GPU_KRW,
  FRAME_PRICE,
  GPU_PRICE,
  GPUS_PER_FRAME,
  MAX_FRAMES_PER_ROOM,
  ROOM_PRICES,
  autoFindWalletDatabase,
  buyFrame,
  buyGpu,
  buyRoom,
  decorateRoom,
  getAccountState,
  listAccounts,
  processMiningWindow,
  reactivateElectricity,
  resetMiningClock,
  sellBitcoin,
  validateWalletDatabase,
} = require("./src/wallet-database");
const {
  BTC_REWARD,
  MINING_INTERVAL_SECONDS,
  SUCCESS_PROBABILITY,
  calculateRewards,
} = require("./src/mining-service");

const singleInstanceLock =
  app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
}

const startHidden =
  process.argv.includes("--hidden");

let mainWindow = null;
let settingsStore = null;
let miningTimer = null;
let tray = null;
let isQuitting = false;
let trayNoticeShown = false;

function currentWalletPath() {
  return (
    settingsStore?.get()
      .walletDatabasePath || ""
  );
}

function showMainWindow() {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  const trayIconPath = path.join(
    __dirname,
    "public",
    "icons",
    "icon.ico",
  );

  tray = new Tray(trayIconPath);
  tray.setToolTip(
    "SD비트코인 채굴장 · 백그라운드 채굴 중",
  );

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "SD비트코인 채굴장 열기",
        click: showMainWindow,
      },
      {
        label: "백그라운드 채굴 중",
        enabled: false,
      },
      { type: "separator" },
      {
        label: "완전 종료",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );

  tray.on("double-click", showMainWindow);
}

function configureWindowsStartup() {
  if (
    process.platform !== "win32" ||
    !app.isPackaged
  ) {
    return;
  }

  app.setLoginItemSettings({
    openAtLogin: true,
    path: process.execPath,
    args: [
      ...(process.argv.find((value) =>
        value.startsWith("--sd-child-app="),
      )
        ? [process.argv.find((value) =>
            value.startsWith("--sd-child-app="),
          )]
        : []),
      "--hidden",
    ],
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1050,
    minHeight: 760,
    title: "SD비트코인 채굴장",
    backgroundColor: "#07090d",
    autoHideMenuBar: true,
    show: false,
    icon: path.join(
      __dirname,
      "public",
      "icons",
      "icon-512.png",
    ),

    webPreferences: {
      preload: path.join(
        __dirname,
        "preload.js",
      ),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(
    () => ({ action: "deny" }),
  );

  mainWindow.webContents.on(
    "will-attach-webview",
    (event) => event.preventDefault(),
  );

  mainWindow.webContents.on(
    "will-navigate",
    (event, navigationUrl) => {
    if (isSdCenterUrl(navigationUrl)) {
      event.preventDefault();
      openSdCenter(app);
      return;
    }

      try {
        const target = new URL(
          navigationUrl,
        );

        if (target.protocol !== "file:") {
          event.preventDefault();
        }
      } catch {
        event.preventDefault();
      }
    },
  );

  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    mainWindow.hide();

    if (
      tray &&
      !trayNoticeShown &&
      process.platform === "win32"
    ) {
      trayNoticeShown = true;

      try {
        tray.displayBalloon({
          title: "SD비트코인 채굴장",
          content:
            "창은 닫혔지만 시스템 트레이에서 채굴이 계속됩니다.",
          iconType: "info",
        });
      } catch {
        // 일부 Windows 환경에서는 풍선 알림을
        // 지원하지 않을 수 있습니다.
      }
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (!startHidden) {
      showMainWindow();
    }
  });

  mainWindow.loadFile(
    path.join(
      __dirname,
      "public",
      "index.html",
    ),
  );
}

function runMiningTick() {
  const databasePath =
    currentWalletPath();

  if (!databasePath) {
    return;
  }

  try {
    const result = processMiningWindow(
      databasePath,
      calculateRewards,
      Date.now(),
      MINING_INTERVAL_SECONDS,
    );

    if (
      Array.isArray(result.billingEvents) &&
      result.billingEvents.length > 0 &&
      mainWindow &&
      !mainWindow.isDestroyed()
    ) {
      mainWindow.webContents.send(
        "electricity:changed",
        result.billingEvents,
      );
    }

    if (
      result.rewards.length > 0 &&
      mainWindow &&
      !mainWindow.isDestroyed()
    ) {
      mainWindow.webContents.send(
        "mining:rewards",
        result.rewards,
      );
    }

    if (
      result.elapsedSeconds > 5 &&
      mainWindow &&
      !mainWindow.isDestroyed()
    ) {
      mainWindow.webContents.send(
        "mining:offline-applied",
        {
          elapsedSeconds:
            result.elapsedSeconds,
          totalBtc:
            result.rewards.reduce(
              (total, reward) =>
                total +
                Number(reward.btc || 0),
              0,
            ),
        },
      );
    }
  } catch (error) {
    console.error(
      "Mining tick failed:",
      error,
    );
  }
}

function startMiningLoop() {
  if (miningTimer) {
    clearInterval(miningTimer);
  }

  runMiningTick();

  miningTimer = setInterval(
    runMiningTick,
    MINING_INTERVAL_SECONDS *
      1000,
  );
}

function registerIpc() {
  ipcMain.handle(
    "settings:get",
    () => settingsStore.get(),
  );

  ipcMain.handle(
    "settings:save",
    (event, patch) =>
      settingsStore.update(patch),
  );

  ipcMain.handle(
    "app:get-config",
    () => ({
      roomPrices: ROOM_PRICES,
      framePrice: FRAME_PRICE,
      gpuPrice: GPU_PRICE,
      btcPriceKrw: BTC_PRICE_KRW,
      maxFramesPerRoom:
        MAX_FRAMES_PER_ROOM,
      gpusPerFrame: GPUS_PER_FRAME,
      btcReward: BTC_REWARD,
      gpuChancePercent: SUCCESS_PROBABILITY * 100,
      dailyElectricityFeeKrw:
        ELECTRICITY_FEE_PER_GPU_KRW,
      electricityTimezone: "UTC",
      miningIntervalSeconds:
        MINING_INTERVAL_SECONDS,
      backgroundMining: true,
      offlineMining: true,
    }),
  );

  ipcMain.handle(
    "wallet:auto-detect",
    () => {
      const found =
        autoFindWalletDatabase({
          appDataPath:
            app.getPath("appData"),
          homePath:
            app.getPath("home"),
        });

      if (!found) {
        return { found: false };
      }

      settingsStore.update({
        walletDatabasePath: found,
        selectedAccountId: "",
      });

      resetMiningClock(
        found,
        Date.now(),
      );

      return {
        found: true,
        path: found,
      };
    },
  );

  ipcMain.handle(
    "wallet:choose-database",
    async () => {
      const result =
        await dialog.showOpenDialog(
          mainWindow,
          {
            title:
              "SD지갑 데이터베이스 선택",
            properties: ["openFile"],
            filters: [
              {
                name:
                  "SQLite Database",
                extensions: [
                  "sqlite",
                  "db",
                  "sqlite3",
                ],
              },
            ],
          },
        );

      if (
        result.canceled ||
        result.filePaths.length === 0
      ) {
        return { canceled: true };
      }

      const databasePath =
        result.filePaths[0];

      const validation =
        validateWalletDatabase(
          databasePath,
        );

      if (!validation.ok) {
        return {
          canceled: false,
          ok: false,
          error: validation.error,
        };
      }

      settingsStore.update({
        walletDatabasePath:
          databasePath,
        selectedAccountId: "",
      });

      resetMiningClock(
        databasePath,
        Date.now(),
      );

      return {
        canceled: false,
        ok: true,
        path: databasePath,
      };
    },
  );

  ipcMain.handle(
    "wallet:list-accounts",
    () => {
      const databasePath =
        currentWalletPath();

      if (!databasePath) {
        return {
          connected: false,
          accounts: [],
        };
      }

      try {
        return {
          connected: true,
          databasePath,
          accounts:
            listAccounts(
              databasePath,
            ),
        };
      } catch (error) {
        return {
          connected: false,
          accounts: [],
          error: error.message,
        };
      }
    },
  );

  ipcMain.handle(
    "wallet:get-state",
    (event, accountId) => {
      try {
        runMiningTick();

        const currentState =
          getAccountState(
            currentWalletPath(),
            String(accountId || ""),
          );

        if (!currentState) {
          return {
            connected: false,
          };
        }

        return {
          connected: true,
          ...currentState,
        };
      } catch (error) {
        return {
          connected: false,
          error: error.message,
        };
      }
    },
  );

  ipcMain.handle(
    "room:buy",
    (event, payload) => {
      try {
        const result = buyRoom(
          currentWalletPath(),
          String(
            payload?.accountId || "",
          ),
          String(
            payload?.roomKey || "",
          ),
        );

        return {
          ok: true,
          ...result,
        };
      } catch (error) {
        return {
          ok: false,
          error: error.message,
        };
      }
    },
  );

  ipcMain.handle(
    "shop:buy-frame",
    (event, payload) => {
      try {
        runMiningTick();

        const result = buyFrame(
          currentWalletPath(),
          String(
            payload?.accountId || "",
          ),
          String(
            payload?.roomKey || "",
          ),
        );

        return {
          ok: true,
          ...result,
        };
      } catch (error) {
        return {
          ok: false,
          error: error.message,
        };
      }
    },
  );

  ipcMain.handle(
    "shop:buy-gpu",
    (event, payload) => {
      try {
        runMiningTick();

        const result = buyGpu(
          currentWalletPath(),
          String(
            payload?.accountId || "",
          ),
          String(
            payload?.roomKey || "",
          ),
        );

        return {
          ok: true,
          ...result,
        };
      } catch (error) {
        return {
          ok: false,
          error: error.message,
        };
      }
    },
  );

  ipcMain.handle(
    "room:decorate",
    (event, payload) => {
      try {
        const result =
          decorateRoom(
            currentWalletPath(),
            String(
              payload?.accountId ||
                "",
            ),
            String(
              payload?.roomKey ||
                "",
            ),
            String(
              payload?.wallTheme ||
                "",
            ),
            String(
              payload?.floorTheme ||
                "",
            ),
          );

        return {
          ok: true,
          ...result,
        };
      } catch (error) {
        return {
          ok: false,
          error: error.message,
        };
      }
    },
  );

  ipcMain.handle(
    "electricity:reactivate",
    (event, accountId) => {
      try {
        const result = reactivateElectricity(
          currentWalletPath(),
          String(accountId || ""),
          Date.now(),
        );

        return { ok: true, ...result };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "bitcoin:sell",
    (event, payload) => {
      try {
        runMiningTick();

        const result =
          sellBitcoin(
            currentWalletPath(),
            String(
              payload?.accountId ||
                "",
            ),
            payload?.btcAmount,
          );

        return {
          ok: true,
          ...result,
        };
      } catch (error) {
        return {
          ok: false,
          error: error.message,
        };
      }
    },
  );
}

app.whenReady().then(() => {
  settingsStore =
    new SettingsStore(
      path.join(
        app.getPath("userData"),
        "settings.json",
      ),
    );

  registerIpc();

  session.defaultSession
    .setPermissionRequestHandler(
      (
        webContents,
        permission,
        callback,
      ) => callback(false),
    );

  createTray();
  configureWindowsStartup();
  createWindow();
  startMiningLoop();
});

app.on("second-instance", () => {
  showMainWindow();
});

app.on("activate", () => {
  showMainWindow();
});

app.on("before-quit", () => {
  isQuitting = true;

  if (miningTimer) {
    clearInterval(miningTimer);
    miningTimer = null;
  }
});

app.on("window-all-closed", () => {
  // 시스템 트레이에서 계속 실행합니다.
});

