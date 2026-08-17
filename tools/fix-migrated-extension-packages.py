from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "update" / "extensions-catalog.json"
DOWNLOAD_DIR = ROOT / "downloads" / "extensions"
LOGISTICS_PATH = DOWNLOAD_DIR / "SDLogisticsCenter_Season0_Desktop.zip"
LOGISTICS_GOOD_COMMIT = "1b2f5e8e31fbbc38cfd5dd7e4de21a43b7e76909"

OPEN_CENTER_MODULE = r'''"use strict";

const { spawn } = require("node:child_process");

const CENTER_PROTOCOLS = new Set(["sd-center:", "sdcenter:"]);

function isSdCenterUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const raw = value.trim();
  try {
    const target = new URL(raw);
    return CENTER_PROTOCOLS.has(target.protocol.toLowerCase());
  } catch {
    const lower = raw.toLowerCase();
    return lower.startsWith("sd-center:") || lower.startsWith("sdcenter:");
  }
}

function openSdCenter(app) {
  try {
    const child = spawn(process.execPath, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();

    if (app && typeof app.quit === "function") {
      setTimeout(() => app.quit(), 120);
    }
    return true;
  } catch (error) {
    console.warn("SD종합센터 열기 실패", error?.message || error);
    return false;
  }
}

module.exports = { isSdCenterUrl, openSdCenter };
'''


def download(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "SDCenter-migration-hotfix/1.0"})
    with urllib.request.urlopen(req, timeout=90) as r, dest.open("wb") as f:
        shutil.copyfileobj(r, f)


def assert_zip(path: Path) -> None:
    with zipfile.ZipFile(path) as z:
        bad = z.testzip()
        if bad:
            raise RuntimeError(f"ZIP CRC failure {path.name}: {bad}")


def extract_zip(path: Path, dest: Path) -> None:
    assert_zip(path)
    with zipfile.ZipFile(path) as z:
        z.extractall(dest)


