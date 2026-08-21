"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SETTINGS = Object.freeze({
  walletDatabasePath: "",
  selectedAccountId: "",
  selectedRoomKey: "A",
});

class SettingsStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = this.#load();
  }

  #load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return { ...DEFAULT_SETTINGS };
      }

      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      const selectedRoomKey = ["A", "B", "C", "D", "E"].includes(parsed.selectedRoomKey)
        ? parsed.selectedRoomKey
        : "A";

      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        selectedRoomKey,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  #save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), "utf-8");
    fs.renameSync(temp, this.filePath);
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

    if (["A", "B", "C", "D", "E"].includes(patch.selectedRoomKey)) {
      this.data.selectedRoomKey = patch.selectedRoomKey;
    }

    this.#save();
    return this.get();
  }
}

module.exports = { SettingsStore };
