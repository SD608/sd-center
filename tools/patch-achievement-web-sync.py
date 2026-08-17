from pathlib import Path

ROOT = Path.cwd()
HTML = ROOT / "achievements.html"
JS = ROOT / "assets/js/achievements-all.js"

SCRIPT_MARKER = '<script defer src="assets/js/auth-nav.js?v=20260817-achievements"></script>'
SCRIPT_BLOCK = SCRIPT_MARKER + '\n<script defer src="assets/js/achievement-sync.js?v=20260818"></script>\n<script defer src="assets/js/achievements-all.js?v=20260818-sync"></script>'

TAIL_MARKER = 'window.SD_ACHIEVEMENTS=A;window.SD_ACHIEVEMENT_PROGRESS=window.SD_ACHIEVEMENT_PROGRESS||{};'
NEW_TAIL = r'''window.SD_ACHIEVEMENTS=A;
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
})();'''


def patch_html():
    text = HTML.read_text(encoding="utf-8")
    if 'assets/js/achievement-sync.js' not in text:
        if SCRIPT_MARKER not in text:
            raise RuntimeError("achievements auth-nav marker missing")
        text = text.replace(SCRIPT_MARKER, SCRIPT_BLOCK, 1)
    HTML.write_text(text, encoding="utf-8")


def patch_js():
    text = JS.read_text(encoding="utf-8")
    idx = text.find(TAIL_MARKER)
    if idx < 0:
        if 'window.SD_ACHIEVEMENT_UNLOCKED' in text and 'sd-achievements-updated' in text:
            return
        raise RuntimeError("achievements-all tail marker missing")
    JS.write_text(text[:idx] + NEW_TAIL + "\n", encoding="utf-8")


if __name__ == "__main__":
    patch_html()
    patch_js()
    print("achievement web sync patched")
