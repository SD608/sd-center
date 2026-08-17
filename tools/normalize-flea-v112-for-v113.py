#!/usr/bin/env python3
from pathlib import Path
import re
import shutil
import zipfile

SRC = Path('downloads/extensions/SDFleaMarket_v1.1.2_Desktop.zip')
OUT = Path('/tmp/SDFleaMarket_v1.1.2_normalized.zip')
ROOT = Path('/tmp/flea112-normalize')

if ROOT.exists():
    shutil.rmtree(ROOT)
ROOT.mkdir(parents=True)
with zipfile.ZipFile(SRC, 'r') as zf:
    zf.extractall(ROOT)

main_path = ROOT / 'main.js'
text = main_path.read_text(encoding='utf-8')

pattern = re.compile(
    r'function finishMission\(\) \{\n'
    r'  const mission = state\.activeMission;\n'
    r'  if \(mission\?\.missionType === "bank-finale" && Number\(mission\.safeOpened \|\| 0\) < 1\) \{\n'
    r'    return \{ ok: false, error: "은행 금고를 최소 1개는 턴 뒤에 탈출할 수 있습니다\.", state: publicState\(\) \};\n'
    r'  \}\n'
    r'  if \(mission\?\.missionType === "bank-finale"\) \{\n'
    r'    mission\.chasePending = true;\n'
    r'    saveState\(\);\n'
    r'    return \{\n'
    r'      ok: true,\n'
    r'      bankChase: true,\n'
    r'      chase: \{\n'
    r'        safeOpened: Number\(mission\.safeOpened \|\| 0\),\n'
    r'        lootValue: Number\(mission\.bankLootValue \|\| 0\),\n'
    r'        lootCount: Array\.isArray\(mission\.bankLootItemIds\) \? mission\.bankLootItemIds\.length : 0,\n'
    r'      \},\n'
    r'      state: publicState\(\),\n'
    r'    \};\n'
    r'  \}',
    re.M,
)
replacement = '''function finishMission() {
  const mission = state.activeMission;
  if (mission?.missionType === "bank-finale" && Number(mission.safeOpened || 0) < 1) { return { ok: false, error: "은행 금고를 최소 1개는 턴 뒤에 탈출할 수 있습니다.", state: publicState() }; }
  if (mission?.missionType === "bank-finale") {
    mission.chasePending = true;
    saveState();
    return { ok: true, bankChase: true, chase: { safeOpened: Number(mission.safeOpened || 0), lootValue: Number(mission.bankLootValue || 0), lootCount: Array.isArray(mission.bankLootItemIds) ? mission.bankLootItemIds.length : 0 }, state: publicState() };
  }'''
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise RuntimeError('Could not normalize main finishMission')
main_path.write_text(text, encoding='utf-8')

if OUT.exists():
    OUT.unlink()
with zipfile.ZipFile(OUT, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for path in sorted(ROOT.rglob('*')):
        if path.is_file():
            zf.write(path, path.relative_to(ROOT).as_posix())
print(OUT)
