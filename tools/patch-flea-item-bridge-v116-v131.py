from __future__ import annotations

import json
import re
import tempfile
import zipfile
from pathlib import Path

ROOT = Path.cwd()

FLEA_SOURCE = ROOT / "downloads/extensions/SDFleaMarket_v1.1.5_Desktop.zip"
FLEA_OUTPUT = ROOT / "downloads/extensions/SDFleaMarket_v1.1.6_Desktop.zip"
FLEA_VERSION = "1.1.6"
FLEA_TAG = "116"

LINK_SOURCE = ROOT / "downloads/extensions/SDLink_v1.3.0_Desktop.zip"
LINK_OUTPUT = ROOT / "downloads/extensions/SDLink_v1.3.1_Desktop.zip"
LINK_VERSION = "1.3.1"
LINK_TAG = "131"

CATALOG = ROOT / "update/extensions-catalog.json"
POLICY = ROOT / "update/desktop-policy.json"
EXT_DATA = [ROOT / "extensions-data.js", ROOT / "assets/js/extensions-data.js"]


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def find_root(extracted: Path, package_names: set[str]) -> Path:
    for package in extracted.rglob("package.json"):
        if "node_modules" in {part.lower() for part in package.parts}:
            continue
        try:
            data = json.loads(package.read_text(encoding="utf-8"))
        except Exception:
            continue
        if data.get("name") in package_names:
            return package.parent
    raise RuntimeError(f"package root not found: {sorted(package_names)}")


FLEA_BRIDGE_HELPERS = r'''
// FLEA_ITEM_SHARED_BRIDGE_V116
// 아이템 동기화는 플리마켓이 SD Link의 암호화 세션을 직접 복호화하지 않고,
// 비밀정보가 없는 공용 스냅샷을 내보낸 뒤 SD Link가 자기 로그인 세션으로 서버에 올립니다.
function fleaBridgeFiles(fileName) {
  const roots = [process.env.APPDATA, process.env.LOCALAPPDATA].filter(Boolean);
  return uniqueExisting(roots.map((root) => path.join(root, "SD608", "integration", fileName)));
}

function fleaInventorySnapshotKey(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item?.local_item_id || "").trim())
    .filter(Boolean)
    .sort()
    .join("|");
}

function writeSharedFleaInventorySnapshot(items, currentUserData) {
  const files = fleaBridgeFiles("flea-inventory.json");
  if (!files.length) return { written: false, filePath: "", snapshotKey: "" };
  const shared = readSdLinkIntegrationState(currentUserData);
  const snapshotKey = fleaInventorySnapshotKey(items);
  const payload = {
    schemaVersion: 1,
    sourceApp: "sd-flea-market",
    sourceVersion: "1.1.6",
    userId: shared?.onlineLinked ? String(shared.userId || "") : "",
    snapshotKey,
    items: Array.isArray(items) ? items : [],
    updatedAt: new Date().toISOString(),
  };
  try {
    const filePath = files[0];
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(payload, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temp, filePath);
    return { written: true, filePath, snapshotKey, userId: payload.userId };
  } catch {
    return { written: false, filePath: "", snapshotKey, userId: payload.userId };
  }
}

function readSharedFleaInventoryResult(currentUserData) {
  const shared = readSdLinkIntegrationState(currentUserData);
  const userId = shared?.onlineLinked ? String(shared.userId || "") : "";
  let newest = null;
  for (const filePath of fleaBridgeFiles("flea-inventory-result.json")) {
    if (!fs.existsSync(filePath)) continue;
    const value = readJson(filePath);
    if (!value || typeof value !== "object") continue;
    if (userId && String(value.userId || "") !== userId) continue;
    const timestamp = Date.parse(value.updatedAt || "") || 0;
    if (!newest || timestamp >= newest.timestamp) newest = { ...value, timestamp, filePath };
  }
  return newest;
}

'''


