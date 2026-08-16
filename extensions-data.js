"use strict";
window.SD_EXTENSION_PACKS = [
  {
    id: "sd-link",
    name: "SD Link",
    stage: "Stage 1",
    version: "v1.2.7",
    category: "온라인 연동 확장팩",
    icon: "assets/icons/center.png",
    fileName: "SDLink_v1.2.7_Desktop.zip",
    downloadUrl: "downloads/extensions/SDLink_v1.2.7_Desktop.zip?v=127",
    description: "SD Online 계정과 PC 앱을 연결하는 핵심 확장팩입니다. v1.2.7에서 로컬 앱 브리지를 안정화해 SD 플리마켓의 온라인 재고·회사 등급 동기화를 지원합니다. 기존 거래 동기화와 백그라운드 안정화 기능도 유지됩니다.",
    requirements: "SD종합센터 v2.1.1 이상 · SD지갑 · Windows 10/11",
    updatedAt: "2026-08-16",
    tags: ["로컬 앱 브리지", "플리마켓 온라인 동기화", "백그라운드 안정화"],
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
    downloadUrl: "downloads/extensions/SDLogisticsCenter_Season0_Desktop.zip?v=1092",
    description: "SD지갑과 연동되는 물류회사 경영 확장팩입니다. v1.0.9에서 현재 회사 등급과 물류 평판을 로컬 공유 상태로 갱신해 SD 플리마켓에서 실제 진행도를 바로 읽을 수 있도록 연동했습니다. 기존 v1.0.9 랭크·차량 해금 및 경영 진행 규칙은 유지됩니다.",
    requirements: "SD종합센터 v2.1.2 이상 · SD지갑 · Windows 10/11",
    updatedAt: "2026-08-16",
    tags: ["회사 등급 공유", "플리마켓 연동", "랭크/차량 해금"],
    featured: true
  },
  {
    id: "sd-bitcoin-miner",
    name: "SD비트코인 채굴장",
    stage: "Version 1.2",
    version: "v1.2.2",
    category: "자동 수익 확장팩",
    icon: "assets/icons/bitcoin.png",
    fileName: "SDBitcoinMiner_v1.2.2_Desktop.zip",
    downloadUrl: "downloads/extensions/SDBitcoinMiner_v1.2.2_Desktop.zip?v=122",
    description: "v1.2.1에서 종합센터 확장팩 설치 경로의 공용 모듈 누락으로 실행되지 않던 문제를 수정했습니다. 채굴 확률 0.02%, GPU 155만원, GPU당 하루 전기세 10만원, 성공 시 해당 GPU 내구도 1% 감소 및 0% 파손 규칙을 유지합니다.",
    requirements: "SD종합센터 v2.1.3 이상 · SD지갑 · Windows 10/11",
    updatedAt: "2026-08-14",
    tags: ["실행 오류 수정", "GPU 내구도", "자동 업데이트"],
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
    version: "v1.0.9",
    category: "파밍·습격 확장팩",
    icon: "assets/icons/flea-market.png?v=3",
    fileName: "SDFleaMarket_v1.0.9_Desktop.zip",
    downloadUrl: "#",
    unlockDownloadUrl: "downloads/extensions/SDFleaMarket_v1.0.9_Desktop.zip?v=109",
    description: "PC에서 획득한 물품을 SD Online 계정과 동기화해 PC·모바일에서 함께 관리하는 플리마켓 확장팩입니다. v1.0.9에서 실제 물류센터 회사 등급을 직접 반영하고, 홈 회사 등급과 물품 보관함에 새로고침 기능을 추가했습니다. SD Link v1.2.7 브리지와 온라인 재고 동기화도 포함됩니다.",
    requirements: "SD종합센터 v2.2.0 이상 · SD Link v1.2.7 이상 · SD 물류회사 S등급 · Windows 10/11",
    updatedAt: "2026-08-16",
    tags: ["회사 등급 직접연동", "온라인 물품 새로고침", "PC·모바일 재고 동기화"],
    featured: true,
    requiredLogisticsRank: "S",
    requiredLogisticsRep: 2200
  }
];

(function initializeFleaMarketEntitlementGate() {
  const pack = window.SD_EXTENSION_PACKS.find((item) => item.id === "sd-flea-market");
  if (!pack) return;

  const rankForRep = (value) => {
    const rep = Number(value || 0);
    if (rep >= 2200) return "S";
    if (rep >= 1450) return "A";
    if (rep >= 900) return "B";
    if (rep >= 520) return "C";
    if (rep >= 260) return "D";
    if (rep >= 100) return "E";
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

    const requiredRep = Number(pack.requiredLogisticsRep || 2200);

    setLink(link, {
      href: "#",
      title: "🔒 S등급 확인 중",
      detail: `SD 물류회사 평판 ${requiredRep.toLocaleString("ko-KR")} 필요`,
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
      if (rep >= requiredRep) {
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
        detail: `현재 평판 ${rep.toLocaleString("ko-KR")} / ${requiredRep.toLocaleString("ko-KR")}`,
        locked: true
      });
      link.onclick = (event) => {
        event.preventDefault();
        window.alert(`SD 플리마켓은 물류회사 S등급에서 해금됩니다.\n현재 ${rank}등급 · 평판 ${rep.toLocaleString("ko-KR")} / ${requiredRep.toLocaleString("ko-KR")}`);
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
