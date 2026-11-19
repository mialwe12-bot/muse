import {ChatInputCommandInteraction} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {STATUS} from '../services/player.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('loop-queue')
    .setDescription('Wiederholung der ganzen Warteschlange an/aus');

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    if (player.status === STATUS.IDLE) {
      throw new Error('keine Songs zum Wiederholen!');
    }

    if (!player.loopCurrentQueue && player.queueSize() < 1) {
      throw new Error('zu wenige Songs, um die Warteschlange zu wiederholen!');
    }

    if (player.loopCurrentSong) {
      player.loopCurrentSong = false;
    }

    player.loopCurrentQueue = !player.loopCurrentQueue;
    player.refreshPlayingMessage();

    await interaction.reply((player.loopCurrentQueue ? '🔁 Warteschlange wird wiederholt' : 'Warteschlange wird nicht mehr wiederholt'));
  }
}
