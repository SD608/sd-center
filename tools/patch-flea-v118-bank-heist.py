from __future__ import annotations

import json
import re
import tempfile
import zipfile
from pathlib import Path

ROOT = Path.cwd()
SOURCE = ROOT / "downloads/extensions/SDFleaMarket_v1.1.7_Desktop.zip"
OUTPUT = ROOT / "downloads/extensions/SDFleaMarket_v1.1.8_Desktop.zip"
VERSION = "1.1.8"
TAG = "118"
CATALOG = ROOT / "update/extensions-catalog.json"
EXT_DATA = [ROOT / "extensions-data.js", ROOT / "assets/js/extensions-data.js"]

SAFE_POSITIONS = (
    "[[8.65,7.7],[21.35,7.7],[8.65,10.0],[21.35,10.0],"
    "[10.15,5.55],[19.85,5.55],[13.35,5.55],[16.65,5.55]]"
)


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


def add_carried_helper(text: str, browser: bool) -> str:
    if "function bankCarriedSafeCount(mission)" in text:
        return text
    if browser:
        anchor = '''  function bankGuardTotal(mission) {\n    return mission?.nodes?.filter((node) => node.kind === "guard").length || 0;\n  }\n'''
        helper = anchor + '''\n  function bankCarriedSafeCount(mission) {\n    const nodes = Array.isArray(mission?.nodes) ? mission.nodes : [];\n    const carriedNodes = nodes.filter((node) => node && node.kind === "safe-node" && (node.carried === true || (node.searched === true && node.opened !== true))).length;\n    return Math.max(Number(mission?.safeCarried || 0), carriedNodes);\n  }\n'''
    else:
        anchor = '''function bankGuardTotal(mission) {\n  return mission?.nodes?.filter((node) => node.kind === "guard").length || 0;\n}\n'''
        helper = anchor + '''\nfunction bankCarriedSafeCount(mission) {\n  const nodes = Array.isArray(mission?.nodes) ? mission.nodes : [];\n  const carriedNodes = nodes.filter((node) => node && node.kind === "safe-node" && (node.carried === true || (node.searched === true && node.opened !== true))).length;\n  return Math.max(Number(mission?.safeCarried || 0), carriedNodes);\n}\n'''
    if anchor not in text:
        raise RuntimeError("bankGuardTotal helper anchor missing")
    return text.replace(anchor, helper, 1)


def patch_bank_spawn(text: str) -> str:
    before = text
    text, count = re.subn(
        r'(?P<i>[ \t]*)const emptySlots = new Set\(Array\.from\(\{ length: 6 \}, \(_, index\) => index\)\.sort\(\(\) => Math\.random\(\) - 0\.5\)\.slice\(0, 2\)\);\n'
        r'(?P=i)const safePositions = \[\[8\.65,7\.7\],\[21\.35,7\.7\],\[8\.65,10\.0\],\[21\.35,10\.0\],\[10\.15,5\.55\],\[19\.85,5\.55\]\];\n'
        r'(?P=i)const safeNodes = Array\.from\(\{ length: 6 \}, \(_, index\) => \(\{',
        lambda m: (
            f'{m.group("i")}const safePositions = {SAFE_POSITIONS};\n'
            f'{m.group("i")}const safeNodes = Array.from({{ length: 8 }}, (_, index) => ({{'
        ),
        text,
    )
    if count < 1:
        raise RuntimeError("은행 금고 6개/꽝 2개 생성 로직을 찾지 못했습니다.")
    text = text.replace("empty: emptySlots.has(index),", "empty: false,")
    text = text.replace("nodeCount: 7, maxBoxes: 0, specialMinTier: \"safe\"", "nodeCount: 9, maxBoxes: 0, specialMinTier: \"safe\"")
    if text == before:
        raise RuntimeError("은행 금고 생성 패치가 적용되지 않았습니다.")
    return text


def patch_no_empty_rewards(text: str) -> str:
    text = text.replace(
        'rollRedDiamond(safe.id) || (safe.empty ? null : rollItem("safe", safe.id, false))',
        'rollRedDiamond(safe.id) || rollItem("safe", safe.id, false)',
    )
    text = text.replace(
        'rollRedDiamond(safeNode.id) || (safeNode.empty ? null : rollItem("safe", safeNode.id, false))',
        'rollRedDiamond(safeNode.id) || rollItem("safe", safeNode.id, false)',
    )
    text = text.replace(
        'safeNode.empty ? null : rollItem("safe", safeNode.id, false)',
        'rollItem("safe", safeNode.id, false)',
    )
    text = text.replace(
        'safe.empty ? null : rollItem("safe", safe.id, false)',
        'rollItem("safe", safe.id, false)',
    )
    return text


