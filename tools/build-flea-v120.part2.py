        <div class="dictionary-toolbar"><div id="dictionaryCategories" class="dictionary-categories"><button class="active" type="button" data-dictionary-tier="all">전체</button><button type="button" data-dictionary-tier="worn">낡은 상자</button><button type="button" data-dictionary-tier="normal">평범한 상자</button><button type="button" data-dictionary-tier="fancy">고급진 상자</button><button type="button" data-dictionary-tier="premium">최고급 상자</button><button type="button" data-dictionary-tier="safe">금고</button></div><label class="dictionary-sort"><span>가격 정렬</span><select id="dictionarySort"><option value="price-asc">낮은 가격순</option><option value="price-desc">높은 가격순</option></select></label></div>
        <div id="dictionaryList" class="dictionary-grid"></div>
      </section>\n'''
        s=replace_required(s,marker,panel+marker,'dictionary panel')
    p.write_text(s,encoding='utf-8')


def patch_css(pkg: Path) -> None:
    p=pkg/'public/style.css'; s=p.read_text(encoding='utf-8')
    if 'v1.2.0 item-specific artwork' not in s:
        s += r'''

/* v1.2.0 item-specific artwork */
.item-art{width:100%;height:104px;display:grid;place-items:center;margin:-2px 0 8px;border:1px solid #2c394b;border-radius:13px;background:#f5f7f9;overflow:hidden;font-size:0}.inventory-item-image{width:100%;height:100%;object-fit:contain;display:block}.reward-item-image{width:min(300px,72vw);height:190px;margin:0 auto 12px;display:grid;place-items:center;border:1px solid #304057;border-radius:18px;background:#f6f7f8;overflow:hidden;font-size:0;filter:none!important}.reward-product-image{width:100%;height:100%;object-fit:contain;display:block}.item-image-fallback{font-size:64px;line-height:1}.bulk-result-icon-strip{display:flex;align-items:center;justify-content:center;gap:7px;min-height:82px;margin:0 auto 10px}.bulk-result-preview-image{width:72px;height:58px;object-fit:contain;border:1px solid #314359;border-radius:10px;background:#f6f7f8}.bulk-result-item-main{display:flex!important;align-items:center;gap:10px;min-width:0}.bulk-result-item-image{width:52px;height:40px;flex:0 0 auto;object-fit:contain;border:1px solid #314359;border-radius:8px;background:#f6f7f8}.bulk-result-item-main>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}@media(max-width:700px){.item-art{height:92px}.reward-item-image{height:160px}.bulk-result-preview-image{width:58px;height:48px}}
'''
    if 'v1.2.0 item dictionary' not in s:
        s += r'''

/* v1.2.0 item dictionary */
.dictionary-icon{background:linear-gradient(145deg,#4c7fe4,#26468d)}.dictionary-heading{align-items:center}.dictionary-progress{display:grid;gap:4px;min-width:120px;text-align:right}.dictionary-progress span{color:var(--muted);font-size:12px}.dictionary-progress strong{font-size:26px;color:#dff7ff}.dictionary-toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:0 0 16px}.dictionary-categories{display:flex;flex-wrap:wrap;gap:8px}.dictionary-categories button{border:1px solid #30435a;background:#111a27;color:#91a3b9;border-radius:999px;padding:9px 13px;font-size:12px;font-weight:850;cursor:pointer}.dictionary-categories button.active{border-color:#4ecfff;background:#173147;color:#eafaff;box-shadow:0 0 0 2px #43cdf217}.dictionary-sort{display:flex;align-items:center;gap:8px;color:#8fa1b7;font-size:12px;white-space:nowrap}.dictionary-sort select{border:1px solid #30435a;background:#101824;color:#eaf4ff;border-radius:10px;padding:9px 12px;font:inherit;font-weight:800}.dictionary-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.dictionary-card{display:grid;grid-template-columns:92px minmax(0,1fr);gap:13px;align-items:center;min-height:150px;padding:14px;border:1px solid #26364b;border-radius:17px;background:linear-gradient(155deg,#151e2c,#0f151f);overflow:hidden}.dictionary-card.unacquired{opacity:.58}.dictionary-card.unacquired .dictionary-product-image{filter:grayscale(.85) brightness(.72)}.dictionary-item-image{width:92px;height:92px;display:grid;place-items:center;border:1px solid #2a3b50;border-radius:14px;background:#0c121b;overflow:hidden}.dictionary-product-image{width:100%;height:100%;object-fit:contain;padding:5px}.dictionary-item-main{min-width:0}.dictionary-item-title{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.dictionary-item-title strong{font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dictionary-tier{flex:0 0 auto;padding:4px 6px;border-radius:7px;background:#233247;color:#aebfd4;font-size:9px;font-weight:900}.dictionary-price{margin-top:7px;font-size:15px;font-weight:900;color:#eff7ff}.dictionary-acquisition{display:inline-flex;margin-top:7px;padding:4px 7px;border-radius:999px;font-size:10px;font-weight:900}.dictionary-acquisition.owned{background:#1c573e;color:#8fffc2}.dictionary-acquisition.missing{background:#303843;color:#8e9aaa}.dictionary-card dl{display:grid;gap:4px;margin:9px 0 0}.dictionary-card dl div{display:flex;justify-content:space-between;gap:9px;font-size:10px}.dictionary-card dt{color:#71839a}.dictionary-card dd{margin:0;color:#c9d8e9;font-weight:800}.tier-worn{color:#d3b28e}.tier-normal{color:#b8d7e8}.tier-fancy{color:#7edfff}.tier-premium{color:#e8a7ff}.tier-safe{color:#ffe07d}@media(max-width:1000px){.dictionary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:700px){.dictionary-toolbar{align-items:stretch;flex-direction:column}.dictionary-sort{justify-content:space-between}.dictionary-grid{grid-template-columns:1fr}.dictionary-heading{align-items:flex-start}.dictionary-progress{text-align:left}.dictionary-card{grid-template-columns:80px minmax(0,1fr)}.dictionary-item-image{width:80px;height:80px}}
'''
    p.write_text(s,encoding='utf-8')


def patch_meta(pkg: Path) -> None:
    p=pkg/'package.json'; data=json.loads(p.read_text(encoding='utf-8')); data['version']=VERSION; data['description']='SD 플리마켓 PC 확장팩'; p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    p=pkg/'sd-app.json'; data=json.loads(p.read_text(encoding='utf-8')); data['version']=VERSION; data['displayVersion']='PC Expansion · v1.2.0'; data.pop('description',None); data.pop('improvement',None); p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    notes=pkg/'RELEASE_NOTES.txt'; notes.write_text('''SD 플리마켓 v1.2.0\n\n- 36종 아이템 고유 이미지 적용\n- 아이템 사전 추가: 상자별 카테고리, 획득 여부, 최초 획득 날짜, 누적 획득 개수, 가격 오름차/내림차\n- 기존 보유 아이템과 과거 획득 기록 소급 복원\n- 앱 첫 화면 설명/부가 설명 제거\n- v1.1.9 은행 금고 상자 보관함 개봉 흐름 유지\n''',encoding='utf-8')


def validate(pkg: Path) -> None:
    items=list((pkg/'public/assets/items').glob('*.png'))
    if len(items)!=36: raise RuntimeError(f'expected 36 images, got {len(items)}')
    app=(pkg/'public/app.js').read_text(encoding='utf-8'); html=(pkg/'public/index.html').read_text(encoding='utf-8')
    for token in ['ITEM_IMAGE_PATHS','ITEM_DICTIONARY_CATALOG','renderDictionary','dictionarySort','firstAcquiredAt','totalAcquired']:
        if token not in app: raise RuntimeError(f'missing app token {token}')
    for token in ['dictionaryPanel','phoneDictionaryCount','data-dictionary-tier="safe"']:
        if token not in html: raise RuntimeError(f'missing html token {token}')
    meta=json.loads((pkg/'sd-app.json').read_text(encoding='utf-8'))
    if meta.get('version')!=VERSION: raise RuntimeError('manifest version incorrect')
    if 'description' in meta or 'improvement' in meta: raise RuntimeError('sd-app descriptions still present')
    if shutil.which('node'):
        subprocess.run(['node','--check',str(pkg/'main.js')],check=True)
        subprocess.run(['node','--check',str(pkg/'public/app.js')],check=True)


def repack(pkg: Path) -> None:
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    if OUTPUT.exists(): OUTPUT.unlink()
    with zipfile.ZipFile(OUTPUT,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for path in sorted(pkg.rglob('*')):
            if path.is_file(): z.write(path,Path('sd-flea-market')/path.relative_to(pkg))
    import hashlib
    digest=hashlib.sha256(OUTPUT.read_bytes()).hexdigest()
    SHA.write_text(f'{digest}  {OUTPUT.name}\n',encoding='utf-8')


def main() -> None:
    if not SOURCE.is_file(): raise SystemExit(f'missing source {SOURCE}')
    if not SPRITE_B64.is_file() or not MANIFEST.is_file(): raise SystemExit('missing sprite inputs')
    with tempfile.TemporaryDirectory() as td:
        ext=Path(td)/'extract'; ext.mkdir()
        with zipfile.ZipFile(SOURCE) as z: z.extractall(ext)
        src=find_root(ext)
        pkg=Path(td)/'pkg'; shutil.copytree(src,pkg)
        install_images(pkg); patch_app(pkg); patch_main(pkg); patch_html(pkg); patch_css(pkg); patch_meta(pkg); validate(pkg); repack(pkg)
    print(f'built {OUTPUT} ({OUTPUT.stat().st_size} bytes)')

if __name__=='__main__': main()
