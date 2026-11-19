import {ChatInputCommandInteraction} from 'discord.js';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {notice} from '../utils/embeds.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('replay')
    .setDescription('aktuellen Song von vorne abspielen');

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);

    const currentSong = player.getCurrent();

    if (!currentSong) {
      throw new Error('gerade läuft nichts');
    }

    if (currentSong.isLive) {
      throw new Error('einen Livestream kann man nicht neu starten');
    }

    await Promise.all([
      player.replay(),
      interaction.deferReply(),
    ]);

    await interaction.editReply({embeds: [notice('music', '⏮️ Song startet von vorne')]});
  }
}
