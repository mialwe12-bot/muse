import {ChatInputCommandInteraction, EmbedBuilder} from 'discord.js';
import {injectable} from 'inversify';
import {SlashCommandBuilder} from '@discordjs/builders';
import Command from './index.js';
import {addToBlacklist, getBlacklist, isOwner, removeFromBlacklist} from '../utils/access.js';
import {truncate} from '../utils/string.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Nutzer für den Bot sperren (nur Bot-Besitzer)')
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
      .setDescription('Sperre aufheben')
      .addUserOption(option => option
        .setName('user')
        .setDescription('Nutzer, der entsperrt wird')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('list')
      .setDescription('alle gesperrten Nutzer anzeigen'));

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!isOwner(interaction.user.id)) {
      throw new Error('die Blacklist kann nur der Bot-Besitzer verwalten');
    }

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
        await interaction.reply({
          content: added ? `⛔ <@${user.id}> ist jetzt gesperrt.` : `<@${user.id}> ist schon gesperrt.`,
          ephemeral: true,
          allowedMentions: {parse: []},
        });
        break;
      }

      case 'remove': {
        const user = interaction.options.getUser('user', true);
        const removed = await removeFromBlacklist(user.id);
        await interaction.reply({
          content: removed ? `✅ Sperre für <@${user.id}> aufgehoben.` : `<@${user.id}> war nicht gesperrt.`,
          ephemeral: true,
          allowedMentions: {parse: []},
        });
        break;
      }

      case 'list': {
        const entries = await getBlacklist();
        if (entries.length === 0) {
          await interaction.reply({content: 'Die Blacklist ist leer.', ephemeral: true});
          return;
        }

        const lines = entries.map(entry => {
          const since = `<t:${Math.floor(new Date(entry.addedAt).getTime() / 1000)}:d>`;
          return `• <@${entry.userId}> (\`${entry.userId}\`) seit ${since}${entry.reason ? ` – ${entry.reason}` : ''}`;
        });
        const embed = new EmbedBuilder()
          .setTitle(`Blacklist (${entries.length})`)
          .setColor('DarkRed')
          .setDescription(truncate(lines.join('\n'), 4096));
        await interaction.reply({embeds: [embed], ephemeral: true, allowedMentions: {parse: []}});
        break;
      }

      default:
        throw new Error('unbekannter Unterbefehl');
    }
  }
}
