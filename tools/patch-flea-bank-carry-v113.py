#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

VERSION = "1.1.3"
SRC_DEFAULT = "downloads/extensions/SDFleaMarket_v1.1.2_Desktop.zip"
OUT_DEFAULT = "downloads/extensions/SDFleaMarket_v1.1.3_Desktop.zip"


def must_replace(text: str, old: str, new: str, label: str, count: int = 1) -> str:
    found = text.count(old)
    if found < count:
        raise RuntimeError(f"Missing patch anchor: {label} (found {found}, need {count})")
    return text.replace(old, new, count)


def replace_regex_once(text: str, pattern: str, repl, label: str, flags=0) -> str:
    out, count = re.subn(pattern, repl, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"Missing patch anchor: {label}")
    return out


def patch_roll_item(text: str) -> str:
    text = must_replace(
        text,
        'function rollItem(tierId, boxId) {\n  if (tierId === "safe") {',
        'function rollItem(tierId, boxId, allowLimited = true) {\n  if (allowLimited && tierId === "safe") {',
        "main rollItem allowLimited",
    ) if 'function rollItem(tierId, boxId) {\n  if (tierId === "safe") {' in text else text

    text = must_replace(
        text,
        '  function rollItem(tierId, boxId) {\n    if (tierId === "safe") {',
        '  function rollItem(tierId, boxId, allowLimited = true) {\n    if (allowLimited && tierId === "safe") {',
        "browser rollItem allowLimited",
    ) if '  function rollItem(tierId, boxId) {\n    if (tierId === "safe") {' in text else text

    if 'function rollItem(tierId, boxId, allowLimited = true)' not in text:
        raise RuntimeError("rollItem signature was not patched")
    return text