def patch_flea_integration(path: Path) -> None:
    text = path.read_text(encoding="utf-8")

    if "FLEA_ITEM_SHARED_BRIDGE_V116" not in text:
        anchor = "\nclass SdIntegration {"
        if anchor not in text:
            raise RuntimeError("flea SdIntegration anchor missing")
        text = text.replace(anchor, "\n" + FLEA_BRIDGE_HELPERS + "class SdIntegration {", 1)

    method_pattern = re.compile(
        r"  async syncFleaInventory\(items\) \{.*?\n  \}\n\n  companyState\(\)",
        re.S,
    )
    replacement = r'''  async syncFleaInventory(items) {
    const payloadItems = Array.isArray(items) ? items.map((item) => ({
      local_item_id: String(item?.id || ""),
      box_id: String(item?.boxId || ""),
      name: String(item?.name || ""),
      tier: String(item?.tier || "worn"),
      original_value: Math.max(0, Math.trunc(Number(item?.originalValue || 0))),
      current_value: Math.max(0, Math.trunc(Number(item?.currentValue ?? item?.originalValue ?? 0))),
      condition_percent: Math.max(0, Math.min(100, Number(item?.conditionPercent ?? 100))),
      acquired_at: String(item?.acquiredAt || new Date().toISOString()),
      source: String(item?.source || "PC 플리마켓"),
    })) : [];

    const snapshot = writeSharedFleaInventorySnapshot(payloadItems, this.userDataPath);

    // 같은 앱 프로세스에서 SD Link 세션 복호화가 가능한 PC는 기존 즉시 RPC도 유지합니다.
    try {
      const result = await invokeAuthenticatedRpc(
        this.userDataPath,
        this.safeStorage,
        "sync_sd_flea_pc_inventory",
        { p_items: payloadItems }
      );
      return { ...(result || {}), queued: snapshot.written, bridge: false };
    } catch (error) {
      const shared = readSdLinkIntegrationState(this.userDataPath);
      if (shared?.onlineLinked && snapshot.written) {
        // SD Link가 직전 같은 스냅샷을 이미 서버에 반영했다면 그 결과를 사용해
        // 모바일에서 판매된 아이템을 PC에서도 제거합니다.
        const bridgeResult = readSharedFleaInventoryResult(this.userDataPath);
        const resultMatches =
          bridgeResult &&
          String(bridgeResult.userId || "") === String(shared.userId || "") &&
          String(bridgeResult.snapshotKey || "") === String(snapshot.snapshotKey || "");
        const ownedIds = resultMatches && Array.isArray(bridgeResult.ownedLocalItemIds)
          ? bridgeResult.ownedLocalItemIds.map(String)
          : payloadItems.map((item) => item.local_item_id).filter(Boolean);

        return {
          synced_count: resultMatches ? Number(bridgeResult.syncedCount || ownedIds.length) : 0,
          owned_local_item_ids: ownedIds,
          deferred: !resultMatches,
          queued: true,
          bridge: Boolean(resultMatches),
          message: resultMatches
            ? "SD Link 공용 아이템 동기화 완료"
            : "SD Link 공용 아이템 동기화 대기",
        };
      }
      throw error;
    }
  }

  companyState()'''
    text, count = method_pattern.subn(replacement, text, count=1)
    if count != 1:
        raise RuntimeError("flea syncFleaInventory patch failed")

    path.write_text(text, encoding="utf-8")


def patch_flea_versions(root: Path) -> None:
    package = root / "package.json"
    data = json.loads(package.read_text(encoding="utf-8"))
    data["version"] = FLEA_VERSION
    write_json(package, data)

    sd_app = root / "sd-app.json"
    if sd_app.is_file():
        obj = json.loads(sd_app.read_text(encoding="utf-8"))
        obj["version"] = FLEA_VERSION
        obj["displayVersion"] = f"PC Expansion · v{FLEA_VERSION}"
        obj["improvement"] = (
            "플리마켓 아이템을 공용 스냅샷으로 내보내 SD Link v1.3.1이 자기 로그인 세션으로 서버에 동기화합니다. "
            "모바일에서 판매된 아이템도 SD Link 결과를 받아 PC 보관함에서 제거됩니다."
        )
        write_json(sd_app, obj)

    readme = root / "README.md"
    if readme.is_file():
        readme.write_text(
            readme.read_text(encoding="utf-8")
            + f"\n\n## v{FLEA_VERSION} · 아이템 SD Link 공용 브리지\n"
              "- 아이템 동기화에서 다른 Electron 앱의 암호화 세션 직접 복호화 의존성을 제거했습니다.\n"
              "- APPDATA/SD608/integration/flea-inventory.json에 비밀정보 없는 아이템 스냅샷을 기록합니다.\n"
              "- SD Link가 반환한 서버 보유 목록으로 모바일 판매분을 PC에서도 제거합니다.\n",
            encoding="utf-8",
        )


