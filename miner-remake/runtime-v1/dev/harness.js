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

  window.runtimeHarness = Object.freeze({ runCycles, phaserVersion: () => Phaser.VERSION });
  createReadyGame("game").then(() => { status.textContent = "READY"; }).catch((error) => { status.textContent = `ERROR:${error.message}`; });
})();
