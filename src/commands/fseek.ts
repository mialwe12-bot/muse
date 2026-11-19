import {ChatInputCommandInteraction} from 'discord.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {TYPES} from '../types.js';
import {inject, injectable} from 'inversify';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {prettyTime} from '../utils/time.js';
import durationStringToSeconds from '../utils/duration-string-to-seconds.js';
import {notice} from '../utils/embeds.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('fseek')
    .setDescription('im aktuellen Song vorspulen')
    .addStringOption(option => option
      .setName('time')
      .setDescription('Zeitangabe oder Sekunden (z. B. 1m, 30s, 100)')
      .setRequired(true));

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
      throw new Error('in einem Livestream kann man nicht spulen');
    }

    const seekValue = interaction.options.getString('time');

    if (!seekValue) {
      throw new Error('keine Zeitangabe');
    }

    const seekTime = durationStringToSeconds(seekValue);

    if (!Number.isFinite(seekTime) || seekTime <= 0) {
      throw new Error('ungültige Zeitangabe');
    }

    if (seekTime + player.getPosition() > currentSong.length) {
      throw new Error('so lang ist der Song nicht');
    }

    await Promise.all([
      player.forwardSeek(seekTime),
      interaction.deferReply(),
    ]);

    await interaction.editReply({embeds: [notice('music', `⏩ Gespult zu ${prettyTime(player.getPosition())}`)]});
  }
}
