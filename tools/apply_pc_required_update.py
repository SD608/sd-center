from pathlib import Path
import json
import shutil
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def extract_app(zip_path):
    work = Path(tempfile.mkdtemp(prefix="sdpatch-"))
    with zipfile.ZipFile(zip_path) as archive:
        archive.extractall(work)
    dirs = [path for path in work.iterdir() if path.is_dir()]
    app = dirs[0] if len(dirs) == 1 else work
    return work, app


def write_zip(source_root, zip_path):
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source_root.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(source_root))


# SD Link v1.2.3 -> v1.2.4
source = ROOT / "downloads/extensions/SDLink_v1.2.3_Desktop.zip"
work, app = extract_app(source)
package_path = app / "package.json"
package = json.loads(package_path.read_text(encoding="utf-8"))
package["version"] = "1.2.4"
package["description"] = "센터 버전 증명과 강제 업데이트 정책을 지원하는 PC ↔ SD608 Online 실시간 동기화 확장팩"
package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

sync_path = app / "src/sync-engine.js"
sync = sync_path.read_text(encoding="utf-8")
if "detectCenterVersion" not in sync:
    sync = sync.replace(
        'const path = require("node:path");',
        'const fs = require("node:fs");\nconst path = require("node:path");',
        1,
    )
    sync = sync.replace(
        "function unwrapJson(value) {",
        'function detectCenterVersion() {\n  const centerRoot = String(process.env.SD_CENTER_ROOT || "").trim();\n  if (!centerRoot) return "0.0.0";\n  try {\n    const parsed = JSON.parse(fs.readFileSync(path.join(centerRoot, "package.json"), "utf8"));\n    return String(parsed?.version || "0.0.0");\n  } catch {\n    return "0.0.0";\n  }\n}\n\nfunction unwrapJson(value) {',
        1,
    )
    sync = sync.replace(
        '  if (text.includes("STA")) return "sta_operation";',
        '  if (text.includes("STA")) return "sta_operation";\n  if (text.includes("물류") || text.includes("SD 기사")) return "sd_logistics";',
        1,
    )
    sync = sync.replace(
        '    this.onStatus = typeof onStatus === "function" ? onStatus : () => {};\n    this.running = false;',
        '    this.onStatus = typeof onStatus === "function" ? onStatus : () => {};\n    this.centerVersion = detectCenterVersion();\n    this.running = false;',
        1,
    )
sync = sync.replace(
    'sd_link_version: "1.2.3",',
    'sd_link_version: "1.2.4",\n            center_version: this.centerVersion,',
)
sync = sync.replace("v1.2.3:", "v1.2.4:")
sync_path.write_text(sync, encoding="utf-8")
(app / "v1.2.4_센터필수업데이트.txt").write_text(
    "SD Link v1.2.4\n- center_version 전송\n- 일반 회원 구 센터 거래 서버 차단 지원\n- 관리자 계정 서버 예외\n",
    encoding="utf-8",
)
write_zip(work, ROOT / "downloads/extensions/SDLink_v1.2.4_Desktop.zip")
shutil.rmtree(work)

# Current logistics -> v1.0.7; existing v1.0.6 economy nerf remains intact.
logistics_zip = ROOT / "downloads/extensions/SDLogisticsCenter_Season0_Desktop.zip"
work, app = extract_app(logistics_zip)
package_path = app / "package.json"
package = json.loads(package_path.read_text(encoding="utf-8"))
package["version"] = "1.0.7"
package["description"] = "경제 밸런스 너프와 센터 버전 증명을 지원하는 SD지갑 연동 물류 경영 확장팩"
package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

wallet_path = app / "src/wallet-db.js"
wallet = wallet_path.read_text(encoding="utf-8")
if 'APP_VERSION=String(require("../package.json")' not in wallet:
    wallet = wallet.replace(
        'const {DatabaseSync}=require("node:sqlite");',
        'const {DatabaseSync}=require("node:sqlite");\nconst APP_VERSION=String(require("../package.json").version||"0.0.0");\n\nfunction safeVersion(value){\n  const match=String(value||"0.0.0").match(/\\d+(?:\\.\\d+){2}/);\n  return match?match[0]:"0.0.0";\n}\nfunction centerVersion(){\n  const root=String(process.env.SD_CENTER_ROOT||"").trim();\n  if(!root)return "0.0.0";\n  try{return safeVersion(JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8")).version);}\n  catch{return "0.0.0";}\n}',
        1,
    )
