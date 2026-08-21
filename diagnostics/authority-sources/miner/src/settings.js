"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SETTINGS = Object.freeze({
  walletDatabasePath: "",
  selectedAccountId: "",
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

      const parsed = JSON.parse(
        fs.readFileSync(this.filePath, "utf-8"),
      );

      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  #save() {
    fs.mkdirSync(path.dirname(this.filePath), {
      recursive: true,
    });

    const temporaryPath = `${this.filePath}.tmp`;

    fs.writeFileSync(
      temporaryPath,
      JSON.stringify(this.data, null, 2),
      "utf-8",
    );

    fs.renameSync(temporaryPath, this.filePath);
  }

  get() {
    return { ...this.data };
  }

  update(patch = {}) {
    if (typeof patch.walletDatabasePath === "string") {
      this.data.walletDatabasePath =
        patch.walletDatabasePath.trim();
    }

    if (typeof patch.selectedAccountId === "string") {
      this.data.selectedAccountId =
        patch.selectedAccountId;
    }

    this.#save();
    return this.get();
  }
}

module.exports = {
  SettingsStore,
};
