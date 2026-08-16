#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path

MARKER = "// SD_SAFE_MOUSE_DIAL_V1"


def patch_app(text: str) -> str:
    if MARKER in text:
        return text

    required = [
        "function safeDialKeyDown(key)",
        "function updateSafeDial(dt, now)",
        "function renderSafe(session)",
        'id="safeDialAssembly"',
        'id="safeConfirmButton"',
    ]
    missing = [needle for needle in required if needle not in text]
    if missing:
        raise RuntimeError("Unexpected safe dial source: " + ", ".join(missing))

    anchor = "let safeRattleAt = 0;\n"
    if anchor not in text:
        raise RuntimeError("safeRattleAt anchor not found")
    text = text.replace(anchor, "let safeRattleAt = 0;\nlet safeDialDrag = null;\n", 1)

    old_update = '''function updateSafeDial(dt, now) {
  if (!safeMinigameActive()) return;
  const aHeld = keys.has("a") && safeHoldStartedAt.a > 0;
  const dHeld = keys.has("d") && safeHoldStartedAt.d > 0;
  if (aHeld === dHeld) return;

  const key = aHeld ? "a" : "d";
  const direction = aHeld ? -1 : 1;
  const heldFor = now - safeHoldStartedAt[key];
  if (heldFor < 180) return;

  const speed = heldFor < 450 ? 7 : 20;
  setSafeDialPosition(safeDialPosition + direction * speed * (dt / 1000), true);
  if (now - safeRattleAt >= 72) {
    playSafeDialRattle();
    safeRattleAt = now;
  }
}

'''
    if old_update not in text:
        raise RuntimeError("updateSafeDial block not found")

    pointer_code = old_update + r'''// SD_SAFE_MOUSE_DIAL_V1
function safeDialPointerAngle(event, element) {
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  return Math.atan2(event.clientY - centerY, event.clientX - centerX);
}

function startSafeDialDrag(event) {
  if (!safeMinigameActive()) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const surface = event.currentTarget;
  if (!surface) return;

  event.preventDefault();
  getAudioContext();
  safeDialDrag = {
    pointerId: event.pointerId,
    lastAngle: safeDialPointerAngle(event, surface),
  };
  surface.setPointerCapture?.(event.pointerId);
  surface.classList.add("dragging");
  surface.style.cursor = "grabbing";
}

function moveSafeDialDrag(event) {
  const drag = safeDialDrag;
  if (!drag || drag.pointerId !== event.pointerId || !safeMinigameActive()) return;
  const surface = event.currentTarget;
  if (!surface) return;

  event.preventDefault();
  const angle = safeDialPointerAngle(event, surface);
  let delta = angle - drag.lastAngle;
  if (delta > Math.PI) delta -= Math.PI * 2;
  else if (delta < -Math.PI) delta += Math.PI * 2;
  drag.lastAngle = angle;

  if (Math.abs(delta) < 0.0001) return;
  const dialDelta = -(delta / (Math.PI * 2)) * 100;
  setSafeDialPosition(safeDialPosition + dialDelta, true);

  const now = performance.now();
  if (now - safeRattleAt >= 72) {
    playSafeDialRattle();
    safeRattleAt = now;
  }
}

function stopSafeDialDrag(event) {
  const drag = safeDialDrag;
  if (!drag) return;
  if (event?.pointerId != null && drag.pointerId !== event.pointerId) return;

  safeDialDrag = null;
  const surface = event?.currentTarget || document.querySelector("#safeDialAssembly .safe-dial-shell");
  if (!surface) return;
  surface.classList.remove("dragging");
  surface.style.cursor = "grab";
  try {
    if (surface.hasPointerCapture?.(drag.pointerId)) {
      surface.releasePointerCapture(drag.pointerId);
    }
  } catch {
    // DOM replacement may release capture first.
  }
}

function bindSafeDialPointerControls() {
  const surface = document.querySelector("#safeDialAssembly .safe-dial-shell");
  if (!surface) return;
  surface.style.touchAction = "none";
  surface.style.userSelect = "none";
  surface.style.cursor = "grab";
  surface.addEventListener("pointerdown", startSafeDialDrag);
  surface.addEventListener("pointermove", moveSafeDialDrag);
  surface.addEventListener("pointerup", stopSafeDialDrag);
  surface.addEventListener("pointercancel", stopSafeDialDrag);
  surface.addEventListener("lostpointercapture", stopSafeDialDrag);
}

'''
    text = text.replace(old_update, pointer_code, 1)

    reset_anchor = '''  safeRattleAt = 0;
  modalSpaceAction = confirmSafeDial;
'''
    if reset_anchor not in text:
        raise RuntimeError("renderSafe reset anchor not found")
    text = text.replace(
        reset_anchor,
        '''  safeRattleAt = 0;
  safeDialDrag = null;
  modalSpaceAction = confirmSafeDial;
''',
        1,
    )

    text = text.replace(
        "A / D로 원하는 방향으로 돌리고, 걸리는 소리를 기억한 뒤 SPACE로 현재 번호를 확정하세요.",
        "A / D 또는 마우스로 다이얼을 직접 잡아 돌리고, 걸리는 소리를 기억한 뒤 SPACE로 현재 번호를 확정하세요.",
        1,
    )

    old_help = '''<div class="safe-control-grid"><span><kbd>A</kbd> 왼쪽</span><span><kbd>D</kbd> 오른쪽</span><span><kbd>SPACE</kbd> 확정</span></div>
        <p class="safe-no-limit">A/D를 짧게 누르면 1칸, 꾹 누르면 연속 회전합니다. 확정 횟수 제한은 없습니다.</p>'''
    new_help = '''<div class="safe-control-grid"><span><kbd>A</kbd> 왼쪽</span><span><kbd>D</kbd> 오른쪽</span><span><kbd>🖱</kbd> 잡고 회전</span><span><kbd>SPACE</kbd> 확정</span></div>
        <p class="safe-no-limit">A/D를 짧게 누르면 1칸, 꾹 누르면 연속 회전합니다. 마우스는 다이얼을 잡은 채 원을 그리듯 돌리면 됩니다. 확정 횟수 제한은 없습니다.</p>'''
    if old_help not in text:
        raise RuntimeError("safe help block not found")
    text = text.replace(old_help, new_help, 1)

    bind_anchor = '''  renderSafePins();
  $("#safeConfirmButton").addEventListener("click", confirmSafeDial);
}
'''
    if bind_anchor not in text:
        raise RuntimeError("safe bind anchor not found")
    text = text.replace(
        bind_anchor,
        '''  renderSafePins();
  bindSafeDialPointerControls();
  $("#safeConfirmButton").addEventListener("click", confirmSafeDial);
}
''',
        1,
    )
    return text


