import {ChatInputCommandInteraction} from 'discord.js';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {notice} from '../utils/embeds.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Songs aus der Warteschlange entfernen')
    .addIntegerOption(option =>
      option.setName('position')
        .setDescription('Position des Songs [Standard: 1]')
        .setMinValue(1)
        .setRequired(false),
    )
    .addIntegerOption(option =>
      option.setName('range')
        .setDescription('Anzahl der Songs [Standard: 1]')
        .setMinValue(1)
        .setRequired(false));

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    const position = interaction.options.getInteger('position') ?? 1;
    const range = interaction.options.getInteger('range') ?? 1;

    if (position < 1) {
      throw new Error('die Position muss mindestens 1 sein');
    }

    if (range < 1) {
      throw new Error('die Anzahl muss mindestens 1 sein');
    }

    if (position > player.queueSize()) {
      throw new Error('diese Position gibt es in der Warteschlange nicht');
    }

    player.removeFromQueue(position, range);

    await interaction.reply({embeds: [notice('success', '🗑️ Aus der Warteschlange entfernt')]});
  }
}
