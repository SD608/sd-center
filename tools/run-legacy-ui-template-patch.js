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

function replaceRequired(source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`v0.11 normalization marker missing: ${label}`);
  return source.replace(needle, replacement);
}

function normalizeV011Target(root) {
  const uiPath = path.join(root, "public", "js", "ui-preview.js");
  let ui = fs.readFileSync(uiPath, "utf8").replace(/\r\n/g, "\n");

  ui = replaceRequired(
    ui,
    'function closePreviewAppContextMenu(){document.getElementById("previewAppContextMenu")?.classList.add("hidden");previewContextAppId="";}',
    'function closePreviewAppContextMenu() {\n  const menu = document.getElementById("previewAppContextMenu");\n  menu?.classList.add("hidden");\n  previewContextAppId = "";\n}',
    "compact close context menu",
  );
  ui = replaceRequired(
    ui,
    'previewContextAppId=app.id;menu.classList.remove("hidden");',
    'previewContextAppId = app.id;\n  menu.classList.remove("hidden");',
    "compact context open state",
  );
  ui = replaceRequired(
    ui,
    'function closePreviewAppInfo(){document.getElementById("previewAppInfoBackdrop")?.classList.add("hidden");}',
    'function closePreviewAppInfo() {\n  document.getElementById("previewAppInfoBackdrop")?.classList.add("hidden");\n}',
    "compact close info",
  );

  const compactAction = 'document.getElementById("previewAppContextMenu")?.addEventListener("click",async event=>{const button=event.target.closest("[data-preview-context-action]");if(!button||!previewContextAppId)return;const appId=previewContextAppId,action=button.dataset.previewContextAction;closePreviewAppContextMenu();if(action==="open")await launchApp(appId);else if(action==="info")showPreviewAppInfo(appId);else if(action==="folder"){const result=await bridge.openAppFolder(appId);if(!result?.ok)showToast(result?.error||"폴더를 열지 못했습니다.");}else if(action==="delete")await deleteApp(appId);});';
  const canonicalAction = 'document.getElementById("previewAppContextMenu")?.addEventListener("click", async (event) => {\n  const actionButton = event.target.closest("[data-preview-context-action]");\n  if (!actionButton || !previewContextAppId) return;\n  const appId = previewContextAppId;\n  const action = actionButton.dataset.previewContextAction;\n  closePreviewAppContextMenu();\n  if (action === "open") {\n    await launchApp(appId);\n  } else if (action === "info") {\n    showPreviewAppInfo(appId);\n  } else if (action === "folder") {\n    const result = await bridge.openAppFolder(appId);\n    if (!result?.ok) showToast(result?.error || "폴더를 열지 못했습니다.");\n  } else if (action === "delete") {\n    await deleteApp(appId);\n  }\n});';
  ui = replaceRequired(ui, compactAction, canonicalAction, "compact context action handler");

  const compactPointer = 'document.addEventListener("pointerdown",event=>{const menu=document.getElementById("previewAppContextMenu");if(menu&&!menu.classList.contains("hidden")&&!event.target.closest("#previewAppContextMenu"))closePreviewAppContextMenu();});';
  const canonicalPointer = 'document.addEventListener("pointerdown", (event) => {\n  const menu = document.getElementById("previewAppContextMenu");\n  if (menu && !menu.classList.contains("hidden") && !event.target.closest("#previewAppContextMenu")) closePreviewAppContextMenu();\n});';
  ui = replaceRequired(ui, compactPointer, canonicalPointer, "compact pointer close handler");

  ui = replaceRequired(ui, 'window.addEventListener("blur",closePreviewAppContextMenu);', 'window.addEventListener("blur", closePreviewAppContextMenu);', "blur handler spacing");
  ui = replaceRequired(ui, 'window.addEventListener("resize",closePreviewAppContextMenu);', 'window.addEventListener("resize", closePreviewAppContextMenu);', "resize handler spacing");
  ui = replaceRequired(ui, 'window.addEventListener("scroll",closePreviewAppContextMenu,true);', 'window.addEventListener("scroll", closePreviewAppContextMenu, true);', "scroll handler spacing");

  const compactEscape = 'document.addEventListener("keydown",event=>{if(event.key!=="Escape")return;closePreviewAppContextMenu();closePreviewAppInfo();});';
  const canonicalEscape = 'document.addEventListener("keydown", (event) => {\n  if (event.key !== "Escape") return;\n  closePreviewAppContextMenu();\n  closePreviewAppInfo();\n});';
  ui = replaceRequired(ui, compactEscape, canonicalEscape, "compact escape handler");

  fs.writeFileSync(uiPath, ui, "utf8");
  console.log("Normalized compact v0.9 context UI for v0.11 audit patch");
}

let source = fs.readFileSync(patchPath, "utf8").replace(/\r\n/g, "\n");
const base = path.basename(patchPath).toLowerCase();

if (base === "patch-center-ui-v010.js") {
  const bad = '    tile.setAttribute("aria-label",`${app.name||"앱"} 열기`);';
  const repaired = '    tile.setAttribute("aria-label",\\`${app.name||"앱"} 열기\\`);';
  if (!source.includes(bad)) throw new Error("Expected v0.10 nested-template defect not found");
  source = source.replace(bad, repaired);
}

if (base === "patch-center-ui-v011.js") normalizeV011Target(appRoot);
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
