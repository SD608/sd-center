from __future__ import annotations

import json
import re
import tempfile
import zipfile
from pathlib import Path

ROOT = Path.cwd()
SOURCE = ROOT / "downloads/extensions/SDFleaMarket_v1.1.8_Desktop.zip"
OUTPUT = ROOT / "downloads/extensions/SDFleaMarket_v1.1.9_Desktop.zip"
VERSION = "1.1.9"
TAG = "119"
CATALOG = ROOT / "update/extensions-catalog.json"
EXT_DATA = [ROOT / "extensions-data.js", ROOT / "assets/js/extensions-data.js"]


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def find_root(extracted: Path) -> Path:
    roots: list[Path] = []
    for package in extracted.rglob("package.json"):
        if "node_modules" in {part.lower() for part in package.parts}:
            continue
        try:
            data = json.loads(package.read_text(encoding="utf-8"))
        except Exception:
            continue
        if data.get("name") in {"sd-flea-market", "sd-flea-market-pc"}:
            roots.append(package.parent)
    if not roots:
        raise RuntimeError("플리마켓 package root not found")
    roots.sort(key=lambda item: len(item.parts))
    return roots[0]


def patch_safe_labels(text: str) -> str:
    # 같은 공간에 여러 금고가 있어도 사용자 화면에는 번호 없이 단순하게 '금고'로 표시한다.
    text = text.replace('objectLabel: `은행 금고 ${index + 1}`', 'objectLabel: "금고"')
    text = text.replace('objectLabel: `은행 금고 ${index+1}`', 'objectLabel: "금고"')
    return text


def patch_main_finish(text: str) -> str:
    pattern = re.compile(r'function finishBankChase\(success\) \{.*?\n\}\n\nfunction activeMissionSafe', re.S)
    match = pattern.search(text)
    if not match:
        raise RuntimeError("main finishBankChase 함수를 찾지 못했습니다.")

    replacement = '''function finishBankChase(success) {
  const mission = state.activeMission;
  if (!mission || mission.missionType !== "bank-finale" || !mission.chasePending) return { ok: false, error: "진행 중인 은행 오토바이 추격전이 없습니다.", state: publicState() };
  const carriedSafes = mission.nodes.filter((node) => node.kind === "safe-node" && node.carried);
  const safeCount = carriedSafes.length;
  const securedBoxes = [];

  if (success) {
    const safeTier = BOX_TIERS.find((tier) => tier.id === "safe") || { id: "safe", name: "금고", accent: "#ffd54f" };
    for (let index = 0; index < safeCount; index += 1) {
      const box = makeBox(safeTier, "은행 습격");
      state.boxes.unshift(box);
      securedBoxes.push(box);
    }
  }

  state.history.unshift({
    type: "bank-chase",
    at: Date.now(),
    text: success
      ? `은행 도주 성공 · 금고 ${safeCount}개를 상자 보관함에 보관`
      : `은행 도주 실패 · 오토바이 내구도 소진 · 운반 중 금고 ${safeCount}개 전부 분실`,
  });
  state.bankPrep = { equipment: false, guardWeakening: false };
  state.activeMission = null;
  saveState();
  return {
    ok: true,
    success: Boolean(success),
    safeCount,
    storedBoxCount: success ? securedBoxes.length : 0,
    boxes: success ? securedBoxes : [],
    securedValue: 0,
    lostValue: 0,
    lostSafes: success ? 0 : safeCount,
    emptyCount: 0,
    rewards: [],
    state: publicState(),
  };
}

function activeMissionSafe'''
    return text[:match.start()] + replacement + text[match.end():]


def patch_browser_finish(text: str) -> str:
    pattern = re.compile(r'    async finishBankChase\(success\) \{.*?\n    \},\n\n\n    async startMissionSafe', re.S)
    match = pattern.search(text)
    if not match:
        # 줄바꿈 수가 다른 패키지도 허용한다.
        pattern = re.compile(r'    async finishBankChase\(success\) \{.*?\n    \},\n\n    async startMissionSafe', re.S)
        match = pattern.search(text)
    if not match:
        raise RuntimeError("browser finishBankChase 함수를 찾지 못했습니다.")

    replacement = '''    async finishBankChase(success) {
      const mission = localState.activeMission;
      if (!mission || mission.missionType !== "bank-finale" || !mission.chasePending) {
        return { ok: false, error: "진행 중인 은행 오토바이 추격전이 없습니다.", state: publicState() };
      }
      const carriedSafes = mission.nodes.filter((node) => node.kind === "safe-node" && node.carried);
      const safeCount = carriedSafes.length;
      const securedBoxes = [];

      if (success) {
        const safeTier = BOX_TIERS.find((tier) => tier.id === "safe") || { id: "safe", name: "금고", accent: "#ffd54f" };
        for (let index = 0; index < safeCount; index += 1) {
          const box = makeBox(safeTier, "은행 습격");
          localState.boxes.unshift(box);
          securedBoxes.push(box);
        }
      }

      localState.history.unshift({
        type: "bank-chase",
        at: Date.now(),
        text: success
          ? `은행 도주 성공 · 금고 ${safeCount}개를 상자 보관함에 보관`
          : `은행 도주 실패 · 오토바이 내구도 소진 · 운반 중 금고 ${safeCount}개 전부 분실`,
      });
      localState.bankPrep = { equipment: false, guardWeakening: false };
      localState.activeMission = null;
      saveState();
      return {
        ok: true,
        success: Boolean(success),
        safeCount,
        storedBoxCount: success ? securedBoxes.length : 0,
        boxes: success ? securedBoxes : [],
        securedValue: 0,
        lostValue: 0,
        lostSafes: success ? 0 : safeCount,
        emptyCount: 0,
        rewards: [],
        state: publicState(),
      };
    },


    async startMissionSafe'''
    return text[:match.start()] + replacement + text[match.end():]