def patch_backend(text: str, state_var: str) -> str:
    text = patch_roll_item(text)

    # Every bank safe can now be carried instead of opened on-site.
    text = must_replace(
        text,
        '    opened: false,\n    kind: "safe-node",',
        '    opened: false,\n    carried: false,\n    kind: "safe-node",',
        "main safe carried field",
    ) if state_var == "state" else text
    text = must_replace(
        text,
        '      opened: false,\n      kind: "safe-node",',
        '      opened: false,\n      carried: false,\n      kind: "safe-node",',
        "browser safe carried field",
    ) if state_var == "localState" else text

    # Mission tracks carried safes independently from opened safes.
    indent = "    " if state_var == "state" else "      "
    text = must_replace(
        text,
        f'{indent}safeOpened: 0,\n{indent}bankLootItemIds: [],',
        f'{indent}safeOpened: 0,\n{indent}safeCarried: 0,\n{indent}bankLootItemIds: [],',
        f"{state_var} safeCarried mission field",
    )

    # Replace bank-finale safe interaction branch only.
    state_expr = f"{state_var}.activeMission"
    safe_branch_pattern = re.compile(
        r'(?P<i>[ \t]*)if \(node\.kind === "safe-node"\) \{\n'
        r'(?P=i)  if \(!mission\.bankDoorUnlocked\) return \{ ok: false, error: "먼저 은행 문을 열어야 합니다\." \};\n'
        r'(?P=i)  const totalGuards = bankGuardTotal\(mission\);\n'
        r'(?P=i)  if \(Number\(mission\.guardsNeutralized \|\| 0\) < totalGuards\) return \{ ok: false, error: `경비원을 모두 제압해야 금고를 열 수 있습니다\. \(\$\{mission\.guardsNeutralized \|\| 0\}/\$\{totalGuards\}\)` \};\n'
        r'(?P=i)  if \(node\.opened\) return \{ ok: false, error: "이미 연 금고입니다\." \};\n'
        r'(?P=i)  saveState\(\);\n'
        r'(?P=i)  return \{ ok: true, found: false, bankAction: "safe", safeId: node\.id, searchedObject: node\.objectLabel, mission: [^,]+, exhausted: false, state: publicState\(\) \};\n'
        r'(?P=i)\}',
        re.M,
    )
    m = safe_branch_pattern.search(text)
    if not m:
        raise RuntimeError(f"Missing bank safe interaction branch for {state_var}")
    i = m.group("i")
    branch = f'''{i}if (node.kind === "safe-node") {{
{i}  if (!mission.bankDoorUnlocked) return {{ ok: false, error: "먼저 은행 문을 열어야 합니다." }};
{i}  const totalGuards = bankGuardTotal(mission);
{i}  if (Number(mission.guardsNeutralized || 0) < totalGuards) return {{ ok: false, error: `경비원을 모두 제압해야 금고를 들고 갈 수 있습니다. (${{mission.guardsNeutralized || 0}}/${{totalGuards}})` }};
{i}  if (node.carried || node.searched) return {{ ok: false, error: "이미 챙긴 금고입니다." }};
{i}  node.carried = true;
{i}  node.searched = true;
{i}  node.opened = false;
{i}  mission.safeCarried = Number(mission.safeCarried || 0) + 1;
{i}  const totalSafes = mission.nodes.filter((entry) => entry.kind === "safe-node").length;
{i}  if (mission.safeCarried >= totalSafes) mission.exhausted = true;
{i}  {state_var}.history.unshift({{ type: "bank-safe-carry", at: Date.now(), text: `${{node.objectLabel}} 통째로 회수 · 현재 ${{mission.safeCarried}}개 운반 중` }});
{i}  saveState();
{i}  return {{ ok: true, found: true, bankAction: "safe-carried", safeId: node.id, safeCount: Number(mission.safeCarried || 0), searchedObject: node.objectLabel, mission: {state_expr}, exhausted: Boolean(mission.exhausted), state: publicState() }};
{i}}}'''
    text = text[:m.start()] + branch + text[m.end():]

    # Finish mission now requires at least one carried safe and passes safe count to chase.
    if state_var == "state":
        old = '''function finishMission() {
  const mission = state.activeMission;
  if (mission?.missionType === "bank-finale" && Number(mission.safeOpened || 0) < 1) { return { ok: false, error: "은행 금고를 최소 1개는 턴 뒤에 탈출할 수 있습니다.", state: publicState() }; }
  if (mission?.missionType === "bank-finale") {
    mission.chasePending = true;
    saveState();
    return { ok: true, bankChase: true, chase: { safeOpened: Number(mission.safeOpened || 0), lootValue: Number(mission.bankLootValue || 0), lootCount: Array.isArray(mission.bankLootItemIds) ? mission.bankLootItemIds.length : 0 }, state: publicState() };
  }'''
        new = '''function finishMission() {
  const mission = state.activeMission;
  if (mission?.missionType === "bank-finale" && Number(mission.safeCarried || 0) < 1) { return { ok: false, error: "은행 금고를 최소 1개는 들고 나와야 탈출할 수 있습니다.", state: publicState() }; }
  if (mission?.missionType === "bank-finale") {
    mission.chasePending = true;
    saveState();
    return { ok: true, bankChase: true, chase: { safeCount: Number(mission.safeCarried || 0), lootValue: 0, lootCount: 0 }, state: publicState() };
  }'''
        text = must_replace(text, old, new, "main finishMission carry")
    else:
        old = '''    async finishMission() {
      const mission = localState.activeMission;
      if (mission?.missionType === "bank-finale" && Number(mission.safeOpened || 0) < 1) {
        return { ok: false, error: "은행 금고를 최소 1개는 턴 뒤에 탈출할 수 있습니다.", state: publicState() };
      }
      if (mission?.missionType === "bank-finale") {
        mission.chasePending = true;
        saveState();
        return {
          ok: true,
          bankChase: true,
          chase: {
            safeOpened: Number(mission.safeOpened || 0),
            lootValue: Number(mission.bankLootValue || 0),
            lootCount: Array.isArray(mission.bankLootItemIds) ? mission.bankLootItemIds.length : 0,
          },
          state: publicState(),
        };
      }'''
        new = '''    async finishMission() {
      const mission = localState.activeMission;
      if (mission?.missionType === "bank-finale" && Number(mission.safeCarried || 0) < 1) {
        return { ok: false, error: "은행 금고를 최소 1개는 들고 나와야 탈출할 수 있습니다.", state: publicState() };
      }
      if (mission?.missionType === "bank-finale") {
        mission.chasePending = true;
        saveState();
        return {
          ok: true,
          bankChase: true,
          chase: {
            safeCount: Number(mission.safeCarried || 0),
            lootValue: 0,
            lootCount: 0,
          },
          state: publicState(),
        };
      }'''
        text = must_replace(text, old, new, "browser finishMission carry")

    # Resolve all carried safes only after successful chase. This keeps exactly one
    # 1/100,000 Red Diamond roll per safe and avoids pre-awarding items before escape.
    inventory = f"{state_var}.items"
    history = f"{state_var}.history"
    reset = f"{state_var}.bankPrep = {{ equipment: false, guardWeakening: false }};\n  {state_var}.activeMission = null;" if state_var == "state" else f"      {state_var}.bankPrep = {{ equipment: false, guardWeakening: false }};\n      {state_var}.activeMission = null;"

    if state_var == "state":
        finish_pattern = re.compile(r'function finishBankChase\(success\) \{.*?\n\}\n\nfunction activeMissionSafe', re.S)
        m = finish_pattern.search(text)
        if not m:
            raise RuntimeError("Missing main finishBankChase")
        finish = '''function finishBankChase(success) {
  const mission = state.activeMission;
  if (!mission || mission.missionType !== "bank-finale" || !mission.chasePending) return { ok: false, error: "진행 중인 은행 오토바이 추격전이 없습니다.", state: publicState() };
  const carriedSafes = mission.nodes.filter((node) => node.kind === "safe-node" && node.carried);
  const safeCount = carriedSafes.length;
  const rewards = [];
  let emptyCount = 0;
  let securedValue = 0;
  if (success) {
    for (const safe of carriedSafes) {
      const item = rollRedDiamond(safe.id) || (safe.empty ? null : rollItem("safe", safe.id, false));
      safe.opened = true;
      if (!item) {
        emptyCount += 1;
        state.history.unshift({ type: "mission-safe", at: Date.now(), text: `${safe.objectLabel || "은행 금고"} 개봉 · 꽝` });
        continue;
      }
      item.source = `은행 탈출 금고 ${safe.id}`;
      state.items.unshift(item);
      rewards.push(item);
      securedValue += Number(item.originalValue || item.currentValue || 0);
      state.history.unshift({ type: "mission-safe", at: Date.now(), text: `${safe.objectLabel || "은행 금고"} 개봉 · ${item.name} 획득` });
    }
    mission.safeOpened = safeCount;
    mission.bankLootItemIds = rewards.map((item) => item.id);
    mission.bankLootValue = securedValue;
  }
  state.history.unshift({
    type: "bank-chase",
    at: Date.now(),
    text: success
      ? `은행 도주 성공 · 금고 ${safeCount}개 확보 · 물품 ${rewards.length}개 · 가치 ${securedValue.toLocaleString("ko-KR")}원`
      : `은행 도주 실패 · 오토바이 내구도 소진 · 운반 중 금고 ${safeCount}개 전부 분실`,
  });
  state.bankPrep = { equipment: false, guardWeakening: false };
  state.activeMission = null;
  saveState();
  return { ok: true, success: Boolean(success), safeCount, securedValue: success ? securedValue : 0, lostValue: 0, lostSafes: success ? 0 : safeCount, emptyCount: success ? emptyCount : 0, rewards: success ? rewards : [], state: publicState() };
}

function activeMissionSafe'''
        text = text[:m.start()] + finish + text[m.end():]
    else:
        finish_pattern = re.compile(r'    async finishBankChase\(success\) \{.*?\n    \},\n\n\n    async startMissionSafe', re.S)
        m = finish_pattern.search(text)
        if not m:
            raise RuntimeError("Missing browser finishBankChase")
        finish = '''    async finishBankChase(success) {
      const mission = localState.activeMission;
      if (!mission || mission.missionType !== "bank-finale" || !mission.chasePending) {
        return { ok: false, error: "진행 중인 은행 오토바이 추격전이 없습니다.", state: publicState() };
      }
      const carriedSafes = mission.nodes.filter((node) => node.kind === "safe-node" && node.carried);
      const safeCount = carriedSafes.length;
      const rewards = [];
      let emptyCount = 0;
      let securedValue = 0;
      if (success) {
        for (const safe of carriedSafes) {
          const item = rollRedDiamond(safe.id) || (safe.empty ? null : rollItem("safe", safe.id, false));
          safe.opened = true;
          if (!item) {
            emptyCount += 1;
            localState.history.unshift({ type: "mission-safe", at: Date.now(), text: `${safe.objectLabel || "은행 금고"} 개봉 · 꽝` });
            continue;
          }
          item.source = `은행 탈출 금고 ${safe.id}`;
          localState.items.unshift(item);
          rewards.push(item);
          securedValue += Number(item.originalValue || item.currentValue || 0);
          localState.history.unshift({ type: "mission-safe", at: Date.now(), text: `${safe.objectLabel || "은행 금고"} 개봉 · ${item.name} 획득` });
        }
        mission.safeOpened = safeCount;
        mission.bankLootItemIds = rewards.map((item) => item.id);
        mission.bankLootValue = securedValue;
      }
      localState.history.unshift({
        type: "bank-chase",
        at: Date.now(),
        text: success
          ? `은행 도주 성공 · 금고 ${safeCount}개 확보 · 물품 ${rewards.length}개 · 가치 ${securedValue.toLocaleString("ko-KR")}원`
          : `은행 도주 실패 · 오토바이 내구도 소진 · 운반 중 금고 ${safeCount}개 전부 분실`,
      });
      localState.bankPrep = { equipment: false, guardWeakening: false };
      localState.activeMission = null;
      saveState();
      return { ok: true, success: Boolean(success), safeCount, securedValue: success ? securedValue : 0, lostValue: 0, lostSafes: success ? 0 : safeCount, emptyCount: success ? emptyCount : 0, rewards: success ? rewards : [], state: publicState() };
    },


    async startMissionSafe'''
        text = text[:m.start()] + finish + text[m.end():]

    return text


