"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const picker = document.getElementById("editorShowcasePicker");
  const layoutEditor = document.getElementById("profileCardLayoutEditor");
  const actions = document.querySelector(".profile-card-editor-actions");
  if (!picker || !layoutEditor || !actions) return;

  const section = picker.closest(".profile-editor-content-section");
  if (!section) return;

  section.classList.add("profile-showcase-inline-section");
  const heading = section.querySelector("h4");
  if (heading) heading.textContent = "플리마켓 자랑 아이템 선택";

  let counter = section.querySelector(".profile-showcase-picker-count");
  if (!counter) {
    counter = document.createElement("span");
    counter.className = "profile-showcase-picker-count";
    const header = section.querySelector("header");
    if (header) header.append(counter);
  }

  actions.before(section);

  function updateCount() {
    const inputs = [...picker.querySelectorAll('input[type="checkbox"]')];
    if (!inputs.length) {
      counter.textContent = picker.querySelector(".profile-editor-empty") ? "불러오는 중" : "보유 0개 · 선택 0/6";
      return;
    }
    const selected = inputs.filter((input) => input.checked).length;
    counter.textContent = `보유 ${inputs.length}개 · 선택 ${selected}/6`;

    const row = layoutEditor.querySelector('[data-layout-block="flea_showcase"] .profile-card-layout-info');
    if (row) {
      let summary = row.querySelector(".profile-showcase-layout-summary");
      if (!summary) {
        summary = document.createElement("small");
        summary.className = "profile-showcase-layout-summary";
        row.append(summary);
      }
      summary.textContent = `보유 ${inputs.length}개 · 선택 ${selected}/6`;
    }
  }

  picker.addEventListener("change", () => queueMicrotask(updateCount));
  new MutationObserver(updateCount).observe(picker, { childList: true, subtree: true });
  updateCount();
});
