"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SETTINGS = Object.freeze({
  walletDatabasePath: "",
  selectedAccountId: "",
  baseBetKrw: 1000,
  selectedBetKrw: 1000,
  betMode: "fixed",
  selectedMultiplier: 1,
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
        baseBetKrw: this.#normalizeBaseBet(parsed.baseBetKrw),
        selectedBetKrw: this.#normalizeBaseBet(
          parsed.selectedBetKrw ?? parsed.baseBetKrw,
        ),
        betMode: parsed.betMode === "all-in" ? "all-in" : "fixed",
        selectedMultiplier: [1, 10, 50, 100].includes(
          Number(parsed.selectedMultiplier),
        )
          ? Number(parsed.selectedMultiplier)
          : 1,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  #normalizeBaseBet(value) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
      return DEFAULT_SETTINGS.baseBetKrw;
    }

    return Math.min(
      1_000_000_000_000,
      Math.max(100, Math.trunc(numeric)),
    );
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

    if (patch.baseBetKrw !== undefined) {
      this.data.baseBetKrw =
        this.#normalizeBaseBet(patch.baseBetKrw);
    }

    if (patch.selectedBetKrw !== undefined) {
      this.data.selectedBetKrw =
        this.#normalizeBaseBet(patch.selectedBetKrw);
    }

    if (["fixed", "all-in"].includes(patch.betMode)) {
      this.data.betMode = patch.betMode;
    }

    if (
      [1, 10, 50, 100].includes(
        Number(patch.selectedMultiplier),
      )
    ) {
      this.data.selectedMultiplier =
        Number(patch.selectedMultiplier);
    }

    this.#save();
    return this.get();
  }
}

module.exports = {
  SettingsStore,
};
