from pathlib import Path
import json
import re
import shutil
import subprocess
import tempfile

WORKSPACE = Path.cwd()
SOURCE_ZIP = WORKSPACE / "downloads/extensions/STA_Version6_Desktop.zip"
TARGET_VERSION = "1.5.1"


def patch_sta_zip():
    temp = Path(tempfile.mkdtemp(prefix="sta-fix-"))
    try:
        subprocess.run(["unzip", "-q", str(SOURCE_ZIP), "-d", str(temp)], check=True)
        root = temp / "STA_Version6_Desktop"
        app_path = root / "public/js/app.js"
        text = app_path.read_text(encoding="utf-8")

        start = text.index("  function startLootScene() {")
        end = text.index("\n  function startTransportScene() {", start)
        replacement = r'''  function startLootScene() {
    setScene("lootScene");
    let finalizing = false;
    let displayedCash = Number(state.operation.rawCash || 0);
    let finishRetryTimer = null;
    const parsedLootEndsAt = Date.parse(String(state.operation.lootEndsAt || ""));
    const lootEndsAtMs = Number.isFinite(parsedLootEndsAt) ? parsedLootEndsAt : Date.now();
    elements.lootCashText.textContent = formatMoney(displayedCash);

    function click(event) {
      if (event.button !== 0 || finalizing || state.operation?.phase !== "raid_loot") return;
      const operationId = state.operation.id;
      void api.lootClick({ operationId }).then((result) => {
        if (!result.ok) {
          if (!finalizing) showToast(result.error);
          return;
        }
        if (result.operation) {
          displayedCash = Math.max(displayedCash, Number(result.operation.rawCash || 0));
          // 종료 처리 중 늦게 도착한 raid_loot 응답이 transport_ready 상태를 되돌리지 않게 한다.
          if (!finalizing || result.operation.phase === "transport_ready") state.operation = result.operation;
          elements.lootCashText.textContent = formatMoney(displayedCash);
        }
        if (result.accepted) state.audio?.cash();
        if (result.expired || result.operation?.phase === "transport_ready") void finish(result.operation);
      }).catch((error) => {
        if (!finalizing) showToast(error?.message || "현금 획득 처리 중 오류가 발생했습니다.");
      });
    }

    async function finish(knownOperation = null) {
      if (finalizing) return;
      finalizing = true;
      clearInterval(state.lootTimer);
      state.lootTimer = null;
      clearTimeout(finishRetryTimer);
      finishRetryTimer = null;
      elements.lootArea.onmousedown = null;
      elements.lootTimerText.textContent = "0.0";

      let operation = knownOperation || state.operation;
      const operationId = operation?.id || state.operation?.id;
      if (!operationId) {
        finalizing = false;
        showToast("STA 작전 정보를 다시 불러오지 못했습니다.");
        return;
      }

      // getState()가 DB의 finalizeLootIfExpired()를 거치므로 실제 종료 시각이 된 뒤
      // transport_ready가 될 때까지 재확인한다. 렌더러 타이머가 수 ms 먼저 끝나도
      // 타이머/입력이 영구 정지된 채 loot 화면에 갇히지 않는다.
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (operation?.phase === "transport_ready") break;
        try {
          const refreshed = await api.getState();
          if (refreshed?.operation) operation = refreshed.operation;
        } catch {}
        if (operation?.phase === "transport_ready") break;
        await sleep(100);
      }

      if (operation?.phase !== "transport_ready") {
        state.operation = operation || state.operation;
        finalizing = false;
        finishRetryTimer = setTimeout(() => void finish(state.operation), 300);
        return;
      }

      state.operation = operation;
      state.audio?.success();
      await showOverlay("습격 성공", `미정산 현금 ${formatMoney(state.operation.rawCash)}\n운반이 해금되었습니다.`, 2400);
      setScene("menuScene");
      renderMenu();
    }

    elements.lootArea.onmousedown = click;
    state.lootTimer = setInterval(() => {
      const remaining = Math.max(0, lootEndsAtMs - Date.now());
      elements.lootTimerText.textContent = (remaining / 1000).toFixed(1);
      if (remaining <= 5000 && remaining > 0 && Math.floor(remaining / 1000) !== Math.floor((remaining + 100) / 1000)) state.audio?.warning();
      if (remaining <= 0) void finish();
    }, 50);
    state.loopCancel = () => {
      elements.lootArea.onmousedown = null;
      clearInterval(state.lootTimer);
      state.lootTimer = null;
      clearTimeout(finishRetryTimer);
      finishRetryTimer = null;
    };
  }
'''
        text = text[:start] + replacement + text[end:]
        app_path.write_text(text, encoding="utf-8")

        for rel in ["package.json", "sd-app.json"]:
            p = root / rel
            if not p.exists():
                continue
            data = json.loads(p.read_text(encoding="utf-8"))
            if "version" in data:
                data["version"] = TARGET_VERSION
            p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        readme = root / "README.md"
        if readme.exists():
            body = readme.read_text(encoding="utf-8")
            hotfix = (
                "## Version 6.1 핫픽스\n\n"
                "- 현금 획득 25초 종료 직후 다음 화면으로 넘어가지 않던 타이머/완료 처리 경쟁 조건 수정\n"
                "- 종료 시 DB 상태를 재확인하여 `transport_ready` 전환을 보장\n"
                "- 늦게 도착한 현금 클릭 응답이 완료 상태를 되돌리지 않도록 보호\n\n"
            )
            if "## Version 6.1 핫픽스" not in body:
                body = body.replace("## Version 6 변경 사항", hotfix + "## Version 6 변경 사항", 1)
            readme.write_text(body, encoding="utf-8")

        rebuilt = temp / "STA_Version6_Desktop.zip"
        subprocess.run(["zip", "-qr", str(rebuilt), root.name], cwd=temp, check=True)
        shutil.copy2(rebuilt, SOURCE_ZIP)
    finally:
        shutil.rmtree(temp, ignore_errors=True)


def patch_extension_metadata():
    for rel in ["extensions-data.js", "assets/js/extensions-data.js"]:
        p = WORKSPACE / rel
        text = p.read_text(encoding="utf-8")
        m = re.search(r'(\{\s*id: "sta",.*?\n\s*featured: true\n\s*\})', text, flags=re.S)
        if not m:
            raise RuntimeError(f"STA metadata block not found: {rel}")
        block = m.group(1)
        block = re.sub(r'version: "[^"]+"', 'version: "v1.5.1"', block, count=1)
        block = re.sub(
            r'downloadUrl: "[^"]+"',
            'downloadUrl: "downloads/extensions/STA_Version6_Desktop.zip?v=151"',
            block,
            count=1,
        )
        block = re.sub(r'updatedAt: "[^"]+"', 'updatedAt: "2026-08-14"', block, count=1)
        block = re.sub(
            r'description: "[^"]+"',
            'description: "해킹, 습격, 운반을 순서대로 수행하는 SD지갑 연동 작전 확장팩입니다. v1.5.1에서 현금 획득 종료 후 운반 화면으로 넘어가지 않던 버그를 수정했습니다."',
            block,
            count=1,
        )
        p.write_text(text[:m.start(1)] + block + text[m.end(1):], encoding="utf-8")


if __name__ == "__main__":
    patch_sta_zip()
    patch_extension_metadata()
    print("STA v1.5.1 cash transition patch prepared")
