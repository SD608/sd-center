import { SlashCommandBuilder } from "discord.js";

export const commandBuilders = [
  new SlashCommandBuilder()
    .setName("잔액")
    .setDescription("SD종합센터 잔액 명령어")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("조회")
        .setDescription("SD종합센터 계정 잔액을 조회합니다.")
        .addStringOption((option) =>
          option
            .setName("닉네임")
            .setDescription("조회할 SD종합센터 닉네임. 생략하면 디스코드 이름으로 찾습니다.")
            .setRequired(false)
        )
    ),
  new SlashCommandBuilder()
    .setName("랭킹")
    .setDescription("SD종합센터 랭킹 명령어")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("조회")
        .setDescription("관리자를 제외한 통장 잔고 랭킹을 조회합니다.")
    ),
];

export const commandJson = commandBuilders.map((command) => command.toJSON());
