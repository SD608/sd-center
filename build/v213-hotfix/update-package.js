"use strict";

const fs = require("node:fs");
const target = process.argv[2];
if (!target) throw new Error("Usage: node update-package.js <package.json>");
const pkg = JSON.parse(fs.readFileSync(target, "utf8"));
pkg.version = "2.1.3";
pkg.description = "홈페이지 확장팩 카탈로그를 확인해 종합센터 안에서 앱별/전체 자동 업데이트를 지원하는 SD종합센터";
fs.writeFileSync(target, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
console.log(`Updated package metadata: ${pkg.name} v${pkg.version}`);