def patch_ui(app: str) -> str:
    # Mission HUD and hints.
    app = app.replace('금고 ${mission.safeOpened || 0}/${mission.nodes.filter((node) => node.kind === "safe-node").length}', '운반 금고 ${mission.safeCarried || 0}/${mission.nodes.filter((node) => node.kind === "safe-node").length}')
    app = app.replace('${mission.safeOpened || 0} / ${mission.nodes.filter((node) => node.kind === "safe-node").length}', '${mission.safeCarried || 0} / ${mission.nodes.filter((node) => node.kind === "safe-node").length}')
    app = app.replace('${node.objectLabel} · <kbd>E</kbd> 청진기로 열기', '${node.objectLabel} · <kbd>E</kbd> 금고 들고 가기')
    app = app.replace('금고 개방 ${state.mission.safeOpened || 0} / ${totalSafes} · 금고 가까이에서 E', '금고 운반 ${state.mission.safeCarried || 0} / ${totalSafes} · 원하는 만큼 챙긴 뒤 EXIT')

    app = must_replace(
        app,
        '  if (result.bankAction === "safe") return { kind: "action", icon: "🔐", title: objectName, detail: "청진기로 금고를 개방합니다." };',
        '  if (result.bankAction === "safe-carried") return { kind: "found", icon: "🔐", title: objectName, detail: `금고 통째로 회수 · 현재 ${result.safeCount || 0}개 운반 중` };\n  if (result.bankAction === "safe") return { kind: "action", icon: "🔐", title: objectName, detail: "청진기로 금고를 개방합니다." };',
        "UI safe carried result",
    )
    app = app.replace('result?.bankAction === "safe" ? 650 : 900', '(result?.bankAction === "safe" || result?.bankAction === "safe-carried") ? 650 : 900')

    box_anchor = '''  if (result.box) {
    currentMissionLoot.push(result.box);
    currentMissionLoot = currentMissionLoot.slice(-missionMaxBoxes());
  }

  if (result.bankAction === "safe" && result.safeId) {'''
    box_replacement = '''  if (result.box) {
    currentMissionLoot.push(result.box);
    currentMissionLoot = currentMissionLoot.slice(-missionMaxBoxes());
  }

  if (result.bankAction === "safe-carried" && result.safeId) {
    currentMissionLoot.push({ id: result.safeId, tier: "safe", tierName: result.searchedObject || "은행 금고", name: result.searchedObject || "은행 금고", accent: "#ffd36e", carriedSafe: true });
    currentMissionLoot = currentMissionLoot.slice(-missionMaxBoxes());
  }

  if (result.bankAction === "safe" && result.safeId) {'''
    app = must_replace(app, box_anchor, box_replacement, "UI carried safe loot list")

    # Chase globals and count-based difficulty label.
    app = must_replace(app, 'let bankChaseLootValue = 0;\n', 'let bankChaseLootValue = 0;\nlet bankChaseSafeCount = 0;\n', "bank chase safe count global")
    label_old = '''function bankChaseDifficultyLabel(value) {
  const amount = Math.max(0, Number(value || 0));
  if (amount < 500000) return "낮음";
  if (amount < 1000000) return "보통";
  if (amount < 1500000) return "높음";
  if (amount < 2500000) return "매우 높음";
  return "최고 경계";
}'''
    label_new = '''function bankChaseDifficultyLabel(value) {
  const count = Math.max(1, Math.min(6, Math.trunc(Number(value || 1))));
  if (count <= 1) return "낮음";
  if (count === 2) return "보통";
  if (count === 3) return "높음";
  if (count === 4) return "매우 높음";
  if (count === 5) return "극한";
  return "최고 경계";
}'''
    app = must_replace(app, label_old, label_new, "count based chase label")

    start_pattern = re.compile(r'async function startBankChase\(chase = \{\}\) \{.*?\n  bankChaseGame\.start\(\);\n\}', re.S)
    m = start_pattern.search(app)
    if not m:
        raise RuntimeError("Missing startBankChase UI")
    start_new = '''async function startBankChase(chase = {}) {
  bankChaseSafeCount = Math.max(1, Math.min(6, Math.trunc(Number(chase.safeCount ?? state?.mission?.safeCarried ?? 1))));
  bankChaseLootValue = 0;
  currentMissionLoot = [...currentMissionLoot];
  bankChaseActive = true;
  document.exitPointerLock?.();
  syncMission3D(null);
  await setMissionFullscreen(true);
  $("#bankChaseLootValue").textContent = `${bankChaseSafeCount}개`;
  $("#bankChaseDifficulty").textContent = `추격 강도 · ${bankChaseDifficultyLabel(bankChaseSafeCount)}`;
  $("#bankChaseResult").classList.add("hidden");
  $("#bankChaseImpact").classList.add("hidden");
  $("#bankChase").classList.remove("hidden");
  updateBankChaseDurability(100);
  bankChaseGame?.stop?.();
  bankChaseGame = window.BankChaseGame?.create({
    canvas: $("#bankChaseCanvas"),
    safeCount: bankChaseSafeCount,
    audioContext: getAudioContext(),
    onDurability: updateBankChaseDurability,
    onDistance: updateBankChaseDistance,
    onImpact: flashBankChaseImpact,
    onFinish: finalizeBankChase,
  });
  if (!bankChaseGame) {
    bankChaseActive = false;
    return toast("오토바이 추격전 모듈을 불러오지 못했습니다.");
  }
  updateBankChaseDistance(0, bankChaseGame.getState?.().targetDistance || 850);
  bankChaseGame.start();
}'''
    app = app[:m.start()] + start_new + app[m.end():]

    # Result copy reflects safes being opened only after escape.
    result_old = '''  const success = Boolean(result.success);
  $("#bankChaseResult").classList.remove("hidden");
  $("#bankChaseResultTitle").textContent = success ? "도주 성공" : "오토바이 파손 · 습격 실패";
  $("#bankChaseResultText").textContent = success
    ? "경찰 추격을 따돌렸습니다. 은행에서 확보한 물품을 그대로 가져갑니다."
    : "오토바이 내구도가 0이 되어 도주에 실패했습니다. 이번 은행 습격에서 확보한 물품을 전부 잃었습니다.";
  $("#bankChaseResultValue").textContent = success
    ? `확보 가치 ${money(result.securedValue || bankChaseLootValue)}`
    : `손실 가치 ${money(result.lostValue || bankChaseLootValue)}`;'''
    result_new = '''  const success = Boolean(result.success);
  const rewards = Array.isArray(result.rewards) ? result.rewards : [];
  const redDiamond = rewards.find((item) => item?.name === "레드 다이아몬드");
  $("#bankChaseResult").classList.remove("hidden");
  $("#bankChaseResultTitle").textContent = success ? (redDiamond ? "도주 성공 · 레드 다이아몬드!" : "도주 성공") : "오토바이 파손 · 습격 실패";
  $("#bankChaseResultText").textContent = success
    ? `금고 ${result.safeCount || bankChaseSafeCount}개를 무사히 가져왔습니다. 은신처에서 개봉해 물품 ${rewards.length}개를 확보했습니다${Number(result.emptyCount || 0) ? ` · 빈 금고 ${result.emptyCount}개` : ""}.${redDiamond ? " 판매 불가 한정판 레드 다이아몬드를 획득했습니다!" : ""}`
    : `오토바이 내구도가 0이 되어 도주에 실패했습니다. 들고 나오던 금고 ${result.lostSafes || bankChaseSafeCount}개를 전부 잃었습니다.`;
  $("#bankChaseResultValue").textContent = success
    ? `확보 가치 ${money(result.securedValue || 0)} · 금고 ${result.safeCount || bankChaseSafeCount}개`
    : `분실 금고 ${result.lostSafes || bankChaseSafeCount}개`;'''
    app = must_replace(app, result_old, result_new, "chase result copy")

    app = must_replace(app, '  bankChaseLootValue = 0;\n  await setMissionFullscreen(false);', '  bankChaseLootValue = 0;\n  bankChaseSafeCount = 0;\n  await setMissionFullscreen(false);', "reset chase safe count")
    return app


