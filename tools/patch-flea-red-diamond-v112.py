#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

VERSION = "1.1.2"
RED_DIAMOND_NAME = "레드 다이아몬드"
RED_DIAMOND_DENOMINATOR = 100000


def require(text: str, needle: str, label: str) -> None:
    if needle not in text:
        raise RuntimeError(f"Missing patch anchor: {label}")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    require(text, old, label)
    return text.replace(old, new, 1)


def patch_core_js(text: str) -> str:
    jackpot = 'const SAFE_JACKPOT_VALUE = Math.max(...ITEMS.safe.map(([, value]) => value));'
    text = replace_once(
        text,
        jackpot,
        jackpot
        + '\nconst RED_DIAMOND_NAME = "레드 다이아몬드";'
        + '\nconst RED_DIAMOND_CHANCE_DENOMINATOR = 100000;',
        "red diamond constants",
    )

    roll_anchor = 'function rollItem(tierId, boxId) {\n  const pool = ITEMS[tierId] || ITEMS.worn;'
    helper = '''function makeRedDiamond(boxId) {
  return {
    id: `ITEM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    boxId,
    name: RED_DIAMOND_NAME,
    tier: "safe",
    originalValue: 1,
    currentValue: 1,
    conditionPercent: 100,
    acquiredAt: new Date().toISOString(),
    source: "금고 한정판",
    syncStatus: "pending",
    limitedEdition: true,
    sellable: false,
    tradeLocked: true,
  };
}

function rollRedDiamond(boxId) {
  return randomInt(RED_DIAMOND_CHANCE_DENOMINATOR) === 0 ? makeRedDiamond(boxId) : null;
}

function isLimitedItem(item) {
  return Boolean(item && (
    item.sellable === false ||
    item.tradeLocked === true ||
    item.name === RED_DIAMOND_NAME
  ));
}

function itemValueDisplay(item) {
  if (isLimitedItem(item)) return "판매 불가 · 한정판 상품";
  return `원본 가치 ${Number(item?.originalValue || 0).toLocaleString("ko-KR")}원`;
}

function rollItem(tierId, boxId) {
  if (tierId === "safe") {
    const limited = rollRedDiamond(boxId);
    if (limited) return limited;
  }
  const pool = ITEMS[tierId] || ITEMS.worn;'''
    text = replace_once(text, roll_anchor, helper, "safe rare roll")

    # Bank finale has intentionally empty safes. A Red Diamond roll still occurs on
    # every opened vault, so the advertised chance is exactly 1/100,000 per vault.
    empty_anchor = 'const pendingItem = safe.kind === "safe-node" && safe.empty ? null : rollItem("safe", safeId);'
    empty_replacement = 'const pendingItem = safe.kind === "safe-node" && safe.empty ? rollRedDiamond(safeId) : rollItem("safe", safeId);'
    text = replace_once(text, empty_anchor, empty_replacement, "bank empty safe rare roll")

    old_glow = '''function previewGlowForSafeItem(item) {
  return Number(item?.originalValue || 0) >= SAFE_JACKPOT_VALUE ? "ruby" : "safe";
}'''
    new_glow = '''function previewGlowForSafeItem(item) {
  if (isLimitedItem(item)) return "ruby";
  return Number(item?.originalValue || 0) >= SAFE_JACKPOT_VALUE ? "ruby" : "safe";
}'''
    text = replace_once(text, old_glow, new_glow, "red diamond ruby glow")

    # Limited collectibles do not lose condition/value while sitting in storage.
    text, decay_count = re.subn(
        r'for \(const item of (state|localState)\.items\) \{\n(\s+)const baseCurrent',
        r'for (const item of \1.items) {\n\2if (isLimitedItem(item)) continue;\n\2const baseCurrent',
        text,
    )
    if decay_count < 1:
        raise RuntimeError("Missing value-decay loop anchor")

    return text


