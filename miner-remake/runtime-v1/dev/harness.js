"use strict";

(() => {
  const status = document.getElementById("runtimeStatus");

  function makeGame(parent, onReady) {
    const scene = {
      create() {
        this.physics.world.setBounds(0, 0, 560, 180);
        const floor = this.add.rectangle(280, 170, 560, 20, 0x4a3b2c);
        this.physics.add.existing(floor, true);
        const player = this.add.rectangle(120, 130, 18, 28, 0x78b7ff);
        this.physics.add.existing(player);
        player.body.setGravityY(500);
        player.body.setCollideWorldBounds(true);
        const boss = this.add.rectangle(410, 126, 54, 64, 0xb85c3d);
        this.physics.add.existing(boss);
        boss.body.setImmovable(true);
        this.physics.add.collider(player, floor);
        this.physics.add.collider(boss, floor);
        onReady?.();
      },
    };
    return new Phaser.Game({
      type: Phaser.CANVAS,
      width: 560,
      height: 180,
      parent,
      backgroundColor: "#11151a",
      physics: { default: "arcade", arcade: { gravity: { y: 0 }, debug: false } },
      audio: { noAudio: true },
      scene,
    });
  }

  async function createReadyGame(parent) {
    return new Promise((resolve, reject) => {
      let game;
      const timer = setTimeout(() => reject(new Error("PHASER_BOOT_TIMEOUT")), 5000);
      game = makeGame(parent, () => { clearTimeout(timer); resolve(game); });
    });
  }

  async function runCycles(count = 100) {
    for (let i = 0; i < count; i += 1) {
      const host = document.createElement("div");
      host.style.display = "none";
      document.body.appendChild(host);
      const game = await createReadyGame(host);
      game.destroy(true);
      host.remove();
    }
    return count;
  }

  function createExecutionWorld(config = {}) {
    return new Promise((resolve, reject) => {
      const host = document.createElement("div");
      host.style.display = "none";
      document.body.appendChild(host);
      let game;
      const timer = setTimeout(() => reject(new Error("P1_EXECUTION_WORLD_BOOT_TIMEOUT")), 5000);
      const unitPx = 40;
      const width = 720;
      const height = 260;
      const scene = {
        create() {
          const phaserScene = this;
          this.physics.world.setBounds(0, 0, width, height);
          const boss = this.add.rectangle(config.bossX ?? 160, config.y ?? 130, 54, 64, 0xb85c3d);
          this.physics.add.existing(boss);
          boss.body.setImmovable(true);
          boss.body.setAllowGravity(false);
          const player = this.add.rectangle(config.playerX ?? 360, config.y ?? 130, 20, 34, 0x78b7ff);
          this.physics.add.existing(player);
          player.body.setImmovable(true);
          player.body.setAllowGravity(false);
          const solids = [];
          if (Number.isFinite(config.wallX)) {
            const wall = this.add.rectangle(config.wallX, config.y ?? 130, 18, 120, 0x777777);
            this.physics.add.existing(wall, true);
            solids.push(wall);
          }
          const adapter = new SDAbisterP1Execution.AbisterP1PhaserExecutionAdapter({
            scene: this,
            boss,
            player,
            unitPx,
            solids,
            playerState: config.playerState,
            response: config.response,
          });
          clearTimeout(timer);
          resolve({ game, host, scene: phaserScene, boss, player, solids, adapter, unitPx });
        },
      };
      game = new Phaser.Game({
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

  function destroyExecutionWorld(world) {
    world.adapter?.destroy();
    world.game?.destroy(true);
    world.host?.remove();
  }

  async function withExecutionWorld(config, fn) {
    const world = await createExecutionWorld(config);
    try { return await fn(world); }
    finally { destroyExecutionWorld(world); }
  }

  async function runP1ExecutionGate() {
    const forepaw = await withExecutionWorld({
      bossX: 180, playerX: 260,
      playerState: { hp: 100, armor: 30, laceration_percent: 0 },
    }, async ({ adapter, player }) => {
      adapter.executeForepawLanding({ centerX: player.x, groundY: player.y });
      return { state: adapter.getPlayerState(), hits: adapter.getHitLog() };
    });

    const jumpGuard = await withExecutionWorld({
      bossX: 180, playerX: 300,
      playerState: { hp: 100, armor: 0, laceration_percent: 0 },
      response: { shield_guard: true, shield_in_front_arc: true },
    }, async ({ adapter, player }) => {
      adapter.executeJumpLanding({ centerX: player.x, groundY: player.y });
      return { state: adapter.getPlayerState(), hits: adapter.getHitLog() };
    });

    const tailParry = await withExecutionWorld({
      bossX: 360, playerX: 240,
      playerState: { hp: 100, armor: 0, laceration_percent: 0 },
      response: { sword_parry: true },
    }, async ({ adapter, player }) => {
      adapter.executeTailSweepSamples([
        { x: player.x, y: player.y },
        { x: player.x, y: player.y },
        { x: player.x, y: player.y },
      ]);
      return { state: adapter.getPlayerState(), hits: adapter.getHitLog() };
    });

    const spikes = await withExecutionWorld({
      bossX: 120, playerX: 360,
      playerState: { hp: 100, armor: 0, laceration_percent: 0 },
    }, async ({ adapter, boss }) => {
      const burst = await adapter.fireSpikeBurst({ originX: boss.x, originY: boss.y, direction: 1 });
      return { state: adapter.getPlayerState(), hits: adapter.getHitLog(), burst };
    });

    const blockedSpikes = await withExecutionWorld({
      bossX: 120, wallX: 240, playerX: 360,
      playerState: { hp: 100, armor: 0, laceration_percent: 0 },
    }, async ({ adapter, boss }) => {
      const burst = await adapter.fireSpikeBurst({ originX: boss.x, originY: boss.y, direction: 1 });
      return { state: adapter.getPlayerState(), hits: adapter.getHitLog(), burst };
    });

    return Object.freeze({ forepaw, jumpGuard, tailParry, spikes, blockedSpikes });
  }

  async function runP1OrchestrationGate() {
    const completed = await withExecutionWorld({
      bossX: 180, playerX: 260,
      playerState: { hp: 100, armor: 30, laceration_percent: 0 },
    }, async ({ adapter, player }) => {
      const { ATTACK, AbisterP1CombatController } = SDAbisterP1Combat;
      const controller = new AbisterP1CombatController({ rng: () => 0 });
      const orchestrator = new SDAbisterP1Orchestration.AbisterP1RuntimeOrchestrator({
        controller,
        executionAdapter: adapter,
      });
      const observation = {
        target_id: "player",
        distance: 2.5,
        direct_perception: true,
        relative_angle_degrees: 0,
        front_attack_valid: true,
        forepaw_path_clear: true,
        forepaw_landing_valid: true,
        tail_path_clear: true,
        jump_path_clear: true,
        jump_landing_valid: true,
        projectile_path_clear: true,
        cooldown_ready: {
          [ATTACK.FOREPAW_SLAM]: true,
          [ATTACK.TAIL_SWEEP]: true,
          [ATTACK.GEOGEUK_JUMP]: true,
          [ATTACK.SPIKE_MACHINEGUN]: true,
        },
      };
      const plan = {
        [ATTACK.FOREPAW_SLAM]: { centerX: player.x, groundY: player.y },
      };
      const decision = orchestrator.decide(observation);
      const locked = await orchestrator.advance(1050, { direct_perception: true }, plan);
      const active = await orchestrator.advance(350, { direct_perception: true }, plan);
      const completedEvents = await orchestrator.advance(200);
      const recovered = await orchestrator.advance(1200);
      return {
        decision,
        locked,
        active,
        completedEvents,
        recovered,
        snapshot: orchestrator.getSnapshot(),
      };
    });

    const cancelled = await withExecutionWorld({
      bossX: 180, playerX: 260,
      playerState: { hp: 100, armor: 0, laceration_percent: 0 },
    }, async ({ adapter, player }) => {
      const { ATTACK, AbisterP1CombatController } = SDAbisterP1Combat;
      const orchestrator = new SDAbisterP1Orchestration.AbisterP1RuntimeOrchestrator({
        controller: new AbisterP1CombatController({ rng: () => 0 }),
        executionAdapter: adapter,
      });
      const observation = {
        target_id: "player",
        distance: 2.5,
        direct_perception: true,
        relative_angle_degrees: 0,
        front_attack_valid: true,
        forepaw_path_clear: true,
        forepaw_landing_valid: true,
        tail_path_clear: true,
        jump_path_clear: true,
        jump_landing_valid: true,
        projectile_path_clear: true,
        cooldown_ready: {
          [ATTACK.FOREPAW_SLAM]: true,
          [ATTACK.TAIL_SWEEP]: true,
          [ATTACK.GEOGEUK_JUMP]: true,
          [ATTACK.SPIKE_MACHINEGUN]: true,
        },
      };
      orchestrator.decide(observation);
      const events = await orchestrator.advance(1000, { direct_perception: false }, {
        [ATTACK.FOREPAW_SLAM]: { centerX: player.x, groundY: player.y },
      });
      return { events, snapshot: orchestrator.getSnapshot() };
    });

    return Object.freeze({ completed, cancelled });
  }

  window.runtimeHarness = Object.freeze({
    runCycles,
    runP1ExecutionGate,
    runP1OrchestrationGate,
    phaserVersion: () => Phaser.VERSION,
    p1ExecutionAdapterVersion: () => Boolean(window.SDAbisterP1Execution?.AbisterP1PhaserExecutionAdapter),
    p1OrchestrationVersion: () => Boolean(window.SDAbisterP1Orchestration?.AbisterP1RuntimeOrchestrator),
  });
  createReadyGame("game").then(() => { status.textContent = "READY"; }).catch((error) => { status.textContent = `ERROR:${error.message}`; });
})();
