from __future__ import annotations

import json
import re
import tempfile
import zipfile
from pathlib import Path

ROOT = Path.cwd()
SOURCE = ROOT / "downloads/extensions/SDFleaMarket_v1.1.4_Desktop.zip"
OUTPUT = ROOT / "downloads/extensions/SDFleaMarket_v1.1.5_Desktop.zip"
CATALOG = ROOT / "update/extensions-catalog.json"
EXT_DATA = [ROOT / "extensions-data.js", ROOT / "assets/js/extensions-data.js"]
VERSION = "1.1.5"
VERSION_TAG = "115"
MARKER = "FLEA_SDLINK_SHARED_STATE_V115"
RUNTIME_MARKER = "FLEA_LIMITED_ITEM_SCOPE_FIX_V115"


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def find_root(extracted: Path) -> Path:
    for package in extracted.rglob("package.json"):
        if "node_modules" in {p.lower() for p in package.parts}:
            continue
        try:
            data = json.loads(package.read_text(encoding="utf-8"))
        except Exception:
            continue
        if data.get("name") in {"sd-flea-market", "sd-flea-market-pc"}:
            return package.parent
    raise RuntimeError("flea package root not found")


def patch_integration(path: Path) -> None:
    text = path.read_text(encoding="utf-8")

    roots_pattern = re.compile(r'function sdLinkRoots\(currentUserData\) \{.*?\n\}', re.S)
    roots_replacement = r'''function sdLinkRoots(currentUserData) {
  const appData = process.env.APPDATA || "";
  const localAppData = process.env.LOCALAPPDATA || "";
  const parent = currentUserData ? path.dirname(currentUserData) : "";
  const roots = [
    process.env.SD_LINK_USER_DATA,
    appData && path.join(appData, "SD Link"),
    appData && path.join(appData, "sdlink-desktop"),
    appData && path.join(appData, "SDLink"),
    localAppData && path.join(localAppData, "SD Link"),
    localAppData && path.join(localAppData, "sdlink-desktop"),
    localAppData && path.join(localAppData, "SDLink"),
    parent && path.join(parent, "SD Link"),
    parent && path.join(parent, "sdlink-desktop"),
  ];

  // FLEA_SDLINK_SHARED_STATE_V115
  // Electron productName/패키징 방식이 바뀌어 userData 폴더명이 달라져도
  // APPDATA 바로 아래에서 sdlink/config.json 또는 integration-state.json을 가진 앱을 찾습니다.
  for (const base of [appData, localAppData]) {
    if (!base || !fs.existsSync(base)) continue;
    try {
      for (const entry of fs.readdirSync(base, { withFileTypes: true }).slice(0, 300)) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(base, entry.name);
        const sdlinkDir = path.join(candidate, "sdlink");
        if (
          fs.existsSync(path.join(sdlinkDir, "config.json")) ||
          fs.existsSync(path.join(sdlinkDir, "integration-state.json"))
        ) roots.push(candidate);
      }
    } catch {
      // 권한이 없는 앱 폴더는 건너뜁니다.
    }
  }
  return uniqueExisting(roots);
}'''
    text, count = roots_pattern.subn(roots_replacement, text, count=1)
    if count != 1:
        raise RuntimeError("sdLinkRoots patch failed")

    shared_reader = r'''

function readSdLinkIntegrationState(currentUserData) {
  let newest = null;
  for (const root of sdLinkRoots(currentUserData)) {
    const filePath = path.join(root, "sdlink", "integration-state.json");
    if (!fs.existsSync(filePath)) continue;
    const value = readJson(filePath);
    if (!value || typeof value !== "object") continue;
    const timestamp = Date.parse(value.updatedAt || "") || 0;
    if (!newest || timestamp >= newest.timestamp) newest = { ...value, filePath, timestamp };
  }
  return newest;
}
'''
    wallet_anchor = '\nfunction walletCandidates(currentUserData) {'
    if "function readSdLinkIntegrationState" not in text:
        if wallet_anchor not in text:
            raise RuntimeError("shared integration reader anchor missing")
        text = text.replace(wallet_anchor, shared_reader + wallet_anchor, 1)

    progress_anchor = '''async function logisticsProgress(currentUserData, safeStorage) {
  // FLEA_LOGISTICS_HQ_UNLOCK_V114
  // 현재 홈페이지 물류 등급표(F 0 / E 300 / D 800 / C 1600 / B 2800 / A 4500 / S 7000)를
  // 그대로 사용하고, S등급 도달 뒤 본부가 개설된 계정은 본부 Lv.1 이상만으로도
  // 플리마켓의 S등급 전용 지역을 계속 이용할 수 있게 합니다.
'''
    progress_replacement = progress_anchor + r'''  // v1.1.5부터는 SD Link v1.3.0이 내보낸 비밀정보 없는 공용 상태를 최우선 사용합니다.
  // 플리마켓이 다른 Electron 앱의 암호화 세션을 직접 복호화해야 했던 의존성을 제거합니다.
  const shared = readSdLinkIntegrationState(currentUserData);
  if (shared?.onlineLinked) {
    const sharedLogistics = shared.logistics && typeof shared.logistics === "object" ? shared.logistics : {};
    const rep = Math.max(0, Number(sharedLogistics.rep ?? sharedLogistics.logisticsRep ?? 0) || 0);
    const headquartersLevel = Math.max(0, Math.trunc(Number(sharedLogistics.headquartersLevel ?? 0) || 0));
    const logisticsGrade = rankFromRep(rep);
    const eligibleForSContent = Boolean(sharedLogistics.eligibleForSContent) || rep >= S_RANK_REP || headquartersLevel >= 1;
    return {
      onlineLinked: true,
      rep,
      grade: eligibleForSContent ? "S" : logisticsGrade,
      logisticsGrade,
      headquartersLevel,
      eligibleForSContent,
      userId: String(shared.userId || ""),
      sharedState: true,
      snapshotResolved: true,
      progressResolved: true,
      lookupFailed: false,
      linkedAt: String(shared.updatedAt || ""),
    };
  }
'''
    if "sharedState: true" not in text:
        if progress_anchor not in text:
            raise RuntimeError("logisticsProgress shared-state anchor missing")
        text = text.replace(progress_anchor, progress_replacement, 1)

    old_inventory = '''    return invokeAuthenticatedRpc(
      this.userDataPath,
      this.safeStorage,
      "sync_sd_flea_pc_inventory",
      { p_items: payloadItems }
    );
'''
    new_inventory = '''    try {
      return await invokeAuthenticatedRpc(
        this.userDataPath,
        this.safeStorage,
        "sync_sd_flea_pc_inventory",
        { p_items: payloadItems }
      );
    } catch (error) {
      // 회사/물류 연결은 SD Link 공용 상태로 이미 확인됐는데 구형 세션 직접 읽기만 실패한 경우,
      // PC 보관품을 삭제하지 않고 그대로 유지합니다. 다음 SD Link/플리마켓 갱신에서 재시도합니다.
      const shared = readSdLinkIntegrationState(this.userDataPath);
      if (shared?.onlineLinked) {
        return {
          synced_count: 0,
          owned_local_item_ids: payloadItems.map((item) => item.local_item_id).filter(Boolean),
          deferred: true,
          message: "SD Link 온라인 재동기화 대기",
        };
      }
      throw error;
    }
'''
    if old_inventory in text:
        text = text.replace(old_inventory, new_inventory, 1)
    elif "SD Link 온라인 재동기화 대기" not in text:
        raise RuntimeError("inventory fallback anchor missing")

    path.write_text(text, encoding="utf-8")


