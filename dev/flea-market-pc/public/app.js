"use strict";

const api = window.flea;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const money = (value) => `₩${Number(value || 0).toLocaleString("ko-KR")}`;

let state = null;
let player = { x: 50, y: 48, speed: 0.065 };
let keys = new Set();
let lastFrame = performance.now();
let missionSearchBusy = false;
let toastTimer;
let activeBox = null;
let cutStep = 0;
let orientationReady = true;
let cutProgress = 0;
let blade = null;
let safeAngle = 0;

function toast(message) {
  clearTimeout(toastTimer);
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

async function refresh() {
  state = await api.getState();
  render();
}

function render() {
  $("#balance").textContent = money(state.balance);
  $("#lockpicks").textContent = `${state.lockpicks}개`;
  $("#boxCount").textContent = state.boxes.length;
  $("#itemCount").textContent = state.items.length;
  $("#buyCutter").textContent = state.cutterOwned ? "구매 완료" : "구매";
  $("#buyCutter").disabled = state.cutterOwned;
  $("#devReset").classList.toggle("hidden", !state.devMode);
  renderMission();
  renderBoxes();
  renderItems();
}

function selectTab(name) {
  $$(".tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === name));
  $$(".panel").forEach((panel) => panel.classList.remove("active"));
  $(`#${name}Panel`).classList.add("active");
}

function renderMission() {
  const mission = state.mission;
  $("#missionButton").textContent = mission ? "임무 포기" : "임무 시작";
  $("#foundBoxes").textContent = mission ? `${mission.foundCount} / ${mission.maxBoxes}` : "0 / 3";
  const warehouse = $("#warehouse");
  $$(".search-node").forEach((node) => node.remove());
  if (!mission) {
    $("#missionHint").textContent = "임무를 시작하면 수색 지점이 표시됩니다.";
    $("#missionTimer").textContent = "01:15";
    return;
  }
  for (const node of mission.nodes) {
    const el = document.createElement("div");
    el.className = `search-node${node.searched ? " searched" : ""}`;
    el.dataset.id = node.id;
    el.style.left = `${node.x}%`;
    el.style.top = `${node.y}%`;
    warehouse.appendChild(el);
  }
  updateMissionHint();
}

function nearestNode() {
  if (!state?.mission) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const node of state.mission.nodes) {
    if (node.searched) continue;
    const dx = node.x - player.x;
    const dy = node.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist < bestDistance) { best = node; bestDistance = dist; }
  }
  return bestDistance <= 7 ? best : null;
}

function updateMissionHint() {
  $$(".search-node").forEach((el) => el.classList.remove("near"));
  const node = nearestNode();
  if (node) {
    document.querySelector(`.search-node[data-id="${node.id}"]`)?.classList.add("near");
    $("#missionHint").innerHTML = `수색 가능 · <kbd>E</kbd>를 눌러 조사`;
  } else if (state?.mission) {
    $("#missionHint").textContent = "빛나는 수색 지점 가까이 이동하세요.";
  }
}

function renderBoxes() {
  const counts = Object.fromEntries(state.boxTiers.map((tier) => [tier.id, 0]));
  state.boxes.forEach((box) => counts[box.tier] = (counts[box.tier] || 0) + 1);
  $("#boxSummary").innerHTML = state.boxTiers.map((tier) => `<div class="summary"><strong>${counts[tier.id] || 0}</strong><span>${tier.name}</span></div>`).join("");
  $("#boxList").innerHTML = state.boxes.map((box) => `
    <article class="box-card" style="--accent:${box.accent}">
      <div class="box-art">${box.tier === "safe" ? "🔐" : "📦"}</div>
      <h3>${box.tierName}</h3>
      <div class="meta">${box.id}<br>${box.source}<br>${new Date(box.acquiredAt).toLocaleString("ko-KR")}</div>
      <button class="open-box" data-id="${box.id}">${box.tier === "safe" ? "락픽으로 열기" : "커터칼로 열기"}</button>
    </article>`).join("");
  $("#boxEmpty").classList.toggle("hidden", state.boxes.length > 0);
}

