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

function scanQuotedSource(source, start, quote) {
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

function scanLineComment(source, start) {
  const end = source.indexOf("\n", start + 2);
  return end < 0 ? source.length : end;
}

function scanBlockComment(source, start) {
  const end = source.indexOf("*/", start + 2);
  if (end < 0) throw new Error("Unterminated block comment in legacy patch source");
  return end + 2;
}

// Once a generator interpolation is changed into literal parent-template text,
// characters that used to be protected by JS expression lexical rules must be
// protected from the parent template parser as well.
function literalizeQuotedExpressionText(source, start, quote) {
  let i = start + 1;
  let out = quote;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "\\") {
      out += "\\\\";
      if (i + 1 < source.length) out += next;
      i += 2;
      continue;
    }
    if (ch === "$" && next === "{") {
      out += "\\${";
      i += 2;
      continue;
    }
    if (ch === "`") {
      out += "\\`";
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
    if (ch === quote) return { text: out, end: i };
  }
  throw new Error(`Unterminated ${quote} string in template expression`);
}

function literalizeLineCommentExpressionText(source, start) {
  let i = start;
  let out = "";
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "$" && next === "{") {
      out += "\\${";
      i += 2;
      continue;
    }
    if (ch === "`") {
      out += "\\`";
      i += 1;
      continue;
    }
    if (ch === "\\") {
      out += "\\\\";
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
    if (ch === "\n") return { text: out, end: i };
  }
  return { text: out, end: i };
}

function literalizeBlockCommentExpressionText(source, start) {
  let i = start;
  let out = "";
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "$" && next === "{") {
      out += "\\${";
      i += 2;
      continue;
    }
    if (ch === "`") {
      out += "\\`";
      i += 1;
      continue;
    }
    if (ch === "\\") {
      out += "\\\\";
      i += 1;
      continue;
    }
    if (ch === "*" && next === "/") {
      out += "*/";
      return { text: out, end: i + 2 };
    }
    out += ch;
    i += 1;
  }
  throw new Error("Unterminated block comment in template expression");
}

function literalizeNestedTemplate(source, start) {
  let i = start + 1;
  let out = "\\`";
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "\\") {
      // Preserve the nested target template's own escape sequence after the
      // parent generator template cooks it.
      out += "\\\\";
      if (i + 1 < source.length) out += next;
      i += 2;
      continue;
    }
    if (ch === "`") {
      out += "\\`";
      return { text: out, end: i + 1 };
    }
    if (ch === "$" && next === "{") {
      out += "\\${";
      const nested = literalizeExpression(source, i + 2);
      out += nested.text;
      i = nested.end;
      continue;
    }
    out += ch;
    i += 1;
  }
  throw new Error("Unterminated nested template literal in legacy patch source");
}

function literalizeExpression(source, start) {
  let i = start;
  let depth = 1;
  let out = "";

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "'") {
      const quoted = literalizeQuotedExpressionText(source, i, "'");
      out += quoted.text;
      i = quoted.end;
      continue;
    }
    if (ch === '"') {
      const quoted = literalizeQuotedExpressionText(source, i, '"');
      out += quoted.text;
      i = quoted.end;
      continue;
    }
    if (ch === "/" && next === "/") {
      const comment = literalizeLineCommentExpressionText(source, i);
      out += comment.text;
      i = comment.end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const comment = literalizeBlockCommentExpressionText(source, i);
      out += comment.text;
      i = comment.end;
      continue;
    }
    if (ch === "`") {
      const nestedTemplate = literalizeNestedTemplate(source, i);
      out += nestedTemplate.text;
      i = nestedTemplate.end;
      continue;
    }
    if (ch === "$" && next === "{") {
      out += "\\${";
      depth += 1;
      i += 2;
      continue;
    }
    if (ch === "\\") {
      out += "\\\\";
      i += 1;
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
      if (i + 1 < source.length) out += next;
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
      const end = scanQuotedSource(source, i, "'");
      out += source.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '"') {
      const end = scanQuotedSource(source, i, '"');
      out += source.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && next === "/") {
      const end = scanLineComment(source, i);
      out += source.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = scanBlockComment(source, i);
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
// to be copied into the target app. Literalize interpolation so the generator
// does not evaluate target-runtime variables such as appCount/count/state.
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
