from pathlib import Path
import json
import re
import shutil
import subprocess
import tempfile

ROOT = Path.cwd()
WEB_JS = ROOT / "assets/js/logistics-center.js"
WEB_HTML = ROOT / "logistics-center.html"
POLICY = ROOT / "update/desktop-policy.json"
ZIP_PATH = ROOT / "downloads/extensions/SDLogisticsCenter_Season0_Desktop.zip"
EXT_DATA = [ROOT / "extensions-data.js", ROOT / "assets/js/extensions-data.js"]
TARGET_VERSION = "1.0.9"
RESET_EPOCH = 109


def require_replace(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f"Patch target missing: {label}")
    return text.replace(old, new, 1)


def add_reset_constants(text: str) -> str:
    anchor = "  const FAST_DELIVERY_BONUS_MULTIPLIER = 1.10;\n"
    addition = (
        anchor
        + f"  const PROGRESSION_RESET_EPOCH = {RESET_EPOCH};\n"
        + '  const PROGRESSION_RESET_MARKER_KEY = "sd_logistics_progress_reset_epoch";\n'
    )
    if "const PROGRESSION_RESET_EPOCH" not in text:
        text = require_replace(text, anchor, addition, "reset constants")
    return text


def add_reset_epoch_to_base_state(text: str) -> str:
    old = "  const baseState = {\n    balance:0,\n"
    new = (
        "  const baseState = {\n"
        "    balance:0,\n"
        "    progressResetEpoch:PROGRESSION_RESET_EPOCH,\n"
    )
    if "progressResetEpoch:PROGRESSION_RESET_EPOCH" not in text:
        text = require_replace(text, old, new, "base state reset epoch")
    return text


