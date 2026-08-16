"use strict";
window.SD_EXTENSION_PACKS = [
  {
    id: "sd-link",
    name: "SD Link",
    stage: "Stage 1",
    version: "v1.2.4",
    category: "온라인 연동 확장팩",
    icon: "assets/icons/center.png",
    fileName: "SDLink_v1.2.4_Desktop.zip",
    downloadUrl: "downloads/extensions/SDLink_v1.2.4_Desktop.zip",
    description: "센터 버전 증명과 필수 업데이트 서버 정책을 추가했습니다. 일반 회원의 구 센터 PC 거래는 서버에서 차단되며 관리자 계정은 예외입니다. v1.2.3 안정화와 동시수익 보호, BTC 정확 연동도 유지됩니다.",
    requirements: "SD종합센터 v2.1.1 이상 · SD지갑 · Windows 10/11",
    updatedAt: "2026-08-14",
    tags: ["응답없음 안정화", "동시 수익 보호", "BTC 정확 연동"],
    featured: true
  },
  {
    id: "sd-logistics-center",
    name: "SD 물류센터",
    stage: "Season 0",
    version: "v1.0.9",
    category: "경영 확장팩",
    icon: "assets/icons/logistics-center.png",
    fileName: "SDLogisticsCenter_Season0_Desktop.zip",
    downloadUrl: "downloads/extensions/SDLogisticsCenter_Season0_Desktop.zip?v=109",
    description: "SD지갑과 연동되는 물류회사 경영 확장팩입니다. v1.0.9 업데이트 후 물류 등급·실적·차량·기사·본부·계약 진행도를 계정/PC 기준으로 1회 초기화하며 SD지갑 잔액과 거래내역은 유지합니다. v1.0.8의 랭크 및 차량 해금 밸런스도 유지됩니다.",
    requirements: "SD종합센터 v2.1.2 이상 · SD지갑 · Windows 10/11",
    updatedAt: "2026-08-14",
    tags: ["SD지갑 유지", "1회 진행도 초기화", "랭크/차량 해금"],
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
    version: "v1.5.1",
    category: "작전 확장팩",
    icon: "assets/icons/sta.png",
    fileName: "STA_Version6_Desktop.zip",
    downloadUrl: "downloads/extensions/STA_Version6_Desktop.zip?v=151",
    description: "해킹, 습격, 운반을 순서대로 수행하는 SD지갑 연동 작전 확장팩입니다. v1.5.1에서 현금 획득 종료 후 운반 화면으로 넘어가지 않던 버그를 수정했습니다.",
    requirements: "SD종합센터 v2.1.1 이상",
    updatedAt: "2026-08-14",
    tags: ["SD지갑 연동", "미니게임 3종", "ZIP 앱 추가"],
    featured: true
  },
  {
    id: "sd-flea-market",
    name: "SD 플리마켓",
    stage: "PC Expansion",
    version: "v1.0.0",
    category: "파밍·습격 확장팩",
    icon: "assets/icons/flea-market.png",
    fileName: "SDFleaMarket_v1.0.0_Desktop.zip",
    downloadUrl: "#",
    unlockDownloadUrl: "downloads/extensions/SDFleaMarket_v1.0.0_Desktop.zip?v=100",
    description: "길거리·상가·물류센터 파밍과 상자 개봉, 은행 준비작업·피날레·오토바이 추격전을 담은 PC 확장팩입니다. 공식 확장팩 센터에서는 SD 물류회사 S등급에서 해금됩니다.",
    requirements: "SD종합센터 v2.2.0 이상 · SD 물류회사 S등급 · Windows 10/11",
    updatedAt: "2026-08-16",
    tags: ["S등급 해금", "은행 습격", "오토바이 추격"],
    featured: true,
    requiredLogisticsRank: "S",
    requiredLogisticsRep: 7000
  }
];

(function initializeFleaMarketEntitlementGate() {
  const pack = window.SD_EXTENSION_PACKS.find((item) => item.id === "sd-flea-market");
  if (!pack) return;

  const rankForRep = (value) => {
    const rep = Number(value || 0);
    if (rep >= 7000) return "S";
    if (rep >= 4500) return "A";
    if (rep >= 2800) return "B";
    if (rep >= 1600) return "C";
    if (rep >= 800) return "D";
    if (rep >= 300) return "E";
    return "F";
  };

  const findCard = () => [...document.querySelectorAll(".extension-card")]
    .find((card) => card.querySelector("h3")?.textContent?.trim() === pack.name);

  const setLink = (link, { href, title, detail, locked }) => {
    if (!link) return;
    link.href = href;
    link.removeAttribute("download");
    link.replaceChildren();
    const main = document.createElement("span");
    main.textContent = title;
    const small = document.createElement("small");
    small.textContent = detail;
    link.append(main, small);
    link.dataset.sdLocked = locked ? "true" : "false";
    link.style.opacity = locked ? "0.72" : "";
    link.style.filter = locked ? "saturate(.55)" : "";
    link.style.cursor = locked ? "not-allowed" : "";
    if (!locked) link.setAttribute("download", pack.fileName);
  };

  const applyGate = async () => {
    const card = findCard();
    const link = card?.querySelector(".extension-download");
    if (!card || !link) return;

    setLink(link, {
      href: "#",
      title: "🔒 S등급 확인 중",
      detail: "SD 물류회사 평판 7,000 필요",
      locked: true
    });

    if (!window.SD_AUTH?.getSession || !window.SD_AUTH?.client) {
      setLink(link, {
        href: "#",
        title: "🔒 S등급 확인 불가",
        detail: "페이지를 새로고침해 주세요",
        locked: true
      });
      link.onclick = (event) => event.preventDefault();
      return;
    }

    try {
      const session = await window.SD_AUTH.getSession();
      if (!session?.user?.id) {
        setLink(link, {
          href: "login.html?next=index.html%23extensions",
          title: "로그인 후 S등급 확인",
          detail: "SD 물류회사 S등급 필요",
          locked: false
        });
        link.removeAttribute("download");
        return;
      }

      const { data, error } = await window.SD_AUTH.client
        .from("sd_logistics_progress")
        .select("state")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (error) throw error;

      const rep = Number(data?.state?.logisticsRep || 0);
      const rank = rankForRep(rep);
      if (rep >= Number(pack.requiredLogisticsRep || 7000)) {
        setLink(link, {
          href: pack.unlockDownloadUrl,
          title: "ZIP 다운로드",
          detail: `${pack.fileName} · S등급 인증 완료`,
          locked: false
        });
        link.onclick = null;
        return;
      }

      setLink(link, {
        href: "#",
        title: `🔒 S등급 필요 · 현재 ${rank}등급`,
        detail: `현재 평판 ${rep.toLocaleString("ko-KR")} / 7,000`,
        locked: true
      });
      link.onclick = (event) => {
        event.preventDefault();
        window.alert(`SD 플리마켓은 물류회사 S등급에서 해금됩니다.\n현재 ${rank}등급 · 평판 ${rep.toLocaleString("ko-KR")} / 7,000`);
      };
    } catch (error) {
      console.warn("SD 플리마켓 S등급 확인 실패", error?.message || error);
      setLink(link, {
        href: "#",
        title: "🔒 S등급 확인 실패",
        detail: "물류회사 진행도를 불러오지 못했습니다",
        locked: true
      });
      link.onclick = (event) => event.preventDefault();
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    window.setTimeout(() => void applyGate(), 0);
  });
})();