def patch_json(name: str, raw: bytes) -> bytes:
    data = json.loads(raw.decode("utf-8-sig"))
    if name == "package.json":
        data["version"] = "1.0.10"
        data["description"] = "SD 플리마켓 PC 확장팩 v1.0.10 - 정상 본체 복구 및 금고 A/D + 마우스 다이얼 조작"
    elif name == "sd-app.json":
        data["version"] = "1.0.10"
        data["displayVersion"] = "PC Expansion · v1.0.10"
        data["description"] = "SD지갑과 SD Link 계정을 연동하는 SD 플리마켓 PC 확장팩입니다. 파밍, 상자 개봉, 은행 습격과 오토바이 추격전을 포함합니다."
        data["improvement"] = "v1.0.9 배포 ZIP 손상을 복구해 마지막 정상 본체를 기준으로 재패키징했습니다. 금고는 기존 A/D 조작을 유지하면서 마우스로 다이얼을 직접 잡아 회전할 수 있습니다."
        data.pop("requiredLogisticsRank", None)
        data.pop("requiredLogisticsRep", None)
    return (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def build(src: Path, dst: Path) -> None:
    with zipfile.ZipFile(src, "r") as zin, zipfile.ZipFile(dst, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zout:
        names = set(zin.namelist())
        required = {"package.json", "sd-app.json", "public/app.js"}
        missing = required - names
        if missing:
            raise RuntimeError("Missing package files: " + ", ".join(sorted(missing)))

        for info in zin.infolist():
            name = info.filename
            raw = zin.read(name)
            if name == "public/app.js":
                raw = patch_app(raw.decode("utf-8-sig")).encode("utf-8")
            elif name in {"package.json", "sd-app.json"}:
                raw = patch_json(name, raw)
            elif name == "RELEASE_NOTES.txt":
                raw = (
                    "SD 플리마켓 v1.0.10\n"
                    "- v1.0.9 손상 배포 ZIP 복구\n"
                    "- 마지막 정상 본체 v1.0.4 기반 재패키징\n"
                    "- 금고 A/D 키 조작 유지\n"
                    "- 금고 다이얼 마우스 드래그 회전 추가\n"
                    "- 별도 패치 프로그램 없이 확장팩 ZIP 자체로 설치\n\n"
                ).encode("utf-8") + raw
            elif name == "README.md":
                text = raw.decode("utf-8-sig")
                text = text.replace("v1.0.4", "v1.0.10")
                raw = text.encode("utf-8")

            new_info = zipfile.ZipInfo(name, date_time=info.date_time)
            new_info.external_attr = info.external_attr
            new_info.create_system = info.create_system
            new_info.compress_type = zipfile.ZIP_DEFLATED if not name.endswith("/") else zipfile.ZIP_STORED
            zout.writestr(new_info, raw)


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: build-flea-v1010.py SOURCE.zip OUTPUT.zip")
        return 2
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    build(src, dst)
    print(dst)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