function renderItems() {
  $("#itemList").innerHTML = state.items.map((item) => `
    <article class="item-card"><div class="box-art">🎁</div><h3>${item.name}</h3>
    <div class="meta">원본 가치 <strong>${money(item.originalValue)}</strong><br>상태 ${item.conditionPercent}%<br>${item.id}</div></article>`).join("");
  $("#itemEmpty").classList.toggle("hidden", state.items.length > 0);
}

async function toggleMission() {
  if (state.mission) {
    const result = await api.finishMission();
    state = result.state;
    toast("임무를 종료했습니다.");
  } else {
    const result = await api.startMission();
    if (!result.ok) return toast(result.error);
    state = result.state;
    player = { x: 50, y: 48, speed: 0.065 };
    toast("폐창고 회수 임무 시작");
  }
  render();
}

async function searchNode() {
  if (missionSearchBusy || !state?.mission) return;
  const node = nearestNode();
  if (!node) return;
  missionSearchBusy = true;
  $("#missionHint").textContent = "수색 중...";
  await new Promise((resolve) => setTimeout(resolve, 1250));
  const result = await api.searchMissionNode(node.id);
  missionSearchBusy = false;
  if (!result.ok) { toast(result.error); return refresh(); }
  state = result.state;
  if (result.found) toast(`${result.box.tierName} 획득! 상자 보관함에 저장했습니다.`);
  else toast("아무것도 찾지 못했습니다.");
  render();
}

function updatePlayer(dt) {
  if (!state?.mission || missionSearchBusy) return;
  let dx = 0, dy = 0;
  if (keys.has("w") || keys.has("arrowup")) dy -= 1;
  if (keys.has("s") || keys.has("arrowdown")) dy += 1;
  if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
  if (keys.has("d") || keys.has("arrowright")) dx += 1;
  if (dx || dy) {
    const length = Math.hypot(dx, dy) || 1;
    player.x = Math.max(3, Math.min(97, player.x + dx / length * player.speed * dt));
    player.y = Math.max(5, Math.min(94, player.y + dy / length * player.speed * dt));
    const el = $("#player");
    el.style.left = `${player.x}%`;
    el.style.top = `${player.y}%`;
    updateMissionHint();
  }
}

function animationLoop(now) {
  const dt = Math.min(40, now - lastFrame);
  lastFrame = now;
  updatePlayer(dt);
  if (state?.mission) {
    const remain = Math.max(0, state.mission.endsAt - Date.now());
    const sec = Math.ceil(remain / 1000);
    $("#missionTimer").textContent = `${String(Math.floor(sec / 60)).padStart(2,"0")}:${String(sec % 60).padStart(2,"0")}`;
    if (remain <= 0) refresh();
  }
  requestAnimationFrame(animationLoop);
}

async function buyCutter() {
  const result = await api.buyCutter();
  if (!result.ok) return toast(result.error);
  state = result.state;
  toast(result.alreadyOwned ? "이미 커터칼을 보유 중입니다." : "커터칼을 구매했습니다. 영구 사용 가능합니다.");
  render();
}

async function buyPicks(quantity) {
  const result = await api.buyLockpicks(quantity);
  if (!result.ok) return toast(result.error);
  state = result.state;
  toast(`락픽 ${result.quantity}개 구매 · ${money(result.cost)}`);
  render();
}

async function openBox(boxId) {
  const box = state.boxes.find((entry) => entry.id === boxId);
  if (!box) return;
  const result = await api.startBoxOpen(boxId);
  if (!result.ok) return toast(result.error);
  activeBox = box;
  $("#openModal").classList.remove("hidden");
  if (box.tier === "safe") renderSafe(result);
  else { cutStep = 0; orientationReady = true; renderRegularOpen(); }
}

function regularInstruction() {
  if (cutStep === 0) return "상자 첫 번째 옆면의 테이프를 위에서 아래로 쭉 자르세요.";
  if (cutStep === 1 && !orientationReady) return "상자를 좌우로 길게 끌어 반대편을 보세요.";
  if (cutStep === 1) return "반대편 옆면의 테이프를 위에서 아래로 자르세요.";
  if (cutStep === 2 && !orientationReady) return "상자를 위쪽으로 끌어 상단을 보세요.";
  return "마지막으로 상자 위 테이프를 왼쪽에서 오른쪽으로 쭉 자르세요.";
}

