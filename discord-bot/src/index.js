import "dotenv/config";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { startUpdateMonitor } from "./update-monitor.js";

const token = String(process.env.DISCORD_TOKEN || "").trim();
if (!token) throw new Error("DISCORD_TOKEN이 필요합니다.");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (readyClient) => {
  console.log(`[SD종합센터 공지봇] ${readyClient.user.tag} 로그인 완료`);
  startUpdateMonitor(readyClient);
});

client.on("error", (error) => console.error("[Discord Client]", error));
await client.login(token);
