"use strict";
(()=>{
const C=`logistics|LOGISTICS|물류센터;flea|FLEA MARKET|플리마켓;miner|MINER|광부;mukjjippa|MUK-JJI-PPA|묵찌빠;slot|SLOT|슬롯;oddeven|ODD / EVEN|홀짝;bitcoin|BITCOIN|비트코인 채굴;sta|STA|STA;gold|GOLD|금 구매;npcvault|NPC VAULT|NPC 금고 따기;sdcoin|SD COIN|SD코인;wallet|WALLET|지갑;ranking|BANK BALANCE RANKING|통장 잔고 랭킹`.split(";").map(x=>{const[id,e,l]=x.split("|");return{id,e,l}});
const A=`logistics-01|logistics|해외 진출|해외 배달 완료|||회
logistics-02|logistics|지점장|S등급 달성|||
logistics-03|logistics|본부장|물류센터 5레벨 달성|p|5|레벨
logistics-04|logistics|C.E.O|물류센터 10레벨 달성|p|10|레벨
logistics-05|logistics|봉고르기니|스타터 차량 레벨 MAX|p|MAX|레벨
logistics-06|logistics|배송의 왕|수동 배송 누적 수익 1억원|p|100000000|원
logistics-07|logistics|배송의 황제|수동 배송 누적 수익 10억원|p|1000000000|원
logistics-08|logistics|배송의 신|수동 배송 누적 수익 100억원|p|10000000000|원
logistics-09|logistics|천리길도 한 걸음|첫 차량 구입 (스타터팩 차량 업그레이드 제외)|||
logistics-10|logistics|차고지|차량 5대 보유|p|5|대
logistics-11|logistics|운수재벌|차량 10대 보유|p|10|대
logistics-12|logistics|택배기사|배송 100회 완료|p|100|회
logistics-13|logistics|오늘도 배송중|배송 1,000회 완료|p|1000|회
logistics-14|logistics|글로벌 물류기업|해외 배송 100회 완료|p|100|회
logistics-15|logistics|베테랑 기사|수동 배송 100회 연속 성공|p|100|회
logistics-16|logistics|카 컬렉터|모든 차량 종류 한 번 이상 보유|p|ALL|종
flea-01|flea|바늘 도둑|은행 습격 1회 성공|p|1|회
flea-02|flea|비일비제|은행 습격 10회 성공|p|10|회
flea-03|flea|소 도둑|은행 습격 100회 성공|p|100|회
flea-04|flea|행운아|레드다이아 획득|||
flea-05|flea|40도|판매 누적 금액 1,000만원|p|10000000|원
flea-06|flea|70도|판매 누적 금액 1억원|p|100000000|원
flea-07|flea|99.9|판매 누적 금액 10억원|p|1000000000|원
flea-08|flea|라쿤|루팅한 상자 100개|p|100|개
flea-09|flea|심마니|루팅한 상자 500개|p|500|개
flea-10|flea|파밍왕|루팅한 상자 1,000개|p|1000|개
flea-11|flea|만물상|모든 종류의 물건 획득 (판매 여부 무관)|p|ALL|종
flea-12|flea|당근하세요?|첫 물건 판매|||
flea-13|flea|도매상|물건 1,000개 판매|p|1000|개
flea-14|flea|교도소 단골|은행 습격 실패 10회|p|10|회
flea-15|flea|득템|한 번의 루팅에서 최고 등급 아이템 획득|||
flea-16|flea|꽝|상자 하나에서 최저 등급 물건만 획득|||
flea-17|flea|사재기|동일 물건 100개 획득|p|100|개
flea-18|flea|폭주족|은행 습격 중 오토바이 최대 속도로 500m 이상 주행|p|500|m
flea-19|flea|되팔이|다른 사람이 판매한 물건 50회 구입|p|50|회
miner-01|miner|아오지 생존자|누적 광석 1,000개 캐기|p|1000|개
miner-02|miner|돌 곡괭이|누적 판매 금액 100만원|p|1000000|원
miner-03|miner|철 곡괭이|누적 판매 금액 500만원|p|5000000|원
miner-04|miner|다이아 곡괭이|누적 판매 금액 1,000만원|p|10000000|원
miner-05|miner|광산의 주인|광석 10,000개 캐기|p|10000|개
miner-06|miner|노다지|최고 등급 광석 첫 획득|||
miner-07|miner|금맥|한 번의 채굴에서 최고 등급 광석 연속 획득|||
miner-08|miner|지질학자|모든 종류의 광석 획득|p|ALL|종
miner-09|miner|광산재벌|광석 누적 판매 1억원|p|100000000|원
mukjjippa-01|mukjjippa|울버린|최대 연승 달성|p|MAX|연승
mukjjippa-02|mukjjippa|심리학자|올인으로 8연승 달성|p|8|연승
slot-01|slot|네잎클로버|777 당첨|||
slot-02|slot|이게 현실이라면|빨간 777 당첨|||
slot-03|slot|인생은 한방|황금색 777 당첨|||
slot-04|slot|레버 중독|슬롯 100회 돌리기|p|100|회
slot-05|slot|카지노 주민|슬롯 1,000회 돌리기|p|1000|회
slot-06|slot|오늘은 아닌가봐|아무 당첨 없이 50회 연속 실패|p|50|회
slot-07|slot|카지노의 왕|슬롯 누적 획득 금액 1억원|p|100000000|원
oddeven-01|oddeven|내가 뭐라고 했더라?|8연승 달성|p|8|연승
oddeven-02|oddeven|운칠기삼|올인으로 8연승 달성|p|8|연승
oddeven-03|oddeven|말이 안되는거잖아|8연패 달성|p|8|연패
oddeven-04|oddeven|반반의 확률|첫 승리|||
oddeven-05|oddeven|촉이 온다|100승 달성|p|100|승
oddeven-06|oddeven|확률을 지배하는 자|1,000승 달성|p|1000|승
oddeven-07|oddeven|거기서?|7연승 후 8번째 판 패배|||
oddeven-08|oddeven|전재산 삭제|올인 후 패배|||
oddeven-09|oddeven|홀릭|연속으로 홀만 선택해 5승|p|5|승
oddeven-10|oddeven|짝사랑|연속으로 짝만 선택해 5승|p|5|승
bitcoin-01|bitcoin|채굴 시작|비트코인 첫 획득|||
bitcoin-02|bitcoin|개미|비트코인 10개 보유|p|10|BTC
bitcoin-03|bitcoin|암호화폐의 거장|비트코인 100개 보유|p|100|BTC
bitcoin-04|bitcoin|사토시 나카모토|비트코인 1,000개 보유|p|1000|BTC
bitcoin-05|bitcoin|???|???|h||
sta-01|sta|바이커|오토바이 추돌 0번으로 클리어|||
sta-02|sta|기계손|한 번에 현금 100만원 획득|||
sta-03|sta|해커|해킹 준비 작업 100번 진행|p|100|회
gold-01|gold|금수저|보유 금 10개|p|10|개
gold-02|gold|리치맨|보유 금 100개|p|100|개
gold-03|gold|미다스|보유 금 1,000개|p|1000|개
npcvault-01|npcvault|좀도둑|일반 금고 따기 성공|||
npcvault-02|npcvault|열쇠공|대형 금고 따기 성공|||
npcvault-03|npcvault|보이지 않는 손|초대형 금고 따기 성공|||
npcvault-04|npcvault|빈집털이|금고 10개 따기|p|10|개
npcvault-05|npcvault|루팡|금고 100개 따기|p|100|개
npcvault-06|npcvault|오션스 일레븐|초대형 금고 10번 성공|p|10|회
npcvault-07|npcvault|마스터키|모든 종류의 금고 성공|p|ALL|종
npcvault-08|npcvault|손기술|금고 따기 연속 10회 성공|p|10|회
sdcoin-coin-01|sdcoin|DDJ|DDJ코인 10,000개 소유|p|10000|개
sdcoin-coin-02|sdcoin|HSH|HSH코인 10,000개 소유|p|10000|개
sdcoin-coin-03|sdcoin|SET|SET코인 10,000개 소유|p|10000|개
sdcoin-coin-04|sdcoin|HIZ|HIZ코인 10,000개 소유|p|10000|개
sdcoin-coin-05|sdcoin|KNG|KNG코인 10,000개 소유|p|10000|개
sdcoin-coin-06|sdcoin|SD|SD코인 10,000개 소유|p|10000|개
sdcoin-01|sdcoin|주린이|처음으로 코인 구매|||
sdcoin-02|sdcoin|분산투자|모든 SD코인 종목 한 번 이상 보유|p|6|종
sdcoin-03|sdcoin|대주주|한 종목 100,000개 소유|p|100000|개
wallet-01|wallet|텅장|잔액 0원 달성|||
wallet-02|wallet|첫 단추|잔액 1,000만원|p|10000000|원
wallet-03|wallet|억소리|잔액 1억원|p|100000000|원
wallet-04|wallet|중산층|잔액 10억원|p|1000000000|원
wallet-05|wallet|대부|잔액 100억원|p|10000000000|원
wallet-06|wallet|억만장자|잔액 1,000억원|p|100000000000|원
wallet-07|wallet|조만장자|잔액 1조원|p|1000000000000|원
ranking-01|ranking|전설|시즌 0 통장 잔고 랭킹 1위|||`.trim().split("\n").map(x=>{const[id,c,n,d,f,t,u]=x.split("|");return{id,c,n,d,h:f.includes("h"),p:f.includes("p"),t:/^\d+$/.test(t)?Number(t):t,u}});
window.SD_ACHIEVEMENTS=A;
window.SD_ACHIEVEMENT_PROGRESS=window.SD_ACHIEVEMENT_PROGRESS||{};
window.SD_ACHIEVEMENT_UNLOCKED=window.SD_ACHIEVEMENT_UNLOCKED||{};
const N=v=>Number(v||0).toLocaleString("ko-KR"),V=(v,u)=>typeof v==="number"?N(v)+(u||""):v;
const done=a=>Boolean(window.SD_ACHIEVEMENT_UNLOCKED[a.id])||(a.p&&typeof a.t==="number"&&Number(window.SD_ACHIEVEMENT_PROGRESS[a.id]||0)>=a.t);
const card=a=>{
  const complete=done(a),hidden=a.h&&!complete;
  if(hidden)return`<article class="achievement-card hidden-achievement"><div class="achievement-top"><div class="achievement-icon">❔</div><span class="achievement-badge hidden-badge">HIDDEN</span></div><h3 class="achievement-name">???</h3><div class="achievement-condition"><small>달성 방법</small><strong>???</strong></div></article>`;
  let p="";
  if(a.p){const cur=Number(window.SD_ACHIEVEMENT_PROGRESS[a.id]||0),pct=typeof a.t==="number"&&a.t>0?Math.max(0,Math.min(100,cur/a.t*100)):(complete?100:0);p=`<div class="achievement-progress"><div class="achievement-progress-head"><span>진행도</span><strong>${pct.toFixed(pct>=10?0:1)}%</strong></div><div class="achievement-progress-track"><div class="achievement-progress-fill" style="width:${pct}%"></div></div><div class="achievement-progress-detail"><span>${N(cur)}${a.u||""}</span><span>목표 ${V(a.t,a.u)}</span></div></div>`}
  return`<article class="achievement-card${complete?" complete":""}"><div class="achievement-top"><div class="achievement-icon">${complete?"✅":"🏆"}</div><span class="achievement-badge">${complete?"달성":a.p?"진행형":"특수 조건"}</span></div><h3 class="achievement-name">${a.n}</h3><div class="achievement-condition"><small>달성 조건</small><strong>${a.d}</strong></div>${p}</article>`
};
const render=()=>{
  const tabs=document.querySelector(".achievement-tabs"),wrap=document.querySelector(".achievement-tabs-wrap"),main=document.querySelector(".achievements-page");if(!tabs||!wrap||!main)return;
  const previous=tabs.querySelector(".achievement-tab.active")?.dataset.achievementTab||"logistics";
  const count=document.querySelector(".achievement-count"),completed=A.filter(done).length;
  if(count)count.textContent=`등록 업적 ${A.length}개 · 달성 ${completed}개`;
  const intro=document.querySelector(".achievements-head p");if(intro)intro.textContent="모든 확장팩의 업적 진행도는 SD Online 계정 기준으로 동기화됩니다. PC에서는 SD Link가 확장팩 기록을 올리고, 홈페이지·모바일에서 같은 계정의 진행도를 읽습니다. 히든 업적은 달성 전까지 이름과 달성 방법이 가려집니다.";
  tabs.innerHTML="";main.querySelectorAll("[data-achievement-panel],.achievement-placeholder").forEach(x=>x.remove());
  C.forEach((c,i)=>{const arr=A.filter(a=>a.c===c.id),active=c.id===previous||(i===0&&!C.some(x=>x.id===previous)),b=document.createElement("button");b.type="button";b.className="achievement-tab"+(active?" active":"");b.dataset.achievementTab=c.id;b.textContent=`${c.l} (${arr.length})`;tabs.append(b);const s=document.createElement("section");s.className="achievement-panel"+(active?" active":"");s.dataset.achievementPanel=c.id;s.innerHTML=`<div class="achievement-category-title"><div><span>${c.e}</span><h2>${c.l}</h2></div><span class="achievement-category-meta">${arr.filter(done).length}/${arr.length} 달성</span></div><div class="achievement-grid">${arr.map(card).join("")}</div>`;main.append(s)});
  const note=document.createElement("div");note.className="achievement-placeholder";note.textContent=window.SD_ACHIEVEMENT_SYNC?"SD Link · 홈페이지 · 모바일 공통 계정 동기화 사용 중입니다. 새 기록은 계정 업적 저장소에 누적되며 달성 기록은 되돌아가지 않습니다.":"업적 동기화 모듈을 불러오는 중입니다.";main.append(note);
  tabs.onclick=e=>{const b=e.target.closest("[data-achievement-tab]");if(!b)return;tabs.querySelectorAll(".achievement-tab").forEach(x=>x.classList.toggle("active",x===b));main.querySelectorAll("[data-achievement-panel]").forEach(x=>x.classList.toggle("active",x.dataset.achievementPanel===b.dataset.achievementTab))};
};
document.readyState==="loading"?document.addEventListener("DOMContentLoaded",render):render();
window.addEventListener("sd-achievements-updated",render);
})();