def patch_public_app(text: str) -> str:
    text = patch_core_js(text)

    # Reward views: hide the nominal DB value for the collectible.
    text = text.replace(
        '원본 가치 ${money(item.originalValue)}',
        '${itemValueDisplay(item)}',
    )

    inventory_old = '<div class="item-current-value ${dropped ? "degraded" : ""}">현재 가치 <strong>${money(currentValue)}</strong></div>'
    inventory_new = '<div class="item-current-value ${dropped && !isLimitedItem(item) ? "degraded" : ""}">${isLimitedItem(item) ? "<strong>한정판 · 판매 불가</strong>" : `현재 가치 <strong>${money(currentValue)}</strong>`}</div>'
    text = replace_once(text, inventory_old, inventory_new, "desktop limited inventory display")

    mission_record_old = 'makeMissionRecord(`${item.name} · ${money(item.originalValue)}`, "#ffd966", "safe")'
    mission_record_new = 'makeMissionRecord(`${item.name} · ${isLimitedItem(item) ? "한정판 · 판매 불가" : money(item.originalValue)}`, "#ffd966", "safe")'
    text = replace_once(text, mission_record_old, mission_record_new, "mission limited reward record")

    return text


def patch_mobile_js(text: str) -> str:
    text = replace_once(
        text,
        '  let currentProfile = null;\n',
        '  let currentProfile = null;\n  const RED_DIAMOND_NAME = "레드 다이아몬드";\n',
        "mobile rare constant",
    )

    text = replace_once(
        text,
        '      const purchased = item.acquisition_kind === "system_purchase";\n      const salePrice = purchased',
        '      const purchased = item.acquisition_kind === "system_purchase";\n      const saleLocked = item.name === RED_DIAMOND_NAME;\n      const salePrice = purchased',
        "mobile sale lock flag",
    )

    text = replace_once(
        text,
        '      value.innerHTML = `${won(item.current_value)}<small>현재 가치</small>`;',
        '      value.innerHTML = saleLocked ? `한정판<small>판매 불가</small>` : `${won(item.current_value)}<small>현재 가치</small>`;',
        "mobile limited value display",
    )

    text = replace_once(
        text,
        '      button.textContent = `시스템에 ${won(salePrice)} 판매`;\n      const rule = document.createElement("div");\n      rule.className = "flea-resale";\n      rule.textContent = purchased ? `구매가 ${won(item.purchase_price)} → 재판매 50%` : "PC 획득품 · 판매 수수료 5%";',
        '      button.textContent = saleLocked ? "판매 불가 · 한정판" : `시스템에 ${won(salePrice)} 판매`;\n      button.disabled = saleLocked;\n      const rule = document.createElement("div");\n      rule.className = "flea-resale";\n      rule.textContent = saleLocked ? "금고 0.001% 한정판 · 시스템 판매 불가" : (purchased ? `구매가 ${won(item.purchase_price)} → 재판매 50%` : "PC 획득품 · 판매 수수료 5%");',
        "mobile disabled sale button",
    )

    text = replace_once(
        text,
        '      button.addEventListener("click", async () => {\n        const message = purchased',
        '      button.addEventListener("click", async () => {\n        if (saleLocked) return;\n        const message = purchased',
        "mobile sale handler guard",
    )

    # Defensive client filter: even if a stale server row ever exists, do not expose
    # the limited item as purchasable system stock.
    text = replace_once(
        text,
        '      market = marketResult.data?.items || [];',
        '      market = (marketResult.data?.items || []).filter((item) => item.name !== RED_DIAMOND_NAME);',
        "mobile system-market filter",
    )

    return text


def patch_mobile_html(text: str) -> str:
    text = replace_once(
        text,
        'assets/js/flea-market-mobile.js?v=1',
        'assets/js/flea-market-mobile.js?v=2',
        "mobile cache bump",
    )
    text = replace_once(
        text,
        'PC에서 직접 획득한 물건은 기존 규칙대로 현재 가치의 95%를 받습니다. 시스템에서 구매한 물건은 구매가의 정확히 50%에만 재판매할 수 있습니다.',
        'PC에서 직접 획득한 물건은 기존 규칙대로 현재 가치의 95%를 받습니다. 시스템에서 구매한 물건은 구매가의 정확히 50%에만 재판매할 수 있습니다. 레드 다이아몬드는 금고 한정판이라 판매할 수 없습니다.',
        "mobile sale rule copy",
    )
    return text


