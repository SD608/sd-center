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
  applyGameResult,
  autoFindWalletDatabase,
  getAccount,
  getRecentTransactions,
  listAccounts,
  validateWalletDatabase,
} = require("./src/wallet-database");
const { GameEngine } = require("./src/game-engine");

const singleInstanceLock =
  app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
}

let mainWindow = null;
let settingsStore = null;
const gameEngine = new GameEngine();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 980,
    minHeight: 720,
    title: "SD홀짝",
    backgroundColor: "#080b12",
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
    "wallet:get-account",
    (event, accountId) => {
      const databasePath = currentWalletPath();

      if (!databasePath || !accountId) {
        return {
          connected: false,
          account: null,
          transactions: [],
        };
      }

      try {
        const account = getAccount(
          databasePath,
          String(accountId),
        );

        const transactions = account
          ? getRecentTransactions(
              databasePath,
              String(accountId),
              12,
            )
          : [];

        return {
          connected: Boolean(account),
          account,
          transactions,
        };
      } catch (error) {
        return {
          connected: false,
          account: null,
          transactions: [],
          error: error.message,
        };
      }
    },
  );

  ipcMain.handle(
    "game:start",
    (event, payload) => {
      const settings = settingsStore.get();
      const accountId = String(
        payload?.accountId || "",
      );

      if (
        !settings.walletDatabasePath ||
        !accountId
      ) {
        return {
          ok: false,
          error: "먼저 SD지갑 계좌를 연결하세요.",
        };
      }

      try {
        const account = getAccount(
          settings.walletDatabasePath,
          accountId,
        );

        if (!account) {
          throw new Error(
            "연결 계좌를 찾을 수 없습니다.",
          );
        }

        const round = gameEngine.startRound({
          accountId,
          betAmountKrw: payload?.betAmountKrw,
          multiplier: payload?.multiplier,
          allIn: payload?.allIn === true,
          balance: account.balance,
        });

        settingsStore.update({
          selectedAccountId: accountId,
          selectedBetKrw: Number(payload?.betAmountKrw),
          betMode: round.allIn ? "all-in" : "fixed",
          selectedMultiplier: round.multiplier,
        });

        return {
          ok: true,
          ...round,
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
    "game:stop",
    (event, roundId) => {
      try {
        return {
          ok: true,
          ...gameEngine.stopRound(roundId),
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
    "game:resolve",
    (event, payload) => {
      const settings = settingsStore.get();
      let result;

      try {
        result = gameEngine.resolveRound({
          roundId: payload?.roundId,
          choice: payload?.choice,
        });

        const walletResult = applyGameResult({
          databasePath:
            settings.walletDatabasePath,
          accountId: result.accountId,
          won: result.won,
          stake: result.stake,
        });

        gameEngine.finishRound(payload?.roundId);

        return {
          ok: true,
          ...result,
          balance: walletResult.balance,
          transaction: walletResult.transaction,
        };
      } catch (error) {
        if (payload?.roundId) {
          gameEngine.cancelRound(payload.roundId);
        }

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
