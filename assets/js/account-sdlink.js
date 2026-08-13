"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const auth = window.SD_AUTH;
  if (!auth) return;
  const badge = document.getElementById("sdlinkMigrationBadge");
  const text = document.getElementById("sdlinkMigrationText");
  const count = document.getElementById("sdlinkDeviceCount");

  try {
    const session = await auth.requireSession();
    if (!session) return;
    const [migrationResult, deviceResult, profileResult] = await Promise.all([
      auth.client.from("wallet_migrations")
        .select("status,migrated_balance,created_at,reviewed_at,rejection_reason")
        .maybeSingle(),
      auth.client.rpc("list_sd_link_devices"),
      auth.client.from("profiles").select("role").single(),
    ]);
    if (migrationResult.error) throw migrationResult.error;
    if (deviceResult.error) throw deviceResult.error;
    if (profileResult.error) throw profileResult.error;

    const isAdmin = profileResult.data?.role === "admin";
    const migrationLink = document.getElementById("adminMigrationLink");
    const inviteLink = document.getElementById("adminInviteLink");
    const securityLink = document.getElementById("adminSecurityLink");
    if (migrationLink) migrationLink.hidden = !isAdmin;
    if (inviteLink) inviteLink.hidden = !isAdmin;
    if (securityLink) securityLink.hidden = !isAdmin;
    const migration = migrationResult.data;
    const devices = (deviceResult.data || []).filter((item) => !item.revoked_at);
    count.textContent = `${devices.length}대 연결됨`;
    if (!migration) {
      badge.textContent = "미신청";
      badge.className = "migration-badge pending";
      text.textContent = "PC에서 SD Link 확장팩을 설치하고 기존 로컬 계좌 이전을 신청하세요.";
    } else if (migration.status === "completed") {
      badge.textContent = "연동 완료";
      badge.className = "migration-badge completed";
      text.textContent = `기존 PC 가상잔액 ${auth.formatWon(migration.migrated_balance)} 이전이 완료되었습니다. PC와 모바일이 같은 온라인 장부를 사용합니다.`;
    } else if (migration.status === "pending") {
      badge.textContent = "승인 대기";
      badge.className = "migration-badge pending";
      text.textContent = "PC 잔액 이전 신청이 관리자 승인 대기 중입니다. 승인 후 SD Link가 자동 동기화를 시작합니다.";
    } else {
      badge.textContent = "거절";
      badge.className = "migration-badge rejected";
      text.textContent = migration.rejection_reason || "잔액 이전이 거절되었습니다. 관리자에게 확인하세요.";
    }
  } catch (error) {
    badge.textContent = "확인 실패";
    badge.className = "migration-badge rejected";
    text.textContent = auth.messageForError(error);
    count.textContent = "확인 실패";
  }
});
