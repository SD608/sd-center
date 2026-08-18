    if (a.price==null) return 1; if (b.price==null) return -1;
    return dictionarySort === "price-desc" ? bp-ap : ap-bp;
  });
  $$("[data-dictionary-tier]").forEach((button)=>button.classList.toggle("active",button.dataset.dictionaryTier===dictionaryCategory));
  const sort=$("#dictionarySort"); if (sort && sort.value!==dictionarySort) sort.value=dictionarySort;
  root.innerHTML=entries.map((entry)=>`<article class="dictionary-card ${entry.acquired?"acquired":"unacquired"}"><div class="dictionary-item-image">${itemImageHtml(entry.name,"dictionary-product-image")}</div><div class="dictionary-item-main"><div class="dictionary-item-title"><strong>${entry.name}</strong><span class="dictionary-tier tier-${entry.tier}">${entry.tierName}</span></div><div class="dictionary-price">${dictionaryPriceText(entry)}</div><div class="dictionary-acquisition ${entry.acquired?"owned":"missing"}">${entry.acquired?"획득 완료":"미획득"}</div><dl><div><dt>최초 획득</dt><dd>${formatDictionaryDate(entry.firstAcquiredAt)}</dd></div><div><dt>누적 획득</dt><dd>${Number(entry.totalAcquired||0).toLocaleString("ko-KR")}개</dd></div></dl></div></article>`).join("");
}

'''
        marker='function render() {'
        if marker not in s: raise RuntimeError('render marker missing')
        s=s.replace(marker,ui+marker,1)

    if '  renderDictionary();' not in s:
        s=replace_required(s,'  renderItems();\n}','  renderItems();\n  renderDictionary();\n}','render dictionary')
    s=s.replace('const titles = { mission: "이동하기", boxes: "상자 보관함", shop: "상점", items: "물건 보관함" };','const titles = { mission: "이동하기", boxes: "상자 보관함", shop: "상점", items: "물건 보관함", dictionary: "아이템 사전" };',1)

    reps=[
      ('<div class="reward-icon">🎁</div>\n      <p class="eyebrow">REVEAL</p>','<div class="reward-icon reward-item-image">${itemImageHtml(item, "reward-product-image")}</div>\n      <p class="eyebrow">REVEAL</p>','bulk reveal'),
      ('<div class="reward-icon">🎁</div>\n      <p class="eyebrow">OPEN RESULT</p>','<div class="bulk-result-icon-strip">${sortedItems.slice(0, 5).map((item) => itemImageHtml(item, "bulk-result-preview-image")).join("")}</div>\n      <p class="eyebrow">OPEN RESULT</p>','bulk summary'),
      ('<div class="bulk-reward-list">${sortedItems.map((item, index) => `<div><span><b class="result-rank">#${index + 1}</b> ${item.name}</span><strong>${money(item.originalValue)}</strong></div>`).join("")}</div>','<div class="bulk-reward-list">${sortedItems.map((item, index) => `<div><span class="bulk-result-item-main">${itemImageHtml(item, "bulk-result-item-image")}<span><b class="result-rank">#${index + 1}</b> ${item.name}</span></span><strong>${money(item.originalValue)}</strong></div>`).join("")}</div>','bulk list'),
      ('<article class="item-card"><div class="box-art">🎁</div><h3>${item.name}</h3>','<article class="item-card"><div class="box-art item-art">${itemImageHtml(item, "inventory-item-image")}</div><h3>${item.name}</h3>','inventory icon'),
      ('<div class="reward-icon">💎</div>\n        <p class="eyebrow">BANK SAFE OPEN</p>','<div class="reward-icon reward-item-image">${itemImageHtml(item, "reward-product-image")}</div>\n        <p class="eyebrow">BANK SAFE OPEN</p>','safe result'),
      ('<div class="reward-icon">🎁</div><p class="eyebrow">ITEM FOUND</p>','<div class="reward-icon reward-item-image">${itemImageHtml(item, "reward-product-image")}</div><p class="eyebrow">ITEM FOUND</p>','single reveal'),
    ]
    for old,new,label in reps:
        if new not in s:
            if old not in s: raise RuntimeError(f'missing item render target: {label}')
            s=s.replace(old,new,1)

    if 'dictionaryCategories")?.addEventListener' not in s:
        bind=r'''  $("#dictionaryCategories")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-dictionary-tier]"); if (!button) return;
    dictionaryCategory = button.dataset.dictionaryTier || "all"; renderDictionary();
  });
  $("#dictionarySort")?.addEventListener("change", (event) => {
    dictionarySort = event.target.value === "price-desc" ? "price-desc" : "price-asc"; renderDictionary();
  });
'''
        marker='  $("#devReset").addEventListener("click", async () => {'
        if marker not in s: raise RuntimeError('devReset binding marker missing')
        s=s.replace(marker,bind+marker,1)

    p.write_text(s,encoding='utf-8')


def patch_main(pkg: Path) -> None:
    p=pkg/'main.js'; s=p.read_text(encoding='utf-8').replace('\r\n','\n')
    s=s.replace('schemaVersion: 3,','schemaVersion: 4,',1)
    if 'function itemDictionaryCatalog()' not in s:
        marker='const RED_DIAMOND_CHANCE_DENOMINATOR = 100000;\n'
        helper=r'''
