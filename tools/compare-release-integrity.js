"use strict";

const fs = require("node:fs");

function load(file) {
  const raw = fs.readFileSync(file, "utf8").trim();
  if (!raw) throw new Error(`empty snapshot: ${file}`);
  return JSON.parse(raw);
}

function flatten(value, prefix = "", out = new Map()) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of Object.keys(value).sort()) {
      flatten(value[key], prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out.set(prefix, value);
  }
  return out;
}

function compareGroup(before, after, group) {
  const left = flatten(before?.[group] || {});
  const right = flatten(after?.[group] || {});
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  return keys
    .filter((key) => JSON.stringify(left.get(key)) !== JSON.stringify(right.get(key)))
    .map((key) => ({ key: `${group}.${key}`, before: left.get(key), after: right.get(key) }));
}

const [, , beforePath, afterPath, ...flags] = process.argv;
if (!beforePath || !afterPath) {
  console.error("usage: node tools/compare-release-integrity.js <before.json> <after.json> [--allow-observational-change]");
  process.exit(2);
}

const before = load(beforePath);
const after = load(afterPath);
if (before.schema_version !== after.schema_version) {
  console.error(`snapshot schema mismatch: ${before.schema_version} != ${after.schema_version}`);
  process.exit(1);
}

const strictDiffs = compareGroup(before, after, "strict");
const observationalDiffs = compareGroup(before, after, "observational");
const allowObservational = flags.includes("--allow-observational-change");

if (strictDiffs.length) {
  console.error("RELEASE INTEGRITY FAIL: strict assets changed");
  for (const diff of strictDiffs) {
    console.error(`- ${diff.key}: ${JSON.stringify(diff.before)} -> ${JSON.stringify(diff.after)}`);
  }
  process.exit(1);
}

if (observationalDiffs.length && !allowObservational) {
  console.error("RELEASE INTEGRITY FAIL: observational state changed without explicit allowance");
  for (const diff of observationalDiffs) {
    console.error(`- ${diff.key}: ${JSON.stringify(diff.before)} -> ${JSON.stringify(diff.after)}`);
  }
  process.exit(1);
}

console.log("Release integrity strict assets PASS");
if (observationalDiffs.length) {
  console.log(`Observational differences allowed: ${observationalDiffs.length}`);
  for (const diff of observationalDiffs) {
    console.log(`- ${diff.key}: ${JSON.stringify(diff.before)} -> ${JSON.stringify(diff.after)}`);
  }
} else {
  console.log("Release integrity observational state PASS");
}
