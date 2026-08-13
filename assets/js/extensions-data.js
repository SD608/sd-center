"use strict";
window.SD_EXTENSION_PACKS = [
  {
    id: "sd-logistics-center",
    name: "SD 물류센터",
    stage: "Season 0",
    version: "v1.0.0",
    category: "경영 확장팩",
    icon: "assets/icons/center.png",
    fileName: "SDLogisticsCenter_Season0_Desktop.zip",
    downloadUrl: "downloads/extensions/SDLogisticsCenter_Season0_Desktop.zip",
    description: "SD종합센터에서 실행하는 물류 경영 확장팩입니다. 운송 계약, 차량 운영, S등급 이후 물류 본부와 기사 자동수익을 제공하며 선택한 SD지갑 가상계좌와 직접 연동됩니다.",
    requirements: "SD종합센터 v2.1.1 이상 · SD지갑 · Windows 10/11",
    updatedAt: "2026-08-14",
    tags: ["SD지갑 연동", "종합센터 실행", "ZIP 앱 추가"],
    featured: true
  },
  {
    id: "sd-link", name: "SD Link", stage: "Stage 1", version: "v1.2.1",
    category: "온라인 연동 확장팩", icon: "assets/icons/center.png",
    fileName: "SDLink_v1.2.1_Desktop.zip", downloadUrl: "downloads/extensions/SDLink_v1.2.1_Desktop.zip",
    description: "BTC 연동 오차를 수정했습니다. 선택한 SD지갑 계좌의 bitcoin_account_stats.btc_balance를 직접 읽어 PC 채굴장에서 실제 판매 가능한 BTC 보유량을 모바일과 정확히 동기화합니다. 기존 PC↔온라인 지갑 동기화와 복구 기능도 유지됩니다.",
    requirements: "SD종합센터 v2.1.1 이상 · SD지갑 · Windows 10/11",
    updatedAt: "2026-08-13", tags: ["PC·모바일 연동", "BTC 정확 연동", "동기화 복구"], featured: true
  },
  {
    id: "sd-slot", name: "SD슬롯", stage: "Stage 7", version: "v1.0.6",
    category: "게임 확장팩", icon: "assets/icons/slot.png",
    fileName: "SDSlot_Stage7_Desktop.zip", downloadUrl: "downloads/extensions/SDSlot_Stage7_Desktop.zip",
    description: "SD지갑 가상계좌와 연동되는 3릴 슬롯머신 시뮬레이션입니다. 선결제 후 3개 릴이 일치하면 가상 당첨금을 지급합니다.",
    requirements: "SD종합센터 v2.1.1 이상", updatedAt: "2026-07-31",
    tags: ["SD지갑 연동", "ZIP 앱 추가", "가상 시뮬레이션"], featured: true
  },
  {
    id: "sd-mukjippa", name: "SD묵찌빠", stage: "Version 1.1", version: "v1.0.1",
    category: "게임 확장팩", icon: "assets/icons/mukjippa.png",
    fileName: "SDMukjippa_Version1_1_Desktop.zip", downloadUrl: "downloads/extensions/SDMukjippa_Version1_1_Desktop.zip",
    description: "SD지갑 가상계좌와 연동되는 연승 도전형 묵찌빠 시뮬레이션입니다. 승리 후 보상을 정산하거나 다음 연승에 도전할 수 있습니다.",
    requirements: "SD종합센터 v2.1.1 이상", updatedAt: "2026-07-31",
    tags: ["SD지갑 연동", "연승 도전", "ZIP 앱 추가"], featured: true
  },
  {
    id: "sta", name: "STA", stage: "Version 6", version: "v1.5.0",
    category: "작전 확장팩", icon: "assets/icons/sta.png",
    fileName: "STA_Version6_Desktop.zip", downloadUrl: "downloads/extensions/STA_Version6_Desktop.zip",
    description: "해킹, 습격, 운반을 순서대로 수행하는 SD지갑 연동 작전 확장팩입니다. 운반 완료 후 최종 보상을 받고 5분 뒤 새 작전을 시작할 수 있습니다.",
    requirements: "SD종합센터 v2.1.1 이상", updatedAt: "2026-07-31",
    tags: ["SD지갑 연동", "미니게임 3종", "ZIP 앱 추가"], featured: true
  }
];