function renderRegularOpen() {
  const viewClass = cutStep === 0 ? "view-front" : cutStep === 1 ? "view-back" : "view-top";
  const trackClass = cutStep < 2 ? "vertical" : "horizontal";
  $("#openStage").innerHTML = `
    <div class="opening-title"><p class="eyebrow">MANUAL OPENING</p><h2>${activeBox.tierName}</h2><p>${activeBox.id}</p></div>
    <div class="box-stage"><div id="boxModel" class="box-model ${viewClass}"><div class="box-face"></div>${orientationReady ? `<div id="cutTrack" class="cut-track ${trackClass}"><span class="cut-progress" style="--progress:0%"></span></div>` : ""}</div></div>
    <div id="openInstruction" class="open-instruction">${regularInstruction()}</div>`;
  if (orientationReady) bindCutTrack();
  else bindRotateGesture();
}

function bindRotateGesture() {
  const model = $("#boxModel");
  let startX = 0, startY = 0, dragging = false;
  model.addEventListener("pointerdown", (event) => { dragging = true; startX = event.clientX; startY = event.clientY; model.setPointerCapture(event.pointerId); });
  model.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    if (cutStep === 1 && Math.abs(event.clientX - startX) > 110) { orientationReady = true; dragging = false; renderRegularOpen(); }
    if (cutStep === 2 && startY - event.clientY > 85) { orientationReady = true; dragging = false; renderRegularOpen(); }
  });
  model.addEventListener("pointerup", () => dragging = false);
}

function bindCutTrack() {
  const track = $("#cutTrack");
  const progress = track.querySelector(".cut-progress");
  let cutting = false;
  let start = 0;
  cutProgress = 0;
  blade = document.createElement("div"); blade.className = "blade"; blade.textContent = "🔪"; document.body.appendChild(blade); blade.style.display = "none";
  const vertical = track.classList.contains("vertical");
  track.addEventListener("pointerdown", (event) => {
    const rect = track.getBoundingClientRect();
    const position = vertical ? event.clientY - rect.top : event.clientX - rect.left;
    const length = vertical ? rect.height : rect.width;
    if (position > length * .22) return toast("테이프 시작점부터 칼을 대세요.");
    cutting = true; start = position; track.setPointerCapture(event.pointerId); blade.style.display = "block";
  });
  track.addEventListener("pointermove", async (event) => {
    if (!cutting) return;
    blade.style.left = `${event.clientX}px`; blade.style.top = `${event.clientY}px`;
    const rect = track.getBoundingClientRect();
    const position = vertical ? event.clientY - rect.top : event.clientX - rect.left;
    const length = vertical ? rect.height : rect.width;
    cutProgress = Math.max(cutProgress, Math.max(0, Math.min(100, ((position - start) / Math.max(1, length - start)) * 100)));
    progress.style.setProperty("--progress", `${cutProgress}%`);
    if (cutProgress >= 94) {
      cutting = false; blade.remove(); blade = null;
      const result = await api.completeCut(activeBox.id, cutStep);
      if (!result.ok) return toast(result.error);
      if (result.opened) return revealReward(result.item, result.state);
      cutStep = result.cutStep;
      orientationReady = false;
      renderRegularOpen();
    }
  });
  track.addEventListener("pointerup", () => { cutting = false; if (blade) blade.style.display = "none"; });
}

