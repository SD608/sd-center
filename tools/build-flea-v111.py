#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
import zipfile
from pathlib import Path

VERSION = "1.1.1"
MOUSE_MARKER = "// SD_SAFE_MOUSE_DIAL_V1"


def require(text: str, needle: str, label: str) -> None:
    if needle not in text:
        raise RuntimeError(f"Missing patch anchor: {label}")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    require(text, old, label)
    return text.replace(old, new, 1)


def patch_integration(text: str) -> str:
    text = replace_once(text, 'const S_RANK_REP = 7000;', 'const S_RANK_REP = 2200;', 'S rank threshold')

    old_rank = '''function rankFromRep(value) {
  const rep = Math.max(0, Number(value || 0));
  if (rep >= 7000) return "S";
  if (rep >= 4500) return "A";
  if (rep >= 2800) return "B";
  if (rep >= 1600) return "C";
  if (rep >= 800) return "D";
  if (rep >= 300) return "E";
  return "F";
}'''
    new_rank = '''function rankFromRep(value) {
  const rep = Math.max(0, Number(value || 0));
  if (rep >= 2200) return "S";
  if (rep >= 1450) return "A";
  if (rep >= 900) return "B";
  if (rep >= 520) return "C";
  if (rep >= 260) return "D";
  if (rep >= 100) return "E";
  return "F";
}'''
    text = replace_once(text, old_rank, new_rank, 'rank thresholds')

    old_logistics = '''async function logisticsProgress(currentUserData, safeStorage) {
  let auth;
  try {
    auth = await onlineSession(currentUserData, safeStorage);
  } catch {
    return { onlineLinked: false, rep: 0, grade: "F", userId: "" };
  }
  if (!auth.onlineLinked || !auth.session) return { onlineLinked: false, rep: 0, grade: "F", userId: auth.userId || "" };

  const userId = auth.userId;
  try {
    const rows = await fetchJson(`${SUPABASE_URL}/rest/v1/sd_logistics_progress?select=state&user_id=eq.${encodeURIComponent(userId)}&limit=1`, {
      headers: {
        Accept: "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${auth.session.accessToken}`,
      },
    });
    const rep = Math.max(0, Number(Array.isArray(rows) ? rows[0]?.state?.logisticsRep : 0) || 0);
    return { onlineLinked: true, rep, grade: rankFromRep(rep), userId };
  } catch {
    return { onlineLinked: true, rep: 0, grade: "F", userId, lookupFailed: true };
  }
}'''
    new_logistics = '''async function logisticsProgress(currentUserData, safeStorage) {
  let auth;
  try {
    auth = await onlineSession(currentUserData, safeStorage);
  } catch {
    return { onlineLinked: false, rep: 0, grade: "F", userId: "" };
  }
  if (!auth.onlineLinked || !auth.session) {
    return { onlineLinked: false, rep: 0, grade: "F", userId: auth.userId || "" };
  }

  const userId = auth.userId;
  let rep = 0;
  let snapshotResolved = false;

  // v1.0.9에서 도입된 회사 스냅샷 RPC를 우선 사용합니다.
  // RPC가 아직 배포되지 않은 환경에서는 기존 진행도 테이블로 안전하게 fallback 합니다.
  try {
    const snapshotResponse = await invokeAuthenticatedRpc(
      currentUserData,
      safeStorage,
      "get_sd_flea_company_snapshot",
      {}
    );
    const snapshot = Array.isArray(snapshotResponse) ? snapshotResponse[0] : snapshotResponse;
    const snapshotRep = Number(snapshot?.logistics_rep ?? snapshot?.logisticsRep ?? 0);
    if (Number.isFinite(snapshotRep)) {
      rep = Math.max(0, snapshotRep);
      snapshotResolved = true;
    }
  } catch {
    // 아래의 기존 sd_logistics_progress 조회로 계속 진행합니다.
  }

  if (!snapshotResolved || rep <= 0) {
    try {
      const rows = await fetchJson(`${SUPABASE_URL}/rest/v1/sd_logistics_progress?select=state&user_id=eq.${encodeURIComponent(userId)}&limit=1`, {
        headers: {
          Accept: "application/json",
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${auth.session.accessToken}`,
        },
      });
      const fallbackRep = Math.max(0, Number(Array.isArray(rows) ? rows[0]?.state?.logisticsRep : 0) || 0);
      rep = Math.max(rep, fallbackRep);
    } catch {
      if (!snapshotResolved) {
        return { onlineLinked: true, rep: 0, grade: "F", userId, lookupFailed: true };
      }
    }
  }

  return {
    onlineLinked: true,
    rep,
    grade: rankFromRep(rep),
    userId,
    snapshotResolved,
  };
}'''
    text = replace_once(text, old_logistics, new_logistics, 'logistics snapshot/fallback')
    return text


