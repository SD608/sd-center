import fs from "node:fs/promises";
import path from "node:path";
import { EmbedBuilder } from "discord.js";

const DEFAULT_CENTER_URL = "https://sd608.github.io/sd-center/update/center-update.json";
const DEFAULT_EXTENSIONS_URL = "https://sd608.github.io/sd-center/update/extensions-catalog.json";
const STATE_PATH = path.resolve("data", "update-state.json");

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "SDCenter-DiscordBot/1.0" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${url} 응답 오류: HTTP ${response.status}`);
  return response.json();
}

function snapshotOf(center, extensions) {
  const extensionVersions = {};
  for (const [id, app] of Object.entries(extensions?.apps || {})) {
    extensionVersions[id] = String(app?.version || "");
  }
  return {
    centerVersion: String(center?.version || ""),
    extensions: extensionVersions,
  };
}

async function readState() {
  try {
    return JSON.parse(await fs.readFile(STATE_PATH, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeState(state) {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function collectChanges(previous, center, extensions) {
  const changes = [];
  const current = snapshotOf(center, extensions);

  if (previous?.centerVersion && current.centerVersion && previous.centerVersion !== current.centerVersion) {
    changes.push({
      type: "center",
      name: "SD종합센터",
      from: previous.centerVersion,
      to: current.centerVersion,
      notes: String(center?.notes || "새 버전이 배포되었습니다."),
      url: String(center?.downloadUrl || ""),
    });
  }

  for (const [id, app] of Object.entries(extensions?.apps || {})) {
    const before = previous?.extensions?.[id];
    const after = String(app?.version || "");
    if (!before || !after || before === after) continue;
    changes.push({
      type: "extension",
      name: String(app?.name || id),
      from: before,
      to: after,
      notes: String(app?.notes || "새 버전이 배포되었습니다."),
      url: String(app?.downloadUrl || ""),
    });
  }

  return { changes, current };
}

function makeUpdateEmbeds(changes) {
  return changes.map((change) => {
    const embed = new EmbedBuilder()
      .setTitle(`📢 ${change.name} 업데이트`)
      .setDescription(`**v${change.from} → v${change.to}**`)
      .addFields({ name: "변경 내용", value: change.notes.slice(0, 1024) || "업데이트가 배포되었습니다." })
      .setTimestamp();

    if (change.url.startsWith("https://") || change.url.startsWith("http://")) {
      embed.setURL(change.url);
    }
    return embed;
  });
}

async function resolveAnnouncementChannel(client) {
  const channelId = String(process.env.UPDATE_CHANNEL_ID || "").trim();
  if (!channelId) return null;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || typeof channel.send !== "function") {
    throw new Error("UPDATE_CHANNEL_ID가 메시지를 보낼 수 있는 텍스트 채널이 아닙니다.");
  }
  return channel;
}

export async function checkForUpdates(client) {
  const centerUrl = process.env.CENTER_UPDATE_URL || DEFAULT_CENTER_URL;
  const extensionsUrl = process.env.EXTENSIONS_CATALOG_URL || DEFAULT_EXTENSIONS_URL;

  const [center, extensions, previous] = await Promise.all([
    fetchJson(centerUrl),
    fetchJson(extensionsUrl),
    readState(),
  ]);

  const current = snapshotOf(center, extensions);
  if (!previous) {
    await writeState(current);
    console.log("[업데이트 공지] 현재 버전을 기준점으로 저장했습니다.");
    return;
  }

  const { changes } = collectChanges(previous, center, extensions);
  if (!changes.length) {
    if (JSON.stringify(previous) !== JSON.stringify(current)) await writeState(current);
    return;
  }

  const channel = await resolveAnnouncementChannel(client);
  if (!channel) {
    console.warn("[업데이트 공지] UPDATE_CHANNEL_ID가 없어 공지를 건너뜁니다.");
    return;
  }

  for (const embed of makeUpdateEmbeds(changes)) {
    await channel.send({ embeds: [embed] });
  }
  await writeState(current);
  console.log(`[업데이트 공지] ${changes.length}개 업데이트를 공지했습니다.`);
}

export function startUpdateMonitor(client) {
  if (!String(process.env.UPDATE_CHANNEL_ID || "").trim()) {
    console.warn("[업데이트 공지] UPDATE_CHANNEL_ID 미설정 - 자동 공지 기능 비활성화");
    return null;
  }

  const requested = Number(process.env.UPDATE_POLL_INTERVAL_MS || 60_000);
  const intervalMs = Number.isFinite(requested) ? Math.max(requested, 30_000) : 60_000;

  const run = () => checkForUpdates(client).catch((error) => {
    console.error("[업데이트 공지] 확인 실패:", error?.message || error);
  });

  void run();
  return setInterval(run, intervalMs);
}
