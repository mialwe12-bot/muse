import {ChatInputCommandInteraction} from 'discord.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {buildQueueEmbed} from '../utils/build-embed.js';
import {buildQueueMessage} from '../utils/build-session-message.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('queue')
    .setDescription('aktuelle Warteschlange anzeigen')
    .addIntegerOption(option => option
      .setName('page')
      .setDescription('Seite der Warteschlange [Standard: 1]')
      .setMinValue(1)
      .setRequired(false))
    .addIntegerOption(option => option
      .setName('page-size')
      .setDescription('Einträge pro Seite [Standard: 10, max: 30]')
      .setMinValue(1)
      .setMaxValue(30)
      .setRequired(false));

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guild!.id;
    const player = this.playerManager.get(guildId);

    const pageSizeFromOptions = interaction.options.getInteger('page-size');
    const pageSize = pageSizeFromOptions ?? (await getGuildSettings(guildId)).defaultQueuePageSize;

    const page = interaction.options.getInteger('page') ?? 1;
    // Mit laufender Hör-Session im selben Kanal: Seiten-Buttons zum Blättern.
    const session = player.listeningSession?.snapshot();
    if (session && !session.endedAt && session.channelId === interaction.channelId && player.getCurrent()) {
      await interaction.reply({...buildQueueMessage(session, player, page - 1, pageSize), ephemeral: true});
      return;
    }

    const embed = buildQueueEmbed(player, page, pageSize);
    await interaction.reply({embeds: [embed], ephemeral: true});
  }
}
