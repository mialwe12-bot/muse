import {ChatInputCommandInteraction} from 'discord.js';
import {injectable} from 'inversify';
import {SlashCommandBuilder} from '@discordjs/builders';
import Command from './index.js';
import {isOwner} from '../utils/access.js';
import {textEmbed} from '../utils/embeds.js';
import {createLoginLink} from '../panel/server.js';

/** Einmal-Link zum Web-Panel (Lizenzen, Blacklist, Server, Spotify). */
@injectable()
export default class implements Command {
  public readonly ownerOnly = true;

  public readonly slashCommand = new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Link zum ByteMusic-Panel (Lizenzen, Blacklist, Spotify) – nur Bot-Besitzer')
    .setDefaultMemberPermissions(0)
    .setDMPermission(false);

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!isOwner(interaction.user.id)) {
      throw new Error('das darf nur der Bot-Besitzer');
    }

    const link = createLoginLink(interaction.user.id);
    await interaction.reply({
      embeds: [textEmbed('info', `[➡️ Panel öffnen](${link})\n\nDer Link gilt 10 Minuten und nur einmal. Danach bleibst du 7 Tage angemeldet. Nicht weitergeben!`, '🔐 ByteMusic-Panel')],
      ephemeral: true,
    });
  }
}
