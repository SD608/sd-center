"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SETTINGS = Object.freeze({
  walletDatabasePath: "",
  selectedAccountId: "",
  betAmount: 1000,
  soundEnabled: true,
});

class SettingsStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = this.#load();
  }

  #load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        betAmount: this.#normalizeBet(parsed.betAmount),
        soundEnabled: parsed.soundEnabled !== false,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  #normalizeBet(value) {
    const amount = Math.trunc(Number(value));
    if (!Number.isSafeInteger(amount)) return DEFAULT_SETTINGS.betAmount;
    return Math.min(1_000_000_000, Math.max(100, amount));
  }

  #save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, this.filePath);
  }

  get() {
    return { ...this.data };
  }

  update(patch = {}) {
    if (typeof patch.walletDatabasePath === "string") {
      this.data.walletDatabasePath = patch.walletDatabasePath.trim();
    }
    if (typeof patch.selectedAccountId === "string") {
      this.data.selectedAccountId = patch.selectedAccountId;
    }
    if (patch.betAmount !== undefined) {
      this.data.betAmount = this.#normalizeBet(patch.betAmount);
    }
    if (patch.soundEnabled !== undefined) {
      this.data.soundEnabled = patch.soundEnabled === true;
    }
    this.#save();
    return this.get();
  }
}

module.exports = { SettingsStore };
