from __future__ import annotations

import importlib.util
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE = ROOT / "patch-flea-v118-bank-heist.py"

spec = importlib.util.spec_from_file_location("flea118_base", BASE)
if spec is None or spec.loader is None:
    raise RuntimeError("base flea patch module load failed")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

base_patch_browser_app = mod.patch_browser_app


def patch_browser_app_v2(text: str) -> str:
    # v1.1.7 실제 배포본은 과거 패치가 UI 사전 차단 식을 변형해 두었다.
    # finishMission() 호출 직전에 있는 은행 전용 차단 블록을 형태와 무관하게
    # 표준 safeOpened 블록으로 정규화한 뒤 기존 패처가 완전히 제거하게 한다.
    exact = '''  if (state.mission.missionType === "bank-finale" && Number(state.mission.safeOpened || 0) < 1) {\n    toast("은행 금고를 최소 1개는 턴 뒤에 탈출할 수 있습니다.");\n    return;\n  }\n'''
    if exact not in text:
        pattern = re.compile(
            r'  if \(state\.mission\.missionType === "bank-finale" && .*?\) \{\n'
            r'    toast\("은행 금고를 최소 1개는 .*?탈출할 수 있습니다\."\);\n'
            r'    return;\n'
            r'  \}\n',
            re.S,
        )
        text, count = pattern.subn(exact, text, count=1)
        if count != 1:
            # 마지막 안전망: EXIT 검사와 missionSearchBusy 사이의 은행 차단 블록만 제거한다.
            pattern2 = re.compile(
                r'(  if \(!engine\?\.isActive\(\) \|\| !engine\.isExitNearby\?\.\(\) \{.*?\n  \}\n)'
                r'(?:\s*if \(state\.mission\.missionType === "bank-finale".*?\n  \}\n)'
                r'(\n  missionSearchBusy = true;)',
                re.S,
            )
            text, count2 = pattern2.subn(r'\1\3', text, count=1)
            if count2 == 1:
                # 기존 패처가 요구하는 블록을 잠시 삽입해 동일한 후처리를 통과시킨다.
                marker = '\n  missionSearchBusy = true;'
                text = text.replace(marker, '\n' + exact + marker.lstrip('\n'), 1)
            else:
                raise RuntimeError("은행 EXIT 앞 UI 사전 차단 블록을 찾지 못했습니다.")
    return base_patch_browser_app(text)


mod.patch_browser_app = patch_browser_app_v2

if __name__ == "__main__":
    mod.main()
