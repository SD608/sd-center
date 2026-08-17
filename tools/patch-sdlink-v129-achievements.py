from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

ROOT=Path.cwd()
SOURCE=ROOT/'downloads/extensions/SDLink_v1.2.8_Desktop.zip'
OUTPUT=ROOT/'downloads/extensions/SDLink_v1.2.9_Desktop.zip'
CATALOG=ROOT/'update/extensions-catalog.json'
EXT_DATA=[ROOT/'extensions-data.js',ROOT/'assets/js/extensions-data.js']
VERSION='1.2.9'
TAG='129'
MARKER='SDLINK_ACHIEVEMENT_BRIDGE_V129'

ACHIEVEMENT_READER=r'''"use strict";

// SDLINK_ACHIEVEMENT_BRIDGE_V129
// PC 확장팩들이 공용 sdwallet.sqlite에 남긴 실제 상태/거래 기록을 읽어서
// 홈페이지 계정의 공용 업적 저장소로 올립니다. 값이 확인되지 않는 특수 조건은
// 추정해서 해금하지 않습니다.
const { DatabaseSync } = require("node:sqlite");

function openDb(filePath) {
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=900;");
  return db;
}
function tableNames(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r)=>String(r.name)));
}
function columns(db, table) {
  try { return db.prepare(`PRAGMA table_info(${JSON.stringify(String(table))})`).all().map((r)=>String(r.name)); }
  catch { return []; }
}
function safeOne(db, sql, ...args) { try { return db.prepare(sql).get(...args) || null; } catch { return null; } }
function safeAll(db, sql, ...args) { try { return db.prepare(sql).all(...args) || []; } catch { return []; } }
function n(value) { const x=Number(value); return Number.isFinite(x)?x:0; }
function item(id,value=0,unlocked=false,metadata={}) { return { achievement_id:id,current_value:Math.max(0,n(value)),unlocked:Boolean(unlocked),metadata }; }
function threshold(id,value,target,metadata={}) { const v=Math.max(0,n(value)); return item(id,v,v>=target,metadata); }
function textIncludes(text, words) { const s=String(text||"").toLowerCase(); return words.some((w)=>s.includes(String(w).toLowerCase())); }
function pickNumeric(row, names) {
  if(!row)return 0;
  for(const name of names){ if(Object.prototype.hasOwnProperty.call(row,name) && Number.isFinite(Number(row[name]))) return Number(row[name]); }
  return 0;
}
function positiveColumnCount(row, ignored=[]) {
  const ignore=new Set(ignored);
  return Object.entries(row||{}).filter(([k,v])=>!ignore.has(k)&&typeof v==="number"&&v>0).length;
}
function transactionStats(db, accountId) {
  const rows=safeAll(db,`SELECT transaction_type,amount,memo,created_at FROM transactions WHERE account_id=? ORDER BY created_at ASC,rowid ASC`,String(accountId));
  const by=(words)=>rows.filter((r)=>textIncludes(r.memo,words));
  const deposits=(list)=>list.filter((r)=>String(r.transaction_type)==="deposit").reduce((s,r)=>s+Math.abs(n(r.amount)),0);
  return { rows, by, deposits };
}

function readAchievementProgress({ databasePath, accountId, bitcoinQuantity=null }) {
  const db=openDb(databasePath);
  try {
    const tables=tableNames(db), out=[], account=safeOne(db,"SELECT balance FROM accounts WHERE id=?",String(accountId));
    const balance=Math.max(0,n(account?.balance));
    const tx=transactionStats(db,accountId);

    // SD지갑
    out.push(item("wallet-01",balance===0?1:0,balance===0,{balance}));
    [["wallet-02",1e7],["wallet-03",1e8],["wallet-04",1e9],["wallet-05",1e10],["wallet-06",1e11],["wallet-07",1e12]].forEach(([id,t])=>out.push(threshold(id,balance,t,{balance})));

    // 비트코인 채굴장
    let btc=bitcoinQuantity==null?0:Math.max(0,n(bitcoinQuantity));
    let btcStats=null;
    if(tables.has("bitcoin_account_stats")){
      btcStats=safeOne(db,"SELECT * FROM bitcoin_account_stats WHERE account_id=?",String(accountId));
      btc=Math.max(btc,pickNumeric(btcStats,["btc_balance","bitcoin_balance","quantity"]));
    }
    let minedBtc=0;
    if(tables.has("bitcoin_rooms")) minedBtc=n(safeOne(db,"SELECT COALESCE(SUM(mined_btc),0) AS v FROM bitcoin_rooms WHERE account_id=?",String(accountId))?.v);
    out.push(item("bitcoin-01",Math.max(btc,minedBtc),btc>0||minedBtc>0,{btc,minedBtc}));
    out.push(threshold("bitcoin-02",btc,10,{btc}),threshold("bitcoin-03",btc,100,{btc}),threshold("bitcoin-04",btc,1000,{btc}));

    // 광부
    if(tables.has("mining_inventory")){
      const inv=safeOne(db,"SELECT * FROM mining_inventory WHERE account_id=?",String(accountId));
      const totalMined=Math.max(0,pickNumeric(inv,["total_mined","total_ores_mined","mined_total"]));
      const oreCount=positiveColumnCount(inv,["account_id","total_mined","created_at","updated_at"]);
      out.push(threshold("miner-01",totalMined,1000,{totalMined}),threshold("miner-05",totalMined,10000,{totalMined}));
      if(oreCount>0) out.push(item("miner-08",oreCount,false,{oreKindsOwned:oreCount}));
    }
    if(tables.has("mining_history")){
      const minedRows=safeOne(db,"SELECT COUNT(*) AS c FROM mining_history WHERE account_id=? AND action_type='mine'",String(accountId));
      const highest=safeOne(db,"SELECT ore_type FROM mining_history WHERE account_id=? AND action_type='mine' ORDER BY rowid DESC LIMIT 1",String(accountId));
      // 최고등급 광석 이름은 버전별로 달라질 수 있으므로 흔한 최상위 키만 확정 판정합니다.
      const high=String(highest?.ore_type||"").toLowerCase();
      if(["diamond","legendary","mythic","special","red_diamond"].includes(high)) out.push(item("miner-06",1,true,{oreType:high}));
      if(n(minedRows?.c)>0 && !out.some((x)=>x.achievement_id==="miner-01")) out.push(item("miner-01",n(minedRows.c),false,{mineEvents:n(minedRows.c)}));
    }
    const minerSales=tx.deposits(tx.by(["SD광부","광물","광석","채굴 판매"]));
    if(minerSales>0){ out.push(threshold("miner-02",minerSales,1e6,{sales:minerSales}),threshold("miner-03",minerSales,5e6,{sales:minerSales}),threshold("miner-04",minerSales,1e7,{sales:minerSales}),threshold("miner-09",minerSales,1e8,{sales:minerSales})); }

    // 묵찌빠
    if(tables.has("sd_mukjippa_sessions")){
      const s=safeOne(db,"SELECT COALESCE(MAX(streak),0) AS max_streak, COUNT(*) AS games FROM sd_mukjippa_sessions WHERE account_id=?",String(accountId));
      const maxStreak=Math.max(0,n(s?.max_streak));
      out.push(item("mukjjippa-01",maxStreak,maxStreak>=8,{maxStreak,games:n(s?.games)}));
      // all-in 여부를 DB가 명시하지 않으므로 mukjjippa-02는 여기서 추정하지 않음.
    }

    // 슬롯
    if(tables.has("sd_slot_rounds")){
      const spins=n(safeOne(db,"SELECT COUNT(*) AS c FROM sd_slot_rounds WHERE account_id=?",String(accountId))?.c);
      out.push(threshold("slot-04",spins,100,{spins}),threshold("slot-05",spins,1000,{spins}));
      const roundCols=new Set(columns(db,"sd_slot_rounds"));
      if(roundCols.has("result_key")){
        const results=safeAll(db,"SELECT result_key, COUNT(*) AS c FROM sd_slot_rounds WHERE account_id=? GROUP BY result_key",String(accountId));
        for(const r of results){
          const key=String(r.result_key||"").toLowerCase();
          if(textIncludes(key,["red777","red-777","red_777"])) out.push(item("slot-02",n(r.c),true,{resultKey:key}));
          else if(textIncludes(key,["gold777","gold-777","gold_777","golden777"])) out.push(item("slot-03",n(r.c),true,{resultKey:key}));
          else if(/(^|[^0-9])777([^0-9]|$)/.test(key)) out.push(item("slot-01",n(r.c),true,{resultKey:key}));
        }
      }
      const slotIncome=tx.deposits(tx.by(["SD슬롯"]));
      if(slotIncome>0) out.push(threshold("slot-07",slotIncome,1e8,{slotIncome}));
    }

    // 홀짝: 구버전은 별도 상태 테이블이 없어 거래 기록에서 확정 가능한 항목만 처리.
    const oddRows=tx.by(["홀짝"]);
    if(oddRows.length){
      const winDeposits=oddRows.filter((r)=>String(r.transaction_type)==="deposit");
      if(winDeposits.length) out.push(item("oddeven-04",winDeposits.length,true,{winsObserved:winDeposits.length}));
      out.push(threshold("oddeven-05",winDeposits.length,100,{winsObserved:winDeposits.length}),threshold("oddeven-06",winDeposits.length,1000,{winsObserved:winDeposits.length}));
    }

    // STA
    if(tables.has("sta_operations")){
      const ops=safeAll(db,"SELECT * FROM sta_operations WHERE account_id=?",String(accountId));
      const hacking=ops.filter((r)=>textIncludes(JSON.stringify(r),["hack","해킹"])).length;
      if(hacking) out.push(threshold("sta-03",hacking,100,{hackingPreparations:hacking}));
      const million=ops.some((r)=>Object.entries(r).some(([k,v])=>/cash|reward|amount/i.test(k)&&n(v)>=1e6));
      if(million) out.push(item("sta-02",1,true,{}));
      const cleanRide=ops.some((r)=>Object.entries(r).some(([k,v])=>/collision|crash/i.test(k)&&n(v)===0));
      if(cleanRide) out.push(item("sta-01",1,true,{}));
    }

    // 금고/금 구매: PC 금고가 거래 메모만 남기는 버전에서도 구매/보유량 관련 기록을 잃지 않게 보조.
    const vaultRows=tx.by(["SD금고","금고","금괴","금 구매"]);
    const goldBuys=vaultRows.filter((r)=>String(r.transaction_type)==="withdraw").length;
    if(goldBuys>0) out.push(item("gold-01",goldBuys,false,{purchaseEvents:goldBuys}));

    // 중복 ID는 가장 큰 진행도/true 해금으로 병합.
    const merged=new Map();
    for(const x of out){
      const prev=merged.get(x.achievement_id);
      if(!prev){merged.set(x.achievement_id,x);continue;}
      prev.current_value=Math.max(n(prev.current_value),n(x.current_value));
      prev.unlocked=Boolean(prev.unlocked||x.unlocked);
      prev.metadata={...(prev.metadata||{}),...(x.metadata||{})};
    }
    return [...merged.values()];
  } finally { db.close(); }
}

module.exports={ readAchievementProgress };
'''