function itemDictionaryCatalog() {
  const tierNames = Object.fromEntries(BOX_TIERS.map((tier) => [tier.id, tier.name]));
  const rows = [];
  for (const tierId of ["worn", "normal", "fancy", "premium"]) {
    const pool = ITEMS[tierId] || [], chance = pool.length ? 100 / pool.length : 0;
    for (const [name, price] of pool) rows.push({ name, price, tier: tierId, tierName: tierNames[tierId], dropChance: chance });
  }
  rows.push({ name: RED_DIAMOND_NAME, price: null, tier: "safe", tierName: tierNames.safe, dropChance: 100 / RED_DIAMOND_CHANCE_DENOMINATOR, limitedEdition: true });
  for (const [name, price, weight] of ITEMS.safe) rows.push({ name, price, tier: "safe", tierName: tierNames.safe, dropChance: (1 - 1 / RED_DIAMOND_CHANCE_DENOMINATOR) * Number(weight || 0) });
  return rows;
}
function itemDictionarySnapshot() {
  const catalog=itemDictionaryCatalog(), stats=new Map(catalog.map((entry)=>[entry.name,{historyCount:0,currentCount:0,firstAt:0}]));
  for (const record of Array.isArray(state?.history)?state.history:[]) {
    const text=String(record?.text||""); if (!text.includes("획득")) continue; const at=Number(record?.at||0);
    for (const entry of catalog) { if (!text.includes(`${entry.name} 획득`)) continue; const stat=stats.get(entry.name); stat.historyCount+=1; if(at>0&&(!stat.firstAt||at<stat.firstAt)) stat.firstAt=at; break; }
  }
  for (const item of Array.isArray(state?.items)?state.items:[]) { const stat=stats.get(String(item?.name||"")); if(!stat) continue; stat.currentCount+=1; const at=Date.parse(item?.acquiredAt||""); if(Number.isFinite(at)&&at>0&&(!stat.firstAt||at<stat.firstAt)) stat.firstAt=at; }
  return catalog.map((entry)=>{ const stat=stats.get(entry.name), totalAcquired=Math.max(Number(stat?.historyCount||0),Number(stat?.currentCount||0)); return {...entry,acquired:totalAcquired>0,firstAcquiredAt:stat?.firstAt?new Date(stat.firstAt).toISOString():null,totalAcquired}; });
}

'''
        if marker not in s: raise RuntimeError('red diamond marker missing')
        s=s.replace(marker,marker+helper,1)
    if 'itemDictionary: itemDictionarySnapshot()' not in s:
        s=replace_required(s,'    farmLocations: FARM_LOCATIONS,\n  };','    farmLocations: FARM_LOCATIONS,\n    itemDictionary: itemDictionarySnapshot(),\n  };','main public state')
    p.write_text(s,encoding='utf-8')


def patch_html(pkg: Path) -> None:
    p=pkg/'public/index.html'; s=p.read_text(encoding='utf-8')
    s=s.replace('<div class="phone-title"><small>SD COMPANY DEVICE</small><h1>플리마켓</h1><p>업무용 휴대폰</p></div>','<div class="phone-title"><small>SD COMPANY DEVICE</small><h1>플리마켓</h1></div>')
    s=s.replace('<button class="phone-app" data-app="mission"><span class="phone-app-icon travel-icon">➜</span><strong>이동하기</strong><small>파밍지 선택</small></button>','<button class="phone-app" data-app="mission"><span class="phone-app-icon travel-icon">➜</span><strong>이동하기</strong></button>')
    s=s.replace('<button class="phone-app" data-app="shop"><span class="phone-app-icon shop-icon">₩</span><strong>상점</strong><small>장비 구매</small></button>','<button class="phone-app" data-app="shop"><span class="phone-app-icon shop-icon">₩</span><strong>상점</strong></button>')
    if 'data-app="dictionary"' not in s:
        needle='<button class="phone-app" data-app="items"><span class="phone-app-icon item-icon">◆</span><strong>물건 보관함</strong><small><b id="phoneItemCount">0</b>개 보관</small></button>'
        s=replace_required(s,needle,needle+'\n        <button class="phone-app" data-app="dictionary"><span class="phone-app-icon dictionary-icon">▦</span><strong>아이템 사전</strong><small><b id="phoneDictionaryCount">0/36</b> 획득</small></button>','dictionary app button')
    if 'id="dictionaryPanel"' not in s:
        marker='    </main>\n  </section>'
        panel='''      <section id="dictionaryPanel" class="panel">
        <div class="panel-heading dictionary-heading"><div><p class="eyebrow">ITEM DICTIONARY</p><h1>아이템 사전</h1></div><div class="dictionary-progress"><span>획득 종류</span><strong id="dictionaryProgress">0 / 36</strong></div></div>
