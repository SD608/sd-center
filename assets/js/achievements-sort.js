"use strict";

(() => {
  const ORDER = {
    logistics: [
      "천리길도 한 걸음", "지점장", "본부장", "택배기사", "해외 진출", "봉고르기니", "차고지", "오늘도 배송중",
      "글로벌 물류기업", "운수재벌", "카 컬렉터", "베테랑 기사", "배송의 왕", "C.E.O", "배송의 황제", "배송의 신"
    ],
    flea: [
      "당근하세요?", "바늘 도둑", "꽝", "득템", "교도소 단골", "라쿤", "폭주족", "되팔이", "비일비제", "40도",
      "사재기", "심마니", "도매상", "만물상", "70도", "소 도둑", "파밍왕", "99.9", "행운아"
    ],
    miner: [
      "노다지", "돌 곡괭이", "아오지 생존자", "철 곡괭이", "다이아 곡괭이", "금맥", "지질학자", "광산의 주인", "광산재벌"
    ],
    mukjjippa: ["울버린", "심리학자"],
    slot: ["네잎클로버", "레버 중독", "오늘은 아닌가봐", "이게 현실이라면", "카지노 주민", "카지노의 왕", "인생은 한방"],
    oddeven: [
      "반반의 확률", "전재산 삭제", "홀릭", "짝사랑", "내가 뭐라고 했더라?", "말이 안되는거잖아", "거기서?", "촉이 온다",
      "운칠기삼", "확률을 지배하는 자"
    ],
    bitcoin: ["채굴 시작", "개미", "암호화폐의 거장", "???", "사토시 나카모토"],
    sta: ["기계손", "바이커", "해커"],
    gold: ["금수저", "리치맨", "미다스"],
    npcvault: ["좀도둑", "열쇠공", "빈집털이", "보이지 않는 손", "마스터키", "손기술", "오션스 일레븐", "루팡"],
    sdcoin: ["주린이", "분산투자", "DDJ", "HSH", "SET", "HIZ", "KNG", "SD", "대주주"],
    wallet: ["텅장", "첫 단추", "억소리", "중산층", "대부", "억만장자", "조만장자"],
    ranking: ["전설"]
  };

  const sortAchievements = () => {
    Object.entries(ORDER).forEach(([category, orderedNames]) => {
      const panel = document.querySelector(`[data-achievement-panel="${category}"]`);
      const grid = panel?.querySelector(".achievement-grid");
      if (!grid) return;

      const ranks = new Map(orderedNames.map((name, index) => [name, index]));
      const cards = Array.from(grid.querySelectorAll(".achievement-card"));
      cards.sort((left, right) => {
        const leftName = left.querySelector(".achievement-name")?.textContent?.trim() || "";
        const rightName = right.querySelector(".achievement-name")?.textContent?.trim() || "";
        return (ranks.get(leftName) ?? 9999) - (ranks.get(rightName) ?? 9999);
      });
      cards.forEach((card) => grid.appendChild(card));
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", sortAchievements, { once: true });
  } else {
    sortAchievements();
  }
})();
