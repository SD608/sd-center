from __future__ import annotations

import json
import re
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "update" / "extensions-catalog.json"
OUT_JSON = ROOT / "diagnostics" / "extension-package-audit.json"
OUT_MD = ROOT / "diagnostics" / "extension-package-audit.md"

TEXT_EXTS = {".js", ".cjs", ".mjs", ".html", ".htm", ".json"}
SKIP_DIRS = {"node_modules", ".git", "dist", "build", "out"}
REL_PATTERNS = [
    re.compile(r"\brequire\(\s*['\"]([^'\"]+)['\"]\s*\)"),
    re.compile(r"\bfrom\s+['\"]([^'\"]+)['\"]"),
    re.compile(r"\bimport\(\s*['\"]([^'\"]+)['\"]\s*\)"),
]
SCRIPT_SRC = re.compile(r"<script[^>]+src=['\"]([^'\"]+)['\"]", re.I)
LINK_HREF = re.compile(r"<link[^>]+href=['\"]([^'\"]+)['\"]", re.I)
SUSPICIOUS = [
    "shared/open-center",
    "../shared/",
    "../../shared/",
    "resources/app/shared",
    "resources\\app\\shared",
]


def clean_url(url: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))


def download(url: str, dest: Path) -> None:
    req = urllib.request.Request(clean_url(url), headers={"User-Agent": "SDCenter-extension-audit/1.0"})
    with urllib.request.urlopen(req, timeout=90) as r, dest.open("wb") as f:
        shutil.copyfileobj(r, f)


def find_package_roots(base: Path):
    roots = []
    for p in base.rglob("package.json"):
        if any(part in SKIP_DIRS for part in p.relative_to(base).parts[:-1]):
            continue
        try:
            data = json.loads(p.read_text(encoding="utf-8-sig"))
        except Exception:
            continue
        main = data.get("main")
        if main:
            roots.append((p.parent, data))
    roots.sort(key=lambda x: len(x[0].relative_to(base).parts))
    return roots


def resolve_local(src_file: Path, spec: str, extracted_root: Path):
    if not spec.startswith("."):
        return None, True
    raw = (src_file.parent / spec).resolve()
    try:
        raw.relative_to(extracted_root.resolve())
    except ValueError:
        return raw, False
    candidates = [raw]
    if not raw.suffix:
        candidates += [Path(str(raw) + ext) for ext in (".js", ".cjs", ".mjs", ".json", ".node")]
        candidates += [raw / f"index{ext}" for ext in (".js", ".cjs", ".mjs", ".json", ".node")]
    return raw, any(c.exists() for c in candidates)