def patch_bankchase(text: str) -> str:
    old = '''    const lootValue = Math.max(0, Number(options.lootValue || 0));
    const risk = clamp(lootValue / 2500000, 0, 1.6);'''
    new = '''    const safeCount = clamp(Math.trunc(Number(options.safeCount || 1)), 1, 6);
    const risk = clamp(((safeCount - 1) / 5) * 1.6, 0, 1.6);'''
    text = must_replace(text, old, new, "bankchase count risk")
    text = must_replace(
        text,
        '      getState: () => ({ durability, distance, targetDistance, lane, speedKmh, cruiseSpeedKmh, maxSpeedKmh, throttleHeld, lootValue, risk, chaseTuning: { ...chaseTuning } }),',
        '      getState: () => ({ durability, distance, targetDistance, lane, speedKmh, cruiseSpeedKmh, maxSpeedKmh, throttleHeld, safeCount, risk, chaseTuning: { ...chaseTuning } }),',
        "bankchase getState safeCount",
    )
    text = text.replace('확보 가치가 높을수록 경찰 대응이 강해져 장애물 간격이 짧아진다.', '운반 중인 금고 수가 많을수록 경찰 대응이 강해져 장애물 간격이 짧아진다.')
    return text


def patch_index(text: str) -> str:
    text = must_replace(
        text,
        '<div class="bank-chase-loot"><span>현재 습격 확보 가치</span><strong id="bankChaseLootValue">₩0</strong><small id="bankChaseDifficulty">추격 강도 · 보통</small><small>오토바이 내구도가 0이 되면 이번 은행 습격 물품을 전부 잃습니다.</small></div>',
        '<div class="bank-chase-loot"><span>운반 중인 금고</span><strong id="bankChaseLootValue">0개</strong><small id="bankChaseDifficulty">추격 강도 · 낮음</small><small>금고를 많이 들고 나올수록 추격 거리가 길어지고 장애물·충돌 피해가 강해집니다.</small></div>',
        "bank chase HUD labels",
    )
    text = text.replace('./bankchase.js?v=0.5.9', './bankchase.js?v=0.5.10')
    text = text.replace('./app.js?v=0.5.9', './app.js?v=0.5.10')
    return text