def patch_main(text: str) -> str:
    text = replace_once(
        text,
        'const company = integration?.companyState?.() || { grade: "F", rep: 0, onlineLinked: false, requiredRep: 7000 };',
        'const company = integration?.companyState?.() || { grade: "F", rep: 0, onlineLinked: false, requiredRep: 2200 };',
        'public company fallback',
    )
    text = replace_once(
        text,
        'companyRequiredRep: Number(company.requiredRep || 7000),',
        'companyRequiredRep: Number(company.requiredRep || 2200),',
        'public required rep fallback',
    )

    old_get_state = '''  ipcMain.handle("flea:get-state", async () => {
    await integration.refreshCompany(false);
    if (Date.now() - lastInventorySyncAt >= 12000) void syncInventoryNow(false);
    return publicState();
  });'''
    new_get_state = '''  ipcMain.handle("flea:get-state", async () => {
    await integration.refreshCompany(false);
    if (Date.now() - lastInventorySyncAt >= 12000) void syncInventoryNow(false);
    return publicState();
  });
  ipcMain.handle("flea:refresh-company", async () => {
    try {
      await integration.refreshCompany(true);
      return { ok: true, state: publicState() };
    } catch (error) {
      return {
        ok: false,
        error: String(error?.message || error || "회사 등급 새로고침 실패"),
        state: publicState(),
      };
    }
  });
  ipcMain.handle("flea:refresh-inventory", async () => {
    try {
      await integration.refreshCompany(true);
      const sync = await syncInventoryNow(true);
      const nextState = publicState();
      if (!sync?.ok && !sync?.skipped) {
        return {
          ok: false,
          error: String(sync?.error || nextState.onlineInventorySync?.lastError || "온라인 물품 새로고침 실패"),
          sync,
          state: nextState,
        };
      }
      return { ok: true, sync, state: nextState };
    } catch (error) {
      return {
        ok: false,
        error: String(error?.message || error || "온라인 물품 새로고침 실패"),
        state: publicState(),
      };
    }
  });'''
    text = replace_once(text, old_get_state, new_get_state, 'refresh IPC handlers')
    return text


def patch_preload(text: str) -> str:
    old = '  getState: () => ipcRenderer.invoke("flea:get-state"),\n'
    new = '''  getState: () => ipcRenderer.invoke("flea:get-state"),
  refreshCompany: () => ipcRenderer.invoke("flea:refresh-company"),
  refreshInventory: () => ipcRenderer.invoke("flea:refresh-inventory"),
'''
    return replace_once(text, old, new, 'preload refresh APIs')


def patch_index(text: str) -> str:
    old_company = '<div class="phone-company-card"><span>회사 등급</span><strong id="phoneCompanyGrade">S</strong><small id="phoneCompanyNote">확장팩 연동 정보</small></div>'
    new_company = '<div class="phone-company-card"><span>회사 등급</span><strong id="phoneCompanyGrade">-</strong><small id="phoneCompanyNote">SD Link 회사 정보 확인 중</small><button id="refreshCompany" class="sync-refresh-button" type="button">새로고침</button></div>'
    text = replace_once(text, old_company, new_company, 'company refresh button')

    old_items = '<div class="panel-heading"><div><p class="eyebrow">ITEM VAULT</p><h1>물건 보관함</h1><p>보관 시간이 지나면 물건의 현재 가치가 떨어집니다. 품질 자동 관리기를 보유하면 가치 하락을 막을 수 있습니다.</p><div id="itemProtectionStatus" class="protection-status">자동 관리기 상태 확인 중...</div></div></div>'
    new_items = '<div class="panel-heading item-vault-heading"><div><p class="eyebrow">ITEM VAULT</p><h1>물건 보관함</h1><p>보관 시간이 지나면 물건의 현재 가치가 떨어집니다. 품질 자동 관리기를 보유하면 가치 하락을 막을 수 있습니다.</p><div id="itemProtectionStatus" class="protection-status">자동 관리기 상태 확인 중...</div></div><div class="online-sync-box"><button id="refreshInventory" class="ghost sync-refresh-button" type="button">온라인 물품 새로고침</button><small id="onlineInventoryStatus">SD Link 동기화 상태 확인 중...</small></div></div>'
    text = replace_once(text, old_items, new_items, 'inventory refresh UI')
    return text


