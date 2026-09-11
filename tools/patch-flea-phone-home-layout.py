from __future__ import annotations

import hashlib
import json
import tempfile
import zipfile
from pathlib import Path

CANDIDATE = Path("diagnostics/SDFleaMarket_v1.2.3_transparent-icons-candidate.zip")
SHA_FILE = Path("diagnostics/SDFleaMarket_v1.2.3_transparent-icons-candidate.sha256")
REPORT = Path("diagnostics/SDFleaMarket_v1.2.3_transparent-icons-report.json")
MARKER = "2026-09-07 phone home five-app overlap fix"

FIX_CSS = r'''

/* 2026-09-07 phone home five-app overlap fix */
.phone-app-grid{
  grid-template-columns:repeat(6,minmax(0,1fr));
  gap:16px 8px;
  padding:10px 3px 8px;
}
.phone-app{
  grid-column:span 2;
  min-width:0;
}
.phone-app:nth-child(4){grid-column:2 / span 2}
.phone-app:nth-child(5){grid-column:4 / span 2}
.phone-app strong,.phone-app small{
  max-width:100%;
  text-align:center;
}
@media(max-height:720px){
  .phone-title{padding:18px 4px 12px}
  .phone-app-grid{gap:10px 6px;padding:4px 3px 6px}
  .phone-app-icon{width:62px;height:62px}
  .phone-app{gap:4px}
}
'''


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def repack(root: Path, output: Path) -> None:
    if output.exists():
        output.unlink()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(root.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(root))


def main() -> None:
    if not CANDIDATE.is_file():
        raise SystemExit(f"missing candidate: {CANDIDATE}")
    if not REPORT.is_file():
        raise SystemExit(f"missing report: {REPORT}")

    with tempfile.TemporaryDirectory() as td:
        root = Path(td) / "extract"
        root.mkdir()
        with zipfile.ZipFile(CANDIDATE) as archive:
            archive.extractall(root)

        package_root = root / "sd-flea-market"
        index_path = package_root / "public/index.html"
        css_path = package_root / "public/style.css"
        if not index_path.is_file() or not css_path.is_file():
            raise RuntimeError("flea package UI files missing")

        index = index_path.read_text(encoding="utf-8")
        css = css_path.read_text(encoding="utf-8")

        app_count = index.count('class="phone-app"')
        if app_count != 5:
            raise RuntimeError(f"unexpected phone home app count: {app_count}")
        for token in (
            '.phone-app-grid{position:relative;z-index:2;display:grid;grid-template-columns:1fr 1fr',
            '.phone-company-card{position:absolute;',
            'data-app="dictionary"',
        ):
            if token not in (css if token.startswith(".") else index):
                raise RuntimeError(f"phone home base marker missing: {token}")

        if MARKER not in css:
            css_path.write_text(css + FIX_CSS, encoding="utf-8")

        final_css = css_path.read_text(encoding="utf-8")
        for token in (
            MARKER,
            'grid-template-columns:repeat(6,minmax(0,1fr));',
            '.phone-app:nth-child(4){grid-column:2 / span 2}',
            '.phone-app:nth-child(5){grid-column:4 / span 2}',
        ):
            if token not in final_css:
                raise RuntimeError(f"phone home overlap fix token missing: {token}")

        repack(root, CANDIDATE)

    digest = sha256(CANDIDATE)
    SHA_FILE.write_text(f"{digest}  {CANDIDATE.name}\n", encoding="utf-8")
    report = json.loads(REPORT.read_text(encoding="utf-8"))
    report["candidate_sha256"] = digest
    report["phone_home_overlap_fix"] = True
    report["phone_home_app_count"] = 5
    report["phone_home_layout"] = "3 apps first row + 2 centered second row"
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"patched={CANDIDATE}")
    print(f"sha256={digest}")


if __name__ == "__main__":
    main()
