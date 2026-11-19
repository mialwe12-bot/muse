import {ChatInputCommandInteraction, EmbedBuilder} from 'discord.js';
import {injectable} from 'inversify';
import {SlashCommandBuilder} from '@discordjs/builders';
import Command from './index.js';
import {
  addGuildToBlacklist, addToBlacklist, getBlacklist, getGuildBlacklist, isOwner, removeFromBlacklist, removeGuildFromBlacklist,
} from '../utils/access.js';
import {leaveIfNotAllowed} from '../utils/licenses.js';
import {truncate} from '../utils/string.js';

const since = (iso: string) => `<t:${Math.floor(new Date(iso).getTime() / 1000)}:d>`;

@injectable()
export default class implements Command {
  public readonly ownerOnly = true;

  public readonly slashCommand = new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Nutzer oder Server für den Bot sperren (nur Bot-Besitzer)')
    .setDefaultMemberPermissions(0)
    .setDMPermission(false)
    .addSubcommand(subcommand => subcommand
      .setName('add')
      .setDescription('Nutzer sperren')
      .addUserOption(option => option
        .setName('user')
        .setDescription('Nutzer, der gesperrt wird')
        .setRequired(true))
      .addStringOption(option => option
        .setName('grund')
        .setDescription('Grund (optional)')
        .setMaxLength(200)))
    .addSubcommand(subcommand => subcommand
      .setName('remove')
      .setDescription('Sperre eines Nutzers aufheben')
      .addUserOption(option => option
        .setName('user')
        .setDescription('Nutzer, der entsperrt wird')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('server-add')
      .setDescription('Server sperren (der Bot verlässt ihn und kommt nicht wieder)')
      .addStringOption(option => option
        .setName('id')
        .setDescription('Server-ID (leer = dieser Server)')
        .setMinLength(17)
        .setMaxLength(20))
      .addStringOption(option => option
        .setName('grund')
        .setDescription('Grund (optional)')
        .setMaxLength(200)))
    .addSubcommand(subcommand => subcommand
      .setName('server-remove')
      .setDescription('Sperre eines Servers aufheben')
      .addStringOption(option => option
        .setName('id')
        .setDescription('Server-ID')
        .setRequired(true)
        .setMinLength(17)
        .setMaxLength(20)))
    .addSubcommand(subcommand => subcommand
      .setName('list')
      .setDescription('alle gesperrten Nutzer und Server anzeigen'));

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!isOwner(interaction.user.id)) {
      throw new Error('die Blacklist kann nur der Bot-Besitzer verwalten');
    }

    const reply = async (content: string | EmbedBuilder) => interaction.reply({
      ...(typeof content === 'string' ? {content} : {embeds: [content]}),
      ephemeral: true,
      allowedMentions: {parse: []},
    });

    switch (interaction.options.getSubcommand()) {
      case 'add': {
        const user = interaction.options.getUser('user', true);
        if (isOwner(user.id)) {
          throw new Error('dich selbst kannst du nicht sperren');
        }

        if (user.id === interaction.client.user.id) {
          throw new Error('den Bot selbst kann man nicht sperren');
        }

        const reason = interaction.options.getString('grund')?.trim() ?? '';
        const added = await addToBlacklist(user.id, reason);
        await reply(added ? `⛔ <@${user.id}> ist jetzt gesperrt.` : `<@${user.id}> ist schon gesperrt.`);
        break;
      }

      case 'remove': {
        const user = interaction.options.getUser('user', true);
        const removed = await removeFromBlacklist(user.id);
        await reply(removed ? `✅ Sperre für <@${user.id}> aufgehoben.` : `<@${user.id}> war nicht gesperrt.`);
        break;
      }

      case 'server-add': {
        const guildId = interaction.options.getString('id')?.trim() ?? interaction.guildId!;
        if (!/^\d{17,20}$/.test(guildId)) {
          throw new Error('ungültige Server-ID');
        }

        const guild = interaction.client.guilds.cache.get(guildId);
        const name = guild?.name ?? 'unbekannter Server';
        const reason = interaction.options.getString('grund')?.trim() ?? '';
        const added = await addGuildToBlacklist(guildId, name, reason);
        if (!added) {
          await reply(`Der Server **${name}** (\`${guildId}\`) ist schon gesperrt.`);
          return;
        }

        await reply(`⛔ Server **${name}** (\`${guildId}\`) ist jetzt gesperrt.${guild ? ' Ich verlasse ihn jetzt.' : ''}`);
        if (guild) {
          await leaveIfNotAllowed(guild);
        }

        break;
      }

      case 'server-remove': {
        const guildId = interaction.options.getString('id', true).trim();
        const removed = await removeGuildFromBlacklist(guildId);
        await reply(removed ? `✅ Sperre für Server \`${guildId}\` aufgehoben. Der Bot kann wieder eingeladen werden.` : `Server \`${guildId}\` war nicht gesperrt.`);
        break;
      }

      case 'list': {
        const [users, guilds] = await Promise.all([getBlacklist(), getGuildBlacklist()]);
        if (users.length === 0 && guilds.length === 0) {
          await reply('Die Blacklist ist leer.');
          return;
        }

        const userLines = users.map(entry => `• <@${entry.userId}> (\`${entry.userId}\`) seit ${since(entry.addedAt)}${entry.reason ? ` – ${entry.reason}` : ''}`);
        const guildLines = guilds.map(entry => `• **${entry.name}** (\`${entry.guildId}\`) seit ${since(entry.addedAt)}${entry.reason ? ` – ${entry.reason}` : ''}`);
        const description = [
          `**Nutzer (${users.length})**`,
          ...(userLines.length > 0 ? userLines : ['–']),
          '',
          `**Server (${guilds.length})**`,
          ...(guildLines.length > 0 ? guildLines : ['–']),
        ].join('\n');
        await reply(new EmbedBuilder().setTitle('Blacklist').setColor('DarkRed').setDescription(truncate(description, 4096)));
        break;
      }

      default:
        throw new Error('unbekannter Unterbefehl');
    }
  }
}
