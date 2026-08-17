from __future__ import annotations

import json
import re
import tempfile
import zipfile
from pathlib import Path

ROOT = Path.cwd()
SOURCE = ROOT / "downloads/extensions/SDLink_v1.2.9_Desktop.zip"
OUTPUT = ROOT / "downloads/extensions/SDLink_v1.3.0_Desktop.zip"
CATALOG = ROOT / "update/extensions-catalog.json"
POLICY = ROOT / "update/desktop-policy.json"
EXT_DATA = [ROOT / "extensions-data.js", ROOT / "assets/js/extensions-data.js"]
VERSION = "1.3.0"
VERSION_TAG = "130"
MARKER = "SDLINK_LOGISTICS_BRIDGE_V130"

LOGISTICS_READER = r'''"use strict";

// SDLINK_LOGISTICS_BRIDGE_V130
// SD 물류센터 v1.1.0이 내보내는 비밀정보 없는 로컬 진행도 스냅샷을 읽습니다.
const fs = require("node:fs");
const path = require("node:path");

function unique(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (!value) continue;
    const resolved = path.resolve(String(value));
    const key = resolved.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }
  return out;
}

function candidates(walletDatabasePath = "") {
  const walletDir = walletDatabasePath ? path.dirname(path.resolve(walletDatabasePath)) : "";
  const roots = unique([
    process.env.APPDATA,
    process.env.LOCALAPPDATA,
    walletDir,
    walletDir && path.dirname(walletDir),
    walletDir && path.dirname(path.dirname(walletDir)),
  ]);
  const files = [];
  for (const root of roots) {
    files.push(path.join(root, "SDLogisticsCenter", "sd-logistics-progress.json"));
    files.push(path.join(root, "SD 물류센터", "sd-logistics-progress.json"));
    files.push(path.join(root, "sd-logistics-progress.json"));
  }
  return unique(files);
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function normalize(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const vehicleTypes = Array.isArray(raw.vehicleTypes)
    ? [...new Set(raw.vehicleTypes.map((v) => String(v || "").trim()).filter(Boolean))].slice(0, 16)
    : [];
  return {
    logisticsRep: number(raw.logisticsRep ?? raw.logistics_rep),
    headquartersLevel: Math.trunc(number(raw.headquartersLevel ?? raw.headquarters_level)),
    completedContracts: Math.trunc(number(raw.completedContracts)),
    logisticsRevenue: number(raw.logisticsRevenue),
    xlargeCompleted: Math.trunc(number(raw.xlargeCompleted)),
    warehouseOwned: Boolean(raw.warehouseOwned),
    fleetCount: Math.trunc(number(raw.fleetCount)),
    vehicleTypes,
    pcProgressUpdatedAt: String(raw.updatedAt || ""),
    pcProgressSource: "sd-logistics-center-desktop",
  };
}

function readLogisticsProgress({ walletDatabasePath = "", accountId = "" } = {}) {
  const found = [];
  for (const file of candidates(walletDatabasePath)) {
    if (!fs.existsSync(file)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      const linkedAccountId = String(raw?.wallet?.selectedAccountId || "");
      if (linkedAccountId && accountId && linkedAccountId !== String(accountId)) continue;
      const state = normalize(raw);
      if (!state) continue;
      const timestamp = Date.parse(raw.updatedAt || "") || fs.statSync(file).mtimeMs || 0;
      found.push({ found: true, sourcePath: file, timestamp, state });
    } catch {
      // 손상되거나 잠시 쓰는 중인 파일은 다음 자동 동기화에서 다시 읽습니다.
    }
  }
  found.sort((a, b) => b.timestamp - a.timestamp);
  return found[0] || { found: false, sourcePath: "", timestamp: 0, state: null };
}

module.exports = { readLogisticsProgress };
'''


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def patch_sync_engine(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    import_anchor = 'const { readAchievementProgress } = require("./achievement-reader");\n'
    if 'require("./logistics-reader")' not in text:
        if import_anchor not in text:
            raise RuntimeError("sync-engine import anchor missing")
        text = text.replace(import_anchor, import_anchor + 'const { readLogisticsProgress } = require("./logistics-reader");\n', 1)

    ctor_anchor = '    this.backupDirectory = path.join(userDataDirectory, "sdlink", "backups");\n'
    if "integrationStatePath" not in text:
        if ctor_anchor not in text:
            raise RuntimeError("sync-engine constructor anchor missing")
        text = text.replace(ctor_anchor, ctor_anchor + '    this.integrationStatePath = path.join(userDataDirectory, "sdlink", "integration-state.json");\n', 1)

    method_anchor = '\n\n  async syncAchievementProgress(config, bitcoinResult) {'
    methods = r'''

  logisticsGrade(rep) {
    const value = Math.max(0, Number(rep || 0));
    if (value >= 7000) return "S";
    if (value >= 4500) return "A";
    if (value >= 2800) return "B";
    if (value >= 1600) return "C";
    if (value >= 800) return "D";
    if (value >= 300) return "E";
    return "F";
  }

  writeIntegrationState({ onlineLinked = false, logistics = null, error = "" } = {}) {
    let session = null;
    try { session = this.auth.publicSession?.() || null; } catch {}
    const rep = Math.max(0, Number(logistics?.rep ?? logistics?.logisticsRep ?? 0));
    const headquartersLevel = Math.max(0, Math.trunc(Number(logistics?.headquartersLevel ?? 0)));
    const grade = String(logistics?.grade || this.logisticsGrade(rep));
    const payload = {
      schemaVersion: 1,
      sourceApp: "sdlink-desktop",
      sourceVersion: "1.3.0",
      onlineLinked: Boolean(onlineLinked && session?.authenticated),
      userId: session?.authenticated ? String(session?.user?.id || "") : "",
      email: session?.authenticated ? String(session?.user?.email || "") : "",
      logistics: {
        rep,
        headquartersLevel,
        grade,
        eligibleForSContent: rep >= 7000 || headquartersLevel >= 1,
        source: String(logistics?.source || "none"),
        pcProgressUpdatedAt: String(logistics?.pcProgressUpdatedAt || ""),
      },
      error: String(error || ""),
      updatedAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(this.integrationStatePath), { recursive: true });
    const temp = `${this.integrationStatePath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(payload, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temp, this.integrationStatePath);
    return payload;
  }

  clearIntegrationState() {
    try { return this.writeIntegrationState({ onlineLinked: false, logistics: null }); }
    catch { return null; }
  }

  async syncLogisticsProgress(config) {
    const local = readLogisticsProgress({
      walletDatabasePath: config.databasePath,
      accountId: config.selectedAccountId,
    });
    try {
      let server = null;
      if (local.found && local.state) {
        server = unwrapJson(await this.auth.rpc("sync_sd_logistics_progress", {
          p_state: local.state,
        }));
      } else {
        server = unwrapJson(await this.auth.rpc("get_sd_flea_company_snapshot", {}));
      }
      const rep = Math.max(0, Number(server?.logistics_rep ?? local.state?.logisticsRep ?? 0));
      const headquartersLevel = Math.max(0, Math.trunc(Number(server?.headquarters_level ?? local.state?.headquartersLevel ?? 0)));
      const grade = this.logisticsGrade(rep);
      this.writeIntegrationState({
        onlineLinked: true,
        logistics: {
          rep,
          headquartersLevel,
          grade,
          source: local.found ? "pc+server" : "server",
          pcProgressUpdatedAt: local.state?.pcProgressUpdatedAt || "",
        },
      });
      return {
        synced: Boolean(local.found),
        localFound: Boolean(local.found),
        state: local.state || null,
        rep,
        headquartersLevel,
        grade,
        eligibleForSContent: rep >= 7000 || headquartersLevel >= 1,
      };
    } catch (error) {
      // 서버 RPC가 일시적으로 실패해도 SD Link 로그인 자체는 유효하므로
      // 로컬 물류 진행도가 있으면 플리마켓이 사용할 공용 상태는 계속 제공합니다.
      if (local.found && local.state) {
        const rep = Math.max(0, Number(local.state.logisticsRep || 0));
        const headquartersLevel = Math.max(0, Math.trunc(Number(local.state.headquartersLevel || 0)));
        const grade = this.logisticsGrade(rep);
        this.writeIntegrationState({
          onlineLinked: true,
          logistics: {
            rep,
            headquartersLevel,
            grade,
            source: "pc-local-fallback",
            pcProgressUpdatedAt: local.state.pcProgressUpdatedAt || "",
          },
          error: String(error?.message || error),
        });
        return {
          synced: false,
          localFound: true,
          localFallback: true,
          state: local.state,
          rep,
          headquartersLevel,
          grade,
          eligibleForSContent: rep >= 7000 || headquartersLevel >= 1,
          error: String(error?.message || error),
        };
      }
      try { this.writeIntegrationState({ onlineLinked: true, logistics: null, error: String(error?.message || error) }); } catch {}
      return { synced: false, localFound: false, state: null, rep: 0, headquartersLevel: 0, grade: "F", error: String(error?.message || error) };
    }
  }
'''
    if "async syncLogisticsProgress(config)" not in text:
        if method_anchor not in text:
            raise RuntimeError("sync-engine method anchor missing")
        text = text.replace(method_anchor, methods + method_anchor, 1)

    text = text.replace(
        '  async syncAchievementProgress(config, bitcoinResult) {',
        '  async syncAchievementProgress(config, bitcoinResult, logisticsResult) {',
        1,
    )
    read_anchor = '        bitcoinQuantity: bitcoinResult?.found ? bitcoinResult.quantity : null,\n'
    if 'logisticsProgress: logisticsResult?.state || null' not in text:
        if read_anchor not in text:
            raise RuntimeError("achievement-reader call anchor missing")
        text = text.replace(read_anchor, read_anchor + '        logisticsProgress: logisticsResult?.state || null,\n', 1)

    old_sequence = '''      const bitcoinResult = await this.syncBitcoinSnapshot(config);
      const achievementResult = await this.syncAchievementProgress(config, bitcoinResult);
'''
    new_sequence = '''      const bitcoinResult = await this.syncBitcoinSnapshot(config);
      const logisticsResult = await this.syncLogisticsProgress(config);
      const achievementResult = await this.syncAchievementProgress(config, bitcoinResult, logisticsResult);
'''
    if old_sequence in text:
        text = text.replace(old_sequence, new_sequence, 1)
    elif "const logisticsResult = await this.syncLogisticsProgress(config);" not in text:
        raise RuntimeError("syncOnce sequence anchor missing")

    achievement_text_anchor = '''      const achievementText = achievementResult.synced
        ? ` / 업적 ${achievementResult.count}항목 동기화`
        : achievementResult.error
          ? " / 업적 동기화 대기"
          : "";
      const message = `완료 · PC ${pushResult.pushed}건 전송 / 온라인 ${pullResult.pulled}건 반영${rejectedText}${bitcoinText}${achievementText}`;
'''
    achievement_text_replacement = '''      const achievementText = achievementResult.synced
        ? ` / 업적 ${achievementResult.count}항목 동기화`
        : achievementResult.error
          ? " / 업적 동기화 대기"
          : "";
      const logisticsText = logisticsResult.localFound
        ? ` / 물류 ${logisticsResult.grade}·본부 Lv.${logisticsResult.headquartersLevel} ${logisticsResult.synced ? "동기화" : "로컬 연결"}`
        : " / 물류 PC 진행도 미감지";
      const message = `완료 · PC ${pushResult.pushed}건 전송 / 온라인 ${pullResult.pulled}건 반영${rejectedText}${bitcoinText}${logisticsText}${achievementText}`;
'''
    if achievement_text_anchor in text:
        text = text.replace(achievement_text_anchor, achievement_text_replacement, 1)
    elif "const logisticsText = logisticsResult.localFound" not in text:
        raise RuntimeError("sync message anchor missing")

    path.write_text(text, encoding="utf-8")


def patch_achievement_reader(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    text = text.replace(
        'function readAchievementProgress({ databasePath, accountId, bitcoinQuantity=null }) {',
        'function readAchievementProgress({ databasePath, accountId, bitcoinQuantity=null, logisticsProgress=null }) {',
        1,
    )
    anchor = '    // 비트코인 채굴장\n'
    block = '''    // SD 물류센터: v1.1.0 공용 진행도 브리지에서 확정 가능한 조건만 판정합니다.
    if(logisticsProgress && typeof logisticsProgress==="object"){
      const rep=Math.max(0,n(logisticsProgress.logisticsRep));
      const hq=Math.max(0,Math.trunc(n(logisticsProgress.headquartersLevel)));
      const completed=Math.max(0,Math.trunc(n(logisticsProgress.completedContracts)));
      const fleetCount=Math.max(0,Math.trunc(n(logisticsProgress.fleetCount)));
      const vehicleTypes=Array.isArray(logisticsProgress.vehicleTypes)?new Set(logisticsProgress.vehicleTypes.map(String).filter(Boolean)):new Set();
      // 본부 Lv.1 이상은 S등급을 거쳐 개설된 것이므로 S등급 달성의 확정 증거로 인정합니다.
      out.push(item("logistics-02",Math.max(rep,hq>=1?7000:0),rep>=7000||hq>=1,{rep,headquartersLevel:hq}));
      out.push(threshold("logistics-03",hq,5,{headquartersLevel:hq}));
      out.push(threshold("logistics-04",hq,10,{headquartersLevel:hq}));
      out.push(threshold("logistics-10",fleetCount,5,{fleetCount}));
      out.push(threshold("logistics-11",fleetCount,10,{fleetCount}));
      out.push(threshold("logistics-12",completed,100,{completedContracts:completed}));
      out.push(threshold("logistics-13",completed,1000,{completedContracts:completed}));
      if(["small","medium","large","xlarge"].every((kind)=>vehicleTypes.has(kind))) out.push(item("logistics-16",4,true,{vehicleTypes:[...vehicleTypes]}));
    }

'''
    if "SD 물류센터: v1.1.0 공용 진행도 브리지" not in text:
        if anchor not in text:
            raise RuntimeError("achievement logistics anchor missing")
        text = text.replace(anchor, block + anchor, 1)
    path.write_text(text, encoding="utf-8")


def patch_main(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    old_logout = '''  ipcMain.handle("sdlink:logout", async () => {
    await authService.signOut();
    return appState(false);
  });
'''
    new_logout = '''  ipcMain.handle("sdlink:logout", async () => {
    syncEngine.clearIntegrationState();
    await authService.signOut();
    return appState(false);
  });
'''
    if old_logout in text:
        text = text.replace(old_logout, new_logout, 1)
    elif "syncEngine.clearIntegrationState();\n    await authService.signOut();" not in text:
        raise RuntimeError("main logout anchor missing")

    reset_anchor = '    await authService.signOut();\n    syncState.clearSynchronizationMarks();\n'
    reset_new = '    syncEngine.clearIntegrationState();\n    await authService.signOut();\n    syncState.clearSynchronizationMarks();\n'
    if reset_anchor in text:
        text = text.replace(reset_anchor, reset_new, 1)
    path.write_text(text, encoding="utf-8")


def patch_versions(root: Path) -> None:
    package = root / "package.json"
    data = json.loads(package.read_text(encoding="utf-8"))
    data["version"] = VERSION
    check = str(data.get("scripts", {}).get("check", ""))
    if "src/logistics-reader.js" not in check:
        check = check.replace("src/achievement-reader.js", "src/achievement-reader.js && node --check src/logistics-reader.js")
        data.setdefault("scripts", {})["check"] = check
    data["description"] = "PC 확장팩 업적과 물류 진행도를 홈페이지 계정으로 동기화하는 SD Link"
    write_json(package, data)

    sd_app = root / "sd-app.json"
    if sd_app.is_file():
        obj = json.loads(sd_app.read_text(encoding="utf-8"))
        obj["version"] = VERSION
        obj["displayVersion"] = f"PC Link · v{VERSION}"
        obj["improvement"] = "물류센터 v1.1.0의 평판·본부레벨을 홈페이지 계정으로 동기화하고 플리마켓이 읽을 수 있는 공용 연결 상태를 제공합니다."
        write_json(sd_app, obj)

    readme = root / "README.md"
    if readme.is_file():
        readme.write_text(readme.read_text(encoding="utf-8") + f"\n\n## v{VERSION} · 물류 진행도 중앙 브리지\n- SD 물류센터 v1.1.0의 로컬 진행도를 계정의 sd_logistics_progress로 병합 동기화합니다.\n- 플리마켓이 암호화 로그인 파일을 직접 읽지 않도록 비밀정보 없는 integration-state.json을 제공합니다.\n- v1.2.9의 공용 업적 동기화 기능을 유지하고 물류 확정 업적도 함께 반영합니다.\n", encoding="utf-8")


def patch_extension_data(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    pattern = re.compile(r'(\{\n\s+"id": "sd-link",.*?\n\s+\})', re.S)
    match = pattern.search(text)
    if not match:
        raise RuntimeError(f"SD Link extension block missing: {path}")
    block = match.group(1)
    block = re.sub(r'"version": "v[^"]+"', f'"version": "v{VERSION}"', block, count=1)
    block = re.sub(r'"fileName": "[^"]+"', '"fileName": "SDLink_v1.3.0_Desktop.zip"', block, count=1)
    block = re.sub(r'"downloadUrl": "[^"]+"', '"downloadUrl": "downloads/extensions/SDLink_v1.3.0_Desktop.zip?v=130"', block, count=1)
    block = re.sub(r'"updatedAt": "[^"]+"', '"updatedAt": "2026-08-18"', block, count=1)
    text = text[:match.start()] + block + text[match.end():]
    path.write_text(text, encoding="utf-8")


def patch_catalog() -> None:
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    data["catalogVersion"] = int(data.get("catalogVersion", 0)) + 1
    data["updatedAt"] = "2026-08-18T07:35:00+09:00"
    app = data["apps"]["sdlink-desktop"]
    app["version"] = VERSION
    app["downloadUrl"] = f"https://sd608.github.io/sd-center/downloads/extensions/SDLink_v{VERSION}_Desktop.zip?v={VERSION_TAG}"
    app["notes"] = "물류센터 v1.1.0의 PC 평판·본부레벨을 홈페이지 계정으로 병합 동기화하고, 플리마켓이 안전하게 읽는 비밀정보 없는 공용 연결 상태를 제공합니다. 기존 업적 동기화도 유지합니다."
    write_json(CATALOG, data)


def patch_policy() -> None:
    data = json.loads(POLICY.read_text(encoding="utf-8"))
    data["policyVersion"] = int(data.get("policyVersion", 0)) + 1
    data["updatedAt"] = "2026-08-18T07:35:00+09:00"
    app = data["apps"]["sdlink-desktop"]
    app["required"] = True
    app["minVersion"] = VERSION
    app["downloadUrl"] = f"https://sd608.github.io/sd-center/downloads/extensions/SDLink_v{VERSION}_Desktop.zip?v={VERSION_TAG}"
    app["message"] = "물류센터 계정 연동과 플리마켓 연결 상태 공유를 위해 SD Link v1.3.0 이상이 필요합니다."
    write_json(POLICY, data)


def build_zip(extracted: Path) -> None:
    if OUTPUT.exists():
        OUTPUT.unlink()
    with zipfile.ZipFile(OUTPUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(extracted.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(extracted).as_posix())


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"missing source: {SOURCE}")
    with tempfile.TemporaryDirectory() as tmp:
        extracted = Path(tmp) / "sdlink"
        extracted.mkdir()
        with zipfile.ZipFile(SOURCE) as archive:
            archive.extractall(extracted)
        root = extracted
        package = root / "package.json"
        if not package.is_file():
            candidates = [p for p in extracted.rglob("package.json") if "node_modules" not in p.parts]
            root = next(p.parent for p in candidates if json.loads(p.read_text(encoding="utf-8")).get("name") == "sdlink-desktop")
        (root / "src" / "logistics-reader.js").write_text(LOGISTICS_READER, encoding="utf-8")
        patch_sync_engine(root / "src" / "sync-engine.js")
        patch_achievement_reader(root / "src" / "achievement-reader.js")
        patch_main(root / "main.js")
        patch_versions(root)
        build_zip(extracted)

    patch_catalog()
    patch_policy()
    for path in EXT_DATA:
        patch_extension_data(path)
    print(f"built {OUTPUT} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
