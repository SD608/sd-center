import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commandJson } from "./commands.js";

const token = String(process.env.DISCORD_TOKEN || "").trim();
const clientId = String(process.env.DISCORD_CLIENT_ID || "").trim();
const guildId = String(process.env.DISCORD_GUILD_ID || "").trim();

if (!token) throw new Error("DISCORD_TOKEN이 필요합니다.");
if (!clientId) throw new Error("DISCORD_CLIENT_ID가 필요합니다.");

const rest = new REST({ version: "10" }).setToken(token);
const route = guildId
  ? Routes.applicationGuildCommands(clientId, guildId)
  : Routes.applicationCommands(clientId);

console.log(`[명령어 등록] ${guildId ? `서버 ${guildId}` : "전역"}에 ${commandJson.length}개 명령어를 등록합니다.`);
await rest.put(route, { body: commandJson });
console.log("[명령어 등록] 완료: /잔액 조회, /랭킹 조회");
