"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const patchPath = process.argv[2];
const appRoot = process.argv[3];
if (!patchPath || !appRoot) {
  throw new Error("Usage: node run-legacy-ui-template-patch.js <patch-script> <app-root>");
}

function copyQuoted(source, start, quote) {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === quote) return i + 1;
    i += 1;
  }
  throw new Error(`Unterminated ${quote} string in legacy patch source`);
}

function copyLineComment(source, start) {
  const end = source.indexOf("\n", start + 2);
  return end < 0 ? source.length : end;
}

function copyBlockComment(source, start) {
  const end = source.indexOf("*/", start + 2);
  if (end < 0) throw new Error("Unterminated block comment in legacy patch source");
  return end + 2;
}

// Finds the closing brace of a template interpolation while preserving enough
// JavaScript lexical structure to ignore braces in quoted strings/comments and
// nested template literals. The returned text is made safe to live as literal
// text inside the parent template: every `${` and backtick is escaped.
function literalizeExpression(source, start) {
  let i = start;
  let depth = 1;
  let out = "";
  const stack = [{ type: "expr" }];

  while (i < source.length) {
    const mode = stack[stack.length - 1];
    const ch = source[i];
    const next = source[i + 1];

    // Everything in a now-literal interpolation must not start a new parent
    // template interpolation.
    if (ch === "$" && next === "{") {
      out += "\\${";
      if (mode.type === "expr") depth += 1;
      else if (mode.type === "template") stack.push({ type: "expr", nested: true, depth: 1 });
      i += 2;
      continue;
    }

    // Any backtick occurring inside the expression must become literal text in
    // the parent template. Track nested-template lexical state separately.
    if (ch === "`") {
      out += "\\`";
      if (mode.type === "expr") stack.push({ type: "template" });
      else if (mode.type === "template") stack.pop();
      i += 1;
      continue;
    }

    if (mode.type === "single" || mode.type === "double") {
      out += ch;
      if (ch === "\\" && i + 1 < source.length) {
        out += source[i + 1];
        i += 2;
        continue;
      }
      if ((mode.type === "single" && ch === "'") || (mode.type === "double" && ch === '"')) {
        stack.pop();
      }
      i += 1;
      continue;
    }

    if (mode.type === "lineComment") {
      out += ch;
      if (ch === "\n") stack.pop();
      i += 1;
      continue;
    }

    if (mode.type === "blockComment") {
      out += ch;
      if (ch === "*" && next === "/") {
        out += "/";
        i += 2;
        stack.pop();
      } else {
        i += 1;
      }
      continue;
    }

    if (mode.type === "template") {
      out += ch;
      if (ch === "\\" && i + 1 < source.length) {
        out += source[i + 1];
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    // Expression lexical state.
    if (ch === "'") {
      out += ch;
      stack.push({ type: "single" });
      i += 1;
      continue;
    }
    if (ch === '"') {
      out += ch;
      stack.push({ type: "double" });
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      out += "//";
      stack.push({ type: "lineComment" });
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      out += "/*";
      stack.push({ type: "blockComment" });
      i += 2;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      out += ch;
      i += 1;
      if (depth === 0) return { text: out, end: i };
      continue;
    }

    out += ch;
    i += 1;
  }

  throw new Error("Unterminated template interpolation in legacy patch source");
}

function literalizeTemplate(source, start) {
  let i = start + 1;
  let out = "`";
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "\\") {
      out += ch;
      if (i + 1 < source.length) out += source[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      out += "`";
      return { text: out, end: i + 1 };
    }
    if (ch === "$" && next === "{") {
      out += "\\${";
      const expression = literalizeExpression(source, i + 2);
      out += expression.text;
      i = expression.end;
      continue;
    }
    out += ch;
    i += 1;
  }
  throw new Error("Unterminated template literal in legacy patch source");
}

function literalizeAllTemplates(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "'") {
      const end = copyQuoted(source, i, "'");
      out += source.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '"') {
      const end = copyQuoted(source, i, '"');
      out += source.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && next === "/") {
      const end = copyLineComment(source, i);
      out += source.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = copyBlockComment(source, i);
      out += source.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "`") {
      const transformed = literalizeTemplate(source, i);
      out += transformed.text;
      i = transformed.end;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

let source = fs.readFileSync(patchPath, "utf8").replace(/\r\n/g, "\n");
const base = path.basename(patchPath).toLowerCase();

// v0.10 contains one historically malformed nested runtime template literal:
// the runtime backticks were not escaped from the generator's outer template.
if (base === "patch-center-ui-v010.js") {
  const bad = '    tile.setAttribute("aria-label",`${app.name||"앱"} 열기`);';
  const repaired = '    tile.setAttribute("aria-label",\\`${app.name||"앱"} 열기\\`);';
  if (!source.includes(bad)) throw new Error("Expected v0.10 nested-template defect not found");
  source = source.replace(bad, repaired);
}

// v0.10/v0.11 were authored as generators whose template snippets are meant
// to be copied into the target app. Literalize their interpolation so the
// generator does not evaluate target-runtime variables such as appCount/count.
source = literalizeAllTemplates(source);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-center-legacy-patch-"));
const tempPatch = path.join(tempDir, base);
fs.writeFileSync(tempPatch, source, "utf8");

const syntax = spawnSync(process.execPath, ["--check", tempPatch], { encoding: "utf8" });
if (syntax.status !== 0) {
  process.stderr.write(syntax.stdout || "");
  process.stderr.write(syntax.stderr || "");
  throw new Error(`Literalized legacy patch still has invalid syntax: ${base}`);
}

const run = spawnSync(process.execPath, [tempPatch, appRoot], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
process.stdout.write(run.stdout || "");
process.stderr.write(run.stderr || "");
if (run.status !== 0) throw new Error(`Legacy UI patch failed after literalization: ${base}`);

console.log(`Legacy UI template patch completed safely: ${base}`);
