from pathlib import Path
import json

root = Path('/tmp/sta/STA_Version6_Desktop')
app = root / 'public/js/app.js'
text = app.read_text(encoding='utf-8')
start = text.index('    function click(event) {', text.index('  function startLootScene() {'))
end = text.index('    elements.lootArea.onmousedown = click;', start)
replacement = '''    function click(event) {
      if (event.button !== 0 || finalizing || state.operation?.phase !== "raid_loot") return;
      const operationId = state.operation.id;
      void api.lootClick({ operationId }).then((result) => {
        if (!result.ok) {
          if (!finalizing) showToast(result.error);
          return;
        }
        if (result.operation) {
          displayedCash = Math.max(displayedCash, Number(result.operation.rawCash || 0));
          state.operation = result.operation;
          elements.lootCashText.textContent = formatMoney(displayedCash);
        }
        if (result.accepted) state.audio?.cash();
        if (result.expired || result.operation?.phase === "transport_ready") void finish(result.operation);
      });
    }

    async function finish(knownOperation = null) {
      if (finalizing) return;
      finalizing = true;
      clearInterval(state.lootTimer);
      state.lootTimer = null;
      elements.lootArea.onmousedown = null;

      let operation = knownOperation || state.operation;
      if (operation?.phase !== "transport_ready") {
        const operationId = operation?.id || state.operation?.id;
        const result = await api.finalizeLoot({ operationId });
        if (!result.ok) {
          const refreshed = await api.getState();
          operation = refreshed?.operation || null;
          if (operation?.phase !== "transport_ready") {
            finalizing = false;
            if (!String(result.error).includes("아직")) showToast(result.error);
            return;
          }
        } else {
          operation = result.operation;
        }
      }

      state.operation = operation;
      state.audio?.success();
      await showOverlay("습격 성공", `미정산 현금 ${formatMoney(state.operation.rawCash)}\\n운반이 해금되었습니다.`, 2400);
      setScene("menuScene");
      renderMenu();
    }

'''
app.write_text(text[:start] + replacement + text[end:], encoding='utf-8')

package_file = root / 'package.json'
package = json.loads(package_file.read_text(encoding='utf-8'))
package['version'] = '1.5.1'
package_file.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

sdapp_file = root / 'sd-app.json'
sdapp = json.loads(sdapp_file.read_text(encoding='utf-8'))
if 'version' in sdapp:
    sdapp['version'] = '1.5.1'
sdapp_file.write_text(json.dumps(sdapp, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

patched = app.read_text(encoding='utf-8')
assert 'result.expired || result.operation?.phase === "transport_ready"' in patched
assert 'const refreshed = await api.getState();' in patched
assert 'clearInterval(state.lootTimer);' in patched
print('STA v1.5.1 loot transition patch applied')
