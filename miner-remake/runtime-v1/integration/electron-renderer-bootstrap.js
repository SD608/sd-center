"use strict";

(async () => {
  if (!window.sdMinerRuntime) return;

  const expose = (value) => {
    window.__sdMinerRuntimeGate = Object.freeze(value);
  };
  expose({ ready: false, error: null });

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`SCRIPT_LOAD_FAILED:${src}`));
      document.head.appendChild(script);
    });
  }

  function addRuntimeHost() {
    const stage = document.getElementById("mineStage");
    if (!stage) throw new Error("MINE_STAGE_MISSING");
    window.sdMinerUI?.openArea("mine");

    const host = document.createElement("div");
    host.id = "encounterRuntimeHost";
    Object.assign(host.style, {
      position: "absolute",
      inset: "12px",
      zIndex: "20",
      borderRadius: "12px",
      overflow: "hidden",
      boxShadow: "0 0 0 1px rgba(255,255,255,.14) inset",
      background: "#10151b",
    });

    const badge = document.createElement("div");
    badge.id = "encounterRuntimeStatus";
    badge.textContent = "RUNTIME BOOT";
    Object.assign(badge.style, {
      position: "absolute",
      right: "20px",
      top: "18px",
      zIndex: "21",
      padding: "5px 8px",
      borderRadius: "6px",
      background: "rgba(0,0,0,.72)",
      color: "#d8f6ff",
      font: "12px sans-serif",
    });

    stage.append(host, badge);
    return { host, badge };
  }

  function bootPhaser(host) {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("ELECTRON_PHASER_BOOT_TIMEOUT")), 8000);
      const width = Math.max(480, Math.floor(host.getBoundingClientRect().width || 720));
      const height = Math.max(240, Math.floor(host.getBoundingClientRect().height || 360));
      const scene = {
        create() {
          this.physics.world.setBounds(0, 0, width, height);
          const floor = this.add.rectangle(width / 2, height - 18, width, 36, 0x4a3b2c);
          this.physics.add.existing(floor, true);
          const player = this.add.rectangle(width * 0.24, height - 72, 22, 38, 0x78b7ff);
          this.physics.add.existing(player);
          player.body.setGravityY(600);
          player.body.setCollideWorldBounds(true);
          const boss = this.add.rectangle(width * 0.72, height - 82, 70, 92, 0xb85c3d);
          this.physics.add.existing(boss);
          boss.body.setImmovable(true);
          this.physics.add.collider(player, floor);
          this.physics.add.collider(boss, floor);
          window.clearTimeout(timeout);
          resolve();
        },
      };
      window.__sdMinerRuntimeGame = new Phaser.Game({
        type: Phaser.CANVAS,
        width,
        height,
        parent: host,
        backgroundColor: "#11151a",
        physics: { default: "arcade", arcade: { gravity: { y: 0 }, debug: false } },
        audio: { noAudio: true },
        scene,
      });
    });
  }

  async function runPersistenceSmoke() {
    const runId = `electron-gate-${Date.now()}`;
    const encounterId = "abister-foundation";
    const now = new Date().toISOString();
    const record = {
      authority_epoch: 0,
      commit_seq: 1,
      event_type: "TARGET_ACQUIRE",
      payload: { target_id: "gate-player" },
    };
    const appendSeq = await window.sdMinerRuntime.appendJournal({
      run_id: runId,
      encounter_id: encounterId,
      record,
    });
    const snapshot = {
      schema_version: 1,
      snapshot_generation: 1,
      base_commit_seq: 1,
      commit_seq: 1,
      run_id: runId,
      encounter_id: encounterId,
      authority_epoch: 0,
      last_resume_checkpoint_utc: now,
      boss: { hp: 3600, phase: "P1", x: 0, y: 0, seal_committed: false },
      participants: {},
      hazards: [],
      p3_env: { active: false, remaining_ms: 5000 },
      attack_history: [],
      clock: { elapsed_ms: 0, paused: false, pause_reason: null },
    };
    const writeResult = await window.sdMinerRuntime.writeSnapshot({
      run_id: runId,
      encounter_id: encounterId,
      snapshot,
    });
    const recovery = await window.sdMinerRuntime.readRecovery({
      run_id: runId,
      encounter_id: encounterId,
    });
    return {
      appendSeq,
      writeOk: writeResult?.ok === true,
      snapshotCount: recovery?.snapshots?.length || 0,
      journalCount: recovery?.journal?.length || 0,
      latestCommitSeq: recovery?.snapshots?.[0]?.commit_seq ?? null,
    };
  }

  try {
    const { host, badge } = addRuntimeHost();
    await loadScript(new URL("../runtime-v1/node_modules/phaser/dist/phaser.js", window.location.href).href);
    if (!window.Phaser || window.Phaser.VERSION !== "4.2.1") throw new Error("PHASER_VERSION_MISMATCH");
    await bootPhaser(host);
    const persistence = window.sdMinerRuntime.gateMode ? await runPersistenceSmoke() : null;
    badge.textContent = "RUNTIME READY";
    expose({
      ready: true,
      error: null,
      bridgeVersion: window.sdMinerRuntime.bridgeVersion,
      phaserVersion: window.Phaser.VERSION,
      persistence,
    });
  } catch (error) {
    expose({ ready: false, error: error?.message || String(error) });
    const badge = document.getElementById("encounterRuntimeStatus");
    if (badge) badge.textContent = `RUNTIME ERROR: ${error?.message || error}`;
    console.error(error);
  }
})();
