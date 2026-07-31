"use strict";
document.addEventListener("DOMContentLoaded", async () => {
  const mobile = window.SD_MOBILE;
  const status = document.getElementById("mobileStatus");
  if (!mobile) return;
  try {
    const state = await mobile.loadMobileShell();
    if (!state) return;
    document.getElementById("mobileSync").textContent = "온라인 연결됨";
  } catch (error) {
    mobile.setMobileStatus(status, mobile.auth.messageForError(error), "error");
  }
});