def update_metadata(root: Path) -> None:
    p = root / "package.json"
    data = json.loads(p.read_text(encoding="utf-8"))
    data["version"] = VERSION
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    p = root / "package-lock.json"
    if p.exists():
        data = json.loads(p.read_text(encoding="utf-8"))
        data["version"] = VERSION
        if isinstance(data.get("packages"), dict) and isinstance(data["packages"].get(""), dict):
            data["packages"][""]["version"] = VERSION
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    p = root / "sd-app.json"
    data = json.loads(p.read_text(encoding="utf-8"))
    data["version"] = VERSION
    data["displayVersion"] = "PC Expansion · v1.1.3"
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    p = root / "RELEASE_NOTES.txt"
    old = p.read_text(encoding="utf-8") if p.exists() else ""
    notes = (
        "v1.1.3\n"
        "- 은행 피날레에서는 금고를 현장에서 열지 않고 금고 자체를 들고 탈출합니다.\n"
        "- 들고 나온 금고 수가 많을수록 오토바이 추격전의 거리, 장애물 빈도, 대형 장애물 확률, 충돌 피해가 증가합니다.\n"
        "- 금고 내용물은 추격전 성공 후 은신처에서 개봉되며 금고 1개당 레드 다이아몬드 0.001%(1/100,000) 판정을 1회 수행합니다.\n"
        "- 레드 다이아몬드는 기존처럼 판매 불가 한정판 상품입니다.\n\n"
    )
    p.write_text(notes + old, encoding="utf-8")