def patch_renderer(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    anchor = 'const api = window.flea || createBrowserFallbackApi();\n'
    helpers = r'''

// FLEA_LIMITED_ITEM_SCOPE_FIX_V115
// 브라우저 fallback 내부에만 있던 helpers를 Electron 실제 UI에서도 쓸 수 있게 전역 스코프로 제공합니다.
function isLimitedItem(item) {
  return Boolean(item && (
    item.sellable === false ||
    item.tradeLocked === true ||
    String(item.name || "") === "레드 다이아몬드"
  ));
}
function itemValueDisplay(item) {
  if (isLimitedItem(item)) return "판매 불가 · 한정판 상품";
  return `원본 가치 ${Number(item?.originalValue || 0).toLocaleString("ko-KR")}원`;
}
'''
    if RUNTIME_MARKER not in text:
        if anchor not in text:
            raise RuntimeError("public/app.js top-level helper anchor missing")
        text = text.replace(anchor, anchor + helpers, 1)
    path.write_text(text, encoding="utf-8")


def patch_versions(root: Path) -> None:
    package = root / "package.json"
    data = json.loads(package.read_text(encoding="utf-8"))
    data["version"] = VERSION
    write_json(package, data)

    sd_app = root / "sd-app.json"
    if sd_app.is_file():
        obj = json.loads(sd_app.read_text(encoding="utf-8"))
        obj["version"] = VERSION
        obj["displayVersion"] = f"PC Expansion · v{VERSION}"
        obj["improvement"] = "SD Link v1.3.0 공용 연결 상태를 읽어 물류 S등급/본부 Lv.1 해금을 안정화하고 isLimitedItem 런타임 오류를 수정했습니다. v1.1.4의 은행 3D 검은 화면 방어 렌더링은 유지됩니다."
        write_json(sd_app, obj)

    readme = root / "README.md"
    if readme.is_file():
        readme.write_text(readme.read_text(encoding="utf-8") + f"\n\n## v{VERSION}\n- SD Link v1.3.0의 integration-state.json을 우선 사용해 온라인 연결/물류 등급을 판정합니다.\n- 본부 Lv.1 이상이면 평판 문자열과 무관하게 S등급 전용 지역을 유지합니다.\n- Electron UI의 isLimitedItem/itemValueDisplay 스코프 오류를 수정했습니다.\n", encoding="utf-8")


def patch_extension_data(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    pattern = re.compile(r'(\{\n\s+"id": "sd-flea-market",.*?\n\s+\})', re.S)
    match = pattern.search(text)
    if not match:
        raise RuntimeError(f"flea extension block missing: {path}")
    block = match.group(1)
    block = re.sub(r'"version": "v[^"]+"', f'"version": "v{VERSION}"', block, count=1)
    block = re.sub(r'"fileName": "[^"]+"', '"fileName": "SDFleaMarket_v1.1.5_Desktop.zip"', block, count=1)
    block = re.sub(r'"downloadUrl": "[^"]+"', '"downloadUrl": "downloads/extensions/SDFleaMarket_v1.1.5_Desktop.zip?v=115"', block, count=1)
    block = re.sub(r'"updatedAt": "[^"]+"', '"updatedAt": "2026-08-18"', block, count=1)
    text = text[:match.start()] + block + text[match.end():]
    path.write_text(text, encoding="utf-8")


def patch_catalog() -> None:
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    data["catalogVersion"] = int(data.get("catalogVersion", 0)) + 1
    data["updatedAt"] = "2026-08-18T07:45:00+09:00"
    app = data["apps"]["sd-flea-market"]
    app["version"] = VERSION
    app["downloadUrl"] = f"https://sd608.github.io/sd-center/downloads/extensions/SDFleaMarket_v{VERSION}_Desktop.zip?v={VERSION_TAG}"
    app["notes"] = "SD Link v1.3.0 공용 연결 상태를 우선 읽어 온라인 연결 오판을 제거하고, 물류 평판 7,000 또는 본부 Lv.1 이상 해금을 안정화했습니다. isLimitedItem 런타임 오류를 수정했으며 v1.1.4의 은행 3D 검은 화면 방어 렌더링을 유지합니다."
    write_json(CATALOG, data)


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
        extracted = Path(tmp) / "flea"
        extracted.mkdir()
        with zipfile.ZipFile(SOURCE) as archive:
            archive.extractall(extracted)
        root = find_root(extracted)
        patch_integration(root / "src" / "sd-integration.js")
        patch_renderer(root / "public" / "app.js")
        patch_versions(root)
        build_zip(extracted)

    patch_catalog()
    for path in EXT_DATA:
        patch_extension_data(path)
    print(f"built {OUTPUT} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
