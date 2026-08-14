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
TARGET_VERSION = "1.0.8"

OLD_VEHICLES = '''  const vehicleTypes = [
    {key:"small",  label:"소형",   name:"소형 밴",         cost:250000,  order:0, stack:1,  speed:1.00, desc:"적재 1스택 · 가장 빠름"},
    {key:"medium", label:"중형",   name:"중형 트럭",       cost:700000,  order:1, stack:3,  speed:0.86, desc:"적재 3스택 · 빠름"},
    {key:"large",  label:"대형",   name:"대형 카고",       cost:1500000, order:2, stack:6,  speed:0.72, desc:"적재 6스택 · 보통"},
    {key:"xlarge", label:"초대형", name:"초대형 트레일러", cost:3000000, order:3, stack:12, speed:0.58, desc:"적재 12스택 · 가장 느림"},
  ];'''
NEW_VEHICLES = '''  const vehicleTypes = [
    {key:"small",  label:"소형",   name:"소형 밴",         cost:250000,  order:0, stack:1,  speed:1.00, minRank:"F", desc:"적재 1스택 · 가장 빠름"},
    {key:"medium", label:"중형",   name:"중형 트럭",       cost:700000,  order:1, stack:3,  speed:0.86, minRank:"E", desc:"적재 3스택 · 빠름"},
    {key:"large",  label:"대형",   name:"대형 카고",       cost:1500000, order:2, stack:6,  speed:0.72, minRank:"C", desc:"적재 6스택 · 보통"},
    {key:"xlarge", label:"초대형", name:"초대형 트레일러", cost:3000000, order:3, stack:12, speed:0.58, minRank:"A", desc:"적재 12스택 · 가장 느림"},
  ];'''

OLD_RANKS = '''  const ranks = [
    {rank:"F", min:0, next:100},
    {rank:"E", min:100, next:260},
    {rank:"D", min:260, next:520},
    {rank:"C", min:520, next:900},
    {rank:"B", min:900, next:1450},
    {rank:"A", min:1450, next:2200},
    {rank:"S", min:2200, next:null},
  ];'''
NEW_RANKS = '''  const ranks = [
    {rank:"F", min:0, next:300},
    {rank:"E", min:300, next:800},
    {rank:"D", min:800, next:1600},
    {rank:"C", min:1600, next:2800},
    {rank:"B", min:2800, next:4500},
    {rank:"A", min:4500, next:7000},
    {rank:"S", min:7000, next:null},
  ];'''

VEHICLE_DEF_ANCHOR = '''  function vehicleDef(type){
    return vehicleTypes.find(v=>v.key===type) || vehicleTypes[0];
  }
'''
VEHICLE_DEF_REPLACEMENT = '''  function vehicleDef(type){
    return vehicleTypes.find(v=>v.key===type) || vehicleTypes[0];
  }
  function vehicleRankUnlocked(typeOrDef){
    const def=typeof typeOrDef==="string" ? vehicleDef(typeOrDef) : typeOrDef;
    const currentRank=rankFromRep(state.logisticsRep).rank;
    return rankIndex(currentRank)>=rankIndex(def?.minRank||"F");
  }
'''

BUY_WEB_OLD = '''  async function buyVehicle(type){
    const def=vehicleDef(type);
    const limit=fleetLimit();'''
BUY_WEB_NEW = '''  async function buyVehicle(type){
    const def=vehicleDef(type);
    if(!vehicleRankUnlocked(def)){toast(`${def.label} 차량은 회사 ${def.minRank}등급부터 구매할 수 있습니다.`);return;}
    const limit=fleetLimit();'''
BUY_DESKTOP_OLD = '''  async function buyVehicle(type){
    const def=vehicleDef(type),limit=fleetLimit();'''
BUY_DESKTOP_NEW = '''  async function buyVehicle(type){
    const def=vehicleDef(type);
    if(!vehicleRankUnlocked(def)){toast(`${def.label} 차량은 회사 ${def.minRank}등급부터 구매할 수 있습니다.`);return;}
    const limit=fleetLimit();'''

STARTER_INFO_OLD = '''  function starterUpgradeInfo(vehicle){
    if(!vehicle.starter)return null;
    const current=vehicleDef(vehicle.type);
    const next=vehicleTypes[current.order+1];
    if(!next)return null;
    const cost=Math.max(0,next.cost-current.cost);
    return {current,next,cost};
  }'''
STARTER_INFO_NEW = '''  function starterUpgradeInfo(vehicle){
    if(!vehicle.starter)return null;
    const current=vehicleDef(vehicle.type);
    const next=vehicleTypes[current.order+1];
    if(!next)return null;
    const cost=Math.max(0,next.cost-current.cost);
    return {current,next,cost,unlocked:vehicleRankUnlocked(next)};
  }'''

