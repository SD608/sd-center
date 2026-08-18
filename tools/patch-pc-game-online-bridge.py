from __future__ import annotations

import json
import re
import shutil
import tempfile
import zipfile
from pathlib import Path

ROOT = Path.cwd()

LINK_SOURCE = ROOT / "downloads/extensions/SDLink_v1.3.1_Desktop.zip"
SLOT_SOURCE = ROOT / "downloads/extensions/SDSlot_Stage7_Desktop.zip"
ODD_SOURCE = ROOT / "downloads/extensions/SDOddEven_v1.1.1_Desktop.zip"

LINK_OUTPUT = ROOT / "downloads/extensions/SDLink_v1.4.0_Desktop.zip"
SLOT_OUTPUT = ROOT / "downloads/extensions/SDSlot_v1.1.0_Desktop.zip"
ODD_OUTPUT = ROOT / "downloads/extensions/SDOddEven_v1.2.0_Desktop.zip"

LINK_VERSION = "1.4.0"
SLOT_VERSION = "1.1.0"
ODD_VERSION = "1.2.0"

GAME_BRIDGE_SERVER = ROOT / "tools/pc-game-online-bridge/game-bridge-server.js"
GAME_CLIENT = ROOT / "tools/pc-game-online-bridge/sdlink-game-client.js"


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def extract(zip_path: Path, destination: Path) -> Path:
    with zipfile.ZipFile(zip_path) as archive:
        archive.extractall(destination)
    package_roots: list[Path] = []
    for package in destination.rglob("package.json"):
        if "node_modules" in {part.lower() for part in package.parts}:
            continue
        package_roots.append(package.parent)
    if not package_roots:
        raise RuntimeError(f"package root not found: {zip_path}")
    package_roots.sort(key=lambda item: len(item.parts))
    return package_roots[0]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"anchor missing: {label}")
    return text.replace(old, new, 1)


def sub_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"regex patch failed: {label}")
    return updated


