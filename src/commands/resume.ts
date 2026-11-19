import {SlashCommandBuilder} from '@discordjs/builders';
import {inject, injectable} from 'inversify';
import Command from './index.js';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import {STATUS} from '../services/player.js';
import SessionPlayer from '../services/session-player.js';
import {getMemberVoiceChannel, getMostPopularVoiceChannel} from '../utils/channels.js';
import {ChatInputCommandInteraction, GuildMember, GuildTextBasedChannel} from 'discord.js';
import {textEmbed} from '../utils/embeds.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Wiedergabe fortsetzen');

  public requiresVC = true;

  private readonly playerManager: PlayerManager;

  constructor(@inject(TYPES.Managers.Player) playerManager: PlayerManager,
    @inject(TYPES.Services.SessionPlayer) private readonly sessionPlayer: SessionPlayer) {
    this.playerManager = playerManager;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const player = this.playerManager.get(interaction.guild!.id);
    const [targetVoiceChannel] = getMemberVoiceChannel(interaction.member as GuildMember) ?? getMostPopularVoiceChannel(interaction.guild!);
    if (player.status === STATUS.PLAYING) {
      throw new Error('läuft schon – gib mir einen Songnamen');
    }

    // Must be resuming play
    if (!player.getCurrent()) {
      throw new Error('nichts zum Abspielen da');
    }

    await interaction.deferReply({ephemeral: true});
    if (player.voiceConnection) {
      await player.ensureVoiceConnectionReady();
    } else {
      await player.connect(targetVoiceChannel);
    }

    await player.play();
    if (!player.getCurrent()) {
      throw new Error('keine abspielbaren Songs gefunden');
    }

    const url = await this.sessionPlayer.ensureMessage(player, interaction.channel as GuildTextBasedChannel);
    await interaction.editReply({embeds: [textEmbed('music', `[➡️ Zum Player](${url})`, '▶️ Wiedergabe fortgesetzt')], allowedMentions: {parse: []}});
  }
}
