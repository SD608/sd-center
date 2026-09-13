from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

ROOT = Path.cwd()
VALIDATED_V123 = ROOT / "diagnostics/SDFleaMarket_v1.2.3_transparent-icons-candidate.zip"
# Exact ZIP handed to the user and validated on Windows. The candidate builder itself is
# not byte-deterministic because archive entry mtimes come from the extraction workspace,
# so CI verifies the normalized entry-content hash below instead of ZIP container metadata.
WINDOWS_TESTED_V123_ZIP_SHA256 = "d7f4b3c29bcf55d18a82cc116579ce7b982169077f7f6a9748ab07581c335c5f"
WINDOWS_TESTED_V123_CONTENT_SHA256 = "358c82fe97a3055d30fc11420d14babb4c9abd5108150b1932266e0654a3514d"
OUT_DIR = ROOT / "artifacts/flea-v124-transparent-icons"
OUT_ZIP = OUT_DIR / "SDFleaMarket_v1.2.4_Desktop-CANDIDATE.zip"
OUT_SHA = OUT_DIR / "SDFleaMarket_v1.2.4_Desktop-CANDIDATE.sha256"
OUT_REPORT = OUT_DIR / "SDFleaMarket_v1.2.4_RELEASE_CANDIDATE_REPORT.json"
EXPECTED_SHA256 = "a23783ff7192a2e0974ae0bca98e3dbfd6c241df345babd0a867a48ea87cbc8c"
FIXED_ZIP_TIME = (2026, 9, 8, 12, 0, 0)
METADATA_ONLY = {
    "sd-flea-market/package.json",
    "sd-flea-market/sd-app.json",
    "sd-flea-market/RELEASE_NOTES.txt",
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalized_zip_content_sha256(path: Path) -> str:
    """Hash file names + uncompressed bytes, intentionally ignoring ZIP metadata."""
    h = hashlib.sha256()
    with zipfile.ZipFile(path) as archive:
        for name in sorted(n for n in archive.namelist() if not n.endswith("/")):
            data = archive.read(name)
            h.update(name.encode("utf-8"))
            h.update(b"\0")
            h.update(len(data).to_bytes(8, "big"))
            h.update(data)
    return h.hexdigest()


def deterministic_zip(package_root: Path, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(p for p in package_root.rglob("*") if p.is_file()):
            rel = Path("sd-flea-market") / path.relative_to(package_root)
            info = zipfile.ZipInfo(str(rel).replace("\\", "/"), date_time=FIXED_ZIP_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def build_exact_validated_v123() -> tuple[str, str]:
    subprocess.run(["python", "tools/build-flea-transparent-icons-candidate.py"], check=True)
    subprocess.run(["python", "tools/patch-flea-phone-home-layout.py"], check=True)
    if not VALIDATED_V123.is_file():
        raise RuntimeError("validated v1.2.3 candidate was not produced")
    zip_digest = sha256(VALIDATED_V123)
    content_digest = normalized_zip_content_sha256(VALIDATED_V123)
    if content_digest != WINDOWS_TESTED_V123_CONTENT_SHA256:
        raise RuntimeError(
            "validated v1.2.3 runtime content mismatch: "
            f"{content_digest}; Windows-tested content={WINDOWS_TESTED_V123_CONTENT_SHA256}"
        )
    print(f"rebuilt_v123_zip_sha256={zip_digest} (container metadata may differ)")
    print(f"rebuilt_v123_content_sha256={content_digest}")
    return zip_digest, content_digest


def build_v124() -> None:
    rebuilt_v123_zip_sha, rebuilt_v123_content_sha = build_exact_validated_v123()
    with tempfile.TemporaryDirectory() as td:
        root = Path(td) / "extract"
        root.mkdir()
        with zipfile.ZipFile(VALIDATED_V123) as archive:
            archive.extractall(root)
        package_root = root / "sd-flea-market"
        package_path = package_root / "package.json"
        app_path = package_root / "sd-app.json"
        notes_path = package_root / "RELEASE_NOTES.txt"

        package = json.loads(package_path.read_text(encoding="utf-8"))
        app = json.loads(app_path.read_text(encoding="utf-8"))
        if package.get("version") != "1.2.3" or app.get("version") != "1.2.3":
            raise RuntimeError("validated base package metadata is not v1.2.3")

        package["version"] = "1.2.4"
        app["version"] = "1.2.4"
        app["displayVersion"] = "PC Expansion · v1.2.4"
        package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        app_path.write_text(json.dumps(app, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        notes_path.write_text(
            "SD 플리마켓 v1.2.4\n\n"
            "- 36종 아이템 이미지를 사용자 승인 투명 아이콘 세트로 교체\n"
            "- 물건 보관함·상자·금고·아이템 사전·다중 결과에서 아이콘 원본 비율과 표시 크기 유지\n"
            "- 초기 핸드폰 홈 앱 5개를 3+2 배치로 정리해 회사 등급 카드와의 겹침 수정\n"
            "- 기존 아이템 ID·가격·등급·수량·획득 기록·보관함 데이터·SD Core 경제 로직 유지\n",
            encoding="utf-8",
        )

        css = (package_root / "public/style.css").read_text(encoding="utf-8")
        index = (package_root / "public/index.html").read_text(encoding="utf-8")
        for marker in (
            "2026-09-07 native-size aspect-safe item artwork",
            "2026-09-07 phone home five-app overlap fix",
            "grid-template-columns:repeat(6,minmax(0,1fr));",
        ):
            if marker not in css:
                raise RuntimeError(f"required validated UI marker missing: {marker}")
        if index.count('class="phone-app"') != 5:
            raise RuntimeError("phone home app count is not 5")
        item_dir = package_root / "public/assets/items"
        if len(list(item_dir.glob("*.png"))) != 36:
            raise RuntimeError("expected exactly 36 item PNGs")

        if shutil.which("node"):
            for relative in (
                "main.js", "preload.js", "src/wallet-db.js", "src/sd-integration.js",
                "public/mission3d.js", "public/bankchase.js", "public/app.js",
            ):
                path = package_root / relative
                if path.is_file():
                    subprocess.run(["node", "--check", str(path)], check=True)

        deterministic_zip(package_root, OUT_ZIP)

    with zipfile.ZipFile(VALIDATED_V123) as old, zipfile.ZipFile(OUT_ZIP) as new:
        old_names = set(old.namelist())
        new_names = set(new.namelist())
        if old_names != new_names:
            raise RuntimeError("v1.2.4 file set differs from validated candidate")
        runtime_diffs = [
            name for name in sorted(old_names - METADATA_ONLY)
            if old.read(name) != new.read(name)
        ]
        if runtime_diffs:
            raise RuntimeError(f"runtime files changed beyond approved candidate: {runtime_diffs}")

    digest = sha256(OUT_ZIP)
    if digest != EXPECTED_SHA256:
        raise RuntimeError(f"reproducible v1.2.4 SHA mismatch: {digest}")
    OUT_SHA.write_text(f"{digest}  SDFleaMarket_v1.2.4_Desktop.zip\n", encoding="ascii")
    OUT_REPORT.write_text(json.dumps({
        "windows_tested_v123_zip_sha256": WINDOWS_TESTED_V123_ZIP_SHA256,
        "windows_tested_v123_content_sha256": WINDOWS_TESTED_V123_CONTENT_SHA256,
        "rebuilt_v123_zip_sha256": rebuilt_v123_zip_sha,
        "rebuilt_v123_content_sha256": rebuilt_v123_content_sha,
        "release_candidate": OUT_ZIP.name,
        "release_candidate_sha256": digest,
        "version": "1.2.4",
        "runtime_diff_except_metadata": 0,
        "metadata_only_changes": sorted(METADATA_ONLY),
        "user_windows_gate_source": "validated v1.2.3 runtime candidate",
        "publication_state": "FINAL_WINDOWS_RETEST_REQUIRED_BEFORE_MAIN_PUBLICATION",
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"candidate={OUT_ZIP}")
    print(f"size={OUT_ZIP.stat().st_size}")
    print(f"sha256={digest}")
    print("runtime_diff_except_metadata=0")


if __name__ == "__main__":
    build_v124()