function renderSafe(session) {
  safeAngle = 0;
  $("#openStage").innerHTML = `
    <div class="opening-title"><p class="eyebrow">LOCKPICK</p><h2>금고</h2><p>마우스를 좌우로 움직여 락픽 각도를 맞추고 버튼을 눌러 실린더를 돌려보세요.</p></div>
    <div class="safe-stage">
      <div id="safeDoor" class="safe-door"><div id="lockCylinder" class="lock-cylinder"><span id="pick" class="pick" style="--pick-angle:0deg"></span></div></div>
      <div class="safe-help"><h3>감으로 각도를 찾으세요</h3><p>정답 각도에서 멀수록 실린더가 조금만 돌아가고 락픽에 부담이 커집니다. 락픽이 부러지면 1개가 소모됩니다.</p>
      <span>락픽 내구도 <b id="pickHealth">${session.pickHealth}%</b></span><div class="meter"><span id="pickMeter"></span></div>
      <span>남은 락픽 <b id="safePicks">${session.lockpicks}개</b></span>
      <button id="torqueButton" class="torque-button">실린더 돌리기 (SPACE)</button></div>
    </div>`;
  const door = $("#safeDoor");
  door.addEventListener("pointermove", (event) => {
    const rect = door.getBoundingClientRect();
    safeAngle = Math.max(-80, Math.min(80, ((event.clientX - rect.left) / rect.width * 160) - 80));
    $("#pick").style.setProperty("--pick-angle", `${safeAngle}deg`);
  });
  $("#torqueButton").addEventListener("click", torqueSafe);
}

async function torqueSafe() {
  if (!activeBox) return;
  const result = await api.safeAttempt(activeBox.id, safeAngle, .55);
  if (!result.ok) return toast(result.error);
  $("#lockCylinder").style.transform = `rotate(${Math.round(result.rotation * 88)}deg)`;
  if (result.opened) return setTimeout(() => revealReward(result.item, result.state), 220);
  $("#pickHealth").textContent = `${result.pickHealth}%`;
  $("#pickMeter").style.transform = `scaleX(${result.pickHealth / 100})`;
  $("#safePicks").textContent = `${result.lockpicks}개`;
  if (result.broke) toast("락픽이 부러졌습니다.");
  if (result.exhausted) toast("락픽이 모두 소진되었습니다.");
  setTimeout(() => { const c = $("#lockCylinder"); if (c) c.style.transform = "rotate(0deg)"; }, 260);
}

function revealReward(item, nextState) {
  state = nextState;
  $("#openStage").innerHTML = `<div class="reward-card"><div class="reward-icon">🎁</div><p class="eyebrow">ITEM FOUND</p><h2>${item.name}</h2><div class="reward-value">원본 가치 ${money(item.originalValue)}</div><p class="meta">현재는 PC 로컬 보관함에 저장됩니다. 다음 단계에서 홈페이지 보관함과 연동됩니다.</p><button id="rewardClose" class="primary">보관함으로 이동</button></div>`;
  $("#rewardClose").addEventListener("click", () => { closeModal(); selectTab("items"); render(); });
}

function closeModal() {
  if (blade) { blade.remove(); blade = null; }
  $("#openModal").classList.add("hidden"); activeBox = null;
}

function bindEvents() {
  $$(".tab").forEach((btn) => btn.addEventListener("click", () => selectTab(btn.dataset.tab)));
  $("#missionButton").addEventListener("click", toggleMission);
  $("#buyCutter").addEventListener("click", buyCutter);
  $$("[data-picks]").forEach((btn) => btn.addEventListener("click", () => buyPicks(Number(btn.dataset.picks))));
  $("#boxList").addEventListener("click", (event) => { const btn = event.target.closest(".open-box"); if (btn) openBox(btn.dataset.id); });
  $("#closeModal").addEventListener("click", closeModal);
  $("#openModal").addEventListener("click", (event) => { if (event.target.id === "openModal") closeModal(); });
  $("#devReset").addEventListener("click", async () => { const result = await api.devReset(); if (result.ok) { state = result.state; render(); toast("개발 데이터를 초기화했습니다."); } });
  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase(); keys.add(key);
    if (key === "e") searchNode();
    if (event.code === "Space" && !$("#openModal").classList.contains("hidden") && activeBox?.tier === "safe") { event.preventDefault(); torqueSafe(); }
  });
  window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
}

(async function init(){ state = await api.getState(); bindEvents(); render(); requestAnimationFrame(animationLoop); })().catch((error) => toast(error.message));