def build(src: Path, out: Path) -> None:
    root = Path('/tmp/flea113')
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)
    with zipfile.ZipFile(src, 'r') as zf:
        zf.extractall(root)

    main_path = root / 'main.js'
    app_path = root / 'public' / 'app.js'
    chase_path = root / 'public' / 'bankchase.js'
    index_path = root / 'public' / 'index.html'

    main = patch_backend(main_path.read_text(encoding='utf-8'), 'state')
    app = patch_backend(app_path.read_text(encoding='utf-8'), 'localState')
    app = patch_ui(app)
    chase = patch_bankchase(chase_path.read_text(encoding='utf-8'))
    index = patch_index(index_path.read_text(encoding='utf-8'))

    main_path.write_text(main, encoding='utf-8')
    app_path.write_text(app, encoding='utf-8')
    chase_path.write_text(chase, encoding='utf-8')
    index_path.write_text(index, encoding='utf-8')
    update_metadata(root)

    if out.exists():
        out.unlink()
    with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in sorted(root.rglob('*')):
            if path.is_file():
                zf.write(path, path.relative_to(root).as_posix())

    with zipfile.ZipFile(out, 'r') as zf:
        bad = zf.testzip()
        if bad:
            raise RuntimeError(f'Corrupt ZIP member: {bad}')

    # Static validation of all requested mechanics.
    main = main_path.read_text(encoding='utf-8')
    app = app_path.read_text(encoding='utf-8')
    chase = chase_path.read_text(encoding='utf-8')
    index = index_path.read_text(encoding='utf-8')
    for text in (main, app):
        assert 'safeCarried: 0' in text
        assert 'bankAction: "safe-carried"' in text
        assert 'node.carried = true' in text
        assert 'rollRedDiamond(safe.id) || (safe.empty ? null : rollItem("safe", safe.id, false))' in text
        assert '금고를 최소 1개는 들고 나와야' in text
        assert 'safeCount: Number(mission.safeCarried || 0)' in text
        assert 'lostSafes: success ? 0 : safeCount' in text
        assert 'function rollItem(tierId, boxId, allowLimited = true)' in text
    assert 'safeCount = clamp(Math.trunc(Number(options.safeCount || 1)), 1, 6)' in chase
    assert '((safeCount - 1) / 5) * 1.6' in chase
    assert 'safeCount: bankChaseSafeCount' in app
    assert '금고 들고 가기' in app
    assert '운반 중인 금고' in index
    assert './bankchase.js?v=0.5.10' in index
    assert './app.js?v=0.5.10' in index


def main() -> int:
    src = Path(sys.argv[1] if len(sys.argv) > 1 else SRC_DEFAULT)
    out = Path(sys.argv[2] if len(sys.argv) > 2 else OUT_DEFAULT)
    build(src, out)
    print(f'Built {out} ({out.stat().st_size} bytes)')
    print('Bank finale: carry safes, rewards after successful chase')
    print('Chase difficulty: safe-count based, 1 easiest -> 6 hardest')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
