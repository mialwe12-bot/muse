import {Client, Guild} from 'discord.js';
import container from '../inversify.config.js';
import Command from '../commands/index.js';
import {TYPES} from '../types.js';
import Config from '../services/config.js';
import {prisma} from '../utils/db.js';
import {REST} from '@discordjs/rest';
import {Setting} from '@prisma/client';
import registerCommandsOnGuild from '../utils/register-commands-on-guild.js';
import {admitNewGuild, leaveIfNotAllowed} from '../utils/licenses.js';
import {notifyOwner} from '../utils/access.js';
import {isAdminGuild} from '../utils/admin-guilds.js';
import {dmEmbed} from '../utils/embeds.js';

export async function createGuildSettings(guildId: string): Promise<Setting> {
  return prisma.setting.upsert({
    where: {
      guildId,
    },
    create: {
      guildId,
    },
    update: {},
  });
}

export default async (guild: Guild): Promise<void> => {
  // Besitzer-Server, lizenziert (ggf. automatisch über die Lizenz des
  // Server-Besitzers) oder Frist zum Aktivieren.
  const state = await admitNewGuild(guild);
  if (state.kind === 'blocked') {
    await leaveIfNotAllowed(guild);
    return;
  }

  const stateText = {
    owner: 'du bist dort Mitglied',
    licensed: state.kind === 'licensed' ? `automatisch freigeschaltet mit Lizenz \`${state.activation.licenseId}\` von <@${state.activation.userId}>` : '',
    grace: 'nicht lizenziert, 15 Minuten Frist zum Aktivieren',
    denied: '',
  }[state.kind];
  await notifyOwner(guild.client, `➕ Ich wurde auf den Server **${guild.name}** (\`${guild.id}\`, ${guild.memberCount} Mitglieder) eingeladen: ${stateText}.`);

  await createGuildSettings(guild.id);
  const adminHere = await isAdminGuild(guild.id);

  const config = container.get<Config>(TYPES.Config);

  // Setup slash commands
  if (!config.REGISTER_COMMANDS_ON_BOT) {
    const client = container.get<Client>(TYPES.Client);

    const rest = new REST({version: '10'}).setToken(config.DISCORD_TOKEN);

    await registerCommandsOnGuild({
      rest,
      applicationId: client.user!.id,
      guildId: guild.id,
      // Admin-Befehle nur auf ByteBot, ByteBeta und per /admin-servers freigegebenen Servern.
      commands: container.getAll<Command>(TYPES.Command)
        .filter(command => adminHere || !command.ownerOnly)
        .map(command => command.slashCommand),
    });
  }

  const owner = await guild.fetchOwner();
  if (state.kind === 'grace') {
    await owner.send({embeds: [dmEmbed('warn', `Ich wurde gerade auf deinen Server **${guild.name}** eingeladen, aber der Server ist nicht lizenziert.

Wer eine Lizenz hat, schaltet ihn dort mit \`/license activate\` frei (oder löst einen Schlüssel mit \`/license redeem\` ein). Sonst verlasse ich den Server <t:${Math.floor(state.until.getTime() / 1000)}:R>.`, '👋 Hi! Lizenz benötigt')]}).catch(() => undefined);
    return;
  }

  await owner.send({embeds: [dmEmbed('music', [
    `Jemand (wahrscheinlich du) hat mich gerade auf **${guild.name}** eingeladen${state.kind === 'licensed' ? ', und der Server wurde automatisch mit deiner Lizenz freigeschaltet' : ''}.`,
    '',
    '🎵 Leg los mit `/play` – YouTube, Spotify, SoundCloud und Jellyfin gehen.',
    '📖 Alle Befehle zeigt `/help`.',
    '',
    'Standardmäßig können mich alle Mitglieder in allen Kanälen benutzen. Einschränken kannst du das unter Servereinstellungen → Integrationen → ByteMusic.',
  ].join('\n'), '👋 Hi! Ich bin ByteMusic')]}).catch(() => undefined);
};