def audit_app(app_id: str, meta: dict, work: Path) -> dict:
    result = {
        "id": app_id,
        "name": meta.get("name"),
        "version": meta.get("version"),
        "downloadUrl": meta.get("downloadUrl"),
        "downloadOk": False,
        "zipOk": False,
        "packageRoots": [],
        "issues": [],
        "warnings": [],
        "suspiciousReferences": [],
    }
    url = str(meta.get("downloadUrl") or "")
    if not url.lower().endswith(".zip") and ".zip?" not in url.lower():
        result["warnings"].append("ZIP 패키지가 아니어서 정적 ZIP 검사를 건너뜀")
        return result

    zip_path = work / f"{app_id}.zip"
    extract = work / app_id
    try:
        download(url, zip_path)
        result["downloadOk"] = True
    except Exception as e:
        result["issues"].append(f"다운로드 실패: {type(e).__name__}: {e}")
        return result

    try:
        with zipfile.ZipFile(zip_path) as z:
            bad = z.testzip()
            if bad:
                result["issues"].append(f"ZIP CRC 오류: {bad}")
                return result
            z.extractall(extract)
        result["zipOk"] = True
    except Exception as e:
        result["issues"].append(f"ZIP 해제 실패: {type(e).__name__}: {e}")
        return result

    package_roots = find_package_roots(extract)
    if not package_roots:
        result["warnings"].append("main 진입점이 있는 package.json을 찾지 못함")
    for pkg_root, pkg in package_roots:
        rel_root = pkg_root.relative_to(extract).as_posix() or "."
        main = str(pkg.get("main") or "")
        result["packageRoots"].append({"root": rel_root, "main": main, "name": pkg.get("name"), "version": pkg.get("version")})
        main_path = (pkg_root / main).resolve()
        if not main_path.exists():
            result["issues"].append(f"package main 누락: {rel_root}/{main}")

    files = []
    for p in extract.rglob("*"):
        if not p.is_file() or p.suffix.lower() not in TEXT_EXTS:
            continue
        rel_parts = p.relative_to(extract).parts
        if any(part in SKIP_DIRS for part in rel_parts):
            continue
        try:
            if p.stat().st_size > 5_000_000:
                continue
            text = p.read_text(encoding="utf-8-sig", errors="ignore")
        except Exception:
            continue
        files.append((p, text))

    missing_seen = set()
    for p, text in files:
        rel = p.relative_to(extract).as_posix()
        for marker in SUSPICIOUS:
            if marker in text:
                result["suspiciousReferences"].append({"file": rel, "marker": marker})
        if p.suffix.lower() in {".js", ".cjs", ".mjs"}:
            for rx in REL_PATTERNS:
                for spec in rx.findall(text):
                    _, ok = resolve_local(p, spec, extract)
                    if not ok:
                        key = (rel, spec)
                        if key not in missing_seen:
                            missing_seen.add(key)
                            result["issues"].append(f"누락된 상대경로 모듈: {rel} -> {spec}")
        elif p.suffix.lower() in {".html", ".htm"}:
            for spec in SCRIPT_SRC.findall(text) + LINK_HREF.findall(text):
                if spec.startswith(("http://", "https://", "//", "data:", "#")):
                    continue
                if "?" in spec:
                    spec = spec.split("?", 1)[0]
                if not spec or spec.startswith("/"):
                    continue
                target = (p.parent / spec).resolve()
                try:
                    target.relative_to(extract.resolve())
                except ValueError:
                    ok = False
                else:
                    ok = target.exists()
                if not ok:
                    key = (rel, spec)
                    if key not in missing_seen:
                        missing_seen.add(key)
                        result["issues"].append(f"누락된 HTML 로컬 자원: {rel} -> {spec}")

    # 외부 shared 상대경로는 실제 파일이 존재해도 확장팩 독립성 위험으로 경고한다.
    for item in result["suspiciousReferences"]:
        if "shared" in item["marker"]:
            result["warnings"].append(f"기본 앱 시절 공용 경로 의심: {item['file']} ({item['marker']})")

    # 중복 제거
    result["warnings"] = list(dict.fromkeys(result["warnings"]))
    result["suspiciousReferences"] = [dict(t) for t in {tuple(sorted(x.items())) for x in result["suspiciousReferences"]}]
    return result


def main():
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    apps = catalog.get("apps", {})
    results = []
    with tempfile.TemporaryDirectory(prefix="sd-ext-audit-") as td:
        work = Path(td)
        for app_id, meta in apps.items():
            print(f"Auditing {app_id} {meta.get('version')}...")
            results.append(audit_app(app_id, meta, work))

    summary = {
        "catalogVersion": catalog.get("catalogVersion"),
        "appCount": len(results),
        "appsWithIssues": [r["id"] for r in results if r["issues"]],
        "appsWithWarnings": [r["id"] for r in results if r["warnings"]],
        "results": results,
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    lines = [
        "# 확장팩 전환 패키지 점검",
        "",
        f"- 카탈로그 버전: {summary['catalogVersion']}",
        f"- 검사 앱: {summary['appCount']}개",
        f"- 오류 발견: {len(summary['appsWithIssues'])}개",
        f"- 경고 발견: {len(summary['appsWithWarnings'])}개",
        "",
    ]
    for r in results:
        status = "FAIL" if r["issues"] else ("WARN" if r["warnings"] else "PASS")
        lines += [f"## {r['name']} ({r['id']}) v{r['version']} — {status}"]
        if r["issues"]:
            lines += [f"- 오류: {x}" for x in r["issues"]]
        if r["warnings"]:
            lines += [f"- 경고: {x}" for x in r["warnings"]]
        if not r["issues"] and not r["warnings"]:
            lines.append("- 패키지 내부 상대경로/진입점 검사 이상 없음")
        lines.append("")
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")

    print(json.dumps({"appsWithIssues": summary["appsWithIssues"], "appsWithWarnings": summary["appsWithWarnings"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
