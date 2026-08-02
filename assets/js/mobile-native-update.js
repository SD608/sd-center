"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const card = document.getElementById("nativeUpdateCard");
  const button = document.getElementById("nativeUpdateButton");
  const version = document.getElementById("nativeAppVersion");
  const hint = document.getElementById("nativeUpdateHint");
  if (!card || !button || !version || !hint) return;

  const match = navigator.userAgent.match(/SD608Android\/([^\s]+)/i);
  if (!match) return;

  card.hidden = false;
  const bridge = window.SDAndroid;

  if (bridge && typeof bridge.getAppVersion === "function" && typeof bridge.checkForUpdates === "function") {
    try {
      version.textContent = `현재 버전 ${bridge.getAppVersion()}`;
    } catch (error) {
      version.textContent = `현재 버전 ${match[1]}`;
    }
    hint.textContent = "버튼을 누르면 최신 버전을 확인하고 설치를 시작합니다.";
    button.addEventListener("click", () => {
      button.disabled = true;
      button.textContent = "확인 중…";
      try {
        bridge.checkForUpdates();
      } finally {
        setTimeout(() => {
          button.disabled = false;
          button.textContent = "업데이트 확인";
        }, 1800);
      }
    });
    return;
  }

  version.textContent = `현재 버전 ${match[1]}`;
  hint.textContent = "자동 업데이트 첫 적용 버전은 기존 앱 삭제 후 설치해야 합니다.";
  button.textContent = "최신 APK 받기";
  button.addEventListener("click", () => {
    location.href = "https://github.com/SD608/sd-center/releases/latest/download/SDCenter-Mobile.apk";
  });
});