def replace_once(text,old,new,label):
    if new in text:return text
    if old not in text:raise RuntimeError(f'missing {label}')
    return text.replace(old,new,1)


def patch_package(root:Path):
    sync=next(iter(sorted(root.rglob('src/sync-engine.js'),key=lambda p:len(p.parts))),None)
    if not sync:raise RuntimeError('sync-engine missing')
    reader=sync.parent/'achievement-reader.js'
    reader.write_text(ACHIEVEMENT_READER,encoding='utf-8')
    text=sync.read_text(encoding='utf-8')
    text=replace_once(text,'const { readBitcoinSnapshot } = require("./bitcoin-reader");','const { readBitcoinSnapshot } = require("./bitcoin-reader");\nconst { readAchievementProgress } = require("./achievement-reader");','reader require')
    marker='  async syncBitcoinSnapshot(config) {'
    method=r'''  async syncAchievementProgress(config, bitcoinResult) {
    try {
      const items = readAchievementProgress({
        databasePath: config.databasePath,
        accountId: config.selectedAccountId,
        bitcoinQuantity: bitcoinResult?.found ? bitcoinResult.quantity : null,
      });
      if (!items.length) return { synced: false, count: 0 };
      const rows = await this.auth.rpc("sync_sd_achievement_progress", {
        p_items: items,
        p_source_app: "sdlink-desktop",
      });
      return { synced: true, count: items.length, rows: Array.isArray(rows) ? rows.length : 0 };
    } catch (error) {
      // 업적 서버 SQL이 아직 적용되지 않았거나 개별 확장팩 DB가 잠겨도
      // 지갑 본 동기화는 절대 실패시키지 않습니다.
      return { synced: false, count: 0, error: String(error?.message || error) };
    }
  }

'''+marker
    text=replace_once(text,marker,method,'achievement method')
    text=replace_once(text,'      const bitcoinResult = await this.syncBitcoinSnapshot(config);','      const bitcoinResult = await this.syncBitcoinSnapshot(config);\n      const achievementResult = await this.syncAchievementProgress(config, bitcoinResult);','sync call')
    text=replace_once(text,'          ? " / BTC 동기화 건너뜀"\n          : " / BTC 원본 미감지";','          ? " / BTC 동기화 건너뜀"\n          : " / BTC 원본 미감지";\n      const achievementText = achievementResult.synced\n        ? ` / 업적 ${achievementResult.count}항목 동기화`\n        : achievementResult.error\n          ? " / 업적 동기화 대기"\n          : "";','message vars')
    text=text.replace('${rejectedText}${bitcoinText}`;','${rejectedText}${bitcoinText}${achievementText}`;',1)
    if MARKER not in reader.read_text(encoding='utf-8'):raise RuntimeError('marker missing')
    sync.write_text(text,encoding='utf-8')

    for p in root.rglob('package.json'):
        if 'node_modules' in [x.lower() for x in p.parts]:continue
        try:data=json.loads(p.read_text(encoding='utf-8'))
        except:continue
        if data.get('name')=='sdlink-desktop':
            data['version']=VERSION
            check=str(data.get('scripts',{}).get('check',''))
            if 'src/achievement-reader.js' not in check:data.setdefault('scripts',{})['check']=check+' && node --check src/achievement-reader.js'
            p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    for p in root.rglob('sd-app.json'):
        try:data=json.loads(p.read_text(encoding='utf-8'))
        except:continue
        if 'link' in str(data.get('id','')).lower() or 'SD Link' in str(data.get('name','')):
            data['version']=VERSION;data['displayVersion']=f'PC Expansion · v{VERSION}';data['improvement']='모든 PC 확장팩의 공용 지갑 DB 기록을 읽어 홈페이지 계정 업적으로 누적 동기화하는 중앙 브리지를 추가했습니다.'
            p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


