"use strict";

const fs = require("node:fs");
const files = process.argv.slice(2);
if (!files.length) throw new Error("Usage: node normalize-source.js <file...>");
for (const file of files) {
  const input = fs.readFileSync(file, "utf8");
  const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  fs.writeFileSync(file, normalized, "utf8");
  console.log(`Normalized line endings: ${file}`);
}
