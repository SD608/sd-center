from __future__ import annotations

import json
import re
import tempfile
import zipfile
from pathlib import Path

ROOT = Path.cwd()
SOURCE = ROOT / "downloads/extensions/SDFleaMarket_v1.1.6_Desktop.zip"
OUTPUT = ROOT / "downloads/extensions/SDFleaMarket_v1.1.7_Desktop.zip"
VERSION = "1.1.7"
TAG = "117"
EXT_DATA = [ROOT / "extensions-data.js", ROOT / "assets/js/extensions-data.js"]
CATALOG = ROOT / "update/extensions-catalog.json"


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def find_root(extracted: Path) -> Path:
    for package in extracted.rglob("package.json"):
        if "node_modules" in {part.lower() for part in package.parts}:
            continue
        try:
            data = json.loads(package.read_text(encoding="utf-8"))
        except Exception:
            continue
        if data.get("name") in {"sd-flea-market", "sd-flea-market-pc"}:
            return package.parent
    raise RuntimeError("플리마켓 package root not found")


CARRIED_COUNT = "Math.max(Number(mission.safeCarried || 0), Array.isArray(mission.nodes) ? mission.nodes.filter((node) => node && node.kind === \"safe-node\" && (node.carried === true || (node.searched === true && node.opened !== true))).length : 0)"


def patch_escape_source(path: Path) -> tuple[int, int]:
    if not path.is_file():
        return (0, 0)
    text = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    before = text

    old_guard_patterns = [
        "Number(mission.safeOpened || 0) < 1",
        "Number(mission.safeCarried || 0) < 1",
    ]
    guard_hits = 0
    for old in old_guard_patterns:
        count = text.count(old)
        if count:
            text = text.replace(old, f"{CARRIED_COUNT} < 1")
            guard_hits += count

    # 옛 문구도 제거해서 현재 규칙이 사용자에게 명확하게 보이도록 합니다.
    text = text.replace(
        "은행 금고를 최소 1개는 턴 뒤에 탈출할 수 있습니다.",
        "은행 금고를 최소 1개는 들고 나와야 탈출할 수 있습니다.",
    )

    # 일부 중복 구현은 추격전 전달값도 safeOpened를 사용합니다.
    chase_old = "safeOpened: Number(mission.safeOpened || 0)"
    chase_hits = text.count(chase_old)
    if chase_hits:
        text = text.replace(chase_old, f"safeCount: {CARRIED_COUNT}")

    # 브리지 스냅샷 버전도 현재 패키지 버전으로 맞춥니다.
    text = text.replace('sourceVersion: "1.1.6"', 'sourceVersion: "1.1.7"')

    if text != before:
        path.write_text(text, encoding="utf-8")
    return guard_hits, chase_hits


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
        obj["improvement"] = (
            "은행 습격 탈출 판정을 현장에서 연 금고 수가 아니라 실제로 들고 있는 금고 수 기준으로 수정했습니다. "
            "금고를 운반 중이면 정상적으로 탈출 및 오토바이 추격전으로 진행됩니다."
        )
        # 센터가 앱 아이콘을 읽을 수 있도록 누락된 manifest 아이콘도 보완합니다.
        if not obj.get("icon"):
            for candidate in ["public/icons/icon-512.png", "public/icon-512.png", "public/icon.png"]:
                if (root / candidate).is_file():
                    obj["icon"] = candidate
                    break
        write_json(sd_app, obj)

    readme = root / "README.md"
    if readme.is_file():
        readme.write_text(
            readme.read_text(encoding="utf-8")
            + f"\n\n## v{VERSION} · 은행 금고 운반 탈출 수정\n"
              "- 탈출 조건에서 현장 금고 개봉 수(safeOpened) 의존성을 제거했습니다.\n"
              "- safeCarried와 실제 carried 금고 노드를 함께 검사해 운반 중인 금고를 정확히 인정합니다.\n"
              "- 금고를 들고 있으면 현장에서 열지 않아도 정상적으로 오토바이 추격전으로 넘어갑니다.\n",
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
        '"description": "은행 습격에서 금고를 직접 들고 탈출하는 흐름을 지원하며, 운반 중인 금고를 기준으로 탈출·오토바이 추격전을 판정합니다. 기존 파밍·온라인 물품 동기화·물류 연동 기능도 유지됩니다."',
        block,
        count=1,
    )
    text = text[:match.start()] + block + text[match.end():]
    path.write_text(text, encoding="utf-8")


def patch_catalog() -> None:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    catalog["catalogVersion"] = int(catalog.get("catalogVersion", 0)) + 1
    catalog["updatedAt"] = "2026-08-18T12:30:00+09:00"
    app = catalog["apps"]["sd-flea-market"]
    app["version"] = VERSION
    app["downloadUrl"] = f"https://sd608.github.io/sd-center/downloads/extensions/SDFleaMarket_v{VERSION}_Desktop.zip?v={TAG}"
    app["notes"] = (
        "은행 습격 탈출 조건을 현장 금고 개봉 수가 아니라 실제 운반 중인 금고 수 기준으로 수정했습니다. "
        "금고를 들고 있으면 정상적으로 탈출 및 오토바이 추격전으로 진행됩니다."
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

        total_guards = 0
        total_chase = 0
        targets = [root / "main.js", root / "public" / "app.js"]
        for target in targets:
            guards, chase = patch_escape_source(target)
            total_guards += guards
            total_chase += chase

        # 반드시 옛 탈출 조건이 하나 이상 존재했어야 이번 버그 수정이 유효합니다.
        if total_guards < 1:
            raise RuntimeError("은행 탈출 조건 패치 대상이 발견되지 않았습니다.")

        for target in targets:
            if target.is_file():
                check = target.read_text(encoding="utf-8")
                if "Number(mission.safeOpened || 0) < 1" in check:
                    raise RuntimeError(f"옛 safeOpened 탈출 조건이 남아 있습니다: {target}")
                if "은행 금고를 최소 1개는 턴 뒤에 탈출할 수 있습니다." in check:
                    raise RuntimeError(f"옛 탈출 안내가 남아 있습니다: {target}")

        patch_versions(root)

        if OUTPUT.exists():
            OUTPUT.unlink()
        with zipfile.ZipFile(OUTPUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for file in sorted(extracted.rglob("*")):
                if file.is_file():
                    archive.write(file, file.relative_to(extracted).as_posix())

    patch_catalog()
    for path in EXT_DATA:
        patch_extension_data(path)
    print(f"built {OUTPUT} ({OUTPUT.stat().st_size} bytes), escape guards patched={total_guards}, chase fields patched={total_chase}")


if __name__ == "__main__":
    main()
