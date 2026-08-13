"use strict";
window.SD_EXTENSION_PACKS = [
  {
    id: "sd-logistics-center-web",
    name: "SD 물류센터",
    stage: "Season 0",
    version: "Web v1.0.0",
    category: "온라인 경영 확장팩",
    icon: "assets/icons/center.png",
    fileName: "홈페이지에서 실행",
    downloadUrl: "logistics-center.html",
    description: "운송 계약, 차량 운영, S등급 물류 본부, 기사 자동수익을 SD608 Online 공용 가상지갑과 연결해 홈페이지에서 바로 플레이합니다.",
    requirements: "SD608 Online 계정 로그인 · Supabase 물류센터 SQL",
    updatedAt: "2026-08-14",
    tags: ["공용 SD지갑", "홈페이지 플레이", "물류 경영"],
    featured: true,
    webApp: true
  },
  {
    id: "sd-link",
    name: "SD Link",
    stage: "Stage 1",
    version: "v1.2.1",
    category: "온라인 연동 확장팩",
    icon: "assets/icons/center.png",
    fileName: "SDLink_v1.2.1_Desktop.zip",
    downloadUrl: "downloads/extensions/SDLink_v1.2.1_Desktop.zip",
    description: "BTC 연동 오차를 수정했습니다. 선택한 SD지갑 계좌의 bitcoin_account_stats.btc_balance를 직접 읽어 PC 채굴장에서 실제 판매 가능한 BTC 보유량을 모바일과 정확히 동기화합니다. 기존 PC↔온라인 지갑 동기화와 복구 기능도 유지됩니다.",
    requirements: "SD종합센터 v2.1.1 이상 · SD지갑 · Windows 10/11",
    updatedAt: "2026-08-13",
    tags: ["PC·모바일 연동", "BTC 정확 연동", "동기화 복구"],
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

// 기존 홈페이지 확장팩 렌더러는 ZIP 버튼 전용입니다.
// 물류센터 카드만 렌더링 직후 "홈페이지에서 실행" 버튼으로 바꿉니다.
// 다른 확장팩 ZIP 동작은 건드리지 않습니다.
document.addEventListener("DOMContentLoaded", () => {
  window.setTimeout(() => {
    const cards = [...document.querySelectorAll(".extension-card")];
    const card = cards.find((item) => item.querySelector("h3")?.textContent?.trim() === "SD 물류센터");
    if (!card) return;
    const action = card.querySelector(".extension-download");
    const hint = card.querySelector(".extension-file-hint");
    if (!action) return;
    action.removeAttribute("download");
    action.href = "logistics-center.html";
    action.setAttribute("aria-label", "SD 물류센터 홈페이지에서 실행");
    const title = action.querySelector("span");
    const small = action.querySelector("small");
    if (title) title.textContent = "홈페이지에서 실행";
    if (small) small.textContent = "공용 SD지갑 온라인 연동";
    if (hint) hint.textContent = "설치 없이 로그인 후 바로 실행";
  }, 0);
});