def patch_app(text: str) -> str:
    if MOUSE_MARKER not in text:
        text = replace_once(text, 'let safeRattleAt = 0;\n', 'let safeRattleAt = 0;\nlet safeDialDrag = null;\n', 'safe drag state')

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
    // DOM 교체가 먼저 포인터 캡처를 해제한 경우입니다.
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
        text = replace_once(text, old_update, pointer_code, 'safe pointer controls')
        text = replace_once(
            text,
            '  safeRattleAt = 0;\n  modalSpaceAction = confirmSafeDial;\n',
            '  safeRattleAt = 0;\n  safeDialDrag = null;\n  modalSpaceAction = confirmSafeDial;\n',
            'safe render drag reset',
        )
        text = replace_once(
            text,
            'A / D로 원하는 방향으로 돌리고, 걸리는 소리를 기억한 뒤 SPACE로 현재 번호를 확정하세요.',
            'A / D 또는 마우스로 다이얼을 직접 잡아 돌리고, 걸리는 소리를 기억한 뒤 SPACE로 현재 번호를 확정하세요.',
            'safe help intro',
        )
        old_help = '<div class="safe-control-grid"><span><kbd>A</kbd> 왼쪽</span><span><kbd>D</kbd> 오른쪽</span><span><kbd>SPACE</kbd> 확정</span></div>\n        <p class="safe-no-limit">A/D를 짧게 누르면 1칸, 꾹 누르면 연속 회전합니다. 확정 횟수 제한은 없습니다.</p>'
        new_help = '<div class="safe-control-grid"><span><kbd>A</kbd> 왼쪽</span><span><kbd>D</kbd> 오른쪽</span><span><kbd>🖱</kbd> 잡고 회전</span><span><kbd>SPACE</kbd> 확정</span></div>\n        <p class="safe-no-limit">A/D를 짧게 누르면 1칸, 꾹 누르면 연속 회전합니다. 마우스는 다이얼을 잡은 채 원을 그리듯 돌리면 됩니다. 확정 횟수 제한은 없습니다.</p>'
        text = replace_once(text, old_help, new_help, 'safe help controls')
        text = replace_once(
            text,
            '  renderSafePins();\n  $("#safeConfirmButton").addEventListener("click", confirmSafeDial);\n}',
            '  renderSafePins();\n  bindSafeDialPointerControls();\n  $("#safeConfirmButton").addEventListener("click", confirmSafeDial);\n}',
            'safe pointer bind',
        )

    old_refresh = '''async function refresh() {
  state = await api.getState();
  render();
}

'''
    refresh_helpers = old_refresh + '''async function refreshCompanyNow() {
  const button = $("#refreshCompany");
  if (button?.disabled) return;
  const oldLabel = button?.textContent || "새로고침";
  if (button) {
    button.disabled = true;
    button.textContent = "확인 중...";
  }
  try {
    const result = await api.refreshCompany?.();
    state = result?.state || await api.getState();
    render();
    if (!result?.ok) {
      toast(result?.error || "회사 등급을 새로고침하지 못했습니다.");
      return;
    }
    toast(`회사 등급 ${state.companyGrade || "-"} · 평판 ${Number(state.companyRep || 0).toLocaleString("ko-KR")} 새로고침 완료`);
  } catch (error) {
    toast(error?.message || "회사 등급 새로고침에 실패했습니다.");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = oldLabel;
    }
  }
}

async function refreshOnlineInventoryNow() {
  const button = $("#refreshInventory");
  if (button?.disabled) return;
  const oldLabel = button?.textContent || "온라인 물품 새로고침";
  if (button) {
    button.disabled = true;
    button.textContent = "동기화 중...";
  }
  try {
    const result = await api.refreshInventory?.();
    state = result?.state || await api.getState();
    render();
    if (!result?.ok) {
      toast(result?.error || state.onlineInventorySync?.lastError || "온라인 물품 새로고침에 실패했습니다.");
      return;
    }
    const removed = Number(result?.sync?.removed || 0);
    toast(removed > 0 ? `온라인 물품 새로고침 완료 · 모바일 판매 ${removed}개 반영` : "온라인 물품 새로고침 완료");
  } catch (error) {
    toast(error?.message || "온라인 물품 새로고침에 실패했습니다.");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = oldLabel;
    }
  }
}

'''
    text = replace_once(text, old_refresh, refresh_helpers, 'manual refresh helpers')

    old_company_note = '  $("#phoneCompanyNote").textContent = state.devMode ? "개발 테스트 등급" : "회사 계정 연동 등급";\n'
    new_company_note = '''  $("#phoneCompanyNote").textContent = state.devMode
    ? "개발 테스트 등급"
    : state.companyOnlineLinked
      ? `평판 ${Number(state.companyRep || 0).toLocaleString("ko-KR")} · SD Link 실시간 연동`
      : "SD Link 온라인 연결 필요";
  const onlineSync = state.onlineInventorySync || {};
  const onlineStatus = $("#onlineInventoryStatus");
  if (onlineStatus) {
    if (onlineSync.syncing) onlineStatus.textContent = "온라인 동기화 중...";
    else if (!onlineSync.linked) onlineStatus.textContent = "SD Link 온라인 연결 필요";
    else if (onlineSync.lastError) onlineStatus.textContent = `최근 동기화 오류 · ${onlineSync.lastError}`;
    else if (Number(onlineSync.lastSyncedAt || 0) > 0) {
      onlineStatus.textContent = `마지막 동기화 ${new Date(Number(onlineSync.lastSyncedAt)).toLocaleTimeString("ko-KR")}`;
    } else onlineStatus.textContent = "온라인 보관함 동기화 대기 중";
  }
'''
    text = replace_once(text, old_company_note, new_company_note, 'render sync status')

    bind_anchor = '  $("#homeButton").addEventListener("click", goPhoneHome);\n'
    bind_new = '''  $("#homeButton").addEventListener("click", goPhoneHome);
  $("#refreshCompany")?.addEventListener("click", refreshCompanyNow);
  $("#refreshInventory")?.addEventListener("click", refreshOnlineInventoryNow);
'''
    text = replace_once(text, bind_anchor, bind_new, 'refresh UI bindings')
    return text


