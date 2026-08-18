from __future__ import annotations
import base64, json, os, re, shutil, subprocess, tempfile, zipfile
from pathlib import Path

ROOT = Path.cwd()
VERSION = '1.2.0'
SOURCE = ROOT / 'downloads/extensions/SDFleaMarket_v1.1.9_Desktop.zip'
OUTPUT = ROOT / 'downloads/extensions/SDFleaMarket_v1.2.0_Desktop.zip'
SHA = ROOT / 'downloads/extensions/SDFleaMarket_v1.2.0_Desktop.sha256'
SPRITE_B64 = ROOT / 'tools/flea-v120-items-sprite.webp.b64'
MANIFEST = ROOT / 'tools/flea-v120-items-manifest.txt'

ITEM_IMAGE_PATHS = {
  '볼펜':'ballpoint-pen.png','클립 한 통':'paper-clips.png','지우개':'eraser.png','15cm 자':'ruler-15cm.png','작은 수첩':'small-notebook.png','열쇠고리':'keychain.png','머그컵':'mug.png','USB 케이블':'usb-cable.png',
  '유선 이어폰':'wired-earphones.png','휴대폰 충전기':'phone-charger.png','미니 선풍기':'mini-fan.png','USB 메모리':'usb-drive.png','무선 마우스':'wireless-mouse.png','보조배터리':'power-bank.png','저가형 헤드셋':'budget-headset.png',
  '게임패드':'gamepad.png','기계식 키보드':'mechanical-keyboard.png','브랜드 운동화':'brand-sneakers.png','블루투스 스피커':'bluetooth-speaker.png','무선 이어폰':'wireless-earbuds.png','스마트워치':'smartwatch.png',
  '휴대용 게임기 세트':'portable-game-console.png','프리미엄 헤드폰':'premium-headphones.png','고급 태블릿':'premium-tablet.png','미러리스 카메라':'mirrorless-camera.png','플래그십 스마트폰':'flagship-smartphone.png','고성능 그래픽카드':'graphics-card.png',
  '레드 다이아몬드':'red-diamond.png','금반지':'gold-ring.png','희귀 주화':'rare-coin.png','금목걸이':'gold-necklace.png','금화 세트':'gold-coins.png','명품 시계':'luxury-watch.png','보석 원석':'gemstone.png','소형 금괴':'small-gold-bar.png','대형 금괴':'large-gold-bar.png'
}


def find_root(extracted: Path) -> Path:
    candidates=[]
    for package in extracted.rglob('package.json'):
        if 'node_modules' in {p.lower() for p in package.parts}: continue
        try: data=json.loads(package.read_text(encoding='utf-8'))
        except Exception: continue
        if data.get('name') in {'sd-flea-market','sd-flea-market-pc'}:
            candidates.append(package.parent)
    if not candidates: raise RuntimeError('플리마켓 package root not found')
    candidates.sort(key=lambda p: len(p.parts))
    return candidates[0]


def replace_required(text: str, old: str, new: str, label: str) -> str:
    if new in text: return text
    if old not in text: raise RuntimeError(f'missing patch target: {label}')
    return text.replace(old,new,1)


def install_images(pkg: Path) -> None:
    from PIL import Image
    out=pkg/'public/assets/items'; out.mkdir(parents=True,exist_ok=True)
    sprite_bytes=base64.b64decode(''.join(SPRITE_B64.read_text(encoding='ascii').split()))
    tmp=pkg/'_flea_items.webp'; tmp.write_bytes(sprite_bytes)
    sprite=Image.open(tmp).convert('RGB')
    lines=[line for line in MANIFEST.read_text(encoding='utf-8').splitlines() if line.strip()]
    if len(lines)!=36: raise RuntimeError(f'item manifest count {len(lines)} != 36')
    for line in lines:
        name,x,y=line.split('\t'); x=int(x); y=int(y)
        crop=sprite.crop((x*64,y*48,(x+1)*64,(y+1)*48)).resize((128,96),Image.Resampling.LANCZOS)
        crop.save(out/name,'PNG',optimize=True)
    tmp.unlink(missing_ok=True)


