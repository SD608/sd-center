"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const card = document.getElementById("androidDownloadCard");
  if (!card) return;
  // APK 내부 WebView에서는 자기 자신을 다시 다운로드하는 안내를 숨깁니다.
  if (navigator.userAgent.includes("SD608Android/")) {
    card.hidden = true;
  }
});