UPGRADE_WEB_OLD = '''    const info=starterUpgradeInfo(vehicle);
    if(!info){toast("스타터 차량이 이미 초대형입니다.");return;}
    if(state.balance<info.cost){toast("업그레이드 비용이 부족합니다.");return;}'''
UPGRADE_WEB_NEW = '''    const info=starterUpgradeInfo(vehicle);
    if(!info){toast("스타터 차량이 이미 초대형입니다.");return;}
    if(!info.unlocked){toast(`스타터 ${info.next.label} 업그레이드는 회사 ${info.next.minRank}등급부터 가능합니다.`);return;}
    if(state.balance<info.cost){toast("업그레이드 비용이 부족합니다.");return;}'''
UPGRADE_DESKTOP_OLD = '''    const info=starterUpgradeInfo(vehicle);
    if(!info){toast("스타터 차량이 이미 초대형입니다.");return;}
    if(state.balance<info.cost){toast("SD지갑 업그레이드 비용이 부족합니다.");return;}'''
UPGRADE_DESKTOP_NEW = '''    const info=starterUpgradeInfo(vehicle);
    if(!info){toast("스타터 차량이 이미 초대형입니다.");return;}
    if(!info.unlocked){toast(`스타터 ${info.next.label} 업그레이드는 회사 ${info.next.minRank}등급부터 가능합니다.`);return;}
    if(state.balance<info.cost){toast("SD지갑 업그레이드 비용이 부족합니다.");return;}'''


def replace_required(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f"Patch target missing: {label}")
    return text.replace(old, new, 1)


def patch_shop_ui(text: str) -> str:
    if "const rankLocked=!vehicleRankUnlocked(def);" not in text:
        old = "        const disabled=full||state.balance<def.cost;\n        let label=`구매 · ${won(def.cost)}`;"
        new = "        const rankLocked=!vehicleRankUnlocked(def);\n        const disabled=full||state.balance<def.cost||rankLocked;\n        let label=`구매 · ${won(def.cost)}`;"
        if old not in text:
            raise RuntimeError("Patch target missing: vehicle shop disabled state")
        text = text.replace(old, new, 1)

    if "if(rankLocked)label=`회사 ${def.minRank}등급에서 해금`;" not in text:
        old = "        if(full)label=`차량 슬롯 가득 참 (${limit}대)`;\n        else if(state.balance<def.cost)label=`잔액 부족 · ${won(def.cost)}`;"
        new = "        if(rankLocked)label=`회사 ${def.minRank}등급에서 해금`;\n        else if(full)label=`차량 슬롯 가득 참 (${limit}대)`;\n        else if(state.balance<def.cost)label=`잔액 부족 · ${won(def.cost)}`;"
        if old not in text:
            raise RuntimeError("Patch target missing: vehicle shop label")
        text = text.replace(old, new, 1)

    if "${def.desc} · 구매 조건 ${def.minRank}등급" not in text:
        if "<small>${def.desc}</small>" not in text:
            raise RuntimeError("Patch target missing: vehicle shop rank description")
        text = text.replace("<small>${def.desc}</small>", "<small>${def.desc} · 구매 조건 ${def.minRank}등급</small>", 1)
    return text


def patch_starter_button_ui(text: str) -> str:
    old = '''            <button class="${busy||state.balance<upgrade.cost?"":"primary"}" data-upgrade-starter="${v.id}" ${busy||state.balance<upgrade.cost?"disabled":""}>
              ${busy ? "운송 중 · 업그레이드 불가" : `스타터 ${upgrade.next.label} 업그레이드 · ${won(upgrade.cost)}`}
            </button>'''
    new = '''            <button class="${busy||!upgrade.unlocked||state.balance<upgrade.cost?"":"primary"}" data-upgrade-starter="${v.id}" ${busy||!upgrade.unlocked||state.balance<upgrade.cost?"disabled":""}>
              ${!upgrade.unlocked ? `회사 ${upgrade.next.minRank}등급에서 ${upgrade.next.label} 해금` : busy ? "운송 중 · 업그레이드 불가" : `스타터 ${upgrade.next.label} 업그레이드 · ${won(upgrade.cost)}`}
            </button>'''
    if new in text:
        return text
    if old in text:
        return text.replace(old, new, 1)
    raise RuntimeError("Patch target missing: starter upgrade button")


