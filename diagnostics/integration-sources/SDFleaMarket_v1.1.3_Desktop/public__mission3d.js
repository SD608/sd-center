"use strict";

(() => {
  const TAU = Math.PI * 2;

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function normAngle(value) {
    let angle = value % TAU;
    if (angle < -Math.PI) angle += TAU;
    if (angle > Math.PI) angle -= TAU;
    return angle;
  }
  function makeGrid(width, height) {
    const grid = Array.from({ length: height }, () => Array(width).fill(0));
    for (let x = 0; x < width; x += 1) { grid[0][x] = 1; grid[height - 1][x] = 1; }
    for (let y = 0; y < height; y += 1) { grid[y][0] = 1; grid[y][width - 1] = 1; }
    return grid;
  }
  function rect(grid, x, y, w, h, value) {
    for (let yy = y; yy < y + h; yy += 1) {
      for (let xx = x; xx < x + w; xx += 1) {
        if (grid[yy] && typeof grid[yy][xx] !== "undefined") grid[yy][xx] = value;
      }
    }
  }

  function buildAlley() {
    const grid = makeGrid(15, 36);
    rect(grid, 1, 1, 4, 34, 1);
    rect(grid, 10, 1, 4, 34, 1);
    grid[35][7] = 9;
    return {
      grid,
      start: { x: 7.5, y: 33.4, angle: -Math.PI / 2 },
      exit: { x: 7.5, y: 34.45 },
      safeSpawns: [],
      spawns: [
        [5.35, 30.0], [9.65, 26.0], [5.35, 22.0], [9.65, 18.0],
        [5.35, 14.0], [9.65, 10.0], [5.35, 6.0], [9.65, 3.4],
      ],
      props: [],
      theme: {
        skyTop: "#070a10", skyBottom: "#17212c", floorTop: "#34383d", floorBottom: "#202327",
        wall: ["#262c33", "#333b43", "#315363", "#584050"], fog: "#080b0f", accent: "#4bdcff",
        floorType: "asphalt", label: "STRAIGHT STREET"
      }
    };
  }

  function buildStore() {
    const grid = makeGrid(30, 22);
    rect(grid, 3, 3, 6, 2, 2); rect(grid, 3, 8, 6, 2, 2);
    rect(grid, 21, 3, 6, 2, 2); rect(grid, 21, 8, 6, 2, 2);
    rect(grid, 11, 4, 3, 2, 3); rect(grid, 16, 4, 3, 2, 3);
    rect(grid, 11, 10, 3, 2, 3); rect(grid, 16, 10, 3, 2, 3);
    rect(grid, 1, 14, 28, 2, 3);
    grid[14][14] = 7; grid[14][15] = 7; grid[15][14] = 7; grid[15][15] = 7;
    grid[21][14] = 9; grid[21][15] = 9;
    return {
      grid,
      start: { x: 15, y: 18.7, angle: -Math.PI / 2 },
      exit: { x: 15, y: 20.35 },
      storeDoorCells: [[14,14],[15,14],[14,15],[15,15]],
      storeDoorPoint: { x: 15, y: 16.35 },
      safeSpawns: [[10.0, 11.9], [20.0, 11.9], [15.0, 2.7]],
      spawns: [
        [11.75, 17.35], [15.0, 16.45],
        [9.65, 12.75], [20.35, 12.75], [9.65, 9.95], [20.35, 9.95],
        [9.65, 6.55], [20.35, 6.55], [10.35, 2.65], [19.65, 2.65],
      ],
      props: [
        { x: 8.7, y: 17.9, type: "plant", scale: .72 },
        { x: 21.3, y: 17.9, type: "plant", scale: .72 },
      ],
      theme: {
        skyTop: "#24231e", skyBottom: "#4a483e", floorTop: "#b0aca2", floorBottom: "#77746e",
        wall: ["#6d6659", "#7a705f", "#556367", "#806d4e"], fog: "#1a1813", accent: "#f1cc78",
        floorType: "concrete", label: "COMMERCIAL ARCADE"
      }
    };
  }

  function buildLogistics() {
    const grid = makeGrid(30, 20);
    rect(grid, 3, 3, 3, 6, 2); rect(grid, 3, 12, 3, 5, 2);
    rect(grid, 10, 3, 3, 6, 2); rect(grid, 10, 12, 3, 5, 2);
    rect(grid, 17, 3, 3, 6, 3); rect(grid, 17, 12, 3, 5, 3);
    rect(grid, 24, 3, 3, 6, 3); rect(grid, 24, 12, 3, 5, 3);
    grid[19][14] = 9; grid[19][15] = 9;
    return {
      grid,
      start: { x: 15, y: 17, angle: -Math.PI / 2 },
      exit: { x: 15, y: 18.4 },
      safeSpawns: [],
      spawns: [
        [2.2, 4.6], [2.2, 14.5], [9.2, 4.6], [9.2, 14.5],
        [16.2, 4.6], [16.2, 14.5], [23.2, 4.6], [23.2, 14.5],
        [5.9, 9.6], [12.9, 9.6], [19.9, 9.6], [26.8, 9.6],
      ],
      props: [],
      theme: {
        skyTop: "#141c1f", skyBottom: "#334247", floorTop: "#5b6466", floorBottom: "#363e40",
        wall: ["#4e5d61", "#697a7e", "#776548", "#456e76"], fog: "#0c1113", accent: "#7ce6ff",
        floorType: "warehouse", label: "LOGISTICS HUB"
      }
    };
  }

  function buildBankPrep() {
    const grid = makeGrid(28, 19);
    rect(grid, 3, 3, 5, 4, 2); rect(grid, 3, 12, 5, 4, 2);
    rect(grid, 20, 3, 5, 4, 2); rect(grid, 20, 12, 5, 4, 2);
    rect(grid, 11, 3, 6, 2, 3); rect(grid, 11, 14, 6, 2, 3);
    grid[18][13] = 9; grid[18][14] = 9;
    return {
      grid,
      start: { x: 14, y: 16.65, angle: -Math.PI / 2 },
      exit: { x: 14, y: 17.45 },
      safeSpawns: [],
      spawns: [
        [8.65, 6.6], [8.65, 12.35], [19.35, 6.6], [19.35, 12.35], [10.35, 5.45], [17.65, 13.55],
      ],
      props: [
        { x: 8.9, y: 6.8, type: "chair", scale: .82 }, { x: 8.9, y: 12.1, type: "chair", scale: .82 },
        { x: 19.1, y: 6.8, type: "chair", scale: .82 }, { x: 19.1, y: 12.1, type: "chair", scale: .82 },
        { x: 10.0, y: 4.6, type: "table", scale: .95 }, { x: 18.0, y: 4.6, type: "table", scale: .95 },
        { x: 7.0, y: 9.5, type: "plant", scale: .9 }, { x: 21.0, y: 9.5, type: "plant", scale: .9 },
        { x: 14.0, y: 2.65, type: "sign", scale: .85 },
      ],
      theme: {
        skyTop: "#171b20", skyBottom: "#323948", floorTop: "#b8bec5", floorBottom: "#7d8790",
        wall: ["#8b9299", "#c5c9ce", "#69707a", "#bbb299"], fog: "#0f1316", accent: "#9ad8ff",
        floorType: "concrete", label: "BANK PREP OFFICE"
      }
    };
  }

  function buildBank() {
    const grid = makeGrid(30, 20);
    rect(grid, 2, 3, 6, 4, 2); rect(grid, 22, 3, 6, 4, 2);
    rect(grid, 2, 11, 6, 5, 2); rect(grid, 22, 11, 6, 5, 2);
    rect(grid, 11, 3, 8, 2, 3); rect(grid, 1, 14, 28, 2, 3);
    grid[14][14] = 8; grid[14][15] = 8; grid[15][14] = 8; grid[15][15] = 8;
    grid[19][14] = 9; grid[19][15] = 9;
    return {
      grid,
      start: { x: 15, y: 17.9, angle: -Math.PI / 2 },
      exit: { x: 15, y: 18.35 },
      bankDoorCells: [[14,14],[15,14],[14,15],[15,15]],
      bankDoorPoint: { x: 15, y: 16.2 },
      safeSpawns: [],
      spawns: [
        [15.0, 16.35],
        [9.8, 12.25], [15.0, 11.15], [20.2, 12.25],
        [8.65, 7.7], [21.35, 7.7], [8.65, 10.0], [21.35, 10.0], [10.15, 5.55], [19.85, 5.55],
      ],
      props: [
        { x: 10.7, y: 15.4, type: "barrier", scale: .72 }, { x: 19.3, y: 15.4, type: "barrier", scale: .72 },
        { x: 8.7, y: 14.1, type: "bench", scale: .9 }, { x: 21.3, y: 14.1, type: "bench", scale: .9 },
        { x: 5.0, y: 10.2, type: "plant", scale: 1.0 }, { x: 25.0, y: 10.2, type: "plant", scale: 1.0 },
        { x: 4.2, y: 6.2, type: "kiosk", scale: .9 }, { x: 25.8, y: 6.2, type: "kiosk", scale: .9 },
        { x: 10.2, y: 6.4, type: "table", scale: 1.05 }, { x: 19.8, y: 6.4, type: "table", scale: 1.05 },
        { x: 15.0, y: 2.6, type: "sign", scale: 1.0 },
      ],
      theme: {
        skyTop: "#11161a", skyBottom: "#29313a", floorTop: "#c6c2b8", floorBottom: "#8d877d",
        wall: ["#ddd6c8", "#f1ece1", "#7a7468", "#b29c63"], fog: "#0d1015", accent: "#8fd8ff",
        floorType: "concrete", label: "BANK LOBBY / VAULT"
      }
    };
  }

  const MAPS = { alley: buildAlley(), abandoned_store: buildStore(), logistics: buildLogistics(), bank_prep: buildBankPrep(), bank: buildBank() };

  function create(options = {}) {
    const container = options.container;
    const canvas = options.canvas;
    if (!container || !canvas) throw new Error("Mission3D requires container and canvas");
    const ctx = canvas.getContext("2d", { alpha: false });

    let active = false;
    let mapId = "alley";
    let map = MAPS.alley;
    let nodes = [];
    let nodePositions = new Map();
    let safeState = null;
    let safePosition = null;
    let width = 960;
    let height = 540;
    let player = { x: map.start.x, y: map.start.y, angle: map.start.angle, pitch: 0 };
    let bob = 0;
    let stepDistance = 0;
    let lastNearestId = null;
    let lastSafeNear = false;
    let searching = false;
    let pointerLocked = false;
    let mouseSensitivity = 0.0022;
    let depthBuffer = [];
    let autoLockPending = false;
    let missionState = null;
    let gunFlashUntil = 0;
    let gunFlashHit = false;
    let brickThrowUntil = 0;
    let brickThrowHit = false;
    let guardAttackCooldown = 0;
    let guardAlertPending = false;
    let guardPatrolStartedAt = performance.now();
    let playerHitUntil = 0;

    const FOV = Math.PI / 3;
    const MAX_DEPTH = 30;
    const INTERACT_DISTANCE = 2.0;
    const SAFE_INTERACT_DISTANCE = 2.25;
    const EXIT_INTERACT_DISTANCE = 1.10;

    function resize() {
      const box = container.getBoundingClientRect();
      width = Math.max(320, Math.floor(box.width));
      height = Math.max(240, Math.floor(box.height));
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${box.width}px`;
      canvas.style.height = `${box.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function cellAt(x, y) {
      const gx = Math.floor(x), gy = Math.floor(y);
      if (!map.grid[gy] || typeof map.grid[gy][gx] === "undefined") return 1;
      return map.grid[gy][gx];
    }
    function walkable(x, y) {
      const r = 0.22;
      return cellAt(x-r,y-r)===0 && cellAt(x+r,y-r)===0 && cellAt(x-r,y+r)===0 && cellAt(x+r,y+r)===0;
    }
    function movePlayer(dx, dy) {
      const nx = player.x + dx, ny = player.y + dy;
      if (walkable(nx, player.y)) player.x = nx;
      if (walkable(player.x, ny)) player.y = ny;
    }

    function snapSpawnToWalkable(x, y) {
      if (walkable(x, y)) return { x, y };
      const offsets = [
        [0.45,0],[-0.45,0],[0,0.45],[0,-0.45],
        [0.8,0],[-0.8,0],[0,0.8],[0,-0.8],
        [0.55,0.55],[-0.55,0.55],[0.55,-0.55],[-0.55,-0.55],
        [1.15,0],[-1.15,0],[0,1.15],[0,-1.15],
      ];
      for (const [ox,oy] of offsets) {
        const nx=x+ox, ny=y+oy;
        if (walkable(nx,ny)) return { x:nx, y:ny };
      }
      return { x: map.start.x, y: map.start.y };
    }

    function syncNodes(nextNodes = []) {
      nodes = nextNodes.map((node) => ({ ...node }));
      const assigned = new Map();
      nodes.forEach((node, index) => {
        const explicit = Number.isFinite(Number(node.worldX)) && Number.isFinite(Number(node.worldY))
          ? [Number(node.worldX), Number(node.worldY)]
          : null;
        const spawn = explicit || map.spawns[index % map.spawns.length] || [map.start.x, map.start.y];
        const snapped = snapSpawnToWalkable(spawn[0], spawn[1]);
        assigned.set(node.id, snapped);
      });
      nodePositions = assigned;
    }

    function syncSafe(nextSafe = null) {
      safeState = nextSafe ? { ...nextSafe } : null;
      if (!safeState || safeState.opened) { safePosition = null; return; }
      const list = map.safeSpawns || [];
      const idx = Math.max(0, Number(safeState.spawnIndex || 0)) % Math.max(1, list.length);
      const spawn = list[idx] || [map.start.x + 2, map.start.y - 4];
      safePosition = { x: spawn[0], y: spawn[1] };
    }


    function setBankDoorOpen(open) {
      if (mapId !== "bank" || !Array.isArray(map.bankDoorCells)) return;
      for (const [x,y] of map.bankDoorCells) {
        if (map.grid[y] && typeof map.grid[y][x] !== "undefined") map.grid[y][x] = open ? 0 : 8;
      }
    }

    function setStoreDoorOpen(open) {
      if (mapId !== "abandoned_store" || !Array.isArray(map.storeDoorCells)) return;
      for (const [x,y] of map.storeDoorCells) {
        if (map.grid[y] && typeof map.grid[y][x] !== "undefined") map.grid[y][x] = open ? 0 : 7;
      }
    }

    function syncMissionState(nextMission = null) {
      missionState = nextMission ? { ...nextMission } : null;
      if (mapId === "bank") {
        setBankDoorOpen(Boolean(missionState?.bankDoorUnlocked));
        if (missionState?.guardAlarmTriggered) guardAlertPending = false;
      }
      if (mapId === "abandoned_store") setStoreDoorOpen(Boolean(missionState?.storeDoorBroken));
    }

    function mount(nextMapId, nextNodes = [], nextSafe = null, autoLock = true) {
      mapId = MAPS[nextMapId] ? nextMapId : "alley";
      map = MAPS[mapId];
      missionState = null;
      if (mapId === "bank") setBankDoorOpen(false);
      if (mapId === "abandoned_store") setStoreDoorOpen(false);
      player = { x: map.start.x, y: map.start.y, angle: map.start.angle, pitch: 0 };
      bob = 0; stepDistance = 0; active = true; searching = false; lastNearestId = null; lastSafeNear = false; guardAttackCooldown = 0; guardAlertPending = false; guardPatrolStartedAt = performance.now();
      syncNodes(nextNodes); syncSafe(nextSafe);
      container.classList.add("three-d-active");
      resize(); render(performance.now());
      autoLockPending = Boolean(autoLock);
      if (autoLockPending) requestPointer();
    }

    function unmount() {
      active = false; searching = false; nodePositions.clear(); nodes = []; safeState = null; safePosition = null; missionState = null;
      lastNearestId = null; lastSafeNear = false; autoLockPending = false;
      container.classList.remove("three-d-active");
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    }

    function nearestNode() {
      if (!active) return null;
      let best = null, bestDistance = Infinity;
      for (const node of nodes) {
        if (node.searched) continue;
        const pos = nodePositions.get(node.id); if (!pos) continue;
        const dx = pos.x-player.x, dy = pos.y-player.y, distance = Math.hypot(dx,dy);
        if (distance > INTERACT_DISTANCE) continue;
        const delta = Math.abs(normAngle(Math.atan2(dy,dx)-player.angle));
        if (delta > 0.72) continue;
        if (distance < bestDistance) { best=node; bestDistance=distance; }
      }
      return best;
    }

    function lineClear(x0,y0,x1,y1) {
      const distance = Math.hypot(x1-x0,y1-y0);
      const steps = Math.max(2, Math.ceil(distance / .14));
      for (let i=1;i<steps;i+=1) {
        const t=i/steps;
        const cell=cellAt(x0+(x1-x0)*t,y0+(y1-y0)*t);
        if (cell !== 0) return false;
      }
      return true;
    }

    function guardCombatActive() {
      if (!active || !missionState) return false;
      if (mapId === "bank") return Boolean(missionState.bankDoorUnlocked);
      return mapId === "bank_prep" && missionState.missionType === "bank-prep" && missionState.prepId === "guardWeakening";
    }

    function guardFacing(node, now = performance.now()) {
      // 은행/준비작업 입구는 맵 남쪽(+Y)이므로 기본 방향은 입구 반대쪽(-Y)입니다.
      // 임무 시작 직후에는 모두 입구 반대쪽을 보고, 경비 번호별로 좌/우 방향을 나눠
      // 약 15초 주기로 천천히 왕복 감시하도록 합니다.
      const baseFacing = Number.isFinite(Number(node?.facing)) ? Number(node.facing) : -Math.PI / 2;
      const serial = Number(String(node?.id || "").match(/(\d+)$/)?.[1] || 0);
      const amplitude = node?.extra ? 0.50 : 0.44;
      const direction = serial % 2 === 0 ? -1 : 1;
      const elapsed = Math.max(0, now - guardPatrolStartedAt);
      const sweep = Math.sin(elapsed / 2400) * amplitude * direction;
      return normAngle(baseFacing + sweep);
    }

    function guardCanSeePlayer(node, now = performance.now()) {
      if (!guardCombatActive() || node.searched || node.kind !== "guard") return false;
      const pos=nodePositions.get(node.id); if(!pos)return false;
      const dx=player.x-pos.x,dy=player.y-pos.y,distance=Math.hypot(dx,dy);
      if(distance>7.4)return false;
      const facing=guardFacing(node, now);
      const delta=Math.abs(normAngle(Math.atan2(dy,dx)-facing));
      if(delta>.34)return false;
      return lineClear(pos.x,pos.y,player.x,player.y);
    }

    function guardsSeeingPlayer(now = performance.now()) {
      if (!guardCombatActive()) return [];
      return nodes.filter((node)=>guardCanSeePlayer(node, now));
    }

    function aimedGuard() {
      if (!guardCombatActive()) return null;
      let best = null, bestAngle = Infinity, bestDistance = Infinity, bestZone="body";
      const cy=height/2;
      for (const node of nodes) {
        if (node.searched || node.kind !== "guard") continue;
        const pos = nodePositions.get(node.id); if (!pos) continue;
        const dx=pos.x-player.x,dy=pos.y-player.y,distance=Math.hypot(dx,dy);
        if (distance > 14) continue;
        const angle=Math.abs(normAngle(Math.atan2(dy,dx)-player.angle));
        if (angle > 0.085) continue;
        const projected=screenProject(pos.x,pos.y);
        if (!projected) continue;
        const scale=clamp(projected.wallH*.3*1.12,28,190);
        const headY=projected.baseY-scale*.84;
        const bodyY=projected.baseY-scale*.39;
        const headDist=Math.abs(cy-headY),bodyDist=Math.abs(cy-bodyY);
        if(Math.min(headDist,bodyDist)>scale*.42)continue;
        const zone=headDist<=scale*.19 ? "head" : "body";
        const aimScore=Math.min(headDist,bodyDist)/Math.max(1,scale)+angle*4;
        if (aimScore < bestAngle || (Math.abs(aimScore-bestAngle)<.01 && distance<bestDistance)) {
          best={...node,hitZone:zone};bestAngle=aimScore;bestDistance=distance;bestZone=zone;
        }
      }
      return best ? {...best,hitZone:bestZone} : null;
    }

    function aimedStoreDoor() {
      if (!active || mapId !== "abandoned_store" || missionState?.storeDoorBroken || !map.storeDoorPoint) return null;
      const dx=map.storeDoorPoint.x-player.x,dy=map.storeDoorPoint.y-player.y,distance=Math.hypot(dx,dy);
      if(distance>12)return null;
      const angle=Math.abs(normAngle(Math.atan2(dy,dx)-player.angle));
      if(angle>.12)return null;
      return nodes.find((node)=>node.kind==="store-door"&&!node.searched)||null;
    }

    function throwBrickFx(hit=false) {
      brickThrowUntil=performance.now()+360;
      brickThrowHit=Boolean(hit);
      render(performance.now());
    }

    function fireGunFx(hit=false) {
      gunFlashHit = Boolean(hit);
      gunFlashUntil = performance.now() + 150;
      render(performance.now());
    }

    function playerHitFx() {
      playerHitUntil = performance.now() + 260;
      render(performance.now());
    }

    function safeInfo() {
      if (!active || !safeState || safeState.opened || !safePosition) return { near:false, visible:false, distance:Infinity, angle:0 };
      const dx=safePosition.x-player.x, dy=safePosition.y-player.y, distance=Math.hypot(dx,dy);
      const angle=normAngle(Math.atan2(dy,dx)-player.angle);
      return { near: distance<=SAFE_INTERACT_DISTANCE && Math.abs(angle)<0.85, visible:true, distance, angle, ...safePosition, safe:safeState };
    }

    function exitInfo() {
      if (!active || !map.exit) return { near:false,distance:Infinity,angle:0,x:0,y:0 };
      const dx=map.exit.x-player.x, dy=map.exit.y-player.y, distance=Math.hypot(dx,dy);
      const angle=normAngle(Math.atan2(dy,dx)-player.angle);
      return { near:distance<=EXIT_INTERACT_DISTANCE,distance,angle,x:map.exit.x,y:map.exit.y };
    }

    function castRay(angle) {
      const rayDirX=Math.cos(angle), rayDirY=Math.sin(angle);
      let mapX=Math.floor(player.x), mapY=Math.floor(player.y);
      const ddx=Math.abs(1/(rayDirX||.00001)), ddy=Math.abs(1/(rayDirY||.00001));
      const sx=rayDirX<0?-1:1, sy=rayDirY<0?-1:1;
      let sdx=rayDirX<0?(player.x-mapX)*ddx:(mapX+1-player.x)*ddx;
      let sdy=rayDirY<0?(player.y-mapY)*ddy:(mapY+1-player.y)*ddy;
      let side=0, cell=0, loops=0;
      while(cell===0 && loops<90){
        if(sdx<sdy){sdx+=ddx;mapX+=sx;side=0;} else {sdy+=ddy;mapY+=sy;side=1;}
        cell=map.grid[mapY]?.[mapX]??1;loops+=1;
      }
      let distance=side===0?(mapX-player.x+(1-sx)/2)/(rayDirX||.00001):(mapY-player.y+(1-sy)/2)/(rayDirY||.00001);
      distance=Math.abs(distance);
      let wallX=side===0?player.y+distance*rayDirY:player.x+distance*rayDirX;
      wallX-=Math.floor(wallX);
      return {distance,side,cell:Math.max(1,Number(cell)||1),mapX,mapY,wallX};
    }

    function shadedColor(hex,factor){
      const c=String(hex||"#777777").replace("#","");
      const r=parseInt(c.slice(0,2),16)||0,g=parseInt(c.slice(2,4),16)||0,b=parseInt(c.slice(4,6),16)||0,f=clamp(factor,0,1.25);
      return `rgb(${Math.round(r*f)},${Math.round(g*f)},${Math.round(b*f)})`;
    }
    function horizonY(){ return height*(0.5-(player.pitch||0))+Math.sin(bob)*2.2; }

    function drawBackground(){
      const horizon=horizonY();
      const sky=ctx.createLinearGradient(0,0,0,horizon); sky.addColorStop(0,map.theme.skyTop); sky.addColorStop(.72,map.theme.skyBottom); sky.addColorStop(1,"#0a0d12");
      ctx.fillStyle=sky;ctx.fillRect(0,0,width,horizon);
      const floor=ctx.createLinearGradient(0,horizon,0,height); floor.addColorStop(0,map.theme.floorTop); floor.addColorStop(.55,map.theme.floorBottom); floor.addColorStop(1,"#1b1f24");
      ctx.fillStyle=floor;ctx.fillRect(0,horizon,width,height-horizon);
      ctx.save();
      const lightBand = ctx.createRadialGradient(width*.5,horizon*.35,10,width*.5,horizon*.35,width*.65);
      lightBand.addColorStop(0,"rgba(255,255,255,.16)");
      lightBand.addColorStop(.35,"rgba(255,255,255,.06)");
      lightBand.addColorStop(1,"rgba(255,255,255,0)");
      ctx.fillStyle=lightBand; ctx.fillRect(0,0,width,horizon+40);
      ctx.globalAlpha=.065; ctx.fillStyle=map.theme.floorType==="asphalt"?"#d5d8da":map.theme.floorType==="warehouse"?"#f5d869":"#ffffff";
      const spacing = map.theme.floorType==="warehouse"?90:64;
      for(let y=Math.ceil(horizon)+26;y<height;y+=spacing){
        for(let x=24;x<width;x+=spacing){
          const offset=((Math.floor(y/spacing)%2)*23);
          ctx.fillRect((x+offset)%width,y, map.theme.floorType==="warehouse"?28:2, map.theme.floorType==="warehouse"?2:2);
        }
      }
      const vignette = ctx.createRadialGradient(width*.5,height*.45,Math.min(width,height)*.18,width*.5,height*.45,Math.max(width,height)*.78);
      vignette.addColorStop(.55,"rgba(0,0,0,0)");
      vignette.addColorStop(1,"rgba(0,0,0,.42)");
      ctx.fillStyle=vignette; ctx.fillRect(0,0,width,height);
      ctx.restore();
    }

    function drawWalls(){
      const strip=width>=900?2:3,horizon=horizonY();depthBuffer=new Array(Math.ceil(width/strip)).fill(MAX_DEPTH);
      for(let x=0;x<width;x+=strip){
        const cameraX=x/width-.5,rayAngle=player.angle+cameraX*FOV,hit=castRay(rayAngle);
        const corrected=Math.max(.05,hit.distance*Math.cos(rayAngle-player.angle));depthBuffer[Math.floor(x/strip)]=corrected;
        const wallHeight=Math.min(height*1.5,height/corrected),top=horizon-wallHeight/2;
        const distanceShade=clamp(1.22-corrected/MAX_DEPTH,.18,1),sideShade=hit.side?.74:1;
        if(hit.cell===7){
          const shade=distanceShade*sideShade;
          const doorTop=top+wallHeight*.04,doorH=wallHeight*.96;
          ctx.fillStyle=shadedColor("#27343a",shade);ctx.fillRect(x,top,strip+1,wallHeight);
          ctx.fillStyle=`rgba(113,190,213,${clamp(.24*shade,.08,.26)})`;ctx.fillRect(x,doorTop,strip+1,doorH);
          const frameEdge=hit.wallX<.065||hit.wallX>.935||Math.abs(hit.wallX-.5)<.028;
          if(frameEdge){ctx.fillStyle=shadedColor("#7b8589",Math.min(1.15,shade*1.12));ctx.fillRect(x,doorTop,strip+1,doorH);}
          if((hit.wallX>.19&&hit.wallX<.205)||(hit.wallX>.795&&hit.wallX<.81)){ctx.fillStyle="rgba(225,245,250,.5)";ctx.fillRect(x,doorTop,strip+1,doorH);}
        }else if(hit.cell===8){
          const shade=distanceShade*sideShade;
          const frame=Math.max(2,wallHeight*.034),doorTop=top+wallHeight*.05,doorH=wallHeight*.94;
          ctx.fillStyle=shadedColor("#111820",shade);ctx.fillRect(x,top,strip+1,wallHeight);
          ctx.fillStyle=shadedColor("#34404a",shade);ctx.fillRect(x,doorTop,strip+1,doorH);
          const edge=hit.wallX<.055||hit.wallX>.945;
          if(edge){ctx.fillStyle=shadedColor("#85939d",Math.min(1.18,shade*1.12));ctx.fillRect(x,doorTop,strip+1,doorH);}
          if(hit.wallX>.47&&hit.wallX<.53){ctx.fillStyle=shadedColor("#0b0e12",shade);ctx.fillRect(x,doorTop,strip+1,doorH);}
          if(hit.wallX>.74&&hit.wallX<.84){ctx.fillStyle=shadedColor("#9a6cff",Math.min(1.25,shade*1.2));ctx.fillRect(x,doorTop+doorH*.42,strip+1,doorH*.16);}
          ctx.fillStyle=shadedColor("#7b8790",shade);ctx.fillRect(x,doorTop,strip+1,frame);ctx.fillRect(x,doorTop+doorH-frame,strip+1,frame);
        }else if(hit.cell===9){
          // 출발 지점 벽 자체를 EXIT 문으로 칠해 웨이포인트가 없어도 육안으로 찾을 수 있게 합니다.
          const shade=distanceShade*sideShade;
          const frame=Math.max(2,wallHeight*.032),doorTop=top+wallHeight*.08,doorH=wallHeight*.9;
          ctx.fillStyle=shadedColor("#17311f",shade);ctx.fillRect(x,top,strip+1,wallHeight);
          ctx.fillStyle=shadedColor("#124a25",shade);ctx.fillRect(x,doorTop,strip+1,doorH);
          const edge=hit.wallX<.075||hit.wallX>.925;
          if(edge){ctx.fillStyle=shadedColor("#35f06a",Math.min(1.2,shade*1.15));ctx.fillRect(x,doorTop,strip+1,doorH);}
          ctx.fillStyle=shadedColor("#42ff73",Math.min(1.25,shade*1.12));
          ctx.fillRect(x,doorTop,strip+1,frame);ctx.fillRect(x,doorTop+doorH-frame,strip+1,frame);
          if(hit.wallX>.47&&hit.wallX<.53){ctx.fillStyle=shadedColor("#5cff83",Math.min(1.25,shade*1.18));ctx.fillRect(x,doorTop,strip+1,doorH);}
        }else{
          ctx.fillStyle=shadedColor(map.theme.wall[(hit.cell-1)%map.theme.wall.length],distanceShade*sideShade);ctx.fillRect(x,top,strip+1,wallHeight);
        }
        if(corrected>5){ctx.globalAlpha=clamp((corrected-5)/MAX_DEPTH,0,.68);ctx.fillStyle=map.theme.fog;ctx.fillRect(x,top,strip+1,wallHeight);ctx.globalAlpha=1;}
      }
    }

    function screenProject(wx,wy,occlusionBias=.28){
      const dx=wx-player.x,dy=wy-player.y,distance=Math.hypot(dx,dy),angle=normAngle(Math.atan2(dy,dx)-player.angle),depth=distance*Math.cos(angle);
      if(depth<=.18 || Math.abs(angle)>FOV*.74) return null;
      const screenX=width*(.5+angle/FOV),strip=width>=900?2:3;
      const wallDepth=depthBuffer[Math.max(0,Math.min(depthBuffer.length-1,Math.floor(screenX/strip)))]??MAX_DEPTH;
      if(depth>wallDepth+occlusionBias)return null;
      const wallH=height/depth,baseY=horizonY()+wallH*.5;
      return {screenX,baseY,depth,distance,angle,wallH};
    }

    function nodeVisual(node){
      const type=node.objectType||"crate";
      const table={
        trash:{shape:"trashcan",color:"#63717a",size:.94},
        vehicle:{shape:"car",color:"#526d79",size:1.95},
        bag:{shape:"parcel",color:"#7b725f",size:.9},
        basket:{shape:"basket",color:"#8d7658",size:.92},
        cart:{shape:"cartsearch",color:"#8a98a2",size:1.06},
        cabinet:{shape:"cabinet",color:"#667882",size:1.02},
        locker:{shape:"locker",color:"#60727d",size:1.08},
        counter:{shape:"counter",color:"#90785c",size:1.34},
        stock:{shape:"stackedcrates",color:"#a3784d",size:1.26},
        cargo:{shape:"palletload",color:"#9c7449",size:1.38},
        case:{shape:"case",color:"#546b76",size:1.08},
        panel:{shape:"panel",color:"#6d88a8",size:1.0},
        guard:{shape:"guard",color:"#616c75",size:1.12},
        safe:{shape:"safe",color:"#707781",size:1.22},
        brick:{shape:"brick",color:"#9b4f38",size:.72},
        glassdoor:{shape:"panel",color:"#70b9cd",size:1.18},
      };
      return table[type]||{shape:"case",color:"#94704a",size:1};
    }

    function drawGroundContact(x,baseY,size,alpha=.55,widthFactor=.72){
      ctx.save();
      ctx.globalAlpha=alpha;
      const g=ctx.createRadialGradient(x,baseY,0,x,baseY,Math.max(12,size*.52));
      g.addColorStop(0,"rgba(0,0,0,.76)");
      g.addColorStop(.58,"rgba(0,0,0,.36)");
      g.addColorStop(1,"rgba(0,0,0,0)");
      ctx.fillStyle=g;
      ctx.beginPath();
      ctx.ellipse(x,baseY+Math.max(1,size*.018),Math.max(8,size*widthFactor*.5),Math.max(3,size*.1),0,0,TAU);
      ctx.fill();
      ctx.restore();
    }

    function drawFloorHalo(x,baseY,size,color){
      ctx.save();
      const g=ctx.createRadialGradient(x,baseY,0,x,baseY,size*.6);
      g.addColorStop(0,color);
      g.addColorStop(.46,color.replace(/[, ]*0?\.?\d*\)$/,'0.18)'));
      g.addColorStop(1,"rgba(0,0,0,0)");
      ctx.fillStyle=g;
      ctx.beginPath();
      ctx.ellipse(x,baseY,size*.52,size*.13,0,0,TAU);
      ctx.fill();
      ctx.restore();
    }

    function drawBoxPrism(left,bottom,w,h,d,front,top,side,stroke){
      const lift=d*.55;
      ctx.fillStyle=top;
      ctx.beginPath();
      ctx.moveTo(left,bottom-h);
      ctx.lineTo(left+d,bottom-h-lift);
      ctx.lineTo(left+w+d,bottom-h-lift);
      ctx.lineTo(left+w,bottom-h);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle=stroke;
      ctx.stroke();

      ctx.fillStyle=side;
      ctx.beginPath();
      ctx.moveTo(left+w,bottom-h);
      ctx.lineTo(left+w+d,bottom-h-lift);
      ctx.lineTo(left+w+d,bottom-lift);
      ctx.lineTo(left+w,bottom);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle=front;
      ctx.fillRect(left,bottom-h,w,h);
      ctx.strokeRect(left,bottom-h,w,h);
    }

    function drawWheel(cx,cy,r){
      ctx.fillStyle="#101417";
      ctx.beginPath();ctx.arc(cx,cy,r,0,TAU);ctx.fill();
      ctx.fillStyle="#4e565d";
      ctx.beginPath();ctx.arc(cx,cy,r*.42,0,TAU);ctx.fill();
    }

    function drawObjectShape(x,baseY,size,shape,color,alpha=1,outline=false){
      ctx.save();
      ctx.globalAlpha=alpha;
      ctx.translate(x,baseY);
      ctx.lineWidth=Math.max(1,size*.042);
      const stroke=outline?"rgba(89,231,255,.98)":"rgba(0,0,0,.72)";
      ctx.strokeStyle=stroke;
      const s=size;
      const topCol=shadedColor(color,1.16);
      const sideCol=shadedColor(color,.74);
      const dark=shadedColor(color,.62);

      if(shape==="locker"||shape==="cabinet"){
        ctx.fillStyle="#272d31";ctx.fillRect(-s*.34,-s*.05,s*.12,s*.05);ctx.fillRect(s*.22,-s*.05,s*.12,s*.05);
        drawBoxPrism(-s*.31,-s*.05,s*.58,s*.84,s*.09,color,topCol,sideCol,stroke);
        ctx.strokeStyle="rgba(255,255,255,.18)";ctx.beginPath();ctx.moveTo(-s*.02,-s*.83);ctx.lineTo(-s*.02,-s*.06);ctx.stroke();
        ctx.fillStyle="#dbe2e6";ctx.fillRect(s*.11,-s*.46,s*.04,s*.07);
      }else if(shape==="trashcan"){
        ctx.fillStyle="#1d2327";ctx.beginPath();ctx.ellipse(0,-s*.03,s*.28,s*.065,0,0,TAU);ctx.fill();
        ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(-s*.28,-s*.62);ctx.lineTo(s*.28,-s*.62);ctx.lineTo(s*.23,-s*.05);ctx.lineTo(-s*.23,-s*.05);ctx.closePath();ctx.fill();ctx.stroke();
        ctx.fillStyle=dark;ctx.fillRect(-s*.33,-s*.7,s*.66,s*.09);ctx.strokeRect(-s*.33,-s*.7,s*.66,s*.09);
        ctx.strokeStyle="rgba(255,255,255,.14)";for(let xx=-.16;xx<=.16;xx+=.16){ctx.beginPath();ctx.moveTo(s*xx,-s*.58);ctx.lineTo(s*xx,-s*.12);ctx.stroke();}
      }else if(shape==="car"){
        drawWheel(-s*.34,-s*.05,s*.12);drawWheel(s*.34,-s*.05,s*.12);
        drawBoxPrism(-s*.54,-s*.1,s*1.08,s*.26,s*.18,color,topCol,sideCol,stroke);
        drawBoxPrism(-s*.24,-s*.36,s*.52,s*.18,s*.12,shadedColor(color,.96),shadedColor(color,1.12),shadedColor(color,.68),stroke);
        ctx.fillStyle="#25363e";ctx.beginPath();ctx.moveTo(-s*.18,-s*.53);ctx.lineTo(-s*.06,-s*.64);ctx.lineTo(s*.12,-s*.64);ctx.lineTo(s*.22,-s*.53);ctx.closePath();ctx.fill();
        ctx.fillStyle="#d6c18a";ctx.fillRect(-s*.5,-s*.28,s*.06,s*.06);ctx.fillRect(s*.44,-s*.28,s*.06,s*.06);
        ctx.fillStyle="rgba(255,255,255,.08)";ctx.fillRect(-s*.42,-s*.27,s*.62,s*.06);
      }else if(shape==="counter"){
        ctx.fillStyle="#2b2926";ctx.fillRect(-s*.44,-s*.05,s*.88,s*.05);
        drawBoxPrism(-s*.46,-s*.05,s*.92,s*.62,s*.11,color,topCol,sideCol,stroke);
        ctx.fillStyle=shadedColor(color,1.18);ctx.fillRect(-s*.51,-s*.77,s*1.02,s*.12);ctx.strokeRect(-s*.51,-s*.77,s*1.02,s*.12);
        ctx.fillStyle="#31393d";ctx.fillRect(-s*.17,-s*.55,s*.34,s*.18);
      }else if(shape==="case"){
        drawBoxPrism(-s*.36,-s*.06,s*.72,s*.46,s*.1,color,topCol,sideCol,stroke);
        ctx.strokeStyle="rgba(255,255,255,.28)";ctx.strokeRect(-s*.1,-s*.62,s*.2,s*.1);
        ctx.fillStyle="#252c30";ctx.fillRect(-s*.28,-s*.06,s*.08,s*.08);ctx.fillRect(s*.2,-s*.06,s*.08,s*.08);
      }else if(shape==="basket"){
        ctx.strokeStyle=color;ctx.lineWidth=s*.06;ctx.strokeRect(-s*.33,-s*.44,s*.66,s*.38);ctx.beginPath();ctx.moveTo(-s*.19,-s*.44);ctx.lineTo(-s*.08,-s*.63);ctx.lineTo(s*.08,-s*.63);ctx.lineTo(s*.19,-s*.44);ctx.stroke();
        ctx.strokeStyle="rgba(0,0,0,.32)";for(let yy=-.37;yy<-.1;yy+=.09){ctx.beginPath();ctx.moveTo(-s*.28,s*yy);ctx.lineTo(s*.28,s*yy);ctx.stroke();}
      }else if(shape==="parcel"){
        drawBoxPrism(-s*.28,-s*.06,s*.56,s*.4,s*.08,color,topCol,sideCol,stroke);
        ctx.strokeStyle="rgba(255,255,255,.14)";ctx.beginPath();ctx.moveTo(0,-s*.47);ctx.lineTo(0,-s*.06);ctx.moveTo(-s*.28,-s*.26);ctx.lineTo(s*.28,-s*.26);ctx.stroke();
      }else if(shape==="cartsearch"){
        ctx.strokeStyle=color;ctx.lineWidth=s*.055;ctx.strokeRect(-s*.4,-s*.56,s*.65,s*.42);ctx.beginPath();ctx.moveTo(s*.24,-s*.56);ctx.lineTo(s*.4,-s*.75);ctx.stroke();
        drawWheel(-s*.24,-s*.04,s*.06);drawWheel(s*.15,-s*.04,s*.06);
        ctx.strokeStyle="rgba(255,255,255,.14)";for(let xx=-.28;xx<=.12;xx+=.14){ctx.beginPath();ctx.moveTo(s*xx,-s*.51);ctx.lineTo(s*xx,-s*.18);ctx.stroke();}
      }else if(shape==="stackedcrates"){
        drawBoxPrism(-s*.46,-s*.06,s*.4,s*.24,s*.07,color,topCol,sideCol,stroke);
        drawBoxPrism(s*.02,-s*.06,s*.4,s*.24,s*.07,shadedColor(color,.96),shadedColor(color,1.12),shadedColor(color,.72),stroke);
        drawBoxPrism(-s*.2,-s*.29,s*.4,s*.24,s*.07,shadedColor(color,1.03),shadedColor(color,1.18),shadedColor(color,.7),stroke);
        ctx.strokeStyle="rgba(255,255,255,.12)";
        [ [-.46,-.18,.4,.001], [.02,-.18,.4,.001], [-.2,-.41,.4,.001] ].forEach(([bx,by,bw])=>{ctx.beginPath();ctx.moveTo(s*(bx+bw*.5),s*by);ctx.lineTo(s*(bx+bw*.5),s*(by+.18));ctx.stroke();});
      }else if(shape==="palletload"){
        ctx.fillStyle="#6e5034";
        ctx.fillRect(-s*.5,-s*.08,s,s*.08);ctx.strokeRect(-s*.5,-s*.08,s,s*.08);
        ctx.fillRect(-s*.42,-s*.12,s*.1,s*.04);ctx.fillRect(-s*.05,-s*.12,s*.1,s*.04);ctx.fillRect(s*.32,-s*.12,s*.1,s*.04);
        drawBoxPrism(-s*.38,-s*.08,s*.76,s*.44,s*.12,color,topCol,sideCol,stroke);
        ctx.strokeStyle="rgba(255,255,255,.14)";ctx.beginPath();ctx.moveTo(-s*.38,-s*.29);ctx.lineTo(s*.38,-s*.29);ctx.moveTo(0,-s*.52);ctx.lineTo(0,-s*.08);ctx.stroke();
        ctx.strokeStyle="#32383b";ctx.lineWidth=Math.max(1,s*.03);ctx.strokeRect(-s*.41,-s*.55,s*.82,s*.47);
      }else if(shape==="brick"){
        drawBoxPrism(-s*.34,-s*.04,s*.68,s*.24,s*.09,color,topCol,sideCol,stroke);
        ctx.strokeStyle="rgba(255,222,198,.28)";ctx.lineWidth=Math.max(1,s*.025);
        ctx.beginPath();ctx.moveTo(0,-s*.27);ctx.lineTo(0,-s*.04);ctx.stroke();
      }else if(shape==="panel"){
        drawBoxPrism(-s*.24,-s*.06,s*.48,s*.62,s*.08,color,topCol,sideCol,stroke);
        ctx.fillStyle="#1d2730";ctx.fillRect(-s*.18,-s*.56,s*.36,s*.24);
        ctx.fillStyle="#76d9ff";ctx.fillRect(-s*.12,-s*.49,s*.24,s*.1);
        ctx.fillStyle="#d3e6ef";ctx.fillRect(-s*.1,-s*.24,s*.2,s*.06);
      }else if(shape==="guard"){
        const skin = "#d6b08c";
        const uniform = shadedColor(color,.92);
        const vest = shadedColor(color,.72);
        ctx.fillStyle=skin;ctx.beginPath();ctx.arc(0,-s*.84,s*.14,0,TAU);ctx.fill();ctx.stroke();
        ctx.fillStyle="#2c2521";ctx.beginPath();ctx.arc(0,-s*.95,s*.08,Math.PI,TAU);ctx.fill();
        ctx.fillStyle=uniform;ctx.beginPath();ctx.moveTo(0,-s*.67);ctx.lineTo(-s*.24,-s*.48);ctx.lineTo(-s*.2,-s*.06);ctx.lineTo(s*.2,-s*.06);ctx.lineTo(s*.24,-s*.48);ctx.closePath();ctx.fill();ctx.stroke();
        ctx.fillStyle=vest;ctx.fillRect(-s*.12,-s*.61,s*.24,s*.39);ctx.strokeRect(-s*.12,-s*.61,s*.24,s*.39);
        ctx.fillStyle=skin;ctx.fillRect(-s*.26,-s*.49,s*.07,s*.26);ctx.fillRect(s*.19,-s*.49,s*.07,s*.26);
        ctx.strokeStyle=stroke;ctx.lineWidth=Math.max(1,s*.04);ctx.beginPath();
        ctx.moveTo(-s*.19,-s*.43);ctx.lineTo(-s*.31,-s*.2);
        ctx.moveTo(s*.19,-s*.43);ctx.lineTo(s*.31,-s*.2);
        ctx.moveTo(-s*.08,-s*.06);ctx.lineTo(-s*.15,s*.24);
        ctx.moveTo(s*.08,-s*.06);ctx.lineTo(s*.15,s*.24);
        ctx.stroke();
        ctx.fillStyle="#1c2023";ctx.fillRect(-s*.17,s*.19,s*.06,s*.08);ctx.fillRect(s*.11,s*.19,s*.06,s*.08);
        ctx.fillStyle="#3a4046";ctx.fillRect(-s*.03,-s*.5,s*.06,s*.24);
      }else if(shape==="safe"){
        drawBoxPrism(-s*.34,-s*.05,s*.68,s*.72,s*.11,color,topCol,sideCol,stroke);
        ctx.fillStyle="#20272d";ctx.fillRect(-s*.21,-s*.55,s*.42,s*.42);ctx.strokeRect(-s*.21,-s*.55,s*.42,s*.42);
        ctx.beginPath();ctx.arc(0,-s*.34,s*.12,0,TAU);ctx.fillStyle="#8d98a3";ctx.fill();ctx.stroke();
        ctx.strokeStyle="#d9e1e6";ctx.beginPath();ctx.moveTo(0,-s*.46);ctx.lineTo(0,-s*.22);ctx.moveTo(-s*.12,-s*.34);ctx.lineTo(s*.12,-s*.34);ctx.stroke();
      }else{
        drawBoxPrism(-s*.38,-s*.05,s*.76,s*.47,s*.1,color,topCol,sideCol,stroke);
        ctx.strokeStyle="rgba(255,255,255,.18)";ctx.beginPath();ctx.moveTo(-s*.38,-s*.27);ctx.lineTo(s*.38,-s*.27);ctx.stroke();
      }
      ctx.restore();
    }

    function guardVisionRayDistance(x, y, angle, maxRange = 7.4) {
      const step = .16;
      let distance = .38;
      for (; distance <= maxRange; distance += step) {
        const cell = cellAt(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance);
        if (cell !== 0) return Math.max(.38, distance - step * .72);
      }
      return maxRange;
    }

    function drawGuardVisionCones() {
      if (!guardCombatActive()) return;
      const now = performance.now();
      const pulse = .78 + Math.sin(now / 150) * .16;
      const range = 7.4;
      const half = .34;
      const angleSteps = 8;
      const radialSteps = 11;

      for (const node of nodes) {
        if (node.searched || node.kind !== "guard") continue;
        const pos = nodePositions.get(node.id); if (!pos) continue;
        const facing = guardFacing(node, now);
        const seeing = guardCanSeePlayer(node, now);
        const fill = seeing ? "#ff3049" : "#ffd328";
        const edge = seeing ? "#ff9aa5" : "#fff59b";
        const rayData = [];

        for (let ai = 0; ai <= angleSteps; ai += 1) {
          const offset = -half + (half * 2 * ai / angleSteps);
          const angle = facing + offset;
          rayData.push({ angle, max: guardVisionRayDistance(pos.x, pos.y, angle, range) });
        }

        // 바닥에 실제 시야 부채꼴을 여러 조각으로 그려서 벽이나 화면 가장자리 때문에
        // 한 꼭짓점이 가려져도 시야 전체가 통째로 사라지지 않게 한다.
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (let ai = 0; ai < angleSteps; ai += 1) {
          const leftRay = rayData[ai];
          const rightRay = rayData[ai + 1];
          const localMax = Math.min(leftRay.max, rightRay.max);
          for (let ri = 0; ri < radialSteps; ri += 1) {
            const r0 = .38 + (localMax - .38) * (ri / radialSteps);
            const r1 = .38 + (localMax - .38) * ((ri + 1) / radialSteps);
            if (r1 <= r0 + .01) continue;
            const p00 = screenProject(pos.x + Math.cos(leftRay.angle) * r0, pos.y + Math.sin(leftRay.angle) * r0, .92);
            const p01 = screenProject(pos.x + Math.cos(rightRay.angle) * r0, pos.y + Math.sin(rightRay.angle) * r0, .92);
            const p11 = screenProject(pos.x + Math.cos(rightRay.angle) * r1, pos.y + Math.sin(rightRay.angle) * r1, .92);
            const p10 = screenProject(pos.x + Math.cos(leftRay.angle) * r1, pos.y + Math.sin(leftRay.angle) * r1, .92);
            if (!p00 || !p01 || !p11 || !p10) continue;
            const depthFade = 1 - ri / radialSteps * .42;
            const stripeBoost = ri % 2 === 0 ? 1 : .72;
            ctx.globalAlpha = (seeing ? .31 : .20) * depthFade * stripeBoost * pulse;
            ctx.fillStyle = fill;
            ctx.beginPath();
            ctx.moveTo(p00.screenX, p00.baseY);
            ctx.lineTo(p01.screenX, p01.baseY);
            ctx.lineTo(p11.screenX, p11.baseY);
            ctx.lineTo(p10.screenX, p10.baseY);
            ctx.closePath();
            ctx.fill();
          }
        }
        ctx.globalCompositeOperation = "source-over";

        // 실제 감지 범위의 좌/우 경계와 중앙선을 강하게 표시한다.
        const apex = screenProject(pos.x, pos.y, .95);
        if (apex) {
          for (const index of [0, Math.floor(angleSteps / 2), angleSteps]) {
            const ray = rayData[index];
            const end = screenProject(pos.x + Math.cos(ray.angle) * ray.max, pos.y + Math.sin(ray.angle) * ray.max, .95);
            if (!end) continue;
            ctx.globalAlpha = (seeing ? .98 : .84) * pulse;
            ctx.strokeStyle = index === Math.floor(angleSteps / 2) ? fill : edge;
            ctx.lineWidth = index === Math.floor(angleSteps / 2) ? 2 : 3;
            ctx.setLineDash(index === Math.floor(angleSteps / 2) ? [6, 8] : [10, 6]);
            ctx.beginPath();
            ctx.moveTo(apex.screenX, apex.baseY);
            ctx.lineTo(end.screenX, end.baseY);
            ctx.stroke();
          }
          ctx.setLineDash([]);
        }

        const centerRay = rayData[Math.floor(angleSteps / 2)];
        const labelDistance = Math.min(centerRay.max * .58, 4.2);
        const center = screenProject(pos.x + Math.cos(facing) * labelDistance, pos.y + Math.sin(facing) * labelDistance, .95);
        if (center) {
          ctx.globalAlpha = 1;
          ctx.textAlign = "center";
          ctx.font = `900 ${seeing ? 14 : 12}px Segoe UI, sans-serif`;
          ctx.fillStyle = seeing ? "#ffe5e8" : "#fff8c7";
          ctx.shadowColor = fill;
          ctx.shadowBlur = seeing ? 18 : 12;
          ctx.fillText(seeing ? "⚠ 경비 시야 · 발각" : "경비 시야", center.screenX, center.baseY - 10);
        }
        ctx.restore();
      }
    }

    function drawNodes(now){
      const visible=[];
      for(const node of nodes){if(node.searched||node.kind==="store-door")continue;const pos=nodePositions.get(node.id);if(!pos)continue;const p=screenProject(pos.x,pos.y,.68);if(p&&p.distance<18)visible.push({node,pos,p});}
      visible.sort((a,b)=>b.p.depth-a.p.depth);
      for(const item of visible){
        const {node,p}=item,near=p.distance<=INTERACT_DISTANCE,alpha=clamp(1.25-p.distance/22,.24,1),visual=nodeVisual(node);
        // 파밍 오브젝트와 경비원 모두 월드 투영값(wallH)을 그대로 사용합니다.
        // screenProject()의 wallH는 depth가 가까워질수록 커지므로 화면 크기도 반드시 커지고,
        // 멀어질수록 작아집니다. 별도의 거리 보정식은 사용하지 않습니다.
        const sizeMultiplier=visual.size||1;
        const projectedSize=p.wallH*.30*sizeMultiplier;
        const maxSize=visual.shape==="car"?330:visual.shape==="palletload"?280:visual.shape==="guard"?230:250;
        const minSize=visual.shape==="guard"?26:24;
        const scale=clamp(projectedSize,minSize,maxSize);
        const baseY=Math.min(p.baseY,height-Math.max(7,scale*.035));
        drawGroundContact(p.screenX,baseY,scale,alpha*.74,visual.shape==="car"?1.18:visual.shape==="palletload"?1.02:.76);
        if(visual.shape==="safe"){
          const pulse=.22+Math.sin(now/180)*.045;
          drawFloorHalo(p.screenX,baseY,scale,`rgba(255,213,79,${pulse})`);
        }else if(node.special){
          const pulse=.24+Math.sin(now/180)*.05;
          drawFloorHalo(p.screenX,baseY,scale,`rgba(255,226,128,${pulse})`);
        }else if(near){
          drawFloorHalo(p.screenX,baseY,scale,"rgba(65,217,255,.16)");
        }
        drawObjectShape(p.screenX,baseY,scale,visual.shape,visual.color,alpha,near);
        if(visual.shape==="guard"&&p.distance<13){
          const hp=Math.max(0,Number(node.hp ?? node.maxHp ?? 50)),maxHp=Math.max(1,Number(node.maxHp ?? 50));
          const w=Math.max(34,scale*.62),h=Math.max(4,scale*.035),x=p.screenX-w/2,y=baseY-scale*1.08;
          ctx.save();ctx.globalAlpha=alpha;ctx.fillStyle="rgba(0,0,0,.72)";ctx.fillRect(x,y,w,h);ctx.fillStyle=hp/maxHp>.5?"#70ef96":hp/maxHp>.25?"#ffd166":"#ff6874";ctx.fillRect(x,y,w*(hp/maxHp),h);ctx.strokeStyle="rgba(255,255,255,.25)";ctx.strokeRect(x,y,w,h);ctx.fillStyle="#eaf5ff";ctx.font="800 9px Segoe UI, sans-serif";ctx.textAlign="center";ctx.fillText(`${hp}/${maxHp}`,p.screenX,y-4);ctx.restore();
        }
        if(visual.shape==="safe"&&p.distance<13){
          ctx.save();ctx.textAlign="center";ctx.fillStyle="#ffe69a";ctx.font="800 11px Segoe UI, sans-serif";ctx.shadowColor="rgba(255,210,80,.75)";ctx.shadowBlur=8;
          ctx.fillText(near?"E  은행 금고":"BANK SAFE",p.screenX,baseY-scale*.94);ctx.restore();
        }
      }
    }

    function propVisual(type){
      const table={bike:["bike","#667781"],bin:["wallbin","#53616a"],ac:["ac","#b6bec2"],vending:["vending","#2f6782"],bench:["bench","#755c43"],bollard:["bollard","#d9b53f"],bag:["parcel","#4b4b49"],pipe:["pipe","#8a9599"],plant:["plant","#5b7f5e"],cart:["cart","#8a969f"],sign:["sign","#c9b472"],trash:["wallbin","#626b6d"],chair:["chair","#6e6250"],kiosk:["kiosk","#595f60"],table:["table","#766a58"],shutter:["shutter","#65696b"],pallet:["pallet","#8d6843"],forklift:["forklift","#d5a628"],drum:["drum","#517887"],cage:["cage","#6f7c80"],crate:["crate","#8a6847"],conveyor:["conveyor","#69777b"],barrier:["barrier","#d6b73f"]};return table[type]||["crate","#777"];
    }

    function drawPropShape(x,baseY,size,type,color,alpha){
      ctx.save();ctx.globalAlpha=alpha;ctx.translate(x,baseY);ctx.strokeStyle="rgba(0,0,0,.7)";ctx.lineWidth=Math.max(1,size*.04);ctx.fillStyle=color;const s=size;
      if(type==="bike"){ctx.strokeStyle=color;ctx.lineWidth=s*.06;ctx.beginPath();ctx.arc(-s*.25,-s*.12,s*.18,0,TAU);ctx.arc(s*.25,-s*.12,s*.18,0,TAU);ctx.moveTo(-s*.25,-s*.12);ctx.lineTo(0,-s*.42);ctx.lineTo(s*.18,-s*.12);ctx.lineTo(-s*.12,-s*.12);ctx.lineTo(s*.25,-s*.12);ctx.stroke();}
      else if(type==="ac"){ctx.fillRect(-s*.38,-s*.65,s*.76,s*.52);ctx.strokeRect(-s*.38,-s*.65,s*.76,s*.52);ctx.strokeStyle="#6d7477";ctx.beginPath();ctx.arc(0,-s*.39,s*.16,0,TAU);ctx.stroke();}
      else if(type==="vending"){ctx.fillRect(-s*.34,-s*.95,s*.68,s*.9);ctx.strokeRect(-s*.34,-s*.95,s*.68,s*.9);ctx.fillStyle="#91d5ef";ctx.fillRect(-s*.22,-s*.79,s*.44,s*.28);ctx.fillStyle="#1b2428";ctx.fillRect(-s*.18,-s*.3,s*.36,s*.16);}
      else if(type==="bench"){ctx.fillRect(-s*.48,-s*.37,s*.96,s*.18);ctx.strokeRect(-s*.48,-s*.37,s*.96,s*.18);ctx.fillRect(-s*.42,-s*.65,s*.84,s*.16);ctx.fillRect(-s*.38,-s*.2,s*.08,s*.2);ctx.fillRect(s*.3,-s*.2,s*.08,s*.2);}
      else if(type==="bollard"){ctx.fillRect(-s*.09,-s*.7,s*.18,s*.66);ctx.strokeRect(-s*.09,-s*.7,s*.18,s*.66);ctx.fillStyle="#1c1d1e";ctx.fillRect(-s*.1,-s*.4,s*.2,s*.08);}
      else if(type==="pipe"){ctx.strokeStyle=color;ctx.lineWidth=s*.1;ctx.beginPath();ctx.moveTo(0,-s);ctx.lineTo(0,-s*.22);ctx.quadraticCurveTo(0,-s*.05,s*.18,-s*.05);ctx.stroke();}
      else if(type==="plant"){ctx.fillStyle="#6f5a43";ctx.fillRect(-s*.16,-s*.25,s*.32,s*.23);ctx.fillStyle=color;for(let i=-2;i<=2;i++){ctx.beginPath();ctx.ellipse(i*s*.08,-s*.48-Math.abs(i)*s*.04,s*.1,s*.24,i*.22,0,TAU);ctx.fill();}}
      else if(type==="cart"){ctx.strokeStyle=color;ctx.lineWidth=s*.06;ctx.strokeRect(-s*.38,-s*.48,s*.64,s*.38);ctx.beginPath();ctx.arc(-s*.22,-s*.04,s*.07,0,TAU);ctx.arc(s*.16,-s*.04,s*.07,0,TAU);ctx.stroke();}
      else if(type==="sign"){ctx.fillRect(-s*.32,-s*.75,s*.64,s*.42);ctx.strokeRect(-s*.32,-s*.75,s*.64,s*.42);ctx.fillRect(-s*.04,-s*.33,s*.08,s*.33);}
      else if(type==="chair"){ctx.fillRect(-s*.28,-s*.38,s*.56,s*.12);ctx.fillRect(-s*.25,-s*.68,s*.5,s*.23);ctx.fillRect(-s*.22,-s*.26,s*.06,s*.26);ctx.fillRect(s*.16,-s*.26,s*.06,s*.26);}
      else if(type==="kiosk"){ctx.fillRect(-s*.36,-s*.88,s*.72,s*.82);ctx.strokeRect(-s*.36,-s*.88,s*.72,s*.82);ctx.fillStyle="#26363c";ctx.fillRect(-s*.23,-s*.72,s*.46,s*.32);}
      else if(type==="table"){ctx.fillRect(-s*.46,-s*.4,s*.92,s*.14);ctx.fillRect(-s*.38,-s*.28,s*.07,s*.28);ctx.fillRect(s*.31,-s*.28,s*.07,s*.28);}
      else if(type==="shutter"){ctx.fillRect(-s*.45,-s,s*.9,s*.98);ctx.strokeRect(-s*.45,-s,s*.9,s*.98);ctx.strokeStyle="rgba(255,255,255,.15)";for(let yy=-.9;yy<0;yy+=.12){ctx.beginPath();ctx.moveTo(-s*.42,s*yy);ctx.lineTo(s*.42,s*yy);ctx.stroke();}}
      else if(type==="forklift"){ctx.fillRect(-s*.4,-s*.5,s*.55,s*.42);ctx.strokeRect(-s*.4,-s*.5,s*.55,s*.42);ctx.strokeStyle="#394247";ctx.lineWidth=s*.08;ctx.beginPath();ctx.moveTo(s*.2,-s*.7);ctx.lineTo(s*.2,-s*.05);ctx.moveTo(s*.2,-s*.06);ctx.lineTo(s*.55,-s*.06);ctx.stroke();ctx.fillStyle="#1e2528";ctx.beginPath();ctx.arc(-s*.25,-s*.04,s*.12,0,TAU);ctx.arc(s*.08,-s*.04,s*.12,0,TAU);ctx.fill();}
      else if(type==="drum"){ctx.beginPath();ctx.roundRect(-s*.24,-s*.72,s*.48,s*.68,s*.14);ctx.fill();ctx.stroke();ctx.strokeStyle="rgba(255,255,255,.25)";ctx.beginPath();ctx.moveTo(-s*.22,-s*.5);ctx.lineTo(s*.22,-s*.5);ctx.moveTo(-s*.22,-s*.22);ctx.lineTo(s*.22,-s*.22);ctx.stroke();}
      else if(type==="cage"){ctx.strokeStyle=color;ctx.lineWidth=s*.05;ctx.strokeRect(-s*.4,-s*.78,s*.8,s*.72);for(let xx=-.3;xx<=.3;xx+=.15){ctx.beginPath();ctx.moveTo(s*xx,-s*.76);ctx.lineTo(s*xx,-s*.08);ctx.stroke();}}
      else if(type==="conveyor"){ctx.fillRect(-s*.55,-s*.35,s*1.1,s*.22);ctx.strokeRect(-s*.55,-s*.35,s*1.1,s*.22);for(let xx=-.42;xx<=.42;xx+=.2){ctx.beginPath();ctx.arc(s*xx,-s*.24,s*.07,0,TAU);ctx.stroke();}}
      else if(type==="barrier"){ctx.fillStyle="#d8be4a";ctx.fillRect(-s*.5,-s*.48,s,s*.12);ctx.strokeRect(-s*.5,-s*.48,s,s*.12);ctx.fillStyle="#555";ctx.fillRect(-s*.42,-s*.36,s*.08,s*.36);ctx.fillRect(s*.34,-s*.36,s*.08,s*.36);}
      else if(type==="pallet"){ctx.fillRect(-s*.46,-s*.22,s*.92,s*.18);ctx.strokeRect(-s*.46,-s*.22,s*.92,s*.18);ctx.strokeStyle="rgba(0,0,0,.45)";for(let xx=-.32;xx<=.32;xx+=.16){ctx.beginPath();ctx.moveTo(s*xx,-s*.22);ctx.lineTo(s*xx,-s*.04);ctx.stroke();}}
      else drawObjectShape(0,0,s,type,color,1,false);
      ctx.restore();
    }

    function drawProps(){
      const visible=[];for(const prop of map.props||[]){const p=screenProject(prop.x,prop.y);if(p&&p.distance<20)visible.push({prop,p});}
      visible.sort((a,b)=>b.p.depth-a.p.depth);
      for(const {prop,p} of visible){
        const [type,color]=propVisual(prop.type),size=clamp(p.wallH*.28*(prop.scale||1),22,170),alpha=clamp(1.2-p.distance/24,.2,1);
        if(type!=="pipe"&&type!=="shutter") drawGroundContact(p.screenX,p.baseY,size,alpha*.48,type==="forklift"?1.15:.72);
        drawPropShape(p.screenX,p.baseY,size,type,color,alpha);
      }
    }

    function drawSafe(now){
      const info=safeInfo();if(!info.visible||!safePosition)return;const p=screenProject(safePosition.x,safePosition.y);if(!p)return;
      // 현장 금고도 다른 파밍 포인트와 동일한 거리 기반 원근감을 사용합니다.
      // 멀리 있을 때 작고 가까이 갈수록 커집니다.
      const safePerspective=clamp(1-(p.distance-1.4)/15.5,0,1);
      const safeFar=clamp(Math.min(width,height)*.06,38,54);
      const safeNear=clamp(Math.min(width,height)*.24,150,205);
      const s=clamp(lerp(safeFar,safeNear,Math.pow(safePerspective,.82)),34,220),near=info.near,pulse=.22+Math.sin(now/220)*.05;
      drawGroundContact(p.screenX,p.baseY,s,.66,.82);
      if(near) drawFloorHalo(p.screenX,p.baseY,s,`rgba(255,213,79,${pulse})`);
      ctx.save();ctx.translate(p.screenX,p.baseY);ctx.fillStyle="#4c545a";ctx.strokeStyle=near?"#f2d26b":"#24292d";ctx.lineWidth=Math.max(2,s*.035);ctx.beginPath();ctx.roundRect(-s*.42,-s*.88,s*.84,s*.88,s*.08);ctx.fill();ctx.stroke();
      ctx.fillStyle="#2b3034";ctx.beginPath();ctx.arc(0,-s*.48,s*.17,0,TAU);ctx.fill();ctx.strokeStyle="#89939a";ctx.stroke();ctx.fillStyle="#727c82";ctx.fillRect(-s*.03,-s*.62,s*.06,s*.28);ctx.fillRect(-s*.14,-s*.51,s*.28,s*.06);ctx.fillStyle="#181c1e";ctx.fillRect(s*.24,-s*.68,s*.08,s*.12);ctx.restore();
      if(near){ctx.save();ctx.textAlign="center";ctx.fillStyle="#ffe69a";ctx.font="800 12px Segoe UI, sans-serif";ctx.shadowColor="rgba(255,210,80,.8)";ctx.shadowBlur=10;ctx.fillText("E  금고 조사",p.screenX,p.baseY-s*.98);ctx.restore();}
    }

    function drawExitDoorLabel(now){
      const info=exitInfo();if(!Number.isFinite(info.distance))return;
      const p=screenProject(info.x,info.y);if(!p||p.distance>18)return;
      const size=clamp(p.wallH*.34,34,150),near=info.near,pulse=.78+Math.sin(now/180)*.12;
      ctx.save();ctx.textAlign="center";ctx.textBaseline="middle";
      ctx.shadowColor=`rgba(60,255,106,${pulse})`;ctx.shadowBlur=near?24:15;
      ctx.fillStyle="rgba(5,28,12,.82)";ctx.strokeStyle=near?"#8dffa7":"#3cff6e";ctx.lineWidth=Math.max(2,size*.025);
      const w=size*.9,h=size*.3,y=p.baseY-size*.72;ctx.beginPath();ctx.roundRect(p.screenX-w/2,y-h/2,w,h,5);ctx.fill();ctx.stroke();
      ctx.fillStyle=near?"#d4ffdc":"#76ff94";ctx.font=`900 ${Math.max(12,size*.15)}px Segoe UI, sans-serif`;ctx.fillText("EXIT",p.screenX,y);ctx.restore();
    }

    function drawExitWaypoint(now){
      const info=exitInfo();if(!Number.isFinite(info.distance))return;
      const normalized=clamp(info.angle/Math.PI,-1,1),x=clamp(width*(.5+normalized*.42),58,width-58),y=clamp(height*.22+Math.abs(normalized)*height*.07,54,height*.4),near=info.near;
      const pulse=near?.88+Math.sin(now/120)*.1:.62+Math.sin(now/230)*.08;
      ctx.save();ctx.translate(x,y);ctx.shadowColor=`rgba(76,255,118,${pulse})`;ctx.shadowBlur=near?26:18;ctx.strokeStyle=near?"#9affaa":"#4cff76";ctx.lineWidth=3;
      const dw=34,dh=50;ctx.strokeRect(-dw/2,-dh/2,dw,dh);ctx.beginPath();ctx.arc(dw*.25,0,2.5,0,TAU);ctx.stroke();ctx.beginPath();ctx.moveTo(-dw*.34,dh*.12);ctx.lineTo(0,dh*.29);ctx.lineTo(dw*.34,dh*.12);ctx.stroke();
      ctx.shadowBlur=10;ctx.fillStyle=near?"#baffc4":"#76ff94";ctx.textAlign="center";ctx.font="900 11px Segoe UI, sans-serif";ctx.fillText("EXIT",0,dh*.62);ctx.font="800 10px Segoe UI, sans-serif";ctx.fillText(`${Math.max(0,info.distance).toFixed(1)}m${near?" · E":""}`,0,dh*.88);ctx.restore();
    }

    function drawStoreDoorLabel(now){
      if(mapId!=="abandoned_store"||missionState?.storeDoorBroken||!map.storeDoorPoint)return;
      const p=screenProject(map.storeDoorPoint.x,map.storeDoorPoint.y);if(!p||p.distance>13)return;
      const w=clamp(p.wallH*.72,120,300),h=clamp(p.wallH*.2,36,70),y=p.baseY-clamp(p.wallH*.67,68,200);
      const hasBrick=Boolean(missionState?.storeBrickOwned);
      ctx.save();ctx.textAlign="center";ctx.textBaseline="middle";
      ctx.shadowColor=hasBrick?"rgba(255,151,92,.82)":"rgba(118,218,241,.72)";ctx.shadowBlur=15+Math.sin(now/210)*3;
      ctx.fillStyle="rgba(10,15,18,.9)";ctx.strokeStyle=hasBrick?"#ff995f":"#79d6eb";ctx.lineWidth=2;
      ctx.beginPath();ctx.roundRect(p.screenX-w/2,y-h/2,w,h,8);ctx.fill();ctx.stroke();
      ctx.fillStyle="#f1f8fb";ctx.font=`900 ${Math.max(13,h*.3)}px Segoe UI, sans-serif`;ctx.fillText("상가 유리문",p.screenX,y-h*.08);
      ctx.fillStyle=hasBrick?"#ffc39c":"#9cecff";ctx.font=`800 ${Math.max(10,h*.18)}px Segoe UI, sans-serif`;ctx.fillText(hasBrick?"조준 후 좌클릭 · 벽돌 던지기":"입구 근처 벽돌 필요",p.screenX,y+h*.23);ctx.restore();
    }

    function drawBrickThrowFx(now){
      if(now>brickThrowUntil)return;
      const duration=360,t=clamp(1-(brickThrowUntil-now)/duration,0,1),ease=1-Math.pow(1-t,2);
      const sx=width*.77,sy=height*.82,ex=width*.5,ey=height*.48;
      const x=sx+(ex-sx)*ease,y=sy+(ey-sy)*ease-Math.sin(Math.PI*t)*height*.12;
      const size=clamp(Math.min(width,height)*(.035+.018*t),18,42);
      ctx.save();ctx.translate(x,y);ctx.rotate(t*Math.PI*4.4);ctx.fillStyle="#9d4f36";ctx.strokeStyle="#3c2019";ctx.lineWidth=2;
      ctx.fillRect(-size*.5,-size*.22,size,size*.44);ctx.strokeRect(-size*.5,-size*.22,size,size*.44);ctx.restore();
      if(brickThrowHit&&t>.54){
        const a=clamp((t-.54)/.46,0,1);ctx.save();ctx.translate(width*.5,height*.48);ctx.globalAlpha=1-a*.45;ctx.strokeStyle="rgba(218,247,255,.9)";ctx.lineWidth=2;
        for(let i=0;i<13;i+=1){const ang=(i/13)*TAU+(i%3)*.17,len=(28+i*5)*a;ctx.beginPath();ctx.moveTo(Math.cos(ang)*8,Math.sin(ang)*8);ctx.lineTo(Math.cos(ang)*len,Math.sin(ang)*len);ctx.stroke();}
        ctx.restore();
      }
    }

    function drawBankDoorLabel(now){
      if(mapId!=="bank"||missionState?.bankDoorUnlocked||!map.bankDoorPoint)return;
      const p=screenProject(map.bankDoorPoint.x,map.bankDoorPoint.y);if(!p||p.distance>12)return;
      const w=clamp(p.wallH*.78,120,320),h=clamp(p.wallH*.21,38,76),y=p.baseY-clamp(p.wallH*.72,72,210);
      ctx.save();ctx.textAlign="center";ctx.textBaseline="middle";
      ctx.shadowColor="rgba(166,108,255,.8)";ctx.shadowBlur=16+Math.sin(now/220)*3;
      ctx.fillStyle="rgba(9,12,18,.9)";ctx.strokeStyle="#9b77e8";ctx.lineWidth=2;
      ctx.beginPath();ctx.roundRect(p.screenX-w/2,y-h/2,w,h,8);ctx.fill();ctx.stroke();
      ctx.shadowBlur=8;ctx.fillStyle="#e8dcff";ctx.font=`900 ${Math.max(13,h*.31)}px Segoe UI, sans-serif`;ctx.fillText("BANK ACCESS",p.screenX,y-h*.09);
      ctx.fillStyle="#b798ff";ctx.font=`800 ${Math.max(10,h*.19)}px Segoe UI, sans-serif`;ctx.fillText("UV LOCK · E",p.screenX,y+h*.23);ctx.restore();
    }

    function drawGunModel(now){
      if(!guardCombatActive())return;
      const totalGuards=nodes.filter((node)=>node.kind==="guard").length;
      if(totalGuards<=0||Number(missionState?.guardsNeutralized||0)>=totalGuards)return;
      const s=clamp(Math.min(width,height)*.19,70,145),x=width*.79,y=height+8;
      ctx.save();ctx.translate(x,y);ctx.rotate(-.08);
      ctx.fillStyle="#20252a";ctx.strokeStyle="#050607";ctx.lineWidth=Math.max(2,s*.025);
      ctx.beginPath();ctx.roundRect(-s*.42,-s*.27,s*.7,s*.18,s*.035);ctx.fill();ctx.stroke();
      ctx.fillStyle="#3c434a";ctx.fillRect(-s*.31,-s*.37,s*.58,s*.11);ctx.strokeRect(-s*.31,-s*.37,s*.58,s*.11);
      ctx.fillStyle="#181c20";ctx.beginPath();ctx.moveTo(-s*.12,-s*.1);ctx.lineTo(s*.09,-s*.09);ctx.lineTo(s*.03,s*.34);ctx.lineTo(-s*.17,s*.33);ctx.closePath();ctx.fill();ctx.stroke();
      ctx.fillStyle="#555e65";ctx.fillRect(-s*.27,-s*.4,s*.12,s*.035);
      if(now<=gunFlashUntil){
        const t=clamp((gunFlashUntil-now)/150,0,1);ctx.globalAlpha=.45+.55*t;ctx.shadowColor="#ffce70";ctx.shadowBlur=26;
        ctx.fillStyle=gunFlashHit?"#ffe39b":"#ffc75a";ctx.beginPath();ctx.moveTo(-s*.48,-s*.31);ctx.lineTo(-s*.66,-s*.43);ctx.lineTo(-s*.57,-s*.29);ctx.lineTo(-s*.69,-s*.21);ctx.closePath();ctx.fill();
      }
      ctx.restore();
      if(now<=gunFlashUntil){
        const t=clamp((gunFlashUntil-now)/150,0,1),cx=width/2,cy=height/2;
        ctx.save();ctx.globalAlpha=.25+.6*t;ctx.strokeStyle=gunFlashHit?"rgba(255,226,150,.95)":"rgba(235,235,235,.55)";ctx.lineWidth=1.4;
        ctx.beginPath();ctx.moveTo(width*.70,height*.78);ctx.lineTo(cx,cy);ctx.stroke();ctx.restore();
      }
    }

    function drawHud(){
      // 우측 상단 맵 텍스트는 제거하고 조준점만 남깁니다.
      ctx.save();ctx.globalAlpha=.85;ctx.strokeStyle="rgba(231,249,255,.85)";ctx.lineWidth=2;const cx=width/2,cy=height/2;
      ctx.beginPath();ctx.moveTo(cx-8,cy);ctx.lineTo(cx-2,cy);ctx.moveTo(cx+2,cy);ctx.lineTo(cx+8,cy);ctx.moveTo(cx,cy-8);ctx.lineTo(cx,cy-2);ctx.moveTo(cx,cy+2);ctx.lineTo(cx,cy+8);ctx.stroke();ctx.restore();
    }

    function render(now=performance.now()){
      if(!active)return;ctx.clearRect(0,0,width,height);drawBackground();drawWalls();drawProps();drawGuardVisionCones();drawNodes(now);drawSafe(now);drawStoreDoorLabel(now);drawBankDoorLabel(now);drawExitDoorLabel(now);drawExitWaypoint(now);drawGunModel(now);drawBrickThrowFx(now);drawHud();
      if(now<playerHitUntil){const t=clamp((playerHitUntil-now)/260,0,1);const g=ctx.createRadialGradient(width/2,height/2,Math.min(width,height)*.18,width/2,height/2,Math.max(width,height)*.7);g.addColorStop(0,"rgba(255,30,45,0)");g.addColorStop(1,`rgba(255,35,48,${.34*t})`);ctx.fillStyle=g;ctx.fillRect(0,0,width,height);}
    }

    function update(dt,keys){
      if(!active||searching){render(performance.now());return;}
      const seconds=clamp(dt/1000,0,.05),sprinting=keys?.has("shift"),moveSpeed=sprinting?4.15:2.75,strafeSpeed=sprinting?3.65:2.45;
      let forward=0,strafe=0;if(keys?.has("w")||keys?.has("arrowup"))forward+=1;if(keys?.has("s")||keys?.has("arrowdown"))forward-=1;if(keys?.has("a")||keys?.has("arrowleft"))strafe-=1;if(keys?.has("d")||keys?.has("arrowright"))strafe+=1;
      if(forward||strafe){const mag=Math.hypot(forward,strafe)||1;forward/=mag;strafe/=mag;const dx=Math.cos(player.angle)*forward*moveSpeed*seconds+Math.cos(player.angle+Math.PI/2)*strafe*strafeSpeed*seconds,dy=Math.sin(player.angle)*forward*moveSpeed*seconds+Math.sin(player.angle+Math.PI/2)*strafe*strafeSpeed*seconds;const bx=player.x,by=player.y;movePlayer(dx,dy);const moved=Math.hypot(player.x-bx,player.y-by);stepDistance+=moved;bob+=moved*(sprinting?5.8:4.5);if(stepDistance>=(sprinting?1.45:1.8)){stepDistance=0;options.onStep?.(sprinting);}}else bob*=.985;
      if(guardCombatActive()){
        const guardNow=performance.now();
        const seeing=guardsSeeingPlayer(guardNow);
        if(seeing.length&&!missionState?.guardAlarmTriggered&&!guardAlertPending){guardAlertPending=true;options.onGuardAlert?.(seeing[0]);}
        guardAttackCooldown=Math.max(0,guardAttackCooldown-seconds);
        if(seeing.length&&guardAttackCooldown<=0){guardAttackCooldown=1.15;options.onGuardAttack?.(seeing[0]);}
      }
      const nearest=nearestNode(),nearestId=nearest?.id||null;if(nearestId!==lastNearestId){lastNearestId=nearestId;options.onNearestChange?.(nearest||null);}
      const sInfo=safeInfo(),sNear=Boolean(sInfo.near);if(sNear!==lastSafeNear){lastSafeNear=sNear;options.onSafeChange?.(sInfo);}
      options.onExitChange?.(exitInfo());render(performance.now());
    }

    function setSearching(value){searching=Boolean(value);}
    function rotate(delta){player.angle=normAngle(player.angle+delta);}
    function requestPointer(){
      autoLockPending=true;
      try{
        const p=canvas.requestPointerLock?.();
        if(p?.catch)p.catch(()=>{});
      }catch{}
    }
    function onMouseMove(event){if(!active||document.pointerLockElement!==canvas)return;rotate(event.movementX*mouseSensitivity);player.pitch=clamp((player.pitch||0)+event.movementY*mouseSensitivity*.38,-.18,.18);}
    function onPointerLockChange(){pointerLocked=document.pointerLockElement===canvas;container.classList.toggle("pointer-locked",pointerLocked);if(pointerLocked)autoLockPending=false;options.onPointerLockChange?.(pointerLocked);}

    function onCanvasClick(){
      if(!active)return;
      if(document.pointerLockElement!==canvas){requestPointer();return;}
      options.onPrimaryAction?.();
    }
    canvas.addEventListener("click",onCanvasClick);document.addEventListener("mousemove",onMouseMove);document.addEventListener("pointerlockchange",onPointerLockChange);window.addEventListener("resize",resize);
    const resizeObserver=typeof ResizeObserver!=="undefined"?new ResizeObserver(()=>resize()):null;resizeObserver?.observe(container);

    return {
      mount,unmount,syncNodes,syncSafe,syncMissionState,update,render,resize,nearestNode,safeInfo,exitInfo,aimedGuard,aimedStoreDoor,fireGunFx,playerHitFx,throwBrickFx,
      isSafeNearby:()=>safeInfo().near,isExitNearby:()=>exitInfo().near,setSearching,isActive:()=>active,isPointerLocked:()=>pointerLocked,requestPointer,
      getPlayer:()=>({...player}),setMouseSensitivity(value){mouseSensitivity=clamp(Number(value)||.0022,.0008,.006);},
      destroy(){unmount();canvas.removeEventListener("click",onCanvasClick);document.removeEventListener("mousemove",onMouseMove);document.removeEventListener("pointerlockchange",onPointerLockChange);window.removeEventListener("resize",resize);resizeObserver?.disconnect();}
    };
  }

  window.Mission3D={create};
})();
