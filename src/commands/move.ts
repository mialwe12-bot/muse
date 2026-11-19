import {ChatInputCommandInteraction} from 'discord.js';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import formatSongReply from '../utils/format-song-reply.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('move')
    .setDescription('Songs in der Warteschlange verschieben')
    .addIntegerOption(option =>
      option.setName('from')
        .setDescription('Position des Songs, der verschoben wird')
        .setRequired(true),
    )
    .addIntegerOption(option =>
      option.setName('to')
        .setDescription('neue Position des Songs')
        .setRequired(true));

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    const from = interaction.options.getInteger('from') ?? 1;
    const to = interaction.options.getInteger('to') ?? 1;

    if (from < 1) {
      throw new Error('die Position muss mindestens 1 sein');
    }

    if (to < 1) {
      throw new Error('die Position muss mindestens 1 sein');
    }

    const {title} = player.move(from, to);

    await interaction.reply(formatSongReply(title, '**', '** auf Position **' + String(to) + '** verschoben'));
  }
}
