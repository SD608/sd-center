"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SETTINGS = Object.freeze({
  walletDatabasePath: "",
  selectedAccountId: "",
  soundEnabled: true,
  musicEnabled: true,
  masterVolume: 70,
});

class SettingsStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = this.#load();
  }

  #normalizeVolume(value) {
    const volume = Math.trunc(Number(value));
    if (!Number.isFinite(volume)) return DEFAULT_SETTINGS.masterVolume;
    return Math.min(100, Math.max(0, volume));
  }

  #load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return {
        walletDatabasePath: typeof parsed.walletDatabasePath === "string" ? parsed.walletDatabasePath : "",
        selectedAccountId: typeof parsed.selectedAccountId === "string" ? parsed.selectedAccountId : "",
        soundEnabled: parsed.soundEnabled !== false,
        musicEnabled: parsed.musicEnabled !== false,
        masterVolume: this.#normalizeVolume(parsed.masterVolume),
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  #save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, this.filePath);
  }

  get() { return { ...this.data }; }

  update(patch = {}) {
    if (typeof patch.walletDatabasePath === "string") this.data.walletDatabasePath = patch.walletDatabasePath.trim();
    if (typeof patch.selectedAccountId === "string") this.data.selectedAccountId = patch.selectedAccountId;
    if (patch.soundEnabled !== undefined) this.data.soundEnabled = patch.soundEnabled === true;
    if (patch.musicEnabled !== undefined) this.data.musicEnabled = patch.musicEnabled === true;
    if (patch.masterVolume !== undefined) this.data.masterVolume = this.#normalizeVolume(patch.masterVolume);
    this.#save();
    return this.get();
  }
}

module.exports = { SettingsStore };
