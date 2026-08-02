"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const auth = window.SD_AUTH;
  if (!auth) return;
  const status = document.getElementById("deviceStatus");
  const list = document.getElementById("deviceList");
  const count = document.getElementById("deviceCount");
  const refresh = document.getElementById("refreshDevices");

  async function load() {
    auth.clearStatus(status);
    refresh.disabled = true;
    try {
      const session = await auth.requireSession();
      if (!session) return;
      const { data, error } = await auth.client.rpc("list_sd_link_devices");
      if (error) throw error;
      const devices = data || [];
      const active = devices.filter((item) => !item.revoked_at);
      count.textContent = `활성 ${active.length}대 / 전체 ${devices.length}대`;
      list.replaceChildren();
      if (!devices.length) {
        const empty = document.createElement("div");
        empty.className = "transaction-empty";
        empty.textContent = "연결된 PC가 없습니다. SD Link 확장팩에서 이 PC 등록을 실행하세요.";
        list.append(empty);
        return;
      }
      devices.forEach((device) => {
        const card = document.createElement("article");
        card.className = `sdlink-device ${device.revoked_at ? "revoked" : ""}`;
        const info = document.createElement("div");
        info.innerHTML = `<strong>${device.device_name}</strong><span>이전 로컬 계좌 ${device.previous_account_number || "-"}</span><small>마지막 접속 ${auth.formatDate(device.last_seen_at)} · 마지막 동기화 ${auth.formatDate(device.last_sync_at)}</small>`;
        const badge = document.createElement("span");
        badge.className = `sdlink-device-badge ${device.revoked_at ? "off" : "on"}`;
        badge.textContent = device.revoked_at ? "연결 해제됨" : "연결됨";
        card.append(info, badge);
        if (!device.revoked_at) {
          const button = document.createElement("button");
          button.className = "sdlink-revoke";
          button.type = "button";
          button.textContent = "연결 해제";
          button.addEventListener("click", async () => {
            if (!confirm(`${device.device_name} 연결을 해제할까요?`)) return;
            button.disabled = true;
            try {
              const result = await auth.client.rpc("revoke_sd_link_device", { p_device_id: device.device_id });
              if (result.error) throw result.error;
              auth.setStatus(status, "PC 연결을 해제했습니다.", "success");
              await load();
            } catch (error) {
              auth.setStatus(status, auth.messageForError(error), "error");
              button.disabled = false;
            }
          });
          card.append(button);
        }
        list.append(card);
      });
    } catch (error) {
      auth.setStatus(status, auth.messageForError(error), "error");
    } finally {
      refresh.disabled = false;
    }
  }

  refresh.addEventListener("click", load);
  document.getElementById("deviceLogout").addEventListener("click", async () => {
    await auth.client.auth.signOut();
    location.replace("login.html");
  });
  load();
});
