import {ChatInputCommandInteraction, EmbedBuilder} from 'discord.js';
import {injectable} from 'inversify';
import {SlashCommandBuilder} from '@discordjs/builders';
import Command from './index.js';
import {isOwner} from '../utils/access.js';
import {addJellyfinServer, listJellyfinServers, removeJellyfinServer} from '../utils/jellyfin.js';
import {notice, textEmbed} from '../utils/embeds.js';

@injectable()
export default class implements Command {
  public readonly ownerOnly = true;

  public readonly slashCommand = new SlashCommandBuilder()
    .setName('jellyfin')
    .setDescription('Jellyfin-Server mit API-Key hinterlegen, damit normale Links funktionieren (nur Bot-Besitzer)')
    .setDefaultMemberPermissions(0)
    .setDMPermission(false)
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Jellyfin-Server hinzufügen oder Key ändern')
      .addStringOption(option => option.setName('url').setDescription('Adresse, z. B. https://jellyfin.example.de').setRequired(true).setMaxLength(300))
      .addStringOption(option => option.setName('key').setDescription('API-Key (Dashboard → API-Schlüssel)').setRequired(true).setMinLength(16).setMaxLength(100)))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Jellyfin-Server entfernen')
      .addStringOption(option => option.setName('url').setDescription('Adresse des Servers').setRequired(true).setMaxLength(300)))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('hinterlegte Jellyfin-Server anzeigen'));

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!isOwner(interaction.user.id)) {
      throw new Error('das darf nur der Bot-Besitzer');
    }

    switch (interaction.options.getSubcommand()) {
      case 'add': {
        await interaction.deferReply({ephemeral: true});
        const server = await addJellyfinServer(interaction.options.getString('url', true).trim(), interaction.options.getString('key', true).trim());
        await interaction.editReply({embeds: [textEmbed('success', `**${server.name}** (${server.base})\nLinks aus der Weboberfläche funktionieren jetzt mit \`/play\`.`, '✅ Jellyfin-Server hinterlegt')]});
        break;
      }

      case 'remove': {
        const removed = await removeJellyfinServer(interaction.options.getString('url', true).trim());
        await interaction.reply({embeds: [removed ? notice('success', '🗑️ Jellyfin-Server entfernt') : notice('warn', 'Dieser Server war nicht hinterlegt')], ephemeral: true});
        break;
      }

      case 'list': {
        const servers = await listJellyfinServers();
        const lines = servers.map(server => `• **${server.name}** – ${server.base} (Key \`…${server.apiKey.slice(-4)}\`)`);
        await interaction.reply({
          embeds: [new EmbedBuilder().setTitle(`Jellyfin-Server (${servers.length})`).setColor('Purple').setDescription(lines.join('\n') || '–')],
          ephemeral: true,
        });
        break;
      }

      default:
        throw new Error('unbekannter Unterbefehl');
    }
  }
}
