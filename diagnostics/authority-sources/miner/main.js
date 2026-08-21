"use strict";

const path = require("node:path");
const { isSdCenterUrl, openSdCenter } = require("./src/open-center");
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
} = require("electron");

const { SettingsStore } = require("./src/settings");
const {
  AUTO_MINING_UPGRADE_PRICE,
  addMinedOre,
  autoFindWalletDatabase,
  getAccount,
  getInventory,
  getMiningStatistics,
  getMiningUpgrade,
  getRecentMiningHistory,
  getSalesHistory,
  listAccounts,
  purchaseAutoMiningUpgrade,
  sellAllOre,
  sellOre,
  validateWalletDatabase,
} = require("./src/wallet-database");
const {
  ORES,
  drawOre,
} = require("./src/mining-engine");

const singleInstanceLock =
  app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
}

let mainWindow = null;
let settingsStore = null;

const lastMineAtByAccount = new Map();
const MINING_COOLDOWN_MS = 300;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 920,
    minWidth: 980,
    minHeight: 720,
    title: "SD광부",
    backgroundColor: "#080a0d",
    autoHideMenuBar: true,
    show: false,
    icon: path.join(
      __dirname,
      "public",
      "icons",
      "icon-512.png",
    ),

    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
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
        const target = new URL(navigationUrl);

        if (target.protocol !== "file:") {
          event.preventDefault();
        }
      } catch {
        event.preventDefault();
      }
    },
  );

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.loadFile(
    path.join(__dirname, "public", "index.html"),
  );
}

function currentWalletPath() {
  return settingsStore.get().walletDatabasePath;
}

function registerIpcHandlers() {
  ipcMain.handle("settings:get", () => {
    return settingsStore.get();
  });

  ipcMain.handle("settings:save", (event, patch) => {
    return settingsStore.update(patch);
  });

  ipcMain.handle("mining:get-config", () => {
    return {
      ores: ORES,
      cooldownMs: MINING_COOLDOWN_MS,
      autoMiningUpgradePrice:
        AUTO_MINING_UPGRADE_PRICE,
    };
  });

  ipcMain.handle("wallet:auto-detect", () => {
    const found = autoFindWalletDatabase({
      appDataPath: app.getPath("appData"),
      homePath: app.getPath("home"),
    });

    if (!found) {
      return { found: false };
    }

    settingsStore.update({
      walletDatabasePath: found,
      selectedAccountId: "",
    });

    return {
      found: true,
      path: found,
    };
  });

  ipcMain.handle(
    "wallet:choose-database",
    async () => {
      const result = await dialog.showOpenDialog(
        mainWindow,
        {
          title: "SD지갑 데이터베이스 선택",
          properties: ["openFile"],
          filters: [
            {
              name: "SQLite Database",
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

      const databasePath = result.filePaths[0];
      const validation =
        validateWalletDatabase(databasePath);

      if (!validation.ok) {
        return {
          canceled: false,
          ok: false,
          error: validation.error,
        };
      }

      settingsStore.update({
        walletDatabasePath: databasePath,
        selectedAccountId: "",
      });

      return {
        canceled: false,
        ok: true,
        path: databasePath,
      };
    },
  );

  ipcMain.handle("wallet:list-accounts", () => {
    const databasePath = currentWalletPath();

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
        accounts: listAccounts(databasePath),
      };
    } catch (error) {
      return {
        connected: false,
        databasePath,
        accounts: [],
        error: error.message,
      };
    }
  });

  ipcMain.handle(
    "wallet:get-account-state",
    (event, accountId) => {
      const databasePath = currentWalletPath();

      if (!databasePath || !accountId) {
        return {
          connected: false,
          account: null,
          inventory: null,
          history: [],
          salesHistory: [],
          statistics: null,
        };
      }

      try {
        const normalizedAccountId =
          String(accountId);
        const account = getAccount(
          databasePath,
          normalizedAccountId,
        );

        if (!account) {
          return {
            connected: false,
            account: null,
            inventory: null,
            history: [],
            salesHistory: [],
            statistics: null,
          };
        }

        return {
          connected: true,
          account,
          inventory: getInventory(
            databasePath,
            normalizedAccountId,
          ),
          upgrade: getMiningUpgrade(
            databasePath,
            normalizedAccountId,
          ),
          history: getRecentMiningHistory(
            databasePath,
            normalizedAccountId,
            14,
          ),
          salesHistory: getSalesHistory(
            databasePath,
            normalizedAccountId,
            50,
          ),
          statistics: getMiningStatistics(
            databasePath,
            normalizedAccountId,
          ),
        };
      } catch (error) {
        return {
          connected: false,
          account: null,
          inventory: null,
          history: [],
          salesHistory: [],
          statistics: null,
          error: error.message,
        };
      }
    },
  );

  ipcMain.handle(
    "mining:mine",
    (event, accountId) => {
      const databasePath = currentWalletPath();
      const normalizedAccountId =
        String(accountId || "");

      if (
        !databasePath ||
        !normalizedAccountId
      ) {
        return {
          ok: false,
          error: "먼저 SD지갑 계좌를 연결하세요.",
        };
      }

      const now = Date.now();
      const lastMineAt =
        lastMineAtByAccount.get(
          normalizedAccountId,
        ) || 0;
      const elapsed = now - lastMineAt;

      if (elapsed < MINING_COOLDOWN_MS) {
        return {
          ok: false,
          cooldown: true,
          retryAfterMs:
            MINING_COOLDOWN_MS - elapsed,
        };
      }

      lastMineAtByAccount.set(
        normalizedAccountId,
        now,
      );

      try {
        const ore = drawOre();
        const inventory = addMinedOre({
          databasePath,
          accountId: normalizedAccountId,
          oreKey: ore.key,
        });

        return {
          ok: true,
          ore,
          inventory,
          minedAt: new Date().toISOString(),
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
  "shop:buy-auto-mining-upgrade",
  (event, accountId) => {
    const databasePath =
      currentWalletPath();

    try {
      const result =
        purchaseAutoMiningUpgrade({
          databasePath,
          accountId: String(
            accountId || "",
          ),
        });

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
    "shop:sell",
    (event, payload) => {
      const databasePath = currentWalletPath();

      try {
        const result = sellOre({
          databasePath,
          accountId: String(
            payload?.accountId || "",
          ),
          oreKey: String(
            payload?.oreKey || "",
          ),
          quantity: payload?.quantity,
        });

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
    "shop:sell-all",
    (event, accountId) => {
      const databasePath = currentWalletPath();

      try {
        const result = sellAllOre({
          databasePath,
          accountId: String(accountId || ""),
        });

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
  settingsStore = new SettingsStore(
    path.join(
      app.getPath("userData"),
      "settings.json",
    ),
  );

  registerIpcHandlers();

  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      callback(false);
    },
  );

  createWindow();
});

app.on("second-instance", () => {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
});

app.on("window-all-closed", () => {
  app.quit();
});
