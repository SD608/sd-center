from __future__ import annotations

import json
import re
import shutil
import tempfile
import zipfile
from pathlib import Path

ROOT = Path.cwd()
SOURCE = ROOT / "downloads/extensions/SDLink_v1.4.0_Desktop.zip"
OUTPUT = ROOT / "downloads/extensions/SDLink_v1.4.1_Desktop.zip"
VERSION = "1.4.1"
TAG = "141"
ICON_SOURCE = ROOT / "assets/icons/sdlink.svg"
CATALOG = ROOT / "update/extensions-catalog.json"
POLICY = ROOT / "update/desktop-policy.json"
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
        if data.get("name") == "sdlink-desktop":
            roots.append(package.parent)
    if not roots:
        raise RuntimeError("SD Link package root not found")
    roots.sort(key=lambda item: len(item.parts))
    return roots[0]


def patch_package(root: Path) -> None:
    package_path = root / "package.json"
    package = json.loads(package_path.read_text(encoding="utf-8"))
    package["version"] = VERSION
    write_json(package_path, package)

    icon_target = root / "assets" / "sdlink-icon.svg"
    icon_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ICON_SOURCE, icon_target)

    manifest_path = root / "sd-app.json"
    if not manifest_path.is_file():
        raise RuntimeError("SD Link sd-app.json missing")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["version"] = VERSION
    manifest["displayVersion"] = f"Stage 1 · v{VERSION}"
    manifest["icon"] = "assets/sdlink-icon.svg"
    manifest["improvement"] = "SD Link 전용 심플 연결고리 아이콘을 추가해 종합센터에서 다른 앱과 구분되도록 했습니다. 기존 온라인 브리지·동기화 기능은 그대로 유지됩니다."
    write_json(manifest_path, manifest)

    readme = root / "README.md"
    if readme.is_file():
        readme.write_text(
            readme.read_text(encoding="utf-8")
            + f"\n\n## v{VERSION} · SD Link 고유 아이콘\n"
              "- 종합센터 등록 카드에서 사용할 SD Link 전용 심플 연결고리 아이콘을 추가했습니다.\n"
              "- sd-app.json의 icon 경로를 assets/sdlink-icon.svg로 고정했습니다.\n"
              "- v1.4.0의 PC 게임 온라인 브리지와 동기화 기능은 변경하지 않았습니다.\n",
            encoding="utf-8",
        )


def patch_extension_data(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    pattern = re.compile(r'(\{\n\s+"id": "sd-link",.*?\n\s+\})', re.S)
    match = pattern.search(text)
    if not match:
        raise RuntimeError(f"SD Link extension block missing: {path}")
    block = match.group(1)
    block = re.sub(r'"version": "v[^"]+"', f'"version": "v{VERSION}"', block, count=1)
    block = re.sub(r'"icon": "[^"]+"', '"icon": "assets/icons/sdlink.svg"', block, count=1)
    block = re.sub(r'"fileName": "[^"]+"', f'"fileName": "SDLink_v{VERSION}_Desktop.zip"', block, count=1)
    block = re.sub(r'"downloadUrl": "[^"]+"', f'"downloadUrl": "downloads/extensions/SDLink_v{VERSION}_Desktop.zip?v={TAG}"', block, count=1)
    block = re.sub(r'"updatedAt": "[^"]+"', '"updatedAt": "2026-08-18"', block, count=1)
    text = text[:match.start()] + block + text[match.end():]
    path.write_text(text, encoding="utf-8")


def patch_catalog_and_policy() -> None:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    catalog["catalogVersion"] = int(catalog.get("catalogVersion", 0)) + 1
    catalog["updatedAt"] = "2026-08-18T20:10:00+09:00"
    app = catalog["apps"]["sdlink-desktop"]
    app["version"] = VERSION
    app["downloadUrl"] = f"https://sd608.github.io/sd-center/downloads/extensions/SDLink_v{VERSION}_Desktop.zip?v={TAG}"
    app["icon"] = "https://sd608.github.io/sd-center/assets/icons/sdlink.svg?v=141"
    app["iconUrl"] = app["icon"]
    app["notes"] = "SD Link 전용 심플 연결고리 아이콘을 추가했습니다. v1.4.0의 PC 슬롯·홀짝 온라인 브리지와 백그라운드 동기화 기능은 그대로 유지됩니다."
    write_json(CATALOG, catalog)

    policy = json.loads(POLICY.read_text(encoding="utf-8"))
    policy["policyVersion"] = int(policy.get("policyVersion", 0)) + 1
    policy["updatedAt"] = "2026-08-18T20:10:00+09:00"
    rule = policy["apps"]["sdlink-desktop"]
    # 기능 호환 최소버전은 1.4.0 그대로 두되, 필수 업데이트를 받는 사용자는 최신 1.4.1을 받게 한다.
    rule["downloadUrl"] = f"https://sd608.github.io/sd-center/downloads/extensions/SDLink_v{VERSION}_Desktop.zip?v={TAG}"
    write_json(POLICY, policy)


def validate(root: Path) -> None:
    package = json.loads((root / "package.json").read_text(encoding="utf-8"))
    manifest = json.loads((root / "sd-app.json").read_text(encoding="utf-8"))
    icon = root / str(manifest.get("icon") or "")
    if package.get("version") != VERSION:
        raise RuntimeError("SD Link package version mismatch")
    if manifest.get("version") != VERSION:
        raise RuntimeError("SD Link manifest version mismatch")
    if manifest.get("icon") != "assets/sdlink-icon.svg" or not icon.is_file():
        raise RuntimeError("SD Link custom icon missing")


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"missing source: {SOURCE}")
    if not ICON_SOURCE.is_file():
        raise SystemExit(f"missing icon: {ICON_SOURCE}")

    with tempfile.TemporaryDirectory() as tmp:
        extracted = Path(tmp) / "sdlink"
        extracted.mkdir()
        with zipfile.ZipFile(SOURCE) as archive:
            archive.extractall(extracted)
        root = find_root(extracted)
        patch_package(root)
        validate(root)

        if OUTPUT.exists():
            OUTPUT.unlink()
        with zipfile.ZipFile(OUTPUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for file in sorted(extracted.rglob("*")):
                if file.is_file():
                    archive.write(file, file.relative_to(extracted).as_posix())

    for path in EXT_DATA:
        patch_extension_data(path)
    patch_catalog_and_policy()
    print(f"built {OUTPUT} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