def write_zip(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in sorted(src.rglob("*")):
            if p.is_file():
                z.write(p, p.relative_to(src).as_posix())
    assert_zip(dest)


def package_roots(base: Path):
    items = []
    for p in base.rglob("package.json"):
        if "node_modules" in p.parts:
            continue
        try:
            data = json.loads(p.read_text(encoding="utf-8-sig"))
        except Exception:
            continue
        if data.get("main"):
            items.append((p.parent, data))
    items.sort(key=lambda x: len(x[0].relative_to(base).parts))
    return items


def bump_metadata(root: Path, version: str) -> None:
    pkg = root / "package.json"
    data = json.loads(pkg.read_text(encoding="utf-8-sig"))
    data["version"] = version
    pkg.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for sd_app in root.rglob("sd-app.json"):
        try:
            d = json.loads(sd_app.read_text(encoding="utf-8-sig"))
        except Exception:
            continue
        if isinstance(d, dict):
            d["version"] = version
            sd_app.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def localize_open_center(pkg_root: Path) -> bool:
    changed = False
    for main in [pkg_root / "main.js"]:
        if not main.exists():
            continue
        text = main.read_text(encoding="utf-8-sig")
        patched, count = re.subn(
            r'''require\(\s*["']\.\./\.\./shared/open-center["']\s*\)''',
            'require("./src/open-center")',
            text,
            count=1,
        )
        if count:
            main.write_text(patched, encoding="utf-8")
            src = pkg_root / "src"
            src.mkdir(parents=True, exist_ok=True)
            (src / "open-center.js").write_text(OPEN_CENTER_MODULE, encoding="utf-8")
            changed = True
    return changed


def validate_pkg(pkg_root: Path, expected_version: str) -> None:
    pkg = json.loads((pkg_root / "package.json").read_text(encoding="utf-8-sig"))
    if str(pkg.get("version")) != expected_version:
        raise RuntimeError(f"Version mismatch in {pkg_root}: {pkg.get('version')} != {expected_version}")
    main = pkg_root / str(pkg.get("main"))
    if not main.exists():
        raise RuntimeError(f"Main missing: {main}")
    subprocess.run(["node", "--check", str(main)], check=True)
    text = main.read_text(encoding="utf-8-sig", errors="ignore")
    if "../../shared/open-center" in text:
        raise RuntimeError(f"External open-center dependency remains: {main}")
    if 'require("./src/open-center")' in text and not (pkg_root / "src" / "open-center.js").exists():
        raise RuntimeError(f"Local open-center missing: {pkg_root}")


def repair_from_zip(source_zip: Path, output_zip: Path, version: str, require_patch: bool) -> dict:
    temp = Path(tempfile.mkdtemp(prefix="sd-hotfix-"))
    try:
        extract = temp / "extract"
        extract.mkdir()
        extract_zip(source_zip, extract)
        roots = package_roots(extract)
        if not roots:
            raise RuntimeError(f"package.json/main not found in {source_zip.name}")
        pkg_root = roots[0][0]
        patched = localize_open_center(pkg_root)
        if require_patch and not patched:
            raise RuntimeError(f"Expected open-center dependency not found in {source_zip.name}")
        bump_metadata(pkg_root, version)
        validate_pkg(pkg_root, version)
        write_zip(extract, output_zip)
        return {"root": pkg_root.relative_to(extract).as_posix() or ".", "openCenterLocalized": patched}
    finally:
        shutil.rmtree(temp, ignore_errors=True)


def restore_logistics_source(dest: Path) -> None:
    spec = f"{LOGISTICS_GOOD_COMMIT}:downloads/extensions/SDLogisticsCenter_Season0_Desktop.zip"
    proc = subprocess.run(["git", "show", spec], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        raise RuntimeError(f"Failed to restore logistics blob: {proc.stderr.decode(errors='ignore')}")
    dest.write_bytes(proc.stdout)
    assert_zip(dest)


def main() -> None:
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    apps = catalog["apps"]
    report = {}

    with tempfile.TemporaryDirectory(prefix="sd-migration-fix-") as td:
        t = Path(td)

        # 1) Logistics: restore the last known-good v1.0.9 binary from git history,
        # then repackage as 1.0.10 so installed 1.0.9 clients can receive the repair.
        logistics_src = t / "logistics-v109.zip"
        restore_logistics_source(logistics_src)
        report["logistics"] = repair_from_zip(
            logistics_src,
            LOGISTICS_PATH,
            "1.0.10",
            require_patch=False,
        )

        # 2) Vault: release v1.2.0 still references the old center-internal shared module.
        vault_src = t / "vault-v120.zip"
        download(apps["vault"]["downloadUrl"], vault_src)
        vault_out = DOWNLOAD_DIR / "SDVault_v1.2.1_Desktop.zip"
        report["vault"] = repair_from_zip(vault_src, vault_out, "1.2.1", require_patch=True)

        # 3) Miner: same legacy center-internal dependency.
        miner_src = t / "miner-v110.zip"
        download(apps["miner"]["downloadUrl"], miner_src)
        miner_out = DOWNLOAD_DIR / "SDMiner_v1.1.1_Desktop.zip"
        report["miner"] = repair_from_zip(miner_src, miner_out, "1.1.1", require_patch=True)

    # Update center catalog.
    catalog["catalogVersion"] = int(catalog.get("catalogVersion", 0)) + 1
    catalog["updatedAt"] = datetime.now(timezone(timedelta(hours=9))).isoformat(timespec="seconds")

    apps["sd-logistics-center-desktop"].update({
        "version": "1.0.10",
        "downloadUrl": "https://sd608.github.io/sd-center/downloads/extensions/SDLogisticsCenter_Season0_Desktop.zip?v=1010",
        "notes": "확장팩 전환 과정에서 손상된 v1.0.9 배포 ZIP을 정상 패키지로 복구한 v1.0.10 핫픽스입니다. 기존 물류 진행/지갑 연동 로직은 유지합니다.",
    })
    apps["vault"].update({
        "version": "1.2.1",
        "downloadUrl": "https://sd608.github.io/sd-center/downloads/extensions/SDVault_v1.2.1_Desktop.zip?v=121",
        "notes": "기본 앱 시절 종합센터 내부 ../../shared/open-center 모듈을 참조하던 문제를 수정하고 필요한 모듈을 ZIP 내부에 자체 포함했습니다.",
    })
    apps["miner"].update({
        "version": "1.1.1",
        "downloadUrl": "https://sd608.github.io/sd-center/downloads/extensions/SDMiner_v1.1.1_Desktop.zip?v=111",
        "notes": "기본 앱 시절 종합센터 내부 ../../shared/open-center 모듈을 참조하던 문제를 수정하고 필요한 모듈을 ZIP 내부에 자체 포함했습니다.",
    })

    CATALOG_PATH.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    report_path = ROOT / "diagnostics" / "migration-hotfix-build.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
