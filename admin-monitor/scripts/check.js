"use strict";
const { spawnSync } = require("node:child_process");
const { readdirSync, statSync } = require("node:fs");
const { join } = require("node:path");
const roots=["main.js","preload.js","lib","renderer","integration","tests"]; const files=[];
function walk(path){const stat=statSync(path);if(stat.isDirectory()){for(const name of readdirSync(path))walk(join(path,name));}else if(path.endsWith(".js"))files.push(path);}
for(const root of roots)walk(root); for(const file of files){const result=spawnSync(process.execPath,["--check",file],{stdio:"inherit"});if(result.status!==0)process.exit(result.status||1);} console.log(`Syntax OK: ${files.length} JS files`);