LINK_READER = r'''"use strict";

// SDLINK_FLEA_ITEM_BRIDGE_V131
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

function candidateFiles(fileName) {
  return unique(
    [process.env.APPDATA, process.env.LOCALAPPDATA]
      .filter(Boolean)
      .map((root) => path.join(root, "SD608", "integration", fileName))
  );
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 5000).map((item) => ({
    local_item_id: String(item?.local_item_id || "").slice(0, 120),
    box_id: String(item?.box_id || "").slice(0, 120),
    name: String(item?.name || "").slice(0, 120),
    tier: String(item?.tier || "worn").toLowerCase(),
    original_value: Math.max(0, Math.trunc(Number(item?.original_value || 0))),
    current_value: Math.max(0, Math.trunc(Number(item?.current_value ?? item?.original_value ?? 0))),
    condition_percent: Math.max(0, Math.min(100, Number(item?.condition_percent ?? 100))),
    acquired_at: String(item?.acquired_at || ""),
    source: String(item?.source || "PC 플리마켓").slice(0, 160),
  })).filter((item) => item.local_item_id && item.name);
}

function readFleaInventorySnapshot({ userId = "" } = {}) {
  let newest = null;
  let unbound = null;
  for (const filePath of candidateFiles("flea-inventory.json")) {
    if (!fs.existsSync(filePath)) continue;
    const value = readJson(filePath);
    if (!value || typeof value !== "object") continue;
    const snapshotUserId = String(value.userId || "");
    const timestamp = Date.parse(value.updatedAt || "") || fs.statSync(filePath).mtimeMs || 0;
    const entry = {
      found: true,
      sourcePath: filePath,
      timestamp,
      userId: snapshotUserId,
      snapshotKey: String(value.snapshotKey || ""),
      items: normalizeItems(value.items),
      updatedAt: String(value.updatedAt || ""),
    };
    if (!snapshotUserId) {
      if (!unbound || timestamp > unbound.timestamp) unbound = entry;
      continue;
    }
    if (userId && snapshotUserId !== String(userId)) continue;
    if (!newest || timestamp > newest.timestamp) newest = entry;
  }
  if (newest) return newest;
  if (unbound) return { ...unbound, found: false, unbound: true, reason: "snapshot-user-not-bound" };
  return { found: false, sourcePath: "", timestamp: 0, userId: "", snapshotKey: "", items: [], updatedAt: "" };
}

function writeFleaInventoryResult({
  sourcePath = "",
  userId = "",
  snapshotKey = "",
  ownedLocalItemIds = [],
  syncedCount = 0,
} = {}) {
  const resultPaths = [];
  if (sourcePath) resultPaths.push(path.join(path.dirname(sourcePath), "flea-inventory-result.json"));
  resultPaths.push(...candidateFiles("flea-inventory-result.json"));
  const targets = unique(resultPaths);
  if (!targets.length) return null;

  const payload = {
    schemaVersion: 1,
    sourceApp: "sdlink-desktop",
    sourceVersion: "1.3.1",
    userId: String(userId || ""),
    snapshotKey: String(snapshotKey || ""),
    ownedLocalItemIds: Array.isArray(ownedLocalItemIds) ? ownedLocalItemIds.map(String) : [],
    syncedCount: Math.max(0, Math.trunc(Number(syncedCount || 0))),
    updatedAt: new Date().toISOString(),
  };

  const filePath = targets[0];
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(payload, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, filePath);
  return { ...payload, filePath };
}

module.exports = {
  readFleaInventorySnapshot,
  writeFleaInventoryResult,
};
'''


