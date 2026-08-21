"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const files = [
  "main.js",
  "preload.js",
  "src/settings.js",
  "src/operation-engine.js",
  "src/wallet-database.js",
  "public/js/app.js",
  "tools/test-operation.js",
].map((file) => path.join(root, file));

for (const file of files) {
  if (!fs.existsSync(file)) throw new Error(`Missing file: ${file}`);
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, "sd-app.json"), "utf8"));
if (manifest.id !== "sta-expansion") throw new Error("Unexpected app id");
if (manifest.entry !== "main.js") throw new Error("Unexpected entry");

console.log("STA file and syntax checks passed.");