def patch_main(text: str) -> str:
    text = add_carried_helper(text, browser=False)
    text = patch_bank_spawn(text)
    text = patch_no_empty_rewards(text)

    # v1.1.7의 복잡한 인라인 carried 식을 단일 권위 함수로 정리한다.
    text, count = re.subn(
        r'if \(mission\?\.missionType === "bank-finale" && .*? < 1\) \{ return \{ ok: false, error: "은행 금고를 최소 1개는 들고 나와야 탈출할 수 있습니다\.", state: publicState\(\) \}; \}',
        'if (mission?.missionType === "bank-finale" && bankCarriedSafeCount(mission) < 1) { return { ok: false, error: "은행 금고를 최소 1개는 들고 나와야 탈출할 수 있습니다.", state: publicState() }; }',
        text,
        count=1,
    )
    if count != 1:
        raise RuntimeError("main finishMission 탈출 조건을 찾지 못했습니다.")

    # 추격전 전달값은 실제 운반 금고 수만 사용한다.
    text = re.sub(
        r'chase: \{ safeCount: .*?, lootValue: 0, lootCount: 0 \}',
        'chase: { safeCount: bankCarriedSafeCount(mission), lootValue: 0, lootCount: 0 }',
        text,
        count=1,
    )
    return text


def patch_browser_app(text: str) -> str:
    text = add_carried_helper(text, browser=True)
    text = patch_bank_spawn(text)
    text = patch_no_empty_rewards(text)

    # 브라우저 fallback API도 서버와 동일한 authoritative 조건으로 맞춘다.
    text, count = re.subn(
        r'      if \(mission\?\.missionType === "bank-finale" && .*? < 1\) \{\n'
        r'        return \{ ok: false, error: "은행 금고를 최소 1개는 들고 나와야 탈출할 수 있습니다\.", state: publicState\(\) \};\n'
        r'      \}',
        '      if (mission?.missionType === "bank-finale" && bankCarriedSafeCount(mission) < 1) {\n'
        '        return { ok: false, error: "은행 금고를 최소 1개는 들고 나와야 탈출할 수 있습니다.", state: publicState() };\n'
        '      }',
        text,
        count=1,
    )
    if count != 1:
        raise RuntimeError("browser fallback finishMission 탈출 조건을 찾지 못했습니다.")

    # 실제 PC 화면에서 API 호출 전에 safeOpened를 검사하던 것이 v1.1.7 버그의 직접 원인이다.
    ui_guard = '''  if (state.mission.missionType === "bank-finale" && Number(state.mission.safeOpened || 0) < 1) {\n    toast("은행 금고를 최소 1개는 턴 뒤에 탈출할 수 있습니다.");\n    return;\n  }\n'''
    if ui_guard not in text:
        raise RuntimeError("남아 있던 state.mission.safeOpened UI 탈출 차단 코드를 찾지 못했습니다.")
    text = text.replace(ui_guard, "", 1)

    # 8개까지 운반 수를 그대로 표시하고, 난이도 표시는 항상 보통이다.
    old_count = 'bankChaseSafeCount = Math.max(1, Math.min(6, Math.trunc(Number(chase.safeCount ?? state?.mission?.safeCarried ?? 1))));'
    if old_count not in text:
        raise RuntimeError("bankChaseSafeCount 1~6 clamp를 찾지 못했습니다.")
    text = text.replace(
        old_count,
        'bankChaseSafeCount = Math.max(1, Math.trunc(Number(chase.safeCount ?? state?.mission?.safeCarried ?? 1)));',
        1,
    )
    text, label_count = re.subn(
        r'function bankChaseDifficultyLabel\(value\) \{.*?\n\}',
        'function bankChaseDifficultyLabel() {\n  return "보통";\n}',
        text,
        count=1,
        flags=re.S,
    )
    if label_count != 1:
        raise RuntimeError("추격 난이도 라벨 함수를 찾지 못했습니다.")

    # 앱 재시작 후 chasePending 복구도 safeOpened가 아니라 safeCarried 기준으로 한다.
    text = re.sub(
        r'await startBankChase\(\{ lootValue: state\.mission\.bankLootValue \|\| 0, safeOpened: state\.mission\.safeOpened \|\| 0 \}\);',
        'await startBankChase({ safeCount: Number(state.mission.safeCarried || 0) || 1 });',
        text,
        count=1,
    )
    return text


def patch_bankchase(text: str) -> str:
    old = '''    const safeCount = clamp(Math.trunc(Number(options.safeCount || 1)), 1, 6);\n    const risk = clamp(((safeCount - 1) / 5) * 1.6, 0, 1.6);'''
    new = '''    const safeCount = Math.max(1, Math.trunc(Number(options.safeCount || 1)));\n    const risk = 0.32; // 보통 난이도 고정: 기존 금고 2개 수준'''
    if old not in text:
        raise RuntimeError("bankchase safeCount 기반 risk 공식을 찾지 못했습니다.")
    return text.replace(old, new, 1)


