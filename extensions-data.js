"use strict";
window.SD_EXTENSION_PACKS = [
  {
    id: "sd-link",
    name: "SD Link",
    stage: "Stage 1",
    version: "v1.2.3",
    category: "온라인 연동 확장팩",
    icon: "assets/icons/center.png",
    fileName: "SDLink_v1.2.3_Desktop.zip",
    downloadUrl: "downloads/extensions/SDLink_v1.2.3_Desktop.zip",
    description: "응답없음 안정화 패치. 자동 동기화와 UI 조회 부하를 줄이고 SQLite 잠금 대기를 단축해 STA·SD광부·물류센터 등이 동시에 지갑을 사용할 때 SD Link 창이 멎는 현상을 완화했습니다. v1.2.2 동시수익 보호와 BTC 정확 연동도 유지됩니다.",
    requirements: "SD종합센터 v2.1.1 이상 · SD지갑 · Windows 10/11",
    updatedAt: "2026-08-14",
    tags: ["응답없음 안정화", "동시 수익 보호", "BTC 정확 연동"],
    featured: true
  },
  {
    id: "sd-slot",
    name: "SD슬롯",
    stage: "Stage 7",
    version: "v1.0.6",
    category: "게임 확장팩",
    icon: "assets/icons/slot.png",
    fileName: "SDSlot_Stage7_Desktop.zip",
    downloadUrl: "downloads/extensions/SDSlot_Stage7_Desktop.zip",
    description: "SD지갑 가상계좌와 연동되는 3릴 슬롯머신 시뮬레이션입니다. 선결제 후 3개 릴이 일치하면 가상 당첨금을 지급합니다.",
    requirements: "SD종합센터 v2.1.1 이상",
    updatedAt: "2026-07-31",
    tags: ["SD지갑 연동", "ZIP 앱 추가", "가상 시뮬레이션"],
    featured: true
  },
  {
    id: "sd-mukjippa",
    name: "SD묵찌빠",
    stage: "Version 1.1",
    version: "v1.0.1",
    category: "게임 확장팩",
    icon: "assets/icons/mukjippa.png",
    fileName: "SDMukjippa_Version1_1_Desktop.zip",
    downloadUrl: "downloads/extensions/SDMukjippa_Version1_1_Desktop.zip",
    description: "SD지갑 가상계좌와 연동되는 연승 도전형 묵찌빠 시뮬레이션입니다. 승리 후 보상을 정산하거나 다음 연승에 도전할 수 있습니다.",
    requirements: "SD종합센터 v2.1.1 이상",
    updatedAt: "2026-07-31",
    tags: ["SD지갑 연동", "연승 도전", "ZIP 앱 추가"],
    featured: true
  },
  {
    id: "sta",
    name: "STA",
    stage: "Version 6",
    version: "v1.5.0",
    category: "작전 확장팩",
    icon: "assets/icons/sta.png",
    fileName: "STA_Version6_Desktop.zip",
    downloadUrl: "downloads/extensions/STA_Version6_Desktop.zip",
    description: "해킹, 습격, 운반을 순서대로 수행하는 SD지갑 연동 작전 확장팩입니다. 운반 완료 후 최종 보상을 받고 5분 뒤 새 작전을 시작할 수 있습니다.",
    requirements: "SD종합센터 v2.1.1 이상",
    updatedAt: "2026-07-31",
    tags: ["SD지갑 연동", "미니게임 3종", "ZIP 앱 추가"],
    featured: true
  }
];