def patch_style(text: str) -> str:
    marker = '/* SD_FLEA_V111_REFRESH_UI */'
    if marker in text:
        return text
    additions = r'''

/* SD_FLEA_V111_REFRESH_UI */
.phone-company-card{grid-template-columns:1fr auto auto;column-gap:10px}
.phone-company-card strong{grid-row:1/3;grid-column:2}
.phone-company-card .sync-refresh-button{grid-row:1/3;grid-column:3;align-self:center}
.sync-refresh-button{border:1px solid #34536f;border-radius:10px;background:#102235;color:#ccefff;padding:8px 11px;font:inherit;font-size:11px;font-weight:800;cursor:pointer;transition:.16s ease}
.sync-refresh-button:hover{background:#17324b;border-color:#5e91b8;transform:translateY(-1px)}
.sync-refresh-button:disabled{opacity:.55;cursor:wait;transform:none}
.item-vault-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}
.online-sync-box{display:flex;min-width:230px;max-width:320px;flex-direction:column;align-items:flex-end;gap:7px;padding:10px 12px;border:1px solid #263b50;border-radius:12px;background:#09131dcc}
.online-sync-box small{color:#8fa9bf;font-size:10px;line-height:1.45;text-align:right;overflow-wrap:anywhere}
.safe-control-grid{grid-template-columns:repeat(4,1fr)}
.safe-dial-shell{touch-action:none;user-select:none}
.safe-dial-shell.dragging{cursor:grabbing}
@media(max-width:900px){.item-vault-heading{flex-direction:column}.online-sync-box{width:100%;max-width:none;align-items:stretch}.online-sync-box small{text-align:left}.safe-control-grid{grid-template-columns:repeat(2,1fr)}}
'''
    return text.rstrip() + additions + '\n'