def patch_app(pkg: Path) -> None:
    p=pkg/'public/app.js'; s=p.read_text(encoding='utf-8').replace('\r\n','\n')
    if 'const ITEM_IMAGE_PATHS' not in s:
        mapping='const ITEM_IMAGE_PATHS = Object.freeze({\n' + ',\n'.join(f'  {json.dumps(k,ensure_ascii=False)}: {json.dumps("assets/items/"+v,ensure_ascii=False)}' for k,v in ITEM_IMAGE_PATHS.items()) + '\n});\n\n'
        helper=r'''function itemImagePath(itemOrName) {
  const name = typeof itemOrName === "string" ? itemOrName : String(itemOrName?.name || "");
  return ITEM_IMAGE_PATHS[name] || "";
}

function itemImageHtml(itemOrName, className = "item-image") {
  const name = typeof itemOrName === "string" ? itemOrName : String(itemOrName?.name || "아이템");
  const src = itemImagePath(name);
  if (!src) return '<span class="item-image-fallback">🎁</span>';
  return `<img class="${className}" src="${src}" alt="${name}" loading="lazy" draggable="false">`;
}

'''
        marker='function createBrowserFallbackApi() {'
        if marker not in s: raise RuntimeError('browser fallback marker missing')
        s=s.replace(marker,mapping+helper+marker,1)

    if 'const ITEM_DICTIONARY_CATALOG' not in s:
        catalog=r'''const ITEM_DICTIONARY_CATALOG = Object.freeze([
  ...[
    ["볼펜", 1000], ["클립 한 통", 2000], ["지우개", 1000], ["15cm 자", 2000],
    ["작은 수첩", 4000], ["열쇠고리", 5000], ["머그컵", 7000], ["USB 케이블", 10000]
  ].map(([name, price]) => ({ name, price, tier: "worn", tierName: "낡은 상자", dropChance: 12.5 })),
  ...[
    ["유선 이어폰", 25000], ["휴대폰 충전기", 30000], ["미니 선풍기", 35000], ["USB 메모리", 40000],
    ["무선 마우스", 50000], ["보조배터리", 60000], ["저가형 헤드셋", 75000]
  ].map(([name, price]) => ({ name, price, tier: "normal", tierName: "평범한 상자", dropChance: 100 / 7 })),
  ...[
    ["게임패드", 90000], ["기계식 키보드", 120000], ["브랜드 운동화", 150000], ["블루투스 스피커", 180000], ["무선 이어폰", 200000], ["스마트워치", 240000]
  ].map(([name, price]) => ({ name, price, tier: "fancy", tierName: "고급진 상자", dropChance: 100 / 6 })),
  ...[
    ["휴대용 게임기 세트", 250000], ["프리미엄 헤드폰", 300000], ["고급 태블릿", 350000], ["미러리스 카메라", 400000], ["플래그십 스마트폰", 450000], ["고성능 그래픽카드", 500000]
  ].map(([name, price]) => ({ name, price, tier: "premium", tierName: "최고급 상자", dropChance: 100 / 6 })),
  { name: "레드 다이아몬드", price: null, tier: "safe", tierName: "금고", dropChance: 0.001, limitedEdition: true },
  ...[
    ["금반지", 220000, 26], ["희귀 주화", 280000, 20], ["금목걸이", 350000, 18], ["금화 세트", 450000, 14], ["명품 시계", 600000, 10], ["보석 원석", 850000, 7], ["소형 금괴", 1200000, 4], ["대형 금괴", 2500000, 1]
  ].map(([name, price, weight]) => ({ name, price, tier: "safe", tierName: "금고", dropChance: 0.99999 * weight }))
]);

function buildItemDictionarySnapshot(rawState) {
  const stats = new Map(ITEM_DICTIONARY_CATALOG.map((entry) => [entry.name, { historyCount: 0, currentCount: 0, firstAt: 0 }]));
  const histories = Array.isArray(rawState?.history) ? rawState.history : [];
  for (const record of histories) {
    const text = String(record?.text || "");
    if (!text.includes("획득")) continue;
    const at = Number(record?.at || 0);
    for (const entry of ITEM_DICTIONARY_CATALOG) {
      if (!text.includes(`${entry.name} 획득`)) continue;
      const stat = stats.get(entry.name); stat.historyCount += 1;
      if (at > 0 && (!stat.firstAt || at < stat.firstAt)) stat.firstAt = at;
      break;
    }
  }
  for (const item of Array.isArray(rawState?.items) ? rawState.items : []) {
    const stat = stats.get(String(item?.name || "")); if (!stat) continue;
    stat.currentCount += 1;
    const at = Date.parse(item?.acquiredAt || "");
    if (Number.isFinite(at) && at > 0 && (!stat.firstAt || at < stat.firstAt)) stat.firstAt = at;
  }
  return ITEM_DICTIONARY_CATALOG.map((entry) => {
    const stat = stats.get(entry.name);
    const totalAcquired = Math.max(Number(stat?.historyCount || 0), Number(stat?.currentCount || 0));
    return { ...entry, acquired: totalAcquired > 0, firstAcquiredAt: stat?.firstAt ? new Date(stat.firstAt).toISOString() : null, totalAcquired };
  });
}

'''
        marker='function itemImagePath(itemOrName) {'
        if marker not in s: raise RuntimeError('item image marker missing')
        s=s.replace(marker,catalog+marker,1)

    s=s.replace('schemaVersion: 3,','schemaVersion: 4,',1)
    if 'itemDictionary: buildItemDictionarySnapshot(localState)' not in s:
        s=replace_required(s,'      farmLocations: FARM_LOCATIONS,\n    };','      farmLocations: FARM_LOCATIONS,\n      itemDictionary: buildItemDictionarySnapshot(localState),\n    };','browser public state')

    if 'function renderDictionary()' not in s:
        ui=r'''let dictionaryCategory = "all";
let dictionarySort = "price-asc";

function formatDictionaryDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}
function dictionaryPriceText(entry) { return entry?.price == null ? "판매 불가" : money(entry.price); }
function renderDictionary() {
  const root = $("#dictionaryList"); if (!root) return;
  const all = Array.isArray(state?.itemDictionary) ? state.itemDictionary : [];
  const acquiredCount = all.filter((entry) => entry.acquired).length;
  const progress = $("#dictionaryProgress"); if (progress) progress.textContent = `${acquiredCount} / ${all.length}`;
  const phoneCount = $("#phoneDictionaryCount"); if (phoneCount) phoneCount.textContent = `${acquiredCount}/${all.length}`;
  let entries = dictionaryCategory === "all" ? [...all] : all.filter((entry) => entry.tier === dictionaryCategory);
  entries.sort((a,b) => {
    const ap=a.price==null?Number.POSITIVE_INFINITY:Number(a.price||0), bp=b.price==null?Number.POSITIVE_INFINITY:Number(b.price||0);
    if (a.price==null && b.price==null) return a.name.localeCompare(b.name,"ko");
