"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
if (!root) throw new Error("Usage: node patch-v227-app-icons.js <app-root>");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
}
function write(rel, content) {
  fs.writeFileSync(path.join(root, rel), content, "utf8");
}
function mustReplace(text, oldText, newText, label) {
  if (!text.includes(oldText)) throw new Error(`Missing marker: ${label}`);
  return text.replace(oldText, newText);
}

const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
if (pkg.version !== "2.2.6") throw new Error(`Expected v2.2.6 base, got ${pkg.version}`);
pkg.version = "2.2.7";
pkg.description = "SD지갑 코어 · 확장팩 상점 · 등록 앱 아이콘 자동 복구 · 잠금 안전 업데이트 · SD Link 백그라운드 자동 시작";
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

let registry = read("src/app-registry.js");
const oldIconInspect = `  let icon = String(\n    sdManifest.icon || "public/icons/icon-512.png",\n  );\n\n  try {\n    icon = normalizeZipPath(icon);\n  } catch {\n    icon = "";\n  }\n\n  if (icon && !entryByName.has(joinZipPath(rootPrefix, icon))) {\n    icon = "";\n  }`;
const newIconInspect = `  const iconCandidates = [\n    sdManifest.icon,\n    "public/icons/icon-512.png",\n    "public/icons/icon.png",\n    "public/icon-512.png",\n    "public/icon.png",\n    "assets/icons/icon-512.png",\n    "assets/icons/icon.png",\n    "assets/icon-512.png",\n    "assets/icon.png",\n    "icon-512.png",\n    "icon.png",\n  ];\n  let icon = "";\n  for (const candidate of iconCandidates) {\n    if (!candidate) continue;\n    let normalized = "";\n    try {\n      normalized = normalizeZipPath(candidate);\n    } catch {\n      continue;\n    }\n    const fullName = joinZipPath(rootPrefix, normalized);\n    const iconEntry = entryByName.get(fullName);\n    if (iconEntry && !iconEntry.isDirectory) {\n      icon = normalized;\n      break;\n    }\n  }`;
registry = mustReplace(registry, oldIconInspect, newIconInspect, "ZIP icon auto discovery");
write("src/app-registry.js", registry);

let main = read("main.js");
const oldAppIconUrl = `  function appIconUrl(entry) {\n    const fallbackPath = path.join(\n      __dirname,\n      "public",\n      "icons",\n      "icon-512.png",\n    );\n    const candidatePath = entry.icon\n      ? path.join(entry.directory, entry.icon)\n      : fallbackPath;\n    const iconPath = fs.existsSync(candidatePath)\n      ? candidatePath\n      : fallbackPath;\n\n    return pathToFileURL(iconPath).href;\n  }`;
const newAppIconUrl = `  function installedAppIconPath(entry) {\n    if (!entry?.directory) return "";\n    const rootDirectory = path.resolve(entry.directory);\n    const candidates = [\n      entry.icon,\n      "public/icons/icon-512.png",\n      "public/icons/icon.png",\n      "public/icon-512.png",\n      "public/icon.png",\n      "assets/icons/icon-512.png",\n      "assets/icons/icon.png",\n      "assets/icon-512.png",\n      "assets/icon.png",\n      "icon-512.png",\n      "icon.png",\n    ];\n\n    for (const candidate of candidates) {\n      if (!candidate || typeof candidate !== "string") continue;\n      const resolved = path.resolve(rootDirectory, candidate);\n      const insideRoot = resolved === rootDirectory || resolved.startsWith(rootDirectory + path.sep);\n      if (!insideRoot) continue;\n      try {\n        if (fs.statSync(resolved).isFile()) return resolved;\n      } catch {}\n    }\n    return "";\n  }\n\n  function appIconUrl(entry) {\n    const fallbackPath = path.join(\n      __dirname,\n      "public",\n      "icons",\n      "icon-512.png",\n    );\n    const iconPath = installedAppIconPath(entry) || fallbackPath;\n    return pathToFileURL(iconPath).href;\n  }`;
main = mustReplace(main, oldAppIconUrl, newAppIconUrl, "installed icon recovery");
write("main.js", main);

for (const marker of [
  "installedAppIconPath",
  '"public/icons/icon.png"',
  '"assets/icons/icon-512.png"',
  "pathToFileURL(iconPath).href",
  "installInspectedZipWithRetry",
  "forceKillChildTree",
  "autoUpdater",
]) {
  if (!read("main.js").includes(marker) && !read("src/app-registry.js").includes(marker)) {
    throw new Error(`v2.2.7 marker missing: ${marker}`);
  }
}

console.log("SDCenter v2.2.7 app icon auto-recovery patch applied");