wallet = wallet.replace(
    'const id=`sdlogistics-${crypto.randomUUID()}`;',
    'const id=`sdlogistics-c${centerVersion()}-v${safeVersion(APP_VERSION)}-${crypto.randomUUID()}`;',
)
wallet_path.write_text(wallet, encoding="utf-8")

index_path = app / "public/index.html"
index_path.write_text(
    index_path.read_text(encoding="utf-8").replace("Season 0 Desktop v1.0.6", "Season 0 Desktop v1.0.7"),
    encoding="utf-8",
)
readme_path = app / "README.md"
readme = readme_path.read_text(encoding="utf-8")
if "v1.0.7 필수 업데이트 증명" not in readme:
    readme += "\n\n## v1.0.7 필수 업데이트 증명\n- 거래 ID에 실행 중인 센터/물류 버전을 기록합니다.\n- 일반 회원은 센터 v2.1.2 + 물류 v1.0.7 이상만 서버 동기화됩니다.\n- 관리자 계정은 서버에서 예외 처리됩니다.\n"
readme_path.write_text(readme, encoding="utf-8")
write_zip(work, logistics_zip)
shutil.rmtree(work)

# Required policy
policy_path = ROOT / "update/desktop-policy.json"
policy = json.loads(policy_path.read_text(encoding="utf-8"))
policy["policyVersion"] = int(policy.get("policyVersion", 2)) + 1
policy["updatedAt"] = "2026-08-14T06:25:00+09:00"
apps = policy.setdefault("apps", {})
apps.setdefault("sd-bitcoin-miner-desktop", {})["required"] = False
apps["sdlink-desktop"] = {
    "required": True,
    "minVersion": "1.2.4",
    "downloadUrl": "https://sd608.github.io/sd-center/downloads/extensions/SDLink_v1.2.4_Desktop.zip",
    "message": "구 센터 우회 차단을 위해 SD Link v1.2.4 이상이 필수입니다.",
}
apps["sd-logistics-center-desktop"] = {
    "required": True,
    "minVersion": "1.0.7",
    "downloadUrl": "https://sd608.github.io/sd-center/downloads/extensions/SDLogisticsCenter_Season0_Desktop.zip",
    "message": "물류회사 경제 밸런스/버전 증명 패치 v1.0.7 이상이 필수입니다.",
}
policy_path.write_text(json.dumps(policy, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Website SD Link card
extension_path = ROOT / "assets/js/extensions-data.js"
extensions = extension_path.read_text(encoding="utf-8")
extensions = extensions.replace('version: "v1.2.3"', 'version: "v1.2.4"', 1)
extensions = extensions.replace('fileName: "SDLink_v1.2.3_Desktop.zip"', 'fileName: "SDLink_v1.2.4_Desktop.zip"', 1)
extensions = extensions.replace('downloadUrl: "downloads/extensions/SDLink_v1.2.3_Desktop.zip"', 'downloadUrl: "downloads/extensions/SDLink_v1.2.4_Desktop.zip"', 1)
extensions = extensions.replace(
    "응답없음 안정화 패치. 자동 동기화와 UI 조회 부하를 줄이고 SQLite 잠금 대기를 단축해 STA·SD광부·물류센터 등이 동시에 지갑을 사용할 때 SD Link 창이 멎는 현상을 완화했습니다. v1.2.2 동시수익 보호와 BTC 정확 연동도 유지됩니다.",
    "센터 버전 증명과 필수 업데이트 서버 정책을 추가했습니다. 일반 회원의 구 센터 PC 거래는 서버에서 차단되며 관리자 계정은 예외입니다. v1.2.3 안정화와 동시수익 보호, BTC 정확 연동도 유지됩니다.",
    1,
)
extension_path.write_text(extensions, encoding="utf-8")
mirror = ROOT / "extensions-data.js"
if mirror.exists():
    mirror.write_text(extensions, encoding="utf-8")

print("PC required-update packages and policy generated.")