def patch_index(text: str) -> str:
    text = text.replace("추격 강도 · 낮음", "추격 강도 · 보통")
    text = text.replace(
        "금고를 많이 들고 나올수록 추격 거리가 길어지고 장애물·충돌 피해가 강해집니다.",
        "금고 수와 관계없이 추격전 난이도는 보통으로 고정됩니다.",
    )
    text = text.replace('./bankchase.js?v=0.5.10', './bankchase.js?v=0.5.11')
    text = text.replace('./app.js?v=0.5.10', './app.js?v=0.5.11')
    return text


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
            "은행 습격 탈출 버튼에 남아 있던 safeOpened 차단 조건을 제거하고 실제 운반 금고만으로 판정합니다. "
            "금고는 8개로 늘고 꽝은 제거되며, 오토바이 추격전 난이도는 보통으로 고정됩니다."
        )
        write_json(manifest, value)

    for js in root.rglob("*.js"):
        try:
            text = js.read_text(encoding="utf-8")
        except Exception:
            continue
        updated = text.replace('sourceVersion: "1.1.7"', 'sourceVersion: "1.1.8"')
        if updated != text:
            js.write_text(updated, encoding="utf-8")

    readme = root / "README.md"
    if readme.is_file():
        readme.write_text(
            readme.read_text(encoding="utf-8")
            + f"\n\n## v{VERSION} · 은행 습격 탈출·금고·추격전 수정\n"
              "- 렌더러에 남아 있던 safeOpened 기반 탈출 차단을 제거했습니다.\n"
              "- 탈출은 실제 운반 중인 금고 수를 메인 프로세스에서 최종 판정합니다.\n"
              "- 은행 금고를 6개에서 8개로 늘리고 빈 금고를 제거했습니다.\n"
              "- 모든 금고는 레드 다이아몬드 판정 후 일반 금고 보상 풀에서 반드시 아이템 1개를 지급합니다.\n"
              "- 금고 수와 관계없이 오토바이 추격전 위험도는 보통(risk 0.32)으로 고정됩니다.\n",
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
    block = re.sub(
        r'"description": "[^"]*"',
        '"description": "은행 습격에서 금고 8개를 운반할 수 있고 빈 금고 없이 반드시 보상을 얻습니다. 탈출은 실제 운반 금고 기준으로 판정되며 오토바이 추격전 난이도는 보통으로 고정됩니다."',
        block,
        count=1,
    )
    text = text[:match.start()] + block + text[match.end():]
    path.write_text(text, encoding="utf-8")


def patch_catalog() -> None:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    catalog["catalogVersion"] = int(catalog.get("catalogVersion", 0)) + 1
    catalog["updatedAt"] = "2026-08-18T20:10:00+09:00"
    app = catalog["apps"]["sd-flea-market"]
    app["version"] = VERSION
    app["downloadUrl"] = f"https://sd608.github.io/sd-center/downloads/extensions/SDFleaMarket_v{VERSION}_Desktop.zip?v={TAG}"
    app["notes"] = (
        "은행 습격 탈출 버튼의 남은 safeOpened 검사를 제거했습니다. 금고는 8개·꽝 0개이며 "
        "실제 운반 금고를 기준으로 탈출하고 추격전 난이도는 보통으로 고정됩니다."
    )
    write_json(CATALOG, catalog)


def validate(root: Path) -> None:
    main = (root / "main.js").read_text(encoding="utf-8")
    app = (root / "public" / "app.js").read_text(encoding="utf-8")
    chase = (root / "public" / "bankchase.js").read_text(encoding="utf-8")

    checks = [
        ("state.mission.safeOpened || 0) < 1" not in app, "렌더러 safeOpened 탈출 차단이 남아 있습니다."),
        ("bankCarriedSafeCount(mission) < 1" in main, "메인 carried 탈출 판정이 없습니다."),
        ("bankCarriedSafeCount(mission) < 1" in app, "fallback carried 탈출 판정이 없습니다."),
        ("Array.from({ length: 8 }" in main and "Array.from({ length: 8 }" in app, "금고 8개 생성이 적용되지 않았습니다."),
        ("emptySlots" not in main and "emptySlots" not in app, "빈 금고 생성 코드가 남아 있습니다."),
        ("empty: false" in main and "empty: false" in app, "금고 empty=false가 적용되지 않았습니다."),
        ('const risk = 0.32' in chase, "추격전 보통 난이도 고정이 적용되지 않았습니다."),
        ("Math.min(6" not in app[app.find("async function startBankChase"):app.find("async function closeBankChaseResult")], "추격전 금고 수 6개 clamp가 남아 있습니다."),
    ]
    failed = [message for ok, message in checks if not ok]
    if failed:
        raise RuntimeError(" / ".join(failed))


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
        index_path = root / "public" / "index.html"

        main_path.write_text(patch_main(main_path.read_text(encoding="utf-8").replace("\r\n", "\n")), encoding="utf-8")
        app_path.write_text(patch_browser_app(app_path.read_text(encoding="utf-8").replace("\r\n", "\n")), encoding="utf-8")
        chase_path.write_text(patch_bankchase(chase_path.read_text(encoding="utf-8").replace("\r\n", "\n")), encoding="utf-8")
        index_path.write_text(patch_index(index_path.read_text(encoding="utf-8").replace("\r\n", "\n")), encoding="utf-8")
        patch_versions(root)
        validate(root)

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
