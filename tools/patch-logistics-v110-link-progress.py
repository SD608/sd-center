from __future__ import annotations

import json
import re
import shutil
import tempfile
import zipfile
from pathlib import Path

ROOT = Path.cwd()
SOURCE = ROOT / "downloads/extensions/SDLogisticsCenter_Season0_Desktop.zip"
OUTPUT = ROOT / "downloads/extensions/SDLogisticsCenter_v1.1.0_Desktop.zip"
CATALOG = ROOT / "update/extensions-catalog.json"
POLICY = ROOT / "update/desktop-policy.json"
EXT_DATA = [ROOT / "extensions-data.js", ROOT / "assets/js/extensions-data.js"]
VERSION = "1.1.0"
VERSION_TAG = "110"
MARKER = "SD_LOGISTICS_PROGRESS_BRIDGE_V110"


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def find_package_root(root: Path) -> Path:
    for package in root.rglob("package.json"):
        if "node_modules" in {p.lower() for p in package.parts}:
            continue
        try:
            data = json.loads(package.read_text(encoding="utf-8"))
        except Exception:
            continue
        if data.get("name") == "sd-logistics-center-desktop":
            return package.parent
    raise RuntimeError("SD logistics package root not found")


def patch_main(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    anchor = 'app.setName("SDLogisticsCenter");\nlet mainWindow=null,configStore=null;\n'
    replacement = '''app.setName("SDLogisticsCenter");
let mainWindow=null,configStore=null;

// SD_LOGISTICS_PROGRESS_BRIDGE_V110
// 렌더러의 물류 진행도를 Electron userData에 비밀정보 없는 JSON으로 내보냅니다.
// SD Link가 이 파일을 읽어 같은 홈페이지 계정의 sd_logistics_progress로 동기화합니다.
function progressBridgeFile(){
  return path.join(app.getPath("userData"),"sd-logistics-progress.json");
}
function safeNonNegative(value){
  const n=Number(value);return Number.isFinite(n)?Math.max(0,n):0;
}
function publishProgressBridge(payload={}){
  const raw=payload&&typeof payload==="object"&&!Array.isArray(payload)?payload:{};
  let wallet=null;
  try{
    const current=currentState();
    if(current?.selected){
      wallet={
        databasePath:String(current.path||""),
        selectedAccountId:String(current.selected.id||""),
      };
    }
  }catch{}
  const vehicleTypes=Array.isArray(raw.vehicleTypes)
    ? [...new Set(raw.vehicleTypes.map((v)=>String(v||"").trim()).filter(Boolean))].slice(0,16)
    : [];
  const snapshot={
    schemaVersion:1,
    sourceApp:"sd-logistics-center-desktop",
    sourceVersion:String(packageJson.version||"1.1.0"),
    logisticsRep:safeNonNegative(raw.logisticsRep),
    headquartersLevel:Math.trunc(safeNonNegative(raw.headquartersLevel)),
    completedContracts:Math.trunc(safeNonNegative(raw.completedContracts)),
    logisticsRevenue:safeNonNegative(raw.logisticsRevenue),
    xlargeCompleted:Math.trunc(safeNonNegative(raw.xlargeCompleted)),
    warehouseOwned:Boolean(raw.warehouseOwned),
    fleetCount:Math.trunc(safeNonNegative(raw.fleetCount)),
    vehicleTypes,
    wallet,
    updatedAt:new Date().toISOString(),
  };
  const file=progressBridgeFile();
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=`${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp,JSON.stringify(snapshot,null,2)+"\\n",{encoding:"utf8",mode:0o600});
  fs.renameSync(temp,file);
  return snapshot;
}
'''
    if MARKER not in text:
        if anchor not in text:
            raise RuntimeError("main.js bridge anchor missing")
        text = text.replace(anchor, replacement, 1)

    ipc_anchor = 'ipcMain.handle("sdlogistics:wallet-state",()=>currentState());\n'
    ipc_replacement = ipc_anchor + '  ipcMain.handle("sdlogistics:publish-progress",(_e,payload)=>publishProgressBridge(payload));\n'
    if 'sdlogistics:publish-progress' not in text:
        if ipc_anchor not in text:
            raise RuntimeError("main.js IPC anchor missing")
        text = text.replace(ipc_anchor, ipc_replacement, 1)
    path.write_text(text, encoding="utf-8")


def patch_preload(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    if "publishProgress" in text:
        return
    old = '  transact:(amount,memo)=>ipcRenderer.invoke("sdlogistics:wallet-transaction",amount,memo)\n});'
    new = '  transact:(amount,memo)=>ipcRenderer.invoke("sdlogistics:wallet-transaction",amount,memo),\n  publishProgress:(payload)=>ipcRenderer.invoke("sdlogistics:publish-progress",payload)\n});'
    if old not in text:
        raise RuntimeError("preload.js bridge anchor missing")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def patch_renderer(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    old_save = '''  function save(){
    const copy=structuredClone(state);delete copy.balance;delete copy.ledger;
    localStorage.setItem(KEY,JSON.stringify(copy));
  }
'''
    new_save = '''  function progressBridgePayload(){
    return {
      logisticsRep:Math.max(0,Number(state.logisticsRep)||0),
      headquartersLevel:Math.max(0,Math.trunc(Number(state.headquartersLevel)||0)),
      completedContracts:Math.max(0,Math.trunc(Number(state.completedContracts)||0)),
      logisticsRevenue:Math.max(0,Number(state.logisticsRevenue)||0),
      xlargeCompleted:Math.max(0,Math.trunc(Number(state.xlargeCompleted)||0)),
      warehouseOwned:!!state.warehouseOwned,
      fleetCount:Array.isArray(state.fleet)?state.fleet.length:0,
      vehicleTypes:Array.isArray(state.fleet)?[...new Set(state.fleet.map(v=>String(v?.type||"")).filter(Boolean))]:[],
    };
  }
  async function publishProgress(){
    try{
      if(!window.sdLogistics?.publishProgress)return null;
      return await window.sdLogistics.publishProgress(progressBridgePayload());
    }catch(error){
      console.warn("SD Link 물류 진행도 브리지 저장 실패",error?.message||error);
      return null;
    }
  }
  function save(){
    const copy=structuredClone(state);delete copy.balance;delete copy.ledger;
    localStorage.setItem(KEY,JSON.stringify(copy));
    void publishProgress();
  }
'''
    if "function progressBridgePayload()" not in text:
        if old_save not in text:
            raise RuntimeError("public/app.js save anchor missing")
        text = text.replace(old_save, new_save, 1)

    old_init = '  void initializeDesktop();\n})();'
    new_init = '  void initializeDesktop().then(()=>publishProgress()).catch(()=>{});\n})();'
    if old_init in text:
        text = text.replace(old_init, new_init, 1)
    elif "initializeDesktop().then(()=>publishProgress())" not in text:
        raise RuntimeError("public/app.js initialize anchor missing")
    path.write_text(text, encoding="utf-8")


def patch_versions(root: Path) -> None:
    package = root / "package.json"
    data = json.loads(package.read_text(encoding="utf-8"))
    data["version"] = VERSION
    data["description"] = "SD Link 계정 물류 진행도 브리지와 기존 SD지갑 연동을 지원하는 물류 경영 확장팩"
    write_json(package, data)

    sd_app = root / "sd-app.json"
    if sd_app.is_file():
        obj = json.loads(sd_app.read_text(encoding="utf-8"))
        obj["version"] = VERSION
        obj["displayVersion"] = f"Season 0 · v{VERSION}"
        obj["improvement"] = "PC 물류 평판·본부레벨을 SD Link가 홈페이지 계정으로 동기화할 수 있도록 공용 진행도 브리지를 추가했습니다."
        write_json(sd_app, obj)

    index = root / "public" / "index.html"
    if index.is_file():
        text = index.read_text(encoding="utf-8")
        text = re.sub(r'(SD Logistics Center[^<]*?v)\d+\.\d+\.\d+', rf'\g<1>{VERSION}', text)
        index.write_text(text, encoding="utf-8")

    readme = root / "README.md"
    if readme.is_file():
        text = readme.read_text(encoding="utf-8")
        text += f"\n\n## v{VERSION} · SD Link 물류 진행도 브리지\n- 기존 PC 물류 진행도를 유지한 채 평판·본부레벨·배송 통계를 공용 JSON으로 내보냅니다.\n- SD Link v1.3.0 이상이 이 기록을 홈페이지 계정의 물류 진행도로 동기화합니다.\n"
        readme.write_text(text, encoding="utf-8")


def patch_extension_data(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    pattern = re.compile(r'(\{\n\s+"id": "sd-logistics-center",.*?\n\s+\})', re.S)
    match = pattern.search(text)
    if not match:
        raise RuntimeError(f"logistics extension block missing: {path}")
    block = match.group(1)
    block = re.sub(r'"version": "v[^"]+"', f'"version": "v{VERSION}"', block, count=1)
    block = re.sub(r'"fileName": "[^"]+"', '"fileName": "SDLogisticsCenter_v1.1.0_Desktop.zip"', block, count=1)
    block = re.sub(r'"downloadUrl": "[^"]+"', '"downloadUrl": "downloads/extensions/SDLogisticsCenter_v1.1.0_Desktop.zip?v=110"', block, count=1)
    block = re.sub(r'"updatedAt": "[^"]+"', '"updatedAt": "2026-08-18"', block, count=1)
    text = text[:match.start()] + block + text[match.end():]
    path.write_text(text, encoding="utf-8")


def patch_catalog() -> None:
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    data["catalogVersion"] = int(data.get("catalogVersion", 0)) + 1
    data["updatedAt"] = "2026-08-18T07:25:00+09:00"
    app = data["apps"]["sd-logistics-center-desktop"]
    app["version"] = VERSION
    app["downloadUrl"] = f"https://sd608.github.io/sd-center/downloads/extensions/SDLogisticsCenter_v{VERSION}_Desktop.zip?v={VERSION_TAG}"
    app["notes"] = "PC 물류 평판·본부레벨·배송 진행도를 SD Link가 읽을 수 있는 공용 브리지로 내보냅니다. 기존 물류 진행도와 SD지갑 데이터는 유지됩니다."
    write_json(CATALOG, data)


def patch_policy() -> None:
    data = json.loads(POLICY.read_text(encoding="utf-8"))
    data["policyVersion"] = int(data.get("policyVersion", 0)) + 1
    data["updatedAt"] = "2026-08-18T07:25:00+09:00"
    app = data["apps"]["sd-logistics-center-desktop"]
    app["required"] = True
    app["minVersion"] = VERSION
    app["downloadUrl"] = f"https://sd608.github.io/sd-center/downloads/extensions/SDLogisticsCenter_v{VERSION}_Desktop.zip?v={VERSION_TAG}"
    app["message"] = "PC 물류 진행도를 홈페이지 계정에 연동하기 위해 SD 물류센터 v1.1.0 이상이 필요합니다. 기존 진행도와 SD지갑 잔액은 유지됩니다."
    write_json(POLICY, data)


def build_zip(source_root: Path) -> None:
    if OUTPUT.exists():
        OUTPUT.unlink()
    with zipfile.ZipFile(OUTPUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(source_root.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(source_root).as_posix())


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"missing source: {SOURCE}")
    with tempfile.TemporaryDirectory() as tmp:
        extracted = Path(tmp) / "package"
        extracted.mkdir()
        with zipfile.ZipFile(SOURCE) as archive:
            archive.extractall(extracted)
        package_root = find_package_root(extracted)
        patch_main(package_root / "main.js")
        patch_preload(package_root / "preload.js")
        patch_renderer(package_root / "public" / "app.js")
        patch_versions(package_root)
        build_zip(extracted)

    patch_catalog()
    patch_policy()
    for path in EXT_DATA:
        patch_extension_data(path)

    print(f"built {OUTPUT} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