def patch_js(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text

    text = replace_required(text, OLD_VEHICLES, NEW_VEHICLES, "vehicle rank requirements")
    text = replace_required(text, OLD_RANKS, NEW_RANKS, "company rank thresholds")
    text = replace_required(text, VEHICLE_DEF_ANCHOR, VEHICLE_DEF_REPLACEMENT, "vehicle rank helper")

    if "차량은 회사 ${def.minRank}등급부터 구매할 수 있습니다." not in text:
        if BUY_WEB_OLD in text:
            text = text.replace(BUY_WEB_OLD, BUY_WEB_NEW, 1)
        elif BUY_DESKTOP_OLD in text:
            text = text.replace(BUY_DESKTOP_OLD, BUY_DESKTOP_NEW, 1)
        else:
            raise RuntimeError("Patch target missing: vehicle purchase rank gate")

    text = replace_required(text, STARTER_INFO_OLD, STARTER_INFO_NEW, "starter upgrade rank data")

    if "스타터 ${info.next.label} 업그레이드는 회사 ${info.next.minRank}등급부터 가능합니다." not in text:
        if UPGRADE_WEB_OLD in text:
            text = text.replace(UPGRADE_WEB_OLD, UPGRADE_WEB_NEW, 1)
        elif UPGRADE_DESKTOP_OLD in text:
            text = text.replace(UPGRADE_DESKTOP_OLD, UPGRADE_DESKTOP_NEW, 1)
        else:
            raise RuntimeError("Patch target missing: starter upgrade rank gate")

    text = patch_shop_ui(text)
    text = patch_starter_button_ui(text)

    # 계약당 실적 지급량은 그대로 유지하고, 등급 요구 실적을 크게 올린다.
    text = text.replace("  const REP_GAIN_MULTIPLIER = 0.50;\n", "")
    text = text.replace(
        "      const repGain=Math.max(1,Math.round((c.rep||0)*REP_GAIN_MULTIPLIER));\n      state.logisticsRep+=repGain;",
        "      state.logisticsRep+=(c.rep||0);",
    )

    if text != original:
        path.write_text(text, encoding="utf-8")
    return all(marker in text for marker in [
        'minRank:"A"',
        'next:7000',
        'vehicleRankUnlocked',
        '회사 ${def.minRank}등급부터 구매할 수 있습니다.',
        '업그레이드는 회사 ${info.next.minRank}등급부터 가능합니다.',
    ])


# 1) Website progression patch.
if not patch_js(WEB_JS):
    raise SystemExit("Website logistics JS patch failed")

html = WEB_HTML.read_text(encoding="utf-8")
for old in ("assets/js/logistics-center.js?v=100", "assets/js/logistics-center.js?v=106", "assets/js/logistics-center.js?v=107"):
    html = html.replace(old, "assets/js/logistics-center.js?v=108")
WEB_HTML.write_text(html, encoding="utf-8")

# 2) Required desktop version -> 1.0.8.
policy = json.loads(POLICY.read_text(encoding="utf-8"))
policy["policyVersion"] = max(4, int(policy.get("policyVersion", 0)) + 1)
policy["updatedAt"] = "2026-08-14T19:40:00+09:00"
logistics = policy["apps"]["sd-logistics-center-desktop"]
logistics["required"] = True
logistics["minVersion"] = TARGET_VERSION
logistics["message"] = "물류회사 등급 실적/차량 랭크 해금 밸런스 패치 v1.0.8 이상이 필수입니다."
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
    if "const vehicleTypes" in text and "const ranks" in text and "async function buyVehicle" in text:
        if patch_js(p):
            patched_js.append(p)

if not patched_js:
    raise SystemExit("Desktop ZIP logistics JS target not found")

version_files = []
for name in ("package.json", "sd-app.json"):
    for p in extract_dir.rglob(name):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(data, dict) and "version" in data:
            old = str(data.get("version", ""))
            text_blob = json.dumps(data, ensure_ascii=False).lower()
            if old.startswith("1.0.") and ("logistics" in text_blob or "물류" in text_blob or name == "sd-app.json"):
                data["version"] = TARGET_VERSION
                p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                version_files.append(p)

if not any(p.name == "package.json" for p in version_files):
    candidates = sorted(extract_dir.rglob("package.json"), key=lambda p: len(p.parts))
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

for readme in extract_dir.rglob("README*"):
    if not readme.is_file():
        continue
    try:
        body = readme.read_text(encoding="utf-8")
    except Exception:
        continue
    note = (
        "\n## v1.0.8 성장 밸런스\n\n"
        "- 회사 등급 요구 실적 확대: E 300 / D 800 / C 1,600 / B 2,800 / A 4,500 / S 7,000\n"
        "- 차량 구매 랭크 해금: 소형 F / 중형 E / 대형 C / 초대형 A\n"
        "- 스타터 차량 업그레이드도 동일한 회사 랭크 조건 적용\n"
        "- 이미 보유한 차량과 기존 누적 실적은 삭제하지 않음\n"
        "- v1.0.7 수익/배송시간 너프 유지\n"
    )
    if "## v1.0.8 성장 밸런스" not in body:
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
print("Prepared logistics v1.0.8 rank + vehicle progression patch")