def update_metadata(root: Path) -> None:
    package_path = root / "package.json"
    package = json.loads(package_path.read_text(encoding="utf-8"))
    package["version"] = VERSION
    package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    lock_path = root / "package-lock.json"
    if lock_path.exists():
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
        lock["version"] = VERSION
        if isinstance(lock.get("packages"), dict) and isinstance(lock["packages"].get(""), dict):
            lock["packages"][""]["version"] = VERSION
        lock_path.write_text(json.dumps(lock, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    appmeta_path = root / "sd-app.json"
    appmeta = json.loads(appmeta_path.read_text(encoding="utf-8"))
    appmeta["version"] = VERSION
    appmeta["displayVersion"] = f"PC Expansion · v{VERSION}"
    appmeta_path.write_text(json.dumps(appmeta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    notes_path = root / "RELEASE_NOTES.txt"
    old_notes = notes_path.read_text(encoding="utf-8") if notes_path.exists() else ""
    note = (
        "v1.1.2\n"
        "- 금고 개봉 1회당 0.001%(1/100,000) 확률로 레드 다이아몬드가 등장합니다.\n"
        "- 레드 다이아몬드는 판매할 수 없는 한정판 아이템이며 가치 하락 대상에서도 제외됩니다.\n"
        "- 은행 금고는 기존처럼 현장에서 직접 개방합니다.\n\n"
    )
    notes_path.write_text(note + old_notes, encoding="utf-8")


def build_zip(src: Path, out: Path, root: Path) -> None:
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)

    with zipfile.ZipFile(src, "r") as zf:
        zf.extractall(root)

    main_path = root / "main.js"
    app_path = root / "public" / "app.js"
    main_path.write_text(patch_core_js(main_path.read_text(encoding="utf-8")), encoding="utf-8")
    app_path.write_text(patch_public_app(app_path.read_text(encoding="utf-8")), encoding="utf-8")
    update_metadata(root)

    if out.exists():
        out.unlink()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in sorted(root.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(root).as_posix())


def validate(out: Path) -> None:
    check = Path("/tmp/flea112-check")
    if check.exists():
        shutil.rmtree(check)
    check.mkdir(parents=True)
    with zipfile.ZipFile(out, "r") as zf:
        bad = zf.testzip()
        if bad:
            raise RuntimeError(f"Corrupt ZIP member: {bad}")
        zf.extractall(check)

    main = (check / "main.js").read_text(encoding="utf-8")
    app = (check / "public" / "app.js").read_text(encoding="utf-8")
    package = json.loads((check / "package.json").read_text(encoding="utf-8"))
    appmeta = json.loads((check / "sd-app.json").read_text(encoding="utf-8"))

    for text in (main, app):
        assert 'const RED_DIAMOND_CHANCE_DENOMINATOR = 100000;' in text
        assert 'randomInt(RED_DIAMOND_CHANCE_DENOMINATOR) === 0' in text
        assert 'name: RED_DIAMOND_NAME' in text
        assert 'limitedEdition: true' in text
        assert 'sellable: false' in text
        assert 'tradeLocked: true' in text
        assert '? rollRedDiamond(safeId) : rollItem("safe", safeId)' in text
        assert 'if (isLimitedItem(item)) return "ruby";' in text
    assert '판매 불가 · 한정판 상품' in app
    assert package["version"] == VERSION
    assert appmeta["version"] == VERSION
    assert appmeta["displayVersion"] == f"PC Expansion · v{VERSION}"


def main() -> int:
    src = Path(sys.argv[1] if len(sys.argv) > 1 else "downloads/extensions/SDFleaMarket_v1.1.1_Desktop.zip")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "downloads/extensions/SDFleaMarket_v1.1.2_Desktop.zip")
    root = Path("/tmp/flea112")

    build_zip(src, out, root)
    validate(out)

    mobile_path = Path("assets/js/flea-market-mobile.js")
    mobile_path.write_text(patch_mobile_js(mobile_path.read_text(encoding="utf-8")), encoding="utf-8")
    mobile_html_path = Path("flea-market-mobile.html")
    mobile_html_path.write_text(patch_mobile_html(mobile_html_path.read_text(encoding="utf-8")), encoding="utf-8")

    mobile = mobile_path.read_text(encoding="utf-8")
    html = mobile_html_path.read_text(encoding="utf-8")
    assert 'const saleLocked = item.name === RED_DIAMOND_NAME;' in mobile
    assert 'button.disabled = saleLocked;' in mobile
    assert 'if (saleLocked) return;' in mobile
    assert '.filter((item) => item.name !== RED_DIAMOND_NAME)' in mobile
    assert 'flea-market-mobile.js?v=2' in html

    print(f"Built {out} ({out.stat().st_size} bytes)")
    print("Red Diamond chance: 1/100,000 per opened safe")
    print("Red Diamond sale: locked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
