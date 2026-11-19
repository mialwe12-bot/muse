import {ChatInputCommandInteraction, EmbedBuilder} from 'discord.js';
import {injectable} from 'inversify';
import {SlashCommandBuilder} from '@discordjs/builders';
import Command from './index.js';
import {isOwner, notifyOwner} from '../utils/access.js';
import {
  activateGuild, checkAllGuilds, createKey, deactivateGuild, deleteKey, extendLicense, getGuildState, giveLicense,
  isExpired, leaveGuild, licensesOf, listKeys, listLicenses, redeemKey, revokeLicenses, type License,
} from '../utils/licenses.js';
import {truncate} from '../utils/string.js';

const timestamp = (iso: string, style = 'd') => `<t:${Math.floor(new Date(iso).getTime() / 1000)}:${style}>`;
const validity = (license: License) => license.expiresAt === null
  ? 'unbegrenzt'
  : isExpired(license) ? `**abgelaufen** ${timestamp(license.expiresAt)}` : `bis ${timestamp(license.expiresAt)}`;
const daysText = (days: number | null) => days === null ? 'unbegrenzt' : `${days} Tag${days === 1 ? '' : 'e'}`;

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('license')
    .setDescription('Lizenzen für den Bot verwalten')
    // Für alle
    .addSubcommand(sub => sub
      .setName('status')
      .setDescription('Lizenz-Status dieses Servers und deine Lizenzen anzeigen'))
    .addSubcommand(sub => sub
      .setName('activate')
      .setDescription('diesen Server mit deiner Lizenz freischalten'))
    .addSubcommand(sub => sub
      .setName('deactivate')
      .setDescription('Lizenz von diesem Server entfernen (der Bot verlässt ihn dann)'))
    .addSubcommand(sub => sub
      .setName('redeem')
      .setDescription('Lizenzschlüssel einlösen')
      .addStringOption(option => option.setName('key').setDescription('Lizenzschlüssel, z. B. BYTE-ABCD-EFGH-JKLM').setRequired(true)));

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await executeLicense(interaction);
  }
}