def patch_sdlink(root: Path) -> None:
    shutil.copy2(GAME_BRIDGE_SERVER, root / "src" / "game-bridge-server.js")
    main = root / "main.js"
    text = main.read_text(encoding="utf-8")

    import_anchor = 'const { inspectBitcoinSource } = require("./src/bitcoin-reader");\n'
    text = replace_once(
        text,
        import_anchor,
        import_anchor + 'const { GameBridgeServer } = require("./src/game-bridge-server");\n',
        "sdlink bridge import",
    )
    text = replace_once(
        text,
        "let syncEngine = null;\nlet timer = null;",
        "let syncEngine = null;\nlet gameBridge = null;\nlet timer = null;",
        "sdlink bridge variable",
    )

    text = replace_once(
        text,
        "    return appState(false);\n  });\n\n  ipcMain.handle(\"sdlink:logout\"",
        "    gameBridge?.refreshState();\n    return appState(false);\n  });\n\n  ipcMain.handle(\"sdlink:logout\"",
        "sdlink login refresh",
    )
    text = replace_once(
        text,
        "    await authService.signOut();\n    return appState(false);\n  });\n\n  ipcMain.handle(\"sdlink:register-device\"",
        "    await authService.signOut();\n    gameBridge?.refreshState();\n    return appState(false);\n  });\n\n  ipcMain.handle(\"sdlink:register-device\"",
        "sdlink logout refresh",
    )
    text = replace_once(
        text,
        "    syncEngine.clearIntegrationState();\n    await authService.signOut();\n    syncState.clearSynchronizationMarks();",
        "    syncEngine.clearIntegrationState();\n    await authService.signOut();\n    gameBridge?.refreshState();\n    syncState.clearSynchronizationMarks();",
        "sdlink reset refresh",
    )

    ready_old = '''app.whenReady().then(() => {
  configStore = new ConfigStore(app.getPath("userData"));
  authService = new AuthService(app.getPath("userData"), safeStorage);
  syncState = new SyncState(app.getPath("userData"));
  syncEngine = new SyncEngine({
    authService,
    configStore,
    syncState,
    userDataDirectory: app.getPath("userData"),
    onStatus: sendStatus,
  });
  registerIpc();
  createWindow();
  createTray();
  startAutoSync();
});'''
    ready_new = '''app.whenReady().then(async () => {
  configStore = new ConfigStore(app.getPath("userData"));
  authService = new AuthService(app.getPath("userData"), safeStorage);
  syncState = new SyncState(app.getPath("userData"));
  syncEngine = new SyncEngine({
    authService,
    configStore,
    syncState,
    userDataDirectory: app.getPath("userData"),
    onStatus: sendStatus,
  });
  gameBridge = new GameBridgeServer({
    authService,
    onActivity: () => {
      setTimeout(() => {
        if (!authService?.publicSession().authenticated) return;
        const config = configStore?.load();
        if (!config?.databasePath || !config?.selectedAccountId) return;
        syncEngine?.syncOnce().catch(() => {});
      }, 120);
    },
  });
  try {
    await gameBridge.start();
  } catch (error) {
    sendStatus({
      message: `PC 게임 온라인 브리지를 시작하지 못했습니다: ${error?.message || error}`,
      kind: "error",
      at: new Date().toISOString(),
    });
  }
  registerIpc();
  createWindow();
  createTray();
  startAutoSync();
});'''
    text = replace_once(text, ready_old, ready_new, "sdlink app ready")

    text = replace_once(
        text,
        "  try { tray?.destroy(); } catch { /* 종료 계속 */ }\n  try { syncState?.close(); } catch { /* 종료 계속 */ }",
        "  try { tray?.destroy(); } catch { /* 종료 계속 */ }\n  try { gameBridge?.stop().catch(() => {}); } catch { /* 종료 계속 */ }\n  try { syncState?.close(); } catch { /* 종료 계속 */ }",
        "sdlink before quit",
    )
    main.write_text(text, encoding="utf-8")

    package = json.loads((root / "package.json").read_text(encoding="utf-8"))
    package["version"] = LINK_VERSION
    package["description"] = "PC 확장팩과 SD Online을 연결하고 슬롯·홀짝을 모바일과 같은 서버에서 실행하는 SD Link"
    if "src/game-bridge-server.js" not in package.get("scripts", {}).get("check", ""):
        package["scripts"]["check"] += " && node --check src/game-bridge-server.js"
    write_json(root / "package.json", package)

    sd_app = root / "sd-app.json"
    if sd_app.exists():
        value = json.loads(sd_app.read_text(encoding="utf-8"))
        value["version"] = LINK_VERSION
        value["displayVersion"] = f"Stage 1 · v{LINK_VERSION}"
        value["description"] = "PC 확장팩과 SD Online 계정을 연결하는 핵심 연동 확장팩입니다."
        value["improvement"] = "PC 슬롯·홀짝을 localhost 인증 브리지로 모바일과 같은 Supabase 게임 서버에 연결합니다. 로그인 토큰은 SD Link 내부에만 보관됩니다."
        write_json(sd_app, value)