def patch_web_js(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    text = add_reset_constants(text)
    text = add_reset_epoch_to_base_state(text)

    old = '''      // 서버 진행도가 있으면 우선 사용. 없으면 기존 브라우저 물류 확장팩 진행도를 마이그레이션.
      if(progressResult.data?.state && typeof progressResult.data.state==="object"){
        const serverProgress=progressResult.data.state;
        const migratedLocal=state;
        state={...migratedLocal,...serverProgress};
      }

      state.balance=Number(onlineWallet.balance||0);
      serverReady=true;
      save();'''
    new = f'''      // v1.0.9 업데이트 후 계정별로 딱 한 번만 물류 진행도를 초기화합니다.
      // SD지갑 잔액/거래내역은 건드리지 않고 sd_logistics_progress만 새 기본 상태로 교체합니다.
      const serverProgress=(progressResult.data?.state && typeof progressResult.data.state==="object")
        ? progressResult.data.state
        : null;
      const serverResetEpoch=Number(serverProgress?.progressResetEpoch)||0;
      let updateResetApplied=false;

      if(serverResetEpoch<PROGRESSION_RESET_EPOCH){{
        state=structuredClone(baseState);
        state.balance=Number(onlineWallet.balance||0);
        state.progressResetEpoch=PROGRESSION_RESET_EPOCH;
        localStorage.removeItem(KEY);
        generateContracts();

        const {{error:resetError}}=await onlineAuth.client
          .from("sd_logistics_progress")
          .upsert({{
            user_id:onlineSession.user.id,
            state:progressPayload(),
            updated_at:new Date().toISOString()
          }},{{onConflict:"user_id"}});
        if(resetError)throw resetError;
        updateResetApplied=true;
      }}else if(serverProgress){{
        const migratedLocal=state;
        state={{...migratedLocal,...serverProgress}};
      }}

      state.balance=Number(onlineWallet.balance||0);
      state.progressResetEpoch=PROGRESSION_RESET_EPOCH;
      serverReady=true;
      save();'''
    text = require_replace(text, old, new, "web server one-time reset")

    old_status = '      setOnlineStatus("공용 SD지갑과 동기화됨","success");'
    new_status = (
        '      setOnlineStatus("공용 SD지갑과 동기화됨","success");\n'
        '      if(updateResetApplied)toast("v1.0.9 업데이트 · 물류 진행도가 1회 초기화되었습니다. SD지갑은 유지됩니다.");'
    )
    text = require_replace(text, old_status, new_status, "web reset toast")

    path.write_text(text, encoding="utf-8")


def patch_desktop_js(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    text = add_reset_constants(text)
    text = add_reset_epoch_to_base_state(text)

    anchor = "  let state = load();\n"
    insertion = '''  let state = load();

  // v1.0.9 설치 후 이 PC에서는 물류 진행도만 딱 한 번 초기화합니다.
  // 실제 SD지갑 DB/잔액은 수정하지 않습니다.
  const updateResetApplied=(()=>{
    try{
      if(localStorage.getItem(PROGRESSION_RESET_MARKER_KEY)===String(PROGRESSION_RESET_EPOCH))return false;
      const walletBalance=Number(state?.balance)||0;
      localStorage.removeItem(KEY);
      state=structuredClone(baseState);
      state.balance=walletBalance;
      state.progressResetEpoch=PROGRESSION_RESET_EPOCH;
      localStorage.setItem(PROGRESSION_RESET_MARKER_KEY,String(PROGRESSION_RESET_EPOCH));
      localStorage.setItem(KEY,JSON.stringify(state));
      return true;
    }catch(_){
      return false;
    }
  })();
'''
    if "const updateResetApplied=(()=>{" not in text:
        text = require_replace(text, anchor, insertion, "desktop one-time local reset")

    path.write_text(text, encoding="utf-8")


def patch_metadata() -> None:
    for path in EXT_DATA:
        text = path.read_text(encoding="utf-8")
        start = text.find('    id: "sd-logistics-center",')
        if start < 0:
            raise RuntimeError(f"Logistics metadata missing: {path}")
        end = text.find("\n  },", start)
        if end < 0:
            raise RuntimeError(f"Logistics metadata end missing: {path}")
        block = text[start:end]
        block = re.sub(r'version: "[^"]+"', 'version: "v1.0.9"', block, count=1)
        block = re.sub(
            r'downloadUrl: "[^"]+"',
            'downloadUrl: "downloads/extensions/SDLogisticsCenter_Season0_Desktop.zip?v=109"',
            block,
            count=1,
        )
        block = re.sub(
            r'description: "[^"]+"',
            'description: "SD지갑과 연동되는 물류회사 경영 확장팩입니다. v1.0.9 업데이트 후 물류 등급·실적·차량·기사·본부·계약 진행도를 계정/PC 기준으로 1회 초기화하며 SD지갑 잔액과 거래내역은 유지합니다. v1.0.8의 랭크 및 차량 해금 밸런스도 유지됩니다."',
            block,
            count=1,
        )
        block = re.sub(
            r'tags: \[[^\]]*\]',
            'tags: ["SD지갑 유지", "1회 진행도 초기화", "랭크/차량 해금"]',
            block,
            count=1,
        )
        path.write_text(text[:start] + block + text[end:], encoding="utf-8")


def patch_policy() -> None:
    policy = json.loads(POLICY.read_text(encoding="utf-8"))
    policy["policyVersion"] = max(5, int(policy.get("policyVersion", 0)) + 1)
    policy["updatedAt"] = "2026-08-14T19:59:00+09:00"
    app = policy["apps"]["sd-logistics-center-desktop"]
    app["required"] = True
    app["minVersion"] = TARGET_VERSION
    app["message"] = "물류회사 v1.0.9 1회 진행도 초기화/랭크 밸런스 패치가 필수입니다. SD지갑 잔액은 유지됩니다."
    POLICY.write_text(json.dumps(policy, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def patch_web_html() -> None:
    text = WEB_HTML.read_text(encoding="utf-8")
    text = re.sub(r'assets/js/logistics-center\.js\?v=\d+', 'assets/js/logistics-center.js?v=109', text)
    WEB_HTML.write_text(text, encoding="utf-8")


def patch_desktop_zip() -> None:
    temp = Path(tempfile.mkdtemp(prefix="logistics-v109-reset-"))
    try:
        extract = temp / "extract"
        extract.mkdir()
        subprocess.run(["unzip", "-q", str(ZIP_PATH), "-d", str(extract)], check=True)

        targets = []
        for p in extract.rglob("*.js"):
            try:
                body = p.read_text(encoding="utf-8")
            except Exception:
                continue
            if "const FAST_DELIVERY_BONUS_MULTIPLIER" in body and "let state = load();" in body and "const baseState" in body:
                patch_desktop_js(p)
                targets.append(p)
        if not targets:
            raise RuntimeError("Desktop logistics JS target not found")

        version_files = []
        for p in list(extract.rglob("package.json")) + list(extract.rglob("sd-app.json")):
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not isinstance(data, dict) or "version" not in data:
                continue
            old = str(data.get("version", ""))
            blob = json.dumps(data, ensure_ascii=False).lower()
            if old.startswith("1.0.") and ("logistics" in blob or "물류" in blob or p.name == "sd-app.json"):
                data["version"] = TARGET_VERSION
                p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                version_files.append(p)

        if not any(p.name == "package.json" for p in version_files):
            candidates = sorted(extract.rglob("package.json"), key=lambda p: len(p.parts))
            for p in candidates:
                try:
                    data = json.loads(p.read_text(encoding="utf-8"))
                except Exception:
                    continue
                if isinstance(data, dict) and str(data.get("version", "")).startswith("1.0."):
                    data["version"] = TARGET_VERSION
                    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                    version_files.append(p)
                    break

        rebuilt = temp / ZIP_PATH.name
        subprocess.run(["zip", "-qr", str(rebuilt), "."], cwd=extract, check=True)
        shutil.copy2(rebuilt, ZIP_PATH)
        print("Desktop patched:", ", ".join(str(p.relative_to(extract)) for p in targets))
        print("Versions:", ", ".join(str(p.relative_to(extract)) for p in version_files))
    finally:
        shutil.rmtree(temp, ignore_errors=True)


if __name__ == "__main__":
    patch_web_js(WEB_JS)
    patch_web_html()
    patch_metadata()
    patch_policy()
    patch_desktop_zip()
    print("Prepared logistics v1.0.9 one-time progression reset")
