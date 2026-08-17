import "dotenv/config";
import { Client, EmbedBuilder, GatewayIntentBits } from "discord.js";
import { findMemberByNames, formatWon, loadRankedMembers } from "./sd-data.js";
import { startUpdateMonitor } from "./update-monitor.js";

const token = String(process.env.DISCORD_TOKEN || "").trim();
if (!token) throw new Error("DISCORD_TOKEN이 필요합니다.");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function medalFor(rank) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${rank}`;
}

async function handleBalanceLookup(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const requestedNickname = interaction.options.getString("닉네임")?.trim() || "";
  const members = await loadRankedMembers();
  const fallbackNames = [
    interaction.member?.displayName,
    interaction.member?.nickname,
    interaction.user?.globalName,
    interaction.user?.username,
  ];
  const names = requestedNickname ? [requestedNickname] : fallbackNames;
  const member = findMemberByNames(members, names);

  if (!member) {
    const message = requestedNickname
      ? `SD종합센터에서 **${requestedNickname}** 닉네임을 찾지 못했습니다.`
      : "디스코드 이름과 같은 SD종합센터 닉네임을 찾지 못했습니다. `/잔액 조회 닉네임:내닉네임`처럼 닉네임을 직접 입력해 주세요.";
    await interaction.editReply({ content: message });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("💳 SD종합센터 잔액 조회")
    .addFields(
      { name: "닉네임", value: String(member.nickname || "회원"), inline: true },
      { name: "현재 잔액", value: formatWon(member.balance), inline: true },
      { name: "잔액 랭킹", value: `${member.rank}위 / ${members.length}명`, inline: true },
    )
    .setFooter({ text: "관리자 계정은 잔액 랭킹에서 제외됩니다." })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleRankingLookup(interaction) {
  await interaction.deferReply();

  const members = await loadRankedMembers();
  if (!members.length) {
    await interaction.editReply("표시할 잔액 랭킹이 없습니다.");
    return;
  }

  const top = members.slice(0, 10);
  const lines = top.map((member) =>
    `${medalFor(member.rank)} **${member.nickname || "회원"}** · ${formatWon(member.balance)}`
  );

  const embed = new EmbedBuilder()
    .setTitle("🏆 SD종합센터 통장 잔고 랭킹")
    .setDescription(lines.join("\n"))
    .setFooter({ text: `관리자 제외 · 전체 ${members.length}명 · 상위 ${top.length}명 표시` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

client.once("ready", (readyClient) => {
  console.log(`[SD종합센터 봇] ${readyClient.user.tag} 로그인 완료`);
  startUpdateMonitor(readyClient);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    const subcommand = interaction.options.getSubcommand(false);
    if (interaction.commandName === "잔액" && subcommand === "조회") {
      await handleBalanceLookup(interaction);
      return;
    }
    if (interaction.commandName === "랭킹" && subcommand === "조회") {
      await handleRankingLookup(interaction);
      return;
    }
  } catch (error) {
    console.error(`[명령어 오류] /${interaction.commandName}`, error);
    const message = "SD종합센터 서버 데이터를 불러오는 중 오류가 발생했습니다.";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message, embeds: [] }).catch(() => {});
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  }
});

client.on("error", (error) => console.error("[Discord Client]", error));
await client.login(token);