def patch_chase_result_ui(text: str) -> str:
    pattern = re.compile(r'async function finalizeBankChase\(outcome\) \{.*?\n\}\n\nasync function startBankChase', re.S)
    match = pattern.search(text)
    if not match:
        raise RuntimeError("finalizeBankChase UI 함수를 찾지 못했습니다.")

    replacement = '''async function finalizeBankChase(outcome) {
  let result;
  try {
    result = await api.finishBankChase(Boolean(outcome?.success));
  } catch (error) {
    result = { ok: false, error: error?.message || "은행 도주 결과 저장에 실패했습니다." };
  }
  bankChaseActive = false;
  if (!result?.ok) {
    $("#bankChaseResult").classList.remove("hidden");
    $("#bankChaseResultTitle").textContent = "도주 결과 처리 오류";
    $("#bankChaseResultText").textContent = result?.error || "은행 도주 결과를 저장하지 못했습니다.";
    $("#bankChaseResultValue").textContent = "확인 필요";
    return;
  }
  state = result.state;
  render();
  const success = Boolean(result.success);
  const safeCount = Number(result.safeCount || bankChaseSafeCount || 0);
  const storedCount = Number(result.storedBoxCount || safeCount || 0);
  $("#bankChaseResult").classList.remove("hidden");
  $("#bankChaseResultTitle").textContent = success ? "도주 성공" : "오토바이 파손 · 습격 실패";
  $("#bankChaseResultText").textContent = success
    ? `금고 ${safeCount}개를 무사히 가져왔습니다. 상자 보관함에 보관했으니 원하는 때 직접 열 수 있습니다.`
    : `오토바이 내구도가 0이 되어 도주에 실패했습니다. 들고 나오던 금고 ${result.lostSafes || bankChaseSafeCount}개를 전부 잃었습니다.`;
  $("#bankChaseResultValue").textContent = success
    ? `상자 보관함 +${storedCount}개`
    : `분실 금고 ${result.lostSafes || bankChaseSafeCount}개`;
}

async function startBankChase'''
    return text[:match.start()] + replacement + text[match.end():]


def patch_versions(root: Path) -> None:
    package = root / "package.json"
    obj = json.loads(package.read_text(encoding="utf-8"))
    obj["version"] = VERSION
    write_json(package, obj)

    manifest = root / "sd-app.json"
    if manifest.is_file():
        value = json.loads(manifest.read_text(encoding="utf-8"))
        value["version"] = VERSION
        value["displayVersion"] = f"PC Expansion · v{VERSION}"
        value["improvement"] = (
            "은행 습격에서 탈출한 금고를 즉시 개봉하지 않고 상자 보관함에 저장하도록 변경했습니다. "
            "은행 내부 금고 표시는 번호 없이 '금고'로 단순화했습니다."
        )
        write_json(manifest, value)

    for js in root.rglob("*.js"):
        try:
            text = js.read_text(encoding="utf-8")
        except Exception:
            continue
        updated = text.replace('sourceVersion: "1.1.8"', 'sourceVersion: "1.1.9"')
        if updated != text:
            js.write_text(updated, encoding="utf-8")

    readme = root / "README.md"
    if readme.is_file():
        readme.write_text(
            readme.read_text(encoding="utf-8")
            + f"\n\n## v{VERSION} · 은행 금고 보관함 복귀\n"
              "- 은행 도주 성공 시 금고 내용물을 즉시 뽑지 않고 금고 상자를 상자 보관함에 추가합니다.\n"
              "- 보관함에서 금고를 직접 열 때 기존 금고 보상 확률과 레드 다이아몬드 판정이 적용됩니다.\n"
              "- 은행 현장 표시는 '은행 금고 1' 같은 번호형 이름 대신 모두 '금고'로 통일했습니다.\n",
            encoding="utf-8",
        )