def build_zip():
    with tempfile.TemporaryDirectory(prefix='sdlink-v129-') as td:
        root=Path(td)
        with zipfile.ZipFile(SOURCE) as z:z.extractall(root)
        patch_package(root)
        if shutil.which('node'):
            reader=next(root.rglob('src/achievement-reader.js'));sync=next(root.rglob('src/sync-engine.js'))
            subprocess.run(['node','--check',str(reader)],check=True);subprocess.run(['node','--check',str(sync)],check=True)
        if OUTPUT.exists():OUTPUT.unlink()
        with zipfile.ZipFile(OUTPUT,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
            for p in sorted(root.rglob('*')):
                if p.is_file():z.write(p,p.relative_to(root).as_posix())
    with zipfile.ZipFile(OUTPUT) as z:
        r=next(n for n in z.namelist() if n.endswith('src/achievement-reader.js'))
        s=next(n for n in z.namelist() if n.endswith('src/sync-engine.js'))
        assert MARKER in z.read(r).decode('utf-8')
        assert 'syncAchievementProgress' in z.read(s).decode('utf-8')


def patch_catalog():
    data=json.loads(CATALOG.read_text(encoding='utf-8'));data['catalogVersion']=int(data.get('catalogVersion',0))+1;data['updatedAt']='2026-08-18T00:55:00+09:00'
    app=data['apps']['sdlink-desktop'];app['version']=VERSION;app['downloadUrl']=f'https://sd608.github.io/sd-center/downloads/extensions/{OUTPUT.name}?v={TAG}';app['notes']='PC 확장팩의 공용 sdwallet.sqlite 상태·거래 기록을 읽어 SD Online 계정의 업적 진행도로 누적 동기화합니다. 업적 서버가 일시적으로 없어도 기존 지갑 동기화는 계속 동작합니다.'
    CATALOG.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


def patch_extension_data(path:Path):
    text=path.read_text(encoding='utf-8');idx=text.find('"id": "sd-link"')
    if idx<0:idx=text.find('"id": "sdlink"')
    if idx<0:return
    a=text.rfind('  {',0,idx);b=text.find('\n  }',idx)
    if a<0 or b<0:return
    b+=4;block=text[a:b]
    block=re.sub(r'"version": "v[^"]+"',f'"version": "v{VERSION}"',block,count=1)
    block=re.sub(r'"fileName": "[^"]+"',f'"fileName": "{OUTPUT.name}"',block,count=1)
    block=re.sub(r'"downloadUrl": "[^"]+"',f'"downloadUrl": "downloads/extensions/{OUTPUT.name}?v={TAG}"',block,count=1)
    block=re.sub(r'"updatedAt": "[^"]+"','"updatedAt": "2026-08-18"',block,count=1)
    path.write_text(text[:a]+block+text[b:],encoding='utf-8')

if __name__=='__main__':
    build_zip();patch_catalog()
    for p in EXT_DATA:patch_extension_data(p)
    print(OUTPUT,OUTPUT.stat().st_size)