def patch_slot(root: Path) -> None:
    shutil.copy2(GAME_CLIENT, root / "src" / "sdlink-game-client.js")
    main = root / "main.js"
    text = main.read_text(encoding="utf-8")

    import_anchor = 'const { createSpinResult, SYMBOLS } = require("./src/slot-engine");\n'
    text = replace_once(
        text,
        import_anchor,
        import_anchor + 'const { SdLinkGameClient } = require("./src/sdlink-game-client");\n',
        "slot game client import",
    )
    text = replace_once(
        text,
        "let mainWindow = null;\nlet settingsStore = null;",
        "let mainWindow = null;\nlet settingsStore = null;\nlet onlineGameClient = null;\nconst pendingOnlineSpins = new Map();\nconst ONLINE_ACCOUNT_ID = \"sd-online\";",
        "slot client variable",
    )

    text = sub_once(
        text,
        r'''  ipcMain\.handle\("wallet:auto-detect", \(\) => \{.*?\n  \}\);\n\n  ipcMain\.handle\("wallet:choose-database", async \(\) => \{.*?\n  \}\);''',
        '''  ipcMain.handle("wallet:auto-detect", async () => {
    try {
      await onlineGameClient.state();
      settingsStore.update({ walletDatabasePath: "SD Link Online", selectedAccountId: ONLINE_ACCOUNT_ID });
      return { found: true, path: "SD Link Online" };
    } catch (error) {
      return { found: false, error: error.message };
    }
  });

  ipcMain.handle("wallet:choose-database", async () => {
    try {
      await onlineGameClient.state();
      settingsStore.update({ walletDatabasePath: "SD Link Online", selectedAccountId: ONLINE_ACCOUNT_ID });
      return { canceled: false, ok: true, path: "SD Link Online" };
    } catch (error) {
      return { canceled: false, ok: false, error: error.message };
    }
  });''',
        "slot online connect handlers",
    )

    text = sub_once(
        text,
        r'''  ipcMain\.handle\("wallet:list-accounts", \(\) => \{.*?\n  \}\);\n\n  ipcMain\.handle\("wallet:get-account", \(event, accountId\) => \{.*?\n  \}\);''',
        '''  ipcMain.handle("wallet:list-accounts", async () => {
    try {
      const state = await onlineGameClient.state();
      settingsStore.update({ walletDatabasePath: "SD Link Online", selectedAccountId: ONLINE_ACCOUNT_ID });
      return { connected: true, databasePath: "SD Link Online", accounts: [state.account] };
    } catch (error) {
      return { connected: false, databasePath: "SD Link Online", accounts: [], error: error.message };
    }
  });

  ipcMain.handle("wallet:get-account", async () => {
    try {
      const state = await onlineGameClient.state();
      return {
        connected: true,
        account: state.account,
        transactions: state.normalizedTransactions,
      };
    } catch (error) {
      return { connected: false, account: null, transactions: [], error: error.message };
    }
  });''',
        "slot online wallet handlers",
    )

    text = sub_once(
        text,
        r'''  ipcMain\.handle\("slot:start", \(event, payload\) => \{.*?\n  \}\);\n\n  ipcMain\.handle\("slot:settle", \(event, roundId\) => \{.*?\n  \}\);''',
        '''  ipcMain.handle("slot:start", async (event, payload) => {
    const betAmount = Math.trunc(Number(payload?.betAmount));
    if (!Number.isSafeInteger(betAmount) || betAmount < 100) {
      return { ok: false, error: "베팅금은 100원 이상의 정수로 입력하세요." };
    }

    try {
      const data = await onlineGameClient.rpc("play_sd_slot", {
        p_wager: betAmount,
        p_request_id: onlineGameClient.uuid(),
        p_platform: "windows",
      });
      const roundId = String(data?.round_id || "");
      if (!roundId) throw new Error("온라인 슬롯 라운드 번호를 받지 못했습니다.");
      const wager = Math.trunc(Number(data?.wager || betAmount));
      const balanceBefore = Math.trunc(Number(data?.balance_before || 0));
      const balanceAfter = Math.trunc(Number(data?.balance_after || 0));
      pendingOnlineSpins.set(roundId, { balance: balanceAfter });
      settingsStore.update({
        walletDatabasePath: "SD Link Online",
        selectedAccountId: ONLINE_ACCOUNT_ID,
        betAmount: wager,
      });
      return {
        ok: true,
        roll: Number(data?.roll || 0),
        resultKey: String(data?.result_key || "miss"),
        resultName: String(data?.result_name || "꽝"),
        probability: String(data?.probability || ""),
        multiplier: Number(data?.multiplier || 0),
        stake: wager,
        payout: Math.trunc(Number(data?.payout || 0)),
        reels: Array.isArray(data?.reels) ? data.reels.map(String) : [],
        won: Boolean(data?.won),
        jackpot: Boolean(data?.jackpot),
        roundId,
        balanceAfterBet: balanceBefore - wager,
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("slot:settle", async (event, roundId) => {
    const key = String(roundId || "");
    try {
      const cached = pendingOnlineSpins.get(key);
      pendingOnlineSpins.delete(key);
      if (cached) return { ok: true, balance: cached.balance };
      const state = await onlineGameClient.state();
      return { ok: true, balance: state.account.balance };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });''',
        "slot online game handlers",
    )

    text = replace_once(
        text,
        '''app.whenReady().then(() => {
  settingsStore = new SettingsStore(path.join(app.getPath("userData"), "settings.json"));
  registerIpc();''',
        '''app.whenReady().then(() => {
  settingsStore = new SettingsStore(path.join(app.getPath("userData"), "settings.json"));
  onlineGameClient = new SdLinkGameClient();
  settingsStore.update({ walletDatabasePath: "SD Link Online", selectedAccountId: ONLINE_ACCOUNT_ID });
  registerIpc();''',
        "slot app ready client",
    )
    main.write_text(text, encoding="utf-8")

    package = json.loads((root / "package.json").read_text(encoding="utf-8"))
    package["version"] = SLOT_VERSION
    package["description"] = "SD Link를 통해 모바일과 같은 SD Online 서버에서 실행되는 3릴 슬롯머신"
    write_json(root / "package.json", package)

    sd_app = root / "sd-app.json"
    if sd_app.exists():
        value = json.loads(sd_app.read_text(encoding="utf-8"))
        value["version"] = SLOT_VERSION
        value["displayVersion"] = f"Stage 7 · v{SLOT_VERSION}"
        value["description"] = "SD Link를 통해 모바일과 같은 SD Online 잔액·확률·게임 기록을 사용하는 3릴 슬롯머신입니다."
        value["improvement"] = "PC 슬롯 결과를 로컬 난수/정산 대신 모바일과 동일한 play_sd_slot 서버 RPC에서 확정합니다. PC와 모바일의 게임 기록·잔액·업적이 같은 계정으로 합쳐집니다."
        write_json(sd_app, value)


