from pathlib import Path
import json
import shutil
import subprocess
import tempfile

ROOT = Path.cwd()
WEB_JS = ROOT / "assets/js/logistics-center.js"
WEB_HTML = ROOT / "logistics-center.html"
POLICY = ROOT / "update/desktop-policy.json"
ZIP_PATH = ROOT / "downloads/extensions/SDLogisticsCenter_Season0_Desktop.zip"

CONST_ANCHOR = "  const FAST_DELIVERY_BONUS_MULTIPLIER = 1.10;\n"
REP_CONST = "  const REP_GAIN_MULTIPLIER = 0.50;\n"
OLD_REP_LINE = "      state.logisticsRep+=(c.rep||0);"
NEW_REP_LINES = "      const repGain=Math.max(1,Math.round((c.rep||0)*REP_GAIN_MULTIPLIER));\n      state.logisticsRep+=repGain;"


def patch_js(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    changed = False

    if "REP_GAIN_MULTIPLIER" not in text:
        if CONST_ANCHOR not in text:
            return False
        text = text.replace(CONST_ANCHOR, CONST_ANCHOR + REP_CONST, 1)
        changed = True

    if OLD_REP_LINE in text:
        text = text.replace(OLD_REP_LINE, NEW_REP_LINES, 1)
        changed = True
    elif "state.logisticsRep+=repGain;" not in text:
        return False

    if changed:
        path.write_text(text, encoding="utf-8")
    return True


# 1) Website balance patch.
if not patch_js(WEB_JS):
    raise SystemExit("Website logistics JS patch target not found")

html = WEB_HTML.read_text(encoding="utf-8")
html = html.replace("assets/js/logistics-center.js?v=106", "assets/js/logistics-center.js?v=108")
html = html.replace("assets/js/logistics-center.js?v=107", "assets/js/logistics-center.js?v=108")
WEB_HTML.write_text(html, encoding="utf-8")

# 2) Required desktop version -> 1.0.8.
policy = json.loads(POLICY.read_text(encoding="utf-8"))
policy["policyVersion"] = max(4, int(policy.get("policyVersion", 0)) + 1)
policy["updatedAt"] = "2026-08-14T19:36:00+09:00"
logistics = policy["apps"]["sd-logistics-center-desktop"]
logistics["required"] = True
logistics["minVersion"] = "1.0.8"
logistics["message"] = "물류회사 수익/경험치 밸런스 패치 v1.0.8 이상이 필수입니다."
POLICY.write_text(json.dumps(policy, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# 3) Patch desktop ZIP in-place.
tmp = Path(tempfile.mkdtemp(prefix="sd-logistics-v108-"))
extract_dir = tmp / "extract"
extract_dir.mkdir()
subprocess.run(["unzip", "-q", str(ZIP_PATH), "-d", str(extract_dir)], check=True)

patched_js = []
for p in extract_dir.rglob("*.js"):
    try:
        text = p.read_text(encoding="utf-8")
    except Exception:
        continue
    if "state.logisticsRep+=(c.rep||0);" in text or ("FAST_DELIVERY_BONUS_MULTIPLIER" in text and "logisticsRep" in text):
        if patch_js(p):
            patched_js.append(p)

if not patched_js:
    raise SystemExit("Desktop ZIP logistics progression JS target not found")

version_files = []
for name in ("package.json", "sd-app.json"):
    for p in extract_dir.rglob(name):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(data, dict) and "version" in data:
            old = str(data.get("version", ""))
            # Only bump the app package itself; dependency package.json files normally have unrelated versions.
            text_blob = json.dumps(data, ensure_ascii=False).lower()
            if old.startswith("1.0.") and ("logistics" in text_blob or "물류" in text_blob or name == "sd-app.json"):
                data["version"] = "1.0.8"
                p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                version_files.append(p)

# If the main package.json did not contain a recognizable logistics marker, detect the shallowest one.
if not any(p.name == "package.json" for p in version_files):
    candidates = sorted(extract_dir.rglob("package.json"), key=lambda p: len(p.parts))
    for p in candidates:
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(data, dict) and str(data.get("version", "")).startswith("1.0."):
            data["version"] = "1.0.8"
            p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            version_files.append(p)
            break

for readme in extract_dir.rglob("README*"):
    if not readme.is_file():
        continue
    try:
        body = readme.read_text(encoding="utf-8")
    except Exception:
        continue
    note = "\n## v1.0.8 경험치 밸런스\n\n- 직접 배송 계약 완료 경험치 획득량 50% 적용 (등급업 속도 약 2배 완화)\n- 기존 누적 경험치와 현재 진행 데이터는 유지\n- v1.0.7 수익/배송시간 너프 유지\n"
    if "v1.0.8 경험치 밸런스" not in body:
        readme.write_text(body.rstrip() + "\n" + note, encoding="utf-8")
    break

rebuilt = tmp / "SDLogisticsCenter_Season0_Desktop.zip"
subprocess.run(["zip", "-qr", str(rebuilt), "."], cwd=extract_dir, check=True)
shutil.copy2(rebuilt, ZIP_PATH)

print("Patched desktop JS:")
for p in patched_js:
    print(" -", p.relative_to(extract_dir))
print("Version files:")
for p in version_files:
    print(" -", p.relative_to(extract_dir))
print("Prepared logistics v1.0.8 progression patch")