def patch_link_engine(path: Path) -> None:
    text = path.read_text(encoding="utf-8")

    if 'require("./flea-inventory-reader")' not in text:
        anchor = 'const { readLogisticsProgress } = require("./logistics-reader");\n'
        if anchor not in text:
            raise RuntimeError("sdlink logistics-reader import anchor missing")
        text = text.replace(
            anchor,
            anchor + 'const { readFleaInventorySnapshot, writeFleaInventoryResult } = require("./flea-inventory-reader");\n',
            1,
        )

    if "async syncFleaInventoryBridge()" not in text:
        method_anchor = "\n\n  async syncAchievementProgress("
        if method_anchor not in text:
            raise RuntimeError("sdlink achievement method anchor missing")
        methods = r'''

  async syncFleaInventoryBridge() {
    let session = null;
    try { session = this.auth.publicSession?.() || null; } catch {}
    const userId = session?.authenticated ? String(session?.user?.id || "") : "";
    if (!userId) {
      return { found: false, synced: false, count: 0, reason: "not-authenticated" };
    }

    const local = readFleaInventorySnapshot({ userId });
    if (!local.found) {
      return {
        found: false,
        synced: false,
        count: 0,
        unbound: Boolean(local.unbound),
        reason: String(local.reason || "snapshot-not-found"),
      };
    }

    try {
      const response = unwrapJson(await this.auth.rpc("sync_sd_flea_pc_inventory", {
        p_items: local.items,
      }));
      const ownedLocalItemIds = Array.isArray(response?.owned_local_item_ids)
        ? response.owned_local_item_ids.map(String)
        : [];
      const count = Math.max(0, Math.trunc(Number(response?.synced_count ?? local.items.length ?? 0)));

      writeFleaInventoryResult({
        sourcePath: local.sourcePath,
        userId,
        snapshotKey: local.snapshotKey,
        ownedLocalItemIds,
        syncedCount: count,
      });

      return {
        found: true,
        synced: true,
        count,
        ownedCount: ownedLocalItemIds.length,
        snapshotKey: local.snapshotKey,
        sourceUpdatedAt: local.updatedAt,
      };
    } catch (error) {
      return {
        found: true,
        synced: false,
        count: 0,
        snapshotKey: local.snapshotKey,
        error: String(error?.message || error),
      };
    }
  }
'''
        text = text.replace(method_anchor, methods + method_anchor, 1)

    old_sequence = '''      const bitcoinResult = await this.syncBitcoinSnapshot(config);
      const logisticsResult = await this.syncLogisticsProgress(config);
      const achievementResult = await this.syncAchievementProgress(config, bitcoinResult, logisticsResult);
'''
    new_sequence = '''      const bitcoinResult = await this.syncBitcoinSnapshot(config);
      const logisticsResult = await this.syncLogisticsProgress(config);
      const fleaInventoryResult = await this.syncFleaInventoryBridge();
      const achievementResult = await this.syncAchievementProgress(config, bitcoinResult, logisticsResult);
'''
    if old_sequence in text:
        text = text.replace(old_sequence, new_sequence, 1)
    elif "const fleaInventoryResult = await this.syncFleaInventoryBridge();" not in text:
        raise RuntimeError("sdlink syncOnce sequence anchor missing")

    if "const fleaInventoryText =" not in text:
        anchor = '''      const achievementText = achievementResult.synced
        ? ` / 업적 ${achievementResult.count}항목 동기화`
        : achievementResult.error
          ? " / 업적 동기화 대기"
          : "";
'''
        if anchor not in text:
            raise RuntimeError("sdlink achievement text anchor missing")
        addition = anchor + '''      const fleaInventoryText = fleaInventoryResult.synced
        ? ` / 플리마켓 아이템 ${fleaInventoryResult.count}개 동기화`
        : fleaInventoryResult.error
          ? " / 플리마켓 아이템 동기화 대기"
          : fleaInventoryResult.unbound
            ? " / 플리마켓 아이템 계정 연결 대기"
            : "";
'''
        text = text.replace(anchor, addition, 1)

    if "${logisticsText}${achievementText}" in text:
        text = text.replace(
            "${logisticsText}${achievementText}",
            "${logisticsText}${fleaInventoryText}${achievementText}",
            1,
        )
    elif "${fleaInventoryText}" not in text:
        raise RuntimeError("sdlink sync message insertion anchor missing")

    path.write_text(text, encoding="utf-8")


