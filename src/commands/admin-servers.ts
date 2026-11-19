import {ChatInputCommandInteraction, EmbedBuilder} from 'discord.js';
import {injectable} from 'inversify';
import {SlashCommandBuilder} from '@discordjs/builders';
import Command from './index.js';
import {isOwner} from '../utils/access.js';
import {addAdminGuild, listAdminGuilds, removeAdminGuild} from '../utils/admin-guilds.js';
import syncGuildCommands from '../utils/sync-guild-commands.js';

@injectable()
export default class implements Command {
  public readonly ownerOnly = true;

  public readonly slashCommand = new SlashCommandBuilder()
    .setName('admin-servers')
    .setDescription('Server verwalten, auf denen die Admin-Befehle verfügbar sind (nur Bot-Besitzer)')
    .setDefaultMemberPermissions(0)
    .setDMPermission(false)
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Admin-Befehle auf einem Server freischalten')
      .addStringOption(option => option.setName('id').setDescription('Server-ID').setRequired(true).setMinLength(17).setMaxLength(20)))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Admin-Befehle von einem Server entfernen')
      .addStringOption(option => option.setName('id').setDescription('Server-ID (leer = dieser Server)').setMinLength(17).setMaxLength(20)))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('alle Server mit Admin-Befehlen anzeigen'));

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!isOwner(interaction.user.id)) {
      throw new Error('das darf nur der Bot-Besitzer');
    }

    const reply = async (content: string | EmbedBuilder) => interaction.reply({
      ...(typeof content === 'string' ? {content} : {embeds: [content]}),
      ephemeral: true,
      allowedMentions: {parse: []},
    });

    switch (interaction.options.getSubcommand()) {
      case 'add': {
        const guildId = interaction.options.getString('id', true).trim();
        if (!/^\d{17,20}$/.test(guildId)) {
          throw new Error('ungültige Server-ID');
        }

        const guild = interaction.client.guilds.cache.get(guildId);
        const name = guild?.name ?? 'unbekannter Server';
        if (!await addAdminGuild(guildId, name)) {
          await reply(`**${name}** (\`${guildId}\`) hat die Admin-Befehle schon.`);
          return;
        }

        if (guild) {
          await syncGuildCommands(guildId);
        }

        await reply(`✅ Admin-Befehle auf **${name}** (\`${guildId}\`) freigeschaltet.${guild ? '' : ' Der Bot ist dort noch nicht; sobald er beitritt, sind sie da.'}`);
        break;
      }

      case 'remove': {
        const guildId = interaction.options.getString('id')?.trim() ?? interaction.guildId!;
        if (!await removeAdminGuild(guildId)) {
          throw new Error(`Server \`${guildId}\` hat keine Admin-Befehle`);
        }

        // Antwort zuerst: entfernt man die Befehle vom aktuellen Server, verschwindet dieser Befehl.
        await reply(`🗑️ Admin-Befehle von Server \`${guildId}\` entfernt.`);
        if (interaction.client.guilds.cache.has(guildId)) {
          await syncGuildCommands(guildId);
        }

        break;
      }

      case 'list': {
        const guilds = await listAdminGuilds();
        const lines = guilds.map(entry => {
          const live = interaction.client.guilds.cache.get(entry.guildId);
          return `• **${live?.name ?? entry.name}** (\`${entry.guildId}\`)${live ? '' : ' – Bot ist nicht auf dem Server'}`;
        });
        await reply(new EmbedBuilder().setTitle(`Server mit Admin-Befehlen (${guilds.length})`).setColor('Blurple')
          .setDescription(lines.join('\n') || '–'));
        break;
      }

      default:
        throw new Error('unbekannter Unterbefehl');
    }
  }
}