def patch_odd_even(root: Path) -> None:
    shutil.copy2(GAME_CLIENT, root / "src" / "sdlink-game-client.js")
    main = root / "main.js"
    text = main.read_text(encoding="utf-8")

    import_anchor = 'const { GameEngine } = require("./src/game-engine");\n'
    text = replace_once(
        text,
        import_anchor,
        import_anchor + 'const { SdLinkGameClient } = require("./src/sdlink-game-client");\n',
        "odd game client import",
    )
    text = replace_once(
        text,
        "let mainWindow = null;\nlet settingsStore = null;\nconst gameEngine = new GameEngine();",
        "let mainWindow = null;\nlet settingsStore = null;\nlet onlineGameClient = null;\nconst gameEngine = new GameEngine();\nconst onlineOddEvenRounds = new Map();\nconst ONLINE_ACCOUNT_ID = \"sd-online\";",
        "odd client variable",
    )

    text = sub_once(
        text,
        r'''  ipcMain\.handle\("wallet:auto-detect", \(\) => \{.*?\n  \}\);\n\n  ipcMain\.handle\(\n    "wallet:choose-database",.*?\n  \);''',
        '''  ipcMain.handle("wallet:auto-detect", async () => {
    try {
      await onlineGameClient.state();
      settingsStore.update({ walletDatabasePath: "SD Link Online", selectedAccountId: ONLINE_ACCOUNT_ID });
      return { found: true, path: "SD Link Online" };
    } catch (error) {
      return { found: false, error: error.message };
    }
  });

  ipcMain.handle("wallet:choose-database", async () => {
    try {
      await onlineGameClient.state();
      settingsStore.update({ walletDatabasePath: "SD Link Online", selectedAccountId: ONLINE_ACCOUNT_ID });
      return { canceled: false, ok: true, path: "SD Link Online" };
    } catch (error) {
      return { canceled: false, ok: false, error: error.message };
    }
  });''',
        "odd online connect handlers",
    )

    text = sub_once(
        text,
        r'''  ipcMain\.handle\("wallet:list-accounts", \(\) => \{.*?\n  \}\);\n\n  ipcMain\.handle\(\n    "wallet:get-account",.*?\n  \);''',
        '''  ipcMain.handle("wallet:list-accounts", async () => {
    try {
      const state = await onlineGameClient.state();
      settingsStore.update({ walletDatabasePath: "SD Link Online", selectedAccountId: ONLINE_ACCOUNT_ID });
      return { connected: true, databasePath: "SD Link Online", accounts: [state.account] };
    } catch (error) {
      return { connected: false, databasePath: "SD Link Online", accounts: [], error: error.message };
    }
  });

  ipcMain.handle("wallet:get-account", async () => {
    try {
      const state = await onlineGameClient.state();
      return {
        connected: true,
        account: state.account,
        transactions: state.normalizedTransactions,
      };
    } catch (error) {
      return { connected: false, account: null, transactions: [], error: error.message };
    }
  });''',
        "odd online wallet handlers",
    )

    text = sub_once(
        text,
        r'''  ipcMain\.handle\(\n    "game:start",.*?\n  \);\n\n  ipcMain\.handle\(\n    "game:stop",.*?\n  \);\n\n  ipcMain\.handle\(\n    "game:resolve",.*?\n  \);''',
        '''  ipcMain.handle("game:start", async (event, payload) => {
    try {
      const state = await onlineGameClient.state();
      const round = gameEngine.startRound({
        accountId: ONLINE_ACCOUNT_ID,
        betAmountKrw: payload?.betAmountKrw,
        multiplier: payload?.multiplier,
        allIn: payload?.allIn === true,
        balance: state.account.balance,
      });
      settingsStore.update({
        walletDatabasePath: "SD Link Online",
        selectedAccountId: ONLINE_ACCOUNT_ID,
        selectedBetKrw: Number(payload?.betAmountKrw),
        betMode: round.allIn ? "all-in" : "fixed",
        selectedMultiplier: round.multiplier,
      });
      return { ok: true, ...round };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("game:stop", async (event, roundId) => {
    const localRoundId = String(roundId || "");
    try {
      const local = gameEngine.stopRound(localRoundId);
      const server = await onlineGameClient.rpc("start_sd_odd_even", {
        p_wager: local.stake,
        p_request_id: onlineGameClient.uuid(),
        p_platform: "windows",
      });
      const serverRoundId = String(server?.round_id || "");
      if (!serverRoundId) throw new Error("온라인 홀짝 라운드 번호를 받지 못했습니다.");
      onlineOddEvenRounds.set(localRoundId, serverRoundId);
      return {
        ok: true,
        ...local,
        balanceAfterWager: Math.trunc(Number(server?.balance_after_wager || 0)),
      };
    } catch (error) {
      gameEngine.cancelRound(localRoundId);
      onlineOddEvenRounds.delete(localRoundId);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("game:resolve", async (event, payload) => {
    const localRoundId = String(payload?.roundId || "");
    try {
      const serverRoundId = onlineOddEvenRounds.get(localRoundId);
      if (!serverRoundId) throw new Error("온라인 홀짝 라운드 정보를 찾지 못했습니다.");
      const data = await onlineGameClient.rpc("finish_sd_odd_even", {
        p_round_id: serverRoundId,
        p_choice: payload?.choice,
      });
      onlineOddEvenRounds.delete(localRoundId);
      gameEngine.finishRound(localRoundId);
      const wager = Math.trunc(Number(data?.wager || 0));
      const won = Boolean(data?.won);
      const now = new Date().toISOString();
      return {
        ok: true,
        dice: [Number(data?.die1 || 1), Number(data?.die2 || 1)],
        sum: Number(data?.total || 0),
        parity: String(data?.parity || "odd"),
        choice: String(data?.choice || payload?.choice || "odd"),
        won,
        stake: wager,
        multiplier: 1,
        balance: Math.trunc(Number(data?.balance_after || 0)),
        transaction: {
          id: String(data?.round_id || serverRoundId),
          type: won ? "deposit" : "withdraw",
          memo: "홀짝 게임",
          amount: wager,
          createdAt: now,
        },
      };
    } catch (error) {
      if (localRoundId) gameEngine.cancelRound(localRoundId);
      onlineOddEvenRounds.delete(localRoundId);
      return { ok: false, error: error.message };
    }
  });''',
        "odd online game handlers",
    )

    text = replace_once(
        text,
        '''  settingsStore = new SettingsStore(
    path.join(
      app.getPath("userData"),
      "settings.json",
    ),
  );

  registerIpcHandlers();''',
        '''  settingsStore = new SettingsStore(
    path.join(
      app.getPath("userData"),
      "settings.json",
    ),
  );
  onlineGameClient = new SdLinkGameClient();
  settingsStore.update({ walletDatabasePath: "SD Link Online", selectedAccountId: ONLINE_ACCOUNT_ID });

  registerIpcHandlers();''',
        "odd app ready client",
    )
    main.write_text(text, encoding="utf-8")

    app_js = root / "public" / "js" / "app.js"
    ui = app_js.read_text(encoding="utf-8")
    ui = replace_once(
        ui,
        '''  if (!result.ok) {
    showToast(result.error);
    resetRound();
    return;
  }

  setPhase("choosing");''',
        '''  if (!result.ok) {
    showToast(result.error);
    resetRound();
    return;
  }

  if (Number.isFinite(Number(result.balanceAfterWager)) && state.account) {
    state.account.balance = Number(result.balanceAfterWager);
    state.account.updatedAt = new Date().toISOString();
    renderAccount();
  }

  setPhase("choosing");''',
        "odd UI wager balance",
    )
    app_js.write_text(ui, encoding="utf-8")

    package = json.loads((root / "package.json").read_text(encoding="utf-8"))
    package["version"] = ODD_VERSION
    package["description"] = "SD Link를 통해 모바일과 같은 SD Online 서버에서 실행되는 주사위 홀짝 게임"
    write_json(root / "package.json", package)

    sd_app = root / "sd-app.json"
    if sd_app.exists():
        value = json.loads(sd_app.read_text(encoding="utf-8"))
        value["version"] = ODD_VERSION
        value["displayVersion"] = f"Stage 4 · v{ODD_VERSION}"
        value["description"] = "SD Link를 통해 모바일과 같은 SD Online 잔액·주사위 결과·게임 기록을 사용하는 홀짝 게임입니다."
        value["improvement"] = "PC 홀짝의 주사위와 정산을 모바일과 동일한 start_sd_odd_even / finish_sd_odd_even 서버 RPC로 통합했습니다. PC와 모바일의 기록·잔액·업적이 같은 계정으로 합쳐집니다."
        write_json(sd_app, value)


def pack(root: Path, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        base = root.parent
        for path in root.rglob("*"):
            if path.is_file():
                archive.write(path, path.relative_to(base))


def main() -> None:
    for source in (LINK_SOURCE, SLOT_SOURCE, ODD_SOURCE, GAME_BRIDGE_SERVER, GAME_CLIENT):
        if not source.exists():
            raise RuntimeError(f"required source missing: {source}")

    with tempfile.TemporaryDirectory(prefix="sd-pc-game-online-") as temp_name:
        temp = Path(temp_name)
        link_root = extract(LINK_SOURCE, temp / "link")
        slot_root = extract(SLOT_SOURCE, temp / "slot")
        odd_root = extract(ODD_SOURCE, temp / "odd")

        patch_sdlink(link_root)
        patch_slot(slot_root)
        patch_odd_even(odd_root)

        pack(link_root, LINK_OUTPUT)
        pack(slot_root, SLOT_OUTPUT)
        pack(odd_root, ODD_OUTPUT)

    print(f"built {LINK_OUTPUT}")
    print(f"built {SLOT_OUTPUT}")
    print(f"built {ODD_OUTPUT}")


if __name__ == "__main__":
    main()
