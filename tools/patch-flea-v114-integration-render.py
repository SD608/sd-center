from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

ROOT = Path.cwd()
SOURCE = ROOT / "downloads/extensions/SDFleaMarket_v1.1.3_Desktop.zip"
OUTPUT = ROOT / "downloads/extensions/SDFleaMarket_v1.1.4_Desktop.zip"
CATALOG = ROOT / "update/extensions-catalog.json"
EXT_DATA = [ROOT / "extensions-data.js", ROOT / "assets/js/extensions-data.js"]
VERSION = "1.1.4"
VERSION_TAG = "114"
MARKER_INTEGRATION = "FLEA_LOGISTICS_HQ_UNLOCK_V114"
MARKER_RENDER = "FLEA_MISSION3D_BLACKSCREEN_V114"


def write_json(path: Path, obj: dict) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def replace_required(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f"Missing patch target: {label}")
    return text.replace(old, new, 1)


def patch_integration(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    text = text.replace('const S_RANK_REP = 2200;', 'const S_RANK_REP = 7000;')

    rank_pattern = re.compile(r'function rankFromRep\(value\) \{.*?\n\}', re.S)
    rank_replacement = '''function rankFromRep(value) {
  const rep = Math.max(0, Number(value || 0));
  if (rep >= 7000) return "S";
  if (rep >= 4500) return "A";
  if (rep >= 2800) return "B";
  if (rep >= 1600) return "C";
  if (rep >= 800) return "D";
  if (rep >= 300) return "E";
  return "F";
}'''
    text, count = rank_pattern.subn(rank_replacement, text, count=1)
    if count != 1:
        raise RuntimeError("rankFromRep patch failed")

    progress_pattern = re.compile(r'async function logisticsProgress\(currentUserData, safeStorage\) \{.*?\n\}\n\nclass SdIntegration', re.S)
    progress_replacement = f'''async function logisticsProgress(currentUserData, safeStorage) {{
  // {MARKER_INTEGRATION}
  // 현재 홈페이지 물류 등급표(F 0 / E 300 / D 800 / C 1600 / B 2800 / A 4500 / S 7000)를
  // 그대로 사용하고, S등급 도달 뒤 본부가 개설된 계정은 본부 Lv.1 이상만으로도
  // 플리마켓의 S등급 전용 지역을 계속 이용할 수 있게 합니다.
  let auth;
  try {{
    auth = await onlineSession(currentUserData, safeStorage);
  }} catch {{
    return {{ onlineLinked: false, rep: 0, grade: "F", logisticsGrade: "F", headquartersLevel: 0, eligibleForSContent: false, userId: "" }};
  }}
  if (!auth.onlineLinked || !auth.session) {{
    return {{ onlineLinked: false, rep: 0, grade: "F", logisticsGrade: "F", headquartersLevel: 0, eligibleForSContent: false, userId: auth.userId || "" }};
  }}

  const userId = auth.userId;
  let rep = 0;
  let headquartersLevel = 0;
  let snapshotResolved = false;
  let progressResolved = false;

  // 서버 스냅샷 RPC가 있으면 우선 사용합니다.
  try {{
    const snapshotResponse = await invokeAuthenticatedRpc(
      currentUserData,
      safeStorage,
      "get_sd_flea_company_snapshot",
      {{}}
    );
    const snapshot = Array.isArray(snapshotResponse) ? snapshotResponse[0] : snapshotResponse;
    const snapshotRep = Number(snapshot?.logistics_rep ?? snapshot?.logisticsRep ?? 0);
    const snapshotHq = Number(snapshot?.headquarters_level ?? snapshot?.headquartersLevel ?? 0);
    if (Number.isFinite(snapshotRep)) rep = Math.max(rep, Math.max(0, snapshotRep));
    if (Number.isFinite(snapshotHq)) headquartersLevel = Math.max(headquartersLevel, Math.max(0, Math.trunc(snapshotHq)));
    snapshotResolved = Boolean(snapshot && (Number.isFinite(snapshotRep) || Number.isFinite(snapshotHq)));
  }} catch {{
    // 아래 sd_logistics_progress 직접 조회가 최종 기준입니다.
  }}

  // 본부 레벨까지 반드시 읽기 위해 스냅샷 성공 여부와 관계없이 계정 진행도를 확인합니다.
  try {{
    const rows = await fetchJson(`${{SUPABASE_URL}}/rest/v1/sd_logistics_progress?select=state&user_id=eq.${{encodeURIComponent(userId)}}&limit=1`, {{
      headers: {{
        Accept: "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${{auth.session.accessToken}}`,
      }},
    }});
    const state = Array.isArray(rows) ? rows[0]?.state : null;
    if (state && typeof state === "object") {{
      const progressRep = Number(state.logisticsRep ?? state.logistics_rep ?? 0);
      const progressHq = Number(state.headquartersLevel ?? state.headquarters_level ?? 0);
      if (Number.isFinite(progressRep)) rep = Math.max(rep, Math.max(0, progressRep));
      if (Number.isFinite(progressHq)) headquartersLevel = Math.max(headquartersLevel, Math.max(0, Math.trunc(progressHq)));
      progressResolved = true;
    }}
  }} catch {{
    // 스냅샷도 실패했다면 아래 lookupFailed로 명확히 표시합니다.
  }}

  const logisticsGrade = rankFromRep(rep);
  const eligibleForSContent = rep >= S_RANK_REP || headquartersLevel >= 1;
  return {{
    onlineLinked: true,
    rep,
    // 기존 main.js의 requiredCompanyGrade="S" 비교 로직과 호환되도록
    // 본부가 개설된 계정은 유효 등급을 S로 반환합니다.
    grade: eligibleForSContent ? "S" : logisticsGrade,
    logisticsGrade,
    headquartersLevel,
    eligibleForSContent,
    userId,
    snapshotResolved,
    progressResolved,
    lookupFailed: !snapshotResolved && !progressResolved,
  }};
}}

class SdIntegration'''
    text, count = progress_pattern.subn(progress_replacement, text, count=1)
    if count != 1:
        raise RuntimeError("logisticsProgress patch failed")

    text = text.replace(
        'this.company = { onlineLinked: false, rep: 0, grade: "F", userId: "" };',
        'this.company = { onlineLinked: false, rep: 0, grade: "F", logisticsGrade: "F", headquartersLevel: 0, eligibleForSContent: false, userId: "" };',
    )
    if MARKER_INTEGRATION not in text:
        raise RuntimeError("integration marker missing")
    path.write_text(text, encoding="utf-8")


def patch_renderer(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    old_ctx = '    const ctx = canvas.getContext("2d", { alpha: false });\n'
    new_ctx = f'''    // {MARKER_RENDER}
    // 일부 Windows/Electron 환경에서 옵션이 붙은 Canvas2D 컨텍스트 생성이 실패할 수 있어
    // 기본 컨텍스트로 한 번 더 시도합니다. 둘 다 실패하면 검은 화면 대신 명확한 오류를 냅니다.
    const ctx = canvas.getContext("2d", {{ alpha: false, desynchronized: false }}) || canvas.getContext("2d");
    if (!ctx) {{
      container.classList.add("mission-3d-render-error");
      throw new Error("Mission3D Canvas2D context unavailable");
    }}
'''
    text = replace_required(text, old_ctx, new_ctx, "Canvas2D fallback")

    old_resize = '''    function resize() {
      const box = container.getBoundingClientRect();
      width = Math.max(320, Math.floor(box.width));
      height = Math.max(240, Math.floor(box.height));
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${box.width}px`;
      canvas.style.height = `${box.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
'''
    new_resize = '''    function resize() {
      const box = container.getBoundingClientRect();
      // display 전환 직후 0x0 rect가 잠깐 반환되어도 내부 버퍼와 CSS 크기를 0으로 만들지 않습니다.
      const cssWidth = Math.max(320, Math.floor(box.width || container.clientWidth || 960));
      const cssHeight = Math.max(240, Math.floor(box.height || container.clientHeight || 540));
      width = cssWidth;
      height = cssHeight;
      const dpr = Math.min(1.5, Math.max(1, window.devicePixelRatio || 1));
      const pixelWidth = Math.max(1, Math.floor(width * dpr));
      const pixelHeight = Math.max(1, Math.floor(height * dpr));
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
'''
    text = replace_required(text, old_resize, new_resize, "robust resize")

    old_render = '''    function render(now=performance.now()){
      if(!active)return;ctx.clearRect(0,0,width,height);drawBackground();drawWalls();drawProps();drawGuardVisionCones();drawNodes(now);drawSafe(now);drawStoreDoorLabel(now);drawBankDoorLabel(now);drawExitDoorLabel(now);drawExitWaypoint(now);drawGunModel(now);drawBrickThrowFx(now);drawHud();
      if(now<playerHitUntil){const t=clamp((playerHitUntil-now)/260,0,1);const g=ctx.createRadialGradient(width/2,height/2,Math.min(width,height)*.18,width/2,height/2,Math.max(width,height)*.7);g.addColorStop(0,"rgba(255,30,45,0)");g.addColorStop(1,`rgba(255,35,48,${.34*t})`);ctx.fillStyle=g;ctx.fillRect(0,0,width,height);}
    }
'''
    new_render = '''    let lastRenderErrorAt = 0;
    function safeLayer(name, draw) {
      try { draw(); return true; }
      catch (error) {
        const now = Date.now();
        if (now - lastRenderErrorAt > 1000) {
          lastRenderErrorAt = now;
          console.error(`[Mission3D] ${name} render failed`, error);
        }
        return false;
      }
    }

    function render(now=performance.now()){
      if(!active)return;
      ctx.clearRect(0,0,width,height);
      // 배경/벽은 최우선 기본 프레임입니다. 부가 오브젝트 하나가 오류를 내더라도
      // 나머지 레이어를 계속 그려 전체 화면이 검게 멈추지 않게 합니다.
      const backgroundOk=safeLayer("background",drawBackground);
      if(!backgroundOk){ctx.fillStyle="#18232d";ctx.fillRect(0,0,width,height);}
      safeLayer("walls",drawWalls);
      safeLayer("props",drawProps);
      safeLayer("guard-vision",drawGuardVisionCones);
      safeLayer("nodes",()=>drawNodes(now));
      safeLayer("safe",()=>drawSafe(now));
      safeLayer("store-door",()=>drawStoreDoorLabel(now));
      safeLayer("bank-door",()=>drawBankDoorLabel(now));
      safeLayer("exit-door",()=>drawExitDoorLabel(now));
      safeLayer("exit-waypoint",()=>drawExitWaypoint(now));
      safeLayer("gun",()=>drawGunModel(now));
      safeLayer("brick",()=>drawBrickThrowFx(now));
      safeLayer("hud",drawHud);
      if(now<playerHitUntil){safeLayer("player-hit",()=>{const t=clamp((playerHitUntil-now)/260,0,1);const g=ctx.createRadialGradient(width/2,height/2,Math.min(width,height)*.18,width/2,height/2,Math.max(width,height)*.7);g.addColorStop(0,"rgba(255,30,45,0)");g.addColorStop(1,`rgba(255,35,48,${.34*t})`);ctx.fillStyle=g;ctx.fillRect(0,0,width,height);});}
    }
'''
    text = replace_required(text, old_render, new_render, "safe render layers")
    if MARKER_RENDER not in text:
        raise RuntimeError("renderer marker missing")
    path.write_text(text, encoding="utf-8")


def patch_versions(root: Path) -> None:
    changed = 0
    for name in ("package.json", "sd-app.json"):
        for path in root.rglob(name):
            if "node_modules" in {p.lower() for p in path.parts}:
                continue
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                continue
            blob = json.dumps(data, ensure_ascii=False).lower()
            if "flea" not in blob and "플리" not in blob and name != "sd-app.json":
                continue
            if "version" in data:
                data["version"] = VERSION
            if name == "sd-app.json":
                data["displayVersion"] = f"PC Expansion · v{VERSION}"
                data["improvement"] = "물류 S등급/본부 Lv.1 해금 연동을 통합하고 은행 습격 3D Canvas2D 검은 화면 방어 렌더링을 추가했습니다."
            write_json(path, data)
            changed += 1
    if not changed:
        raise RuntimeError("No flea package version files patched")


def patch_zip() -> None:
    if not SOURCE.is_file():
        raise FileNotFoundError(SOURCE)
    with tempfile.TemporaryDirectory(prefix="flea-v114-") as td:
        root = Path(td)
        with zipfile.ZipFile(SOURCE) as z:
            z.extractall(root)

        integration = next(iter(sorted(root.rglob("src/sd-integration.js"), key=lambda p: len(p.parts))), None)
        mission3d = next(iter(sorted(root.rglob("public/mission3d.js"), key=lambda p: len(p.parts))), None)
        if not integration or not mission3d:
            raise RuntimeError("Flea integration or mission3d source missing")
        patch_integration(integration)
        patch_renderer(mission3d)
        patch_versions(root)

        if shutil.which("node"):
            subprocess.run(["node", "--check", str(integration)], check=True)
            subprocess.run(["node", "--check", str(mission3d)], check=True)

        if OUTPUT.exists():
            OUTPUT.unlink()
        with zipfile.ZipFile(OUTPUT, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            for item in sorted(root.rglob("*")):
                if item.is_file():
                    z.write(item, item.relative_to(root).as_posix())

    with zipfile.ZipFile(OUTPUT) as z:
        integ_name = next(n for n in z.namelist() if n.endswith("src/sd-integration.js"))
        render_name = next(n for n in z.namelist() if n.endswith("public/mission3d.js"))
        if MARKER_INTEGRATION not in z.read(integ_name).decode("utf-8"):
            raise RuntimeError("Output integration marker missing")
        if MARKER_RENDER not in z.read(render_name).decode("utf-8"):
            raise RuntimeError("Output render marker missing")


def patch_extension_data(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    start = text.find('"id": "sd-flea-market"')
    if start < 0:
        raise RuntimeError(f"Flea metadata missing: {path}")
    block_start = text.rfind("  {", 0, start)
    block_end = text.find("\n  }", start)
    if block_start < 0 or block_end < 0:
        raise RuntimeError(f"Flea block boundaries missing: {path}")
    block_end += len("\n  }")
    block = text[block_start:block_end]
    block = re.sub(r'"version": "v[^"]+"', f'"version": "v{VERSION}"', block, count=1)
    block = re.sub(r'"fileName": "[^"]+"', f'"fileName": "{OUTPUT.name}"', block, count=1)
    block = re.sub(r'"downloadUrl": "[^"]+"', f'"downloadUrl": "downloads/extensions/{OUTPUT.name}?v={VERSION_TAG}"', block, count=1)
    block = re.sub(r'"description": "[^"]+"', '"description": "물류 계정 연동을 현재 기준으로 통일해 회사 평판 7,000(S등급) 또는 물류 본부 Lv.1 이상이면 S등급 전용 지역을 이용할 수 있습니다. 은행 습격 3D 맵은 Canvas2D 컨텍스트·크기·레이어 오류를 방어해 검은 화면으로 멈추는 문제를 줄였습니다."', block, count=1)
    block = re.sub(r'"updatedAt": "[^"]+"', '"updatedAt": "2026-08-18"', block, count=1)
    block = re.sub(r'"tags": \[[^\]]*\]', '"tags": ["S등급·본부 연동", "은행 3D 안정화", "SD Link 계정"]', block, count=1)
    path.write_text(text[:block_start] + block + text[block_end:], encoding="utf-8")


def patch_catalog() -> None:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    catalog["catalogVersion"] = int(catalog.get("catalogVersion", 0)) + 1
    catalog["updatedAt"] = "2026-08-18T00:45:00+09:00"
    app = catalog["apps"]["sd-flea-market"]
    app["version"] = VERSION
    app["downloadUrl"] = f"https://sd608.github.io/sd-center/downloads/extensions/{OUTPUT.name}?v={VERSION_TAG}"
    app["notes"] = "물류 평판 7,000(S등급) 또는 물류 본부 Lv.1 이상이면 S등급 전용 지역을 해금하도록 SD Link 계정 연동을 통합했습니다. 은행 습격 3D Canvas2D는 컨텍스트·크기·레이어 오류가 전체 검은 화면으로 번지지 않도록 방어 렌더링을 적용했습니다."
    write_json(CATALOG, catalog)


def main() -> None:
    patch_zip()
    for path in EXT_DATA:
        patch_extension_data(path)
    patch_catalog()
    print(f"Prepared {OUTPUT.name} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