def patch_extension_data(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    pattern = re.compile(r'(\{\n\s+"id": "sd-flea-market",.*?\n\s+\})', re.S)
    match = pattern.search(text)
    if not match:
        raise RuntimeError(f"flea extension block missing: {path}")
    block = match.group(1)
    block = re.sub(r'"version": "v[^"]+"', f'"version": "v{VERSION}"', block, count=1)
    block = re.sub(r'"fileName": "[^"]+"', f'"fileName": "SDFleaMarket_v{VERSION}_Desktop.zip"', block, count=1)
    block = re.sub(r'"downloadUrl": "[^"]+"', f'"downloadUrl": "downloads/extensions/SDFleaMarket_v{VERSION}_Desktop.zip?v={TAG}"', block, count=1)
    block = re.sub(r'"updatedAt": "[^"]+"', '"updatedAt": "2026-08-18"', block, count=1)
    block = re.sub(
        r'"description": "[^"]*"',
        '"description": "은행 습격에서 확보한 금고는 도주 성공 후 상자 보관함에 저장되며 원하는 때 직접 열 수 있습니다. 금고 8개·꽝 0개·보통 난이도 고정 규칙도 유지됩니다."',
        block,
        count=1,
    )
    text = text[:match.start()] + block + text[match.end():]
    path.write_text(text, encoding="utf-8")


def patch_catalog() -> None:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    catalog["catalogVersion"] = int(catalog.get("catalogVersion", 0)) + 1
    catalog["updatedAt"] = "2026-08-18T21:45:00+09:00"
    app = catalog["apps"]["sd-flea-market"]
    app["version"] = VERSION
    app["downloadUrl"] = f"https://sd608.github.io/sd-center/downloads/extensions/SDFleaMarket_v{VERSION}_Desktop.zip?v={TAG}"
    app["notes"] = (
        "은행 도주 성공 시 확보한 금고를 즉시 개봉하지 않고 상자 보관함에 저장합니다. "
        "현장 금고 명칭은 번호 없이 '금고'로 표시하며 v1.1.8의 금고 8개·꽝 0개·추격전 보통 고정 규칙을 유지합니다."
    )
    write_json(CATALOG, catalog)


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"missing source: {SOURCE}")

    with tempfile.TemporaryDirectory() as tmp:
        extracted = Path(tmp) / "flea"
        extracted.mkdir()
        with zipfile.ZipFile(SOURCE) as archive:
            archive.extractall(extracted)
        root = find_root(extracted)

        main_path = root / "main.js"
        app_path = root / "public" / "app.js"
        chase_path = root / "public" / "bankchase.js"

        main_text = main_path.read_text(encoding="utf-8").replace("\r\n", "\n")
        app_text = app_path.read_text(encoding="utf-8").replace("\r\n", "\n")

        main_text = patch_safe_labels(main_text)
        app_text = patch_safe_labels(app_text)
        main_text = patch_main_finish(main_text)
        app_text = patch_browser_finish(app_text)
        app_text = patch_chase_result_ui(app_text)

        main_path.write_text(main_text, encoding="utf-8")
        app_path.write_text(app_text, encoding="utf-8")
        patch_versions(root)

        # 핵심 회귀 검증
        check_main = main_path.read_text(encoding="utf-8")
        check_app = app_path.read_text(encoding="utf-8")
        if 'objectLabel: `은행 금고 ${index + 1}`' in check_main or 'objectLabel: `은행 금고 ${index + 1}`' in check_app:
            raise RuntimeError("번호형 은행 금고 이름이 남아 있습니다.")
        if 'objectLabel: "금고"' not in check_main or 'objectLabel: "금고"' not in check_app:
            raise RuntimeError("단순 금고 이름이 적용되지 않았습니다.")
        main_finish = re.search(r'function finishBankChase\(success\) \{.*?\n\}\n\nfunction activeMissionSafe', check_main, re.S)
        browser_finish = re.search(r'    async finishBankChase\(success\) \{.*?\n    \},\n\n+', check_app, re.S)
        if not main_finish or not browser_finish:
            raise RuntimeError("패치된 finishBankChase 검증에 실패했습니다.")
        for name, block in [("main", main_finish.group(0)), ("browser", browser_finish.group(0))]:
            if 'boxes.unshift(box)' not in block:
                raise RuntimeError(f"{name}: 금고가 상자 보관함에 저장되지 않습니다.")
            if 'rollItem(' in block or 'rollRedDiamond(' in block or 'items.unshift' in block:
                raise RuntimeError(f"{name}: 도주 성공 시 금고가 즉시 개봉되는 코드가 남아 있습니다.")
        if 'const risk = 0.32' not in chase_path.read_text(encoding="utf-8"):
            raise RuntimeError("v1.1.8의 추격전 보통 고정 설정이 유지되지 않았습니다.")
        if 'Array.from({ length: 8 }' not in check_main or 'emptySlots' in check_main:
            raise RuntimeError("v1.1.8의 금고 8개·꽝 0개 설정이 유지되지 않았습니다.")

        if OUTPUT.exists():
            OUTPUT.unlink()
        with zipfile.ZipFile(OUTPUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for file in sorted(extracted.rglob("*")):
                if file.is_file():
                    archive.write(file, file.relative_to(extracted).as_posix())

    patch_catalog()
    for path in EXT_DATA:
        patch_extension_data(path)
    print(f"built {OUTPUT} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
