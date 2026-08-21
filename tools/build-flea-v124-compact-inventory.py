from __future__ import annotations

import hashlib
import json
import tempfile
import zipfile
from pathlib import Path

BASE = Path("downloads/extensions/SDFleaMarket_v1.2.3_Desktop.zip")
BASE_SHA256 = "5ee869af576045fae3bc48366a8de58bdcac7bfeedad77a9a9d1d94bd5ac3e75"
OUT_DIR = Path("artifacts/flea-v124")
OUT_ZIP = OUT_DIR / "SDFleaMarket_v1.2.4_Desktop-CANDIDATE.zip"
OUT_SHA = OUT_DIR / "SDFleaMarket_v1.2.4_Desktop-CANDIDATE.sha256"
OUT_PROVENANCE = OUT_DIR / "FLEA_V124_CANDIDATE_PROVENANCE.txt"
FIX_MARKER = "v1.2.4 compact inventory artwork"

COMPACT_CSS = r'''

/* v1.2.4 compact inventory artwork */
.item-card .item-art{width:min(96px,100%);height:76px;margin:2px auto 10px}
.item-card .inventory-item-image{width:82px;height:64px;max-width:86%;max-height:86%;object-fit:contain;display:block}
@media(max-width:700px){.item-card .item-art{width:min(88px,100%);height:70px}.item-card .inventory-item-image{width:76px;height:58px}}
'''


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def deterministic_zip(source_root: Path, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for path in sorted(p for p in source_root.rglob("*") if p.is_file()):
            rel = Path("sd-flea-market") / path.relative_to(source_root)
            info = zipfile.ZipInfo(str(rel).replace("\\", "/"), date_time=(2026, 8, 21, 12, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            z.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def main() -> None:
    if not BASE.is_file():
        raise SystemExit(f"missing base package: {BASE}")
    actual_base_sha = sha256(BASE)
    if actual_base_sha != BASE_SHA256:
        raise SystemExit(f"base SHA-256 mismatch: {actual_base_sha}")

    with tempfile.TemporaryDirectory() as td:
        extract = Path(td) / "extract"
        extract.mkdir()
        with zipfile.ZipFile(BASE) as z:
            z.extractall(extract)
        pkg = extract / "sd-flea-market"
        if not pkg.is_dir():
            raise SystemExit("sd-flea-market package root missing")

        package_path = pkg / "package.json"
        app_path = pkg / "sd-app.json"
        css_path = pkg / "public" / "style.css"
        notes_path = pkg / "RELEASE_NOTES.txt"

        package = json.loads(package_path.read_text(encoding="utf-8"))
        app = json.loads(app_path.read_text(encoding="utf-8"))
        if package.get("version") != "1.2.3" or app.get("version") != "1.2.3":
            raise SystemExit("expected exact flea v1.2.3 base")

        css = css_path.read_text(encoding="utf-8")
        for marker in [
            ".item-art{width:100%;height:104px",
            ".inventory-item-image{width:100%;height:100%;object-fit:contain",
        ]:
            if marker not in css:
                raise SystemExit(f"base inventory CSS marker missing: {marker}")
        if FIX_MARKER in css:
            raise SystemExit("compact inventory fix already present in base")
        css_path.write_text(css + COMPACT_CSS, encoding="utf-8")

        package["version"] = "1.2.4"
        app["version"] = "1.2.4"
        app["displayVersion"] = "PC Expansion · v1.2.4"
        package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        app_path.write_text(json.dumps(app, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        notes_path.write_text(
            "SD 플리마켓 v1.2.4 후보\n\n"
            "- 물건 보관함 카드의 아이템 이미지를 대형 배너형에서 중앙 소형 썸네일로 축소\n"
            "- 데스크톱 96x76px, 모바일 88x70px 컨테이너 기준으로 조정\n"
            "- 아이템 가격/상태/보관 데이터와 경제 로직은 변경하지 않음\n"
            "- 공식 배포 전 Windows 시각 smoke 필요\n",
            encoding="utf-8",
        )

        final_css = css_path.read_text(encoding="utf-8")
        for marker in [
            FIX_MARKER,
            ".item-card .item-art{width:min(96px,100%);height:76px",
            ".item-card .inventory-item-image{width:82px;height:64px",
        ]:
            if marker not in final_css:
                raise SystemExit(f"compact UI marker missing: {marker}")

        deterministic_zip(pkg, OUT_ZIP)

    digest = sha256(OUT_ZIP)
    OUT_SHA.write_text(f"{digest}  {OUT_ZIP.name}\n", encoding="ascii")
    OUT_PROVENANCE.write_text(
        "SD Flea Market v1.2.4 UI candidate\n"
        f"base_file={BASE.as_posix()}\n"
        f"base_sha256={BASE_SHA256}\n"
        f"candidate_file={OUT_ZIP.name}\n"
        f"candidate_sha256={digest}\n"
        "change_scope=inventory artwork size only + package candidate version metadata\n"
        "publication_state=BLOCKED_FINAL_GATE_ARTIFACT_ONLY\n"
        "catalog_or_official_release_modified=false\n",
        encoding="utf-8",
    )
    print(f"built {OUT_ZIP} ({OUT_ZIP.stat().st_size} bytes) sha256={digest}")


if __name__ == "__main__":
    main()
