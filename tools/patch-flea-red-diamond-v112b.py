#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

VERSION = "1.1.2"
RED_NAME = "레드 다이아몬드"
DENOMINATOR = 100000


def must_replace(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"Missing patch anchor: {label}")
    return text.replace(old, new, 1)


def indent_block(block: str, indent: str) -> str:
    return "\n".join((indent + line) if line else "" for line in block.splitlines())


def patch_core(text: str) -> str:
    const_pattern = re.compile(
        r'(?m)^(?P<i>[ \t]*)const SAFE_JACKPOT_VALUE = Math\.max\(\.\.\.ITEMS\.safe\.map\(\(\[, value\]\) => value\)\);$'
    )
    m = const_pattern.search(text)
    if not m:
        raise RuntimeError("Missing patch anchor: safe jackpot constant")
    i = m.group("i")
    const_replacement = (
        f'{i}const SAFE_JACKPOT_VALUE = Math.max(...ITEMS.safe.map(([, value]) => value));\n'
        f'{i}const RED_DIAMOND_NAME = "{RED_NAME}";\n'
        f'{i}const RED_DIAMOND_CHANCE_DENOMINATOR = {DENOMINATOR};'
    )
    text = text[:m.start()] + const_replacement + text[m.end():]

    roll_pattern = re.compile(
        r'(?m)^(?P<i>[ \t]*)function rollItem\(tierId, boxId\) \{\n(?P=i)  const pool = ITEMS\[tierId\] \|\| ITEMS\.worn;'
    )
    m = roll_pattern.search(text)
    if not m:
        raise RuntimeError("Missing patch anchor: rollItem")
    i = m.group("i")
    helper = '''function makeRedDiamond(boxId) {
  const itemId = typeof uid === "function"
    ? uid("ITEM")
    : `ITEM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  return {
    id: itemId,
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
    replacement = indent_block(helper, i)
    text = text[:m.start()] + replacement + text[m.end():]

    empty_pattern = re.compile(
        r'(?m)^(?P<i>[ \t]*)const pendingItem = (?P<cond>[^;\n]*?\.empty) \? null : rollItem\("safe", safeId\);$'
    )
    m = empty_pattern.search(text)
    if not m:
        raise RuntimeError("Missing patch anchor: empty bank safe")
    i = m.group("i")
    cond = m.group("cond")
    empty_replacement = f'{i}const pendingItem = {cond} ? rollRedDiamond(safeId) : rollItem("safe", safeId);'
    text = text[:m.start()] + empty_replacement + text[m.end():]

    glow_pattern = re.compile(
        r'(?m)^(?P<i>[ \t]*)function previewGlowForSafeItem\(item\) \{\n(?P=i)  return Number\(item\?\.originalValue \|\| 0\) >= SAFE_JACKPOT_VALUE \? "ruby" : "safe";\n(?P=i)\}$'
    )
    m = glow_pattern.search(text)
    if not m:
        raise RuntimeError("Missing patch anchor: safe preview glow")
    i = m.group("i")
    glow = '''function previewGlowForSafeItem(item) {
  if (isLimitedItem(item)) return "ruby";
  return Number(item?.originalValue || 0) >= SAFE_JACKPOT_VALUE ? "ruby" : "safe";
}'''
    glow_replacement = indent_block(glow, i)
    text = text[:m.start()] + glow_replacement + text[m.end():]

    decay_pattern = re.compile(
        r'(?m)^(?P<i>[ \t]*)for \(const item of (?P<s>state|localState)\.items\) \{\n(?P=i)  const baseCurrent'
    )
    matches = list(decay_pattern.finditer(text))
    if not matches:
        raise RuntimeError("Missing patch anchor: item decay loop")
    text = decay_pattern.sub(
        lambda x: f'{x.group("i")}for (const item of {x.group("s")}.items) {{\n{x.group("i")}  if (isLimitedItem(item)) continue;\n{x.group("i")}  const baseCurrent',
        text,
    )
    return text


def patch_public_app(text: str) -> str:
    text = patch_core(text)
    text = text.replace('원본 가치 ${money(item.originalValue)}', '${itemValueDisplay(item)}')

    old = '<div class="item-current-value ${dropped ? "degraded" : ""}">현재 가치 <strong>${money(currentValue)}</strong></div>'
    new = '<div class="item-current-value ${dropped && !isLimitedItem(item) ? "degraded" : ""}">${isLimitedItem(item) ? "<strong>한정판 · 판매 불가</strong>" : `현재 가치 <strong>${money(currentValue)}</strong>`}</div>'
    text = must_replace(text, old, new, "desktop inventory limited display")

    old = 'makeMissionRecord(`${item.name} · ${money(item.originalValue)}`, "#ffd966", "safe")'
    new = 'makeMissionRecord(`${item.name} · ${isLimitedItem(item) ? "한정판 · 판매 불가" : money(item.originalValue)}`, "#ffd966", "safe")'
    text = must_replace(text, old, new, "mission safe reward record")
    return text


def patch_mobile_js(text: str) -> str:
    text = must_replace(
        text,
        '  let currentProfile = null;\n',
        '  let currentProfile = null;\n  const RED_DIAMOND_NAME = "레드 다이아몬드";\n',
        "mobile rare constant",
    )
    text = must_replace(
        text,
        '      const purchased = item.acquisition_kind === "system_purchase";\n      const salePrice = purchased',
        '      const purchased = item.acquisition_kind === "system_purchase";\n      const saleLocked = item.name === RED_DIAMOND_NAME;\n      const salePrice = purchased',
        "mobile sale lock flag",
    )
    text = must_replace(
        text,
        '      value.innerHTML = `${won(item.current_value)}<small>현재 가치</small>`;',
        '      value.innerHTML = saleLocked ? `한정판<small>판매 불가</small>` : `${won(item.current_value)}<small>현재 가치</small>`;',
        "mobile limited value",
    )
    text = must_replace(
        text,
        '      button.textContent = `시스템에 ${won(salePrice)} 판매`;\n      const rule = document.createElement("div");\n      rule.className = "flea-resale";\n      rule.textContent = purchased ? `구매가 ${won(item.purchase_price)} → 재판매 50%` : "PC 획득품 · 판매 수수료 5%";',
        '      button.textContent = saleLocked ? "판매 불가 · 한정판" : `시스템에 ${won(salePrice)} 판매`;\n      button.disabled = saleLocked;\n      const rule = document.createElement("div");\n      rule.className = "flea-resale";\n      rule.textContent = saleLocked ? "금고 0.001% 한정판 · 시스템 판매 불가" : (purchased ? `구매가 ${won(item.purchase_price)} → 재판매 50%` : "PC 획득품 · 판매 수수료 5%");',
        "mobile sale button",
    )
    text = must_replace(
        text,
        '      button.addEventListener("click", async () => {\n        const message = purchased',
        '      button.addEventListener("click", async () => {\n        if (saleLocked) return;\n        const message = purchased',
        "mobile sale handler guard",
    )
    text = must_replace(
        text,
        '      market = marketResult.data?.items || [];',
        '      market = (marketResult.data?.items || []).filter((item) => item.name !== RED_DIAMOND_NAME);',
        "mobile market filter",
    )
    return text


def patch_mobile_html(text: str) -> str:
    text = must_replace(
        text,
        'assets/js/flea-market-mobile.js?v=1',
        'assets/js/flea-market-mobile.js?v=2',
        "mobile cache version",
    )
    text = must_replace(
        text,
        'PC에서 직접 획득한 물건은 기존 규칙대로 현재 가치의 95%를 받습니다. 시스템에서 구매한 물건은 구매가의 정확히 50%에만 재판매할 수 있습니다.',
        'PC에서 직접 획득한 물건은 기존 규칙대로 현재 가치의 95%를 받습니다. 시스템에서 구매한 물건은 구매가의 정확히 50%에만 재판매할 수 있습니다. 레드 다이아몬드는 금고 한정판이라 판매할 수 없습니다.',
        "mobile rule text",
    )
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
    data["displayVersion"] = "PC Expansion · v1.1.2"
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    p = root / "RELEASE_NOTES.txt"
    previous = p.read_text(encoding="utf-8") if p.exists() else ""
    notes = (
        "v1.1.2\n"
        "- 금고 개봉 1회당 0.001%(1/100,000) 확률로 레드 다이아몬드가 등장합니다.\n"
        "- 레드 다이아몬드는 판매할 수 없는 한정판 상품이며 가치 하락 대상에서도 제외됩니다.\n"
        "- 은행 금고는 기존처럼 현장에서 직접 개방합니다.\n\n"
    )
    p.write_text(notes + previous, encoding="utf-8")


def build(src: Path, out: Path) -> None:
    root = Path("/tmp/flea112")
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)
    with zipfile.ZipFile(src, "r") as zf:
        zf.extractall(root)

    main_path = root / "main.js"
    public_path = root / "public" / "app.js"
    main_path.write_text(patch_core(main_path.read_text(encoding="utf-8")), encoding="utf-8")
    public_path.write_text(patch_public_app(public_path.read_text(encoding="utf-8")), encoding="utf-8")
    update_metadata(root)

    if out.exists():
        out.unlink()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in sorted(root.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(root).as_posix())

    with zipfile.ZipFile(out, "r") as zf:
        bad = zf.testzip()
        if bad:
            raise RuntimeError(f"Corrupt ZIP member: {bad}")

    main = main_path.read_text(encoding="utf-8")
    public = public_path.read_text(encoding="utf-8")
    for text in (main, public):
        assert 'RED_DIAMOND_CHANCE_DENOMINATOR = 100000' in text
        assert 'randomInt(RED_DIAMOND_CHANCE_DENOMINATOR) === 0' in text
        assert 'limitedEdition: true' in text
        assert 'sellable: false' in text
        assert 'tradeLocked: true' in text
        assert '? rollRedDiamond(safeId) : rollItem("safe", safeId)' in text
        assert 'if (isLimitedItem(item)) return "ruby";' in text
    assert '판매 불가 · 한정판 상품' in public


def main() -> int:
    src = Path(sys.argv[1] if len(sys.argv) > 1 else "downloads/extensions/SDFleaMarket_v1.1.1_Desktop.zip")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "downloads/extensions/SDFleaMarket_v1.1.2_Desktop.zip")
    build(src, out)

    mobile = Path("assets/js/flea-market-mobile.js")
    mobile.write_text(patch_mobile_js(mobile.read_text(encoding="utf-8")), encoding="utf-8")
    html = Path("flea-market-mobile.html")
    html.write_text(patch_mobile_html(html.read_text(encoding="utf-8")), encoding="utf-8")

    m = mobile.read_text(encoding="utf-8")
    h = html.read_text(encoding="utf-8")
    assert 'const saleLocked = item.name === RED_DIAMOND_NAME;' in m
    assert 'button.disabled = saleLocked;' in m
    assert 'if (saleLocked) return;' in m
    assert '.filter((item) => item.name !== RED_DIAMOND_NAME)' in m
    assert 'flea-market-mobile.js?v=2' in h

    print(f"Built {out} ({out.stat().st_size} bytes)")
    print("Red Diamond: 0.001% per opened safe, limited, sale locked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