def patch_json(name: str, raw: bytes) -> bytes:
    data = json.loads(raw.decode('utf-8-sig'))
    if name == 'package.json':
        data['version'] = VERSION
        data['description'] = 'SD 플리마켓 PC 확장팩 v1.1.1 - v1.0.9 연동 기능 재구축 및 금고 A/D·마우스 조작'
    elif name == 'sd-app.json':
        data['version'] = VERSION
        data['displayVersion'] = 'PC Expansion · v1.1.1'
        data['description'] = 'SD지갑과 SD Link 계정을 연동하는 SD 플리마켓 PC 확장팩입니다. 파밍, 상자 개봉, 은행 습격, 온라인 물품 동기화와 오토바이 추격전을 포함합니다.'
        data['improvement'] = '손상된 v1.0.9 배포본 대신 마지막 정상 코드에 v1.0.9 릴리스에서 의도했던 회사 스냅샷 직접연동, 최신 물류 등급 기준, 회사·온라인 물품 수동 새로고침을 재구축했습니다. 기존 5초 SD Link 자동 재연결과 모바일 판매 반영을 유지하고 금고 A/D 조작에 마우스 직접 회전을 추가했습니다.'
        data.pop('requiredLogisticsRank', None)
        data.pop('requiredLogisticsRep', None)
    return (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def patch_release_notes(raw: bytes) -> bytes:
    old = raw.decode('utf-8-sig')
    header = '''SD 플리마켓 v1.1.1
- 손상된 v1.0.9 배포본의 릴리스 의도 기능을 정상 v1.0.4 코드 위에 재구축
- 실제 물류회사 등급: get_sd_flea_company_snapshot 우선 조회 + 기존 진행도 fallback
- 최신 물류 평판 등급 기준 반영 (S 2,200 / A 1,450 / B 900 / C 520 / D 260 / E 100)
- 홈 회사 등급 수동 새로고침 추가
- 물건 보관함 온라인 물품 수동 새로고침 추가
- 기존 5초 SD Link 자동 재연결·PC↔모바일 재고 동기화·모바일 판매 반영 유지
- 금고 A/D 키 조작 유지 + 마우스로 다이얼 직접 잡아 회전 추가
- 종합센터 앱 자동업데이트가 잘못 배포된 v1.1.0에서 교체할 수 있도록 v1.1.1로 배포

'''
    return (header + old).encode('utf-8')


def build(src: Path, dst: Path) -> None:
    with zipfile.ZipFile(src, 'r') as zin:
        names = set(zin.namelist())
        required = {
            'package.json', 'sd-app.json', 'main.js', 'preload.js',
            'src/sd-integration.js', 'public/index.html', 'public/app.js',
            'public/style.css', 'RELEASE_NOTES.txt'
        }
        missing = required - names
        if missing:
            raise RuntimeError('Missing package files: ' + ', '.join(sorted(missing)))

        with zipfile.ZipFile(dst, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zout:
            for info in zin.infolist():
                name = info.filename
                raw = zin.read(name)
                if name in {'package.json', 'sd-app.json'}:
                    raw = patch_json(name, raw)
                elif name == 'src/sd-integration.js':
                    raw = patch_integration(raw.decode('utf-8-sig')).encode('utf-8')
                elif name == 'main.js':
                    raw = patch_main(raw.decode('utf-8-sig')).encode('utf-8')
                elif name == 'preload.js':
                    raw = patch_preload(raw.decode('utf-8-sig')).encode('utf-8')
                elif name == 'public/index.html':
                    raw = patch_index(raw.decode('utf-8-sig')).encode('utf-8')
                elif name == 'public/app.js':
                    raw = patch_app(raw.decode('utf-8-sig')).encode('utf-8')
                elif name == 'public/style.css':
                    raw = patch_style(raw.decode('utf-8-sig')).encode('utf-8')
                elif name == 'RELEASE_NOTES.txt':
                    raw = patch_release_notes(raw)

                new_info = zipfile.ZipInfo(name, date_time=info.date_time)
                new_info.external_attr = info.external_attr
                new_info.create_system = info.create_system
                new_info.compress_type = zipfile.ZIP_STORED if name.endswith('/') else zipfile.ZIP_DEFLATED
                zout.writestr(new_info, raw)


def main() -> int:
    if len(sys.argv) != 3:
        print('usage: build-flea-v111.py SOURCE.zip OUTPUT.zip')
        return 2
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    build(src, dst)
    print(dst)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
