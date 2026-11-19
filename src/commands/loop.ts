import {ChatInputCommandInteraction} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {STATUS} from '../services/player.js';
import {notice} from '../utils/embeds.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Wiederholung des aktuellen Songs an/aus');

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    if (player.status === STATUS.IDLE) {
      throw new Error('kein Song zum Wiederholen!');
    }

    if (player.loopCurrentQueue) {
      player.loopCurrentQueue = false;
    }

    player.loopCurrentSong = !player.loopCurrentSong;
    player.refreshPlayingMessage();

    await interaction.reply({embeds: [notice('music', player.loopCurrentSong ? '🔂 Song wird wiederholt' : '➡️ Song wird nicht mehr wiederholt')]});
  }
}