def patch_link_versions(root: Path) -> None:
    package = root / "package.json"
    data = json.loads(package.read_text(encoding="utf-8"))
    data["version"] = LINK_VERSION
    check = str(data.get("scripts", {}).get("check", ""))
    if "src/flea-inventory-reader.js" not in check:
        if "src/logistics-reader.js" in check:
            check = check.replace(
                "src/logistics-reader.js",
                "src/logistics-reader.js && node --check src/flea-inventory-reader.js",
                1,
            )
        else:
            check = (check + " && node --check src/flea-inventory-reader.js").strip(" &")
        data.setdefault("scripts", {})["check"] = check
    data["description"] = "PC 확장팩 업적·물류·플리마켓 아이템을 홈페이지 계정으로 동기화하는 SD Link"
    write_json(package, data)

    sd_app = root / "sd-app.json"
    if sd_app.is_file():
        obj = json.loads(sd_app.read_text(encoding="utf-8"))
        obj["version"] = LINK_VERSION
        obj["displayVersion"] = f"PC Link · v{LINK_VERSION}"
        obj["improvement"] = (
            "플리마켓 v1.1.6이 내보낸 아이템 스냅샷을 SD Link 로그인 세션으로 서버에 올리고, "
            "서버의 실제 보유 아이템 목록을 다시 PC 플리마켓에 전달합니다."
        )
        write_json(sd_app, obj)

    readme = root / "README.md"
    if readme.is_file():
        readme.write_text(
            readme.read_text(encoding="utf-8")
            + f"\n\n## v{LINK_VERSION} · 플리마켓 아이템 공용 브리지\n"
              "- APPDATA/SD608/integration/flea-inventory.json을 읽어 로그인한 SD Online 계정으로 업로드합니다.\n"
              "- 서버가 반환한 보유 아이템 ID를 flea-inventory-result.json에 기록해 모바일 판매분을 PC가 반영할 수 있게 합니다.\n"
              "- 계정 ID가 다른 스냅샷은 업로드하지 않아 계정 전환 시 잘못된 아이템 혼합을 막습니다.\n",
            encoding="utf-8",
        )


