"use strict";

const fs = require("node:fs");
const path = require("node:path");

const appRoot = process.argv[2];
const net45Root = process.argv[3];
if (!appRoot || !net45Root) {
  throw new Error("Usage: node inject-achievement-overlay-physical-smoke.js <app-root> <net45-root>");
}

const mainPath = path.join(appRoot, "main.js");
const helperPath = path.join(appRoot, "src", "sdlink-achievement-overlay.js");
if (!fs.existsSync(mainPath)) throw new Error("main.js missing");
if (!fs.existsSync(helperPath)) throw new Error("achievement overlay helper missing; apply production overlay patch first");

let source = fs.readFileSync(mainPath, "utf8").replace(/\r\n/g, "\n");
if (!source.includes("patchIntegratedSdLinkAchievementOverlay")) {
  throw new Error("production achievement overlay patch marker missing");
}
if (source.includes("--sd-achievement-overlay-smoke")) {
  throw new Error("physical smoke hook already injected");
}

const needle = `const childId = parseChildId();\n\nif (childId) {\n  runChildMode(childId);\n} else {\n  runCenterMode();\n}\n`;
if (!source.includes(needle)) throw new Error("physical smoke insertion marker missing");

const replacement = `async function runAchievementOverlaySmokeMode() {\n  const smokeRoot = path.join(os.tmpdir(), "SDCenter-Ch3-7-Overlay-Smoke");\n  try { fs.rmSync(smokeRoot, { recursive: true, force: true }); } catch {}\n  app.setPath("userData", smokeRoot);\n  app.setName("SD종합센터 업적 오버레이 테스트");\n  await app.whenReady();\n  const { createOverlayController } = require("./src/sdlink-achievement-overlay");\n  const electron = require("electron");\n  const controller = createOverlayController({\n    app,\n    BrowserWindow: electron.BrowserWindow,\n    screen: electron.screen,\n    shell: electron.shell,\n  });\n  const smokeUserId = "37777777-7777-4777-8777-777777777777";\n  const smokeAchievementId = "38888888-8888-4888-8888-888888888888";\n  let phase = 0;\n  const engine = {\n    auth: {\n      requireSession: async () => ({ user: { id: smokeUserId } }),\n      rpc: async (name) => {\n        if (name !== "get_sd_achievement_center_v1") throw new Error("unexpected smoke RPC");\n        phase += 1;\n        return {\n          schema_version: 1,\n          catalog_count: phase > 1 ? 1 : 0,\n          achievements: phase > 1 ? [{\n            id: smokeAchievementId,\n            code: "smoke-01",\n            name: "[테스트] 업적 달성",\n            description: "우측 하단 표시 · 소리 · 클릭 바로가기를 확인하세요.",\n            icon: "🏆",\n            title_reward: "테스트 칭호",\n            unlocked: true,\n            unlocked_at: new Date().toISOString(),\n          }] : [],\n        };\n      },\n    },\n  };\n  await controller.poll(engine);\n  await controller.poll(engine);\n  setTimeout(() => {\n    try { controller.dispose(); } catch {}\n    try { fs.rmSync(smokeRoot, { recursive: true, force: true }); } catch {}\n    app.quit();\n  }, 9000);\n}\n\nconst achievementOverlaySmokeMode = process.argv.includes("--sd-achievement-overlay-smoke");\nconst childId = parseChildId();\n\nif (achievementOverlaySmokeMode) {\n  void runAchievementOverlaySmokeMode().catch((error) => {\n    console.error("업적 오버레이 물리 smoke 실패", error);\n    app.quit();\n  });\n} else if (childId) {\n  runChildMode(childId);\n} else {\n  runCenterMode();\n}\n`;

source = source.replace(needle, replacement);
fs.writeFileSync(mainPath, source, "utf8");

const launcher = `@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\nstart "" /wait "%~dp0SDCenter.exe" --sd-achievement-overlay-smoke\r\nendlocal\r\n`;
fs.writeFileSync(path.join(net45Root, "Run-Ch3-7-Overlay-Smoke.cmd"), launcher, "utf8");

const readme = `SD종합센터 Chapter 3-7 업적 오버레이 물리 Smoke 후보\r\n\r\nRun-Ch3-7-Overlay-Smoke.cmd 를 실행하세요.\r\n- 실제 로그인/Core RPC/업적/지갑/거래를 변경하지 않습니다.\r\n- 합성 업적 1개가 우측 하단에 나타나야 합니다.\r\n- Windows 시스템 비프가 한 번 들려야 합니다.\r\n- 클릭하면 공식 업적 페이지가 기본 브라우저로 열려야 합니다.\r\n- 약 5.6초 후 알림이 사라지고 약 9초 후 테스트 프로세스가 종료됩니다.\r\n- 별도 임시 userData를 사용하고 종료 시 삭제합니다.\r\n`;
fs.writeFileSync(path.join(net45Root, "CH3-7-SMOKE-README.txt"), readme, "utf8");

console.log("Chapter 3-7 physical smoke hook injected into candidate copy only");