/** Gemeinsame Logik für /license (Nutzer) und /license-admin (Bot-Besitzer). */
export const executeLicense = async (interaction: ChatInputCommandInteraction): Promise<void> => {
    const subcommand = interaction.options.getSubcommand();
    const ownerOnly = ['give', 'key', 'revoke', 'list', 'keys', 'delete-key', 'extend'];
    if (ownerOnly.includes(subcommand) && !isOwner(interaction.user.id)) {
      throw new Error('das darf nur der Bot-Besitzer');
    }

    const reply = async (content: string | EmbedBuilder) => interaction.reply({
      ...(typeof content === 'string' ? {content} : {embeds: [content]}),
      ephemeral: true,
      allowedMentions: {parse: []},
    });

    switch (subcommand) {
      case 'status': {
        const state = await getGuildState(interaction.guild!);
        const serverLine = {
          owner: '✅ Dieser Server ist freigeschaltet (Bot-Besitzer ist Mitglied).',
          licensed: state.kind === 'licensed' ? `✅ Dieser Server ist mit der Lizenz von <@${state.activation.userId}> freigeschaltet.` : '',
          grace: state.kind === 'grace' ? `⏳ Dieser Server ist nicht lizenziert. Ich verlasse ihn ${timestamp(state.until.toISOString(), 'R')}, wenn niemand \`/license activate\` ausführt.` : '',
          denied: '⛔ Dieser Server ist nicht lizenziert.',
          blocked: '⛔ Dieser Server ist gesperrt.',
        }[state.kind];

        const own = await licensesOf(interaction.user.id);
        const ownLines = own.length === 0
          ? 'Du hast keine Lizenz.'
          : own.map(license => `\`${license.id}\`: ${license.used.length}/${license.maxServers} Server, ${validity(license)}${license.used.length > 0 ? `\n  ${license.used.map(activation => activation.guildName).join(', ')}` : ''}`).join('\n');
        await reply(new EmbedBuilder().setTitle('Lizenz-Status').setColor('Blurple')
          .setDescription(truncate(`${serverLine}\n\n**Deine Lizenzen**\n${ownLines}`, 4096)));
        break;
      }

      case 'activate': {
        const state = await getGuildState(interaction.guild!);
        if (state.kind === 'owner') {
          await reply('Nicht nötig: der Bot-Besitzer ist auf diesem Server, hier ist der Bot sowieso freigeschaltet.');
          return;
        }

        const result = await activateGuild(interaction.guild!, interaction.user.id);
        if (!result.ok) {
          throw new Error(result.reason);
        }

        await reply(`✅ Server freigeschaltet mit Lizenz \`${result.license.id}\`.`);
        break;
      }

      case 'deactivate': {
        const state = await getGuildState(interaction.guild!);
        if (state.kind !== 'licensed') {
          throw new Error('dieser Server ist nicht mit einer Lizenz aktiviert');
        }

        if (state.activation.userId !== interaction.user.id && !isOwner(interaction.user.id)) {
          throw new Error('nur der Lizenz-Inhaber kann die Lizenz von diesem Server entfernen');
        }

        await deactivateGuild(interaction.guild!.id);
        await reply('Lizenz entfernt, der Platz ist wieder frei. Ich verlasse diesen Server jetzt. 👋');
        await leaveGuild(interaction.guild!, 'Lizenz deaktiviert');
        break;
      }

      case 'redeem': {
        const license = await redeemKey(interaction.options.getString('key', true), interaction.user.id);
        if (!license) {
          throw new Error('ungültiger oder schon eingelöster Schlüssel');
        }

        let extra = '';
        const state = await getGuildState(interaction.guild!);
        if (state.kind === 'grace' || state.kind === 'denied') {
          const result = await activateGuild(interaction.guild!, interaction.user.id);
          if (result.ok) {
            extra = '\nDieser Server wurde direkt damit freigeschaltet.';
          }
        }

        await notifyOwner(interaction.client, `🔑 <@${interaction.user.id}> (${interaction.user.tag}) hat einen Schlüssel eingelöst: Lizenz \`${license.id}\`, ${license.maxServers} Server, ${license.expiresAt ? `bis <t:${Math.floor(new Date(license.expiresAt).getTime() / 1000)}:d>` : 'unbegrenzt'}${extra ? `, Server **${interaction.guild!.name}** freigeschaltet` : ''}.`);
        await reply(`🎉 Lizenz \`${license.id}\` eingelöst: ${license.maxServers} Server, ${validity(license)}.${extra}\nWeitere Server schaltest du dort mit \`/license activate\` frei.`);
        break;
      }

      case 'give': {
        const user = interaction.options.getUser('user', true);
        if (user.bot) {
          throw new Error('Bots können keine Lizenz bekommen');
        }

        const license = await giveLicense(
          user.id,
          interaction.options.getInteger('servers', true),
          interaction.options.getInteger('tage'),
          interaction.options.getString('notiz')?.trim() ?? '',
        );
        await reply(`✅ Lizenz \`${license.id}\` für <@${user.id}>: ${license.maxServers} Server, ${validity(license)}.\nDie Person kann ihre Server jetzt mit \`/license activate\` freischalten.`);
        break;
      }

      case 'key': {
        const key = await createKey(
          interaction.options.getInteger('servers', true),
          interaction.options.getInteger('tage'),
          interaction.options.getString('notiz')?.trim() ?? '',
        );
        await reply(`🔑 Neuer Schlüssel für ${key.maxServers} Server (${daysText(key.days)} ab Einlösen):\n\`\`\`\n${key.key}\n\`\`\`Einlösen mit \`/license redeem key:${key.key}\``);
        break;
      }

      case 'revoke': {
        const licenseId = interaction.options.getString('id') ?? undefined;
        const user = interaction.options.getUser('user') ?? undefined;
        if (!licenseId && !user) {
          throw new Error('gib eine Lizenz-ID oder einen Nutzer an');
        }

        const revoked = await revokeLicenses({licenseId, userId: user?.id});
        if (revoked.length === 0) {
          throw new Error('keine passende Lizenz gefunden');
        }

        await reply(`🗑️ ${revoked.length} Lizenz${revoked.length === 1 ? '' : 'en'} entzogen: ${revoked.map(license => `\`${license.id}\``).join(', ')}. Server ohne gültige Lizenz verlasse ich jetzt.`);
        await checkAllGuilds(interaction.client);
        break;
      }

      case 'list': {
        const licenses = await listLicenses();
        if (licenses.length === 0) {
          await reply('Es gibt noch keine Lizenzen.');
          return;
        }

        const lines = licenses.map(license => {
          const servers = license.used.length > 0 ? `\n  ${license.used.map(activation => activation.guildName).join(', ')}` : '';
          return `\`${license.id}\` <@${license.userId}>: ${license.used.length}/${license.maxServers} Server, ${validity(license)}${license.source === 'key' ? ', per Schlüssel' : ''}${license.note ? ` – ${license.note}` : ''}${servers}`;
        });
        await reply(new EmbedBuilder().setTitle(`Lizenzen (${licenses.length})`).setColor('Blurple').setDescription(truncate(lines.join('\n'), 4096)));
        break;
      }

      case 'keys': {
        const keys = await listKeys();
        if (keys.length === 0) {
          await reply('Es gibt keine offenen Schlüssel.');
          return;
        }

        const lines = keys.map(key => `\`${key.key}\`: ${key.maxServers} Server, ${daysText(key.days)}, erstellt ${timestamp(key.createdAt)}${key.note ? ` – ${key.note}` : ''}`);
        await reply(new EmbedBuilder().setTitle(`Offene Schlüssel (${keys.length})`).setColor('Blurple').setDescription(truncate(lines.join('\n'), 4096)));
        break;
      }

      case 'delete-key': {
        if (!await deleteKey(interaction.options.getString('key', true))) {
          throw new Error('diesen Schlüssel gibt es nicht (oder er wurde schon eingelöst)');
        }

        await reply('🗑️ Schlüssel gelöscht.');
        break;
      }

      case 'extend': {
        const days = interaction.options.getInteger('tage');
        const servers = interaction.options.getInteger('servers');
        const unlimited = interaction.options.getBoolean('unbegrenzt');
        if (!days && !servers && !unlimited) {
          throw new Error('gib tage, servers oder unbegrenzt an');
        }

        const result = await extendLicense(interaction.options.getString('id', true), {days, servers, unlimited});
        if (!result) {
          throw new Error('diese Lizenz gibt es nicht');
        }

        const {license, dropped} = result;
        const droppedText = dropped.length > 0 ? `
Zu viele Server aktiv, entfernt (Bot verlässt sie): ${dropped.map(activation => activation.guildName).join(', ')}` : '';
        await reply(`✅ Lizenz \`${license.id}\` von <@${license.userId}>: ${license.maxServers} Server, ${validity(license)}.${droppedText}`);
        if (dropped.length > 0) {
          await checkAllGuilds(interaction.client);
        }

        break;
      }

      default:
        throw new Error('unbekannter Unterbefehl');
    }
};