def build_flea() -> None:
    if not FLEA_SOURCE.is_file():
        raise SystemExit(f"missing source: {FLEA_SOURCE}")
    with tempfile.TemporaryDirectory() as tmp:
        extracted = Path(tmp) / "flea"
        extracted.mkdir()
        with zipfile.ZipFile(FLEA_SOURCE) as archive:
            archive.extractall(extracted)
        root = find_root(extracted, {"sd-flea-market", "sd-flea-market-pc"})
        patch_flea_integration(root / "src" / "sd-integration.js")
        patch_flea_versions(root)
        if FLEA_OUTPUT.exists():
            FLEA_OUTPUT.unlink()
        with zipfile.ZipFile(FLEA_OUTPUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for file in sorted(extracted.rglob("*")):
                if file.is_file():
                    archive.write(file, file.relative_to(extracted).as_posix())


def build_link() -> None:
    if not LINK_SOURCE.is_file():
        raise SystemExit(f"missing source: {LINK_SOURCE}")
    with tempfile.TemporaryDirectory() as tmp:
        extracted = Path(tmp) / "sdlink"
        extracted.mkdir()
        with zipfile.ZipFile(LINK_SOURCE) as archive:
            archive.extractall(extracted)
        root = find_root(extracted, {"sdlink-desktop"})
        (root / "src" / "flea-inventory-reader.js").write_text(LINK_READER, encoding="utf-8")
        patch_link_engine(root / "src" / "sync-engine.js")
        patch_link_versions(root)
        if LINK_OUTPUT.exists():
            LINK_OUTPUT.unlink()
        with zipfile.ZipFile(LINK_OUTPUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for file in sorted(extracted.rglob("*")):
                if file.is_file():
                    archive.write(file, file.relative_to(extracted).as_posix())


def patch_extension_data(path: Path) -> None:
    text = path.read_text(encoding="utf-8")

    flea_pattern = re.compile(r'(\{\n\s+"id": "sd-flea-market",.*?\n\s+\})', re.S)
    match = flea_pattern.search(text)
    if not match:
        raise RuntimeError(f"flea extension block missing: {path}")
    block = match.group(1)
    block = re.sub(r'"version": "v[^"]+"', f'"version": "v{FLEA_VERSION}"', block, count=1)
    block = re.sub(r'"fileName": "[^"]+"', f'"fileName": "SDFleaMarket_v{FLEA_VERSION}_Desktop.zip"', block, count=1)
    block = re.sub(
        r'"downloadUrl": "[^"]+"',
        f'"downloadUrl": "downloads/extensions/SDFleaMarket_v{FLEA_VERSION}_Desktop.zip?v={FLEA_TAG}"',
        block,
        count=1,
    )
    block = re.sub(r'"updatedAt": "[^"]+"', '"updatedAt": "2026-08-18"', block, count=1)
    text = text[:match.start()] + block + text[match.end():]

    link_pattern = re.compile(r'(\{\n\s+"id": "sd-link",.*?\n\s+\})', re.S)
    match = link_pattern.search(text)
    if not match:
        raise RuntimeError(f"SD Link extension block missing: {path}")
    block = match.group(1)
    block = re.sub(r'"version": "v[^"]+"', f'"version": "v{LINK_VERSION}"', block, count=1)
    block = re.sub(r'"fileName": "[^"]+"', f'"fileName": "SDLink_v{LINK_VERSION}_Desktop.zip"', block, count=1)
    block = re.sub(
        r'"downloadUrl": "[^"]+"',
        f'"downloadUrl": "downloads/extensions/SDLink_v{LINK_VERSION}_Desktop.zip?v={LINK_TAG}"',
        block,
        count=1,
    )
    block = re.sub(r'"updatedAt": "[^"]+"', '"updatedAt": "2026-08-18"', block, count=1)
    text = text[:match.start()] + block + text[match.end():]

    path.write_text(text, encoding="utf-8")


def patch_catalog_policy() -> None:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    catalog["catalogVersion"] = int(catalog.get("catalogVersion", 0)) + 1
    catalog["updatedAt"] = "2026-08-18T08:40:00+09:00"

    flea = catalog["apps"]["sd-flea-market"]
    flea["version"] = FLEA_VERSION
    flea["downloadUrl"] = f"https://sd608.github.io/sd-center/downloads/extensions/SDFleaMarket_v{FLEA_VERSION}_Desktop.zip?v={FLEA_TAG}"
    flea["notes"] = (
        "아이템을 SD Link 공용 스냅샷으로 전달해 온라인 보관함 동기화를 복구했습니다. "
        "모바일에서 판매된 아이템도 SD Link 결과를 통해 PC 보관함에서 제거됩니다."
    )

    link = catalog["apps"]["sdlink-desktop"]
    link["version"] = LINK_VERSION
    link["downloadUrl"] = f"https://sd608.github.io/sd-center/downloads/extensions/SDLink_v{LINK_VERSION}_Desktop.zip?v={LINK_TAG}"
    link["notes"] = (
        "플리마켓 v1.1.6 아이템 스냅샷을 로그인 세션으로 서버에 업로드하고 실제 서버 보유 목록을 PC에 다시 전달합니다. "
        "기존 업적·물류 동기화 기능을 유지합니다."
    )
    write_json(CATALOG, catalog)

    policy = json.loads(POLICY.read_text(encoding="utf-8"))
    policy["policyVersion"] = int(policy.get("policyVersion", 0)) + 1
    policy["updatedAt"] = "2026-08-18T08:40:00+09:00"
    link_policy = policy["apps"]["sdlink-desktop"]
    link_policy["required"] = True
    link_policy["minVersion"] = LINK_VERSION
    link_policy["downloadUrl"] = f"https://sd608.github.io/sd-center/downloads/extensions/SDLink_v{LINK_VERSION}_Desktop.zip?v={LINK_TAG}"
    link_policy["message"] = "플리마켓 아이템 온라인 동기화 복구를 위해 SD Link v1.3.1 이상이 필요합니다."
    write_json(POLICY, policy)


def main() -> None:
    build_flea()
    build_link()
    patch_catalog_policy()
    for path in EXT_DATA:
        patch_extension_data(path)
    print(f"built {FLEA_OUTPUT} ({FLEA_OUTPUT.stat().st_size} bytes)")
    print(f"built {LINK_OUTPUT} ({LINK_OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
