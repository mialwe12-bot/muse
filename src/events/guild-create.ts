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

  const config = container.get<Config>(TYPES.Config);

  // Setup slash commands
  if (!config.REGISTER_COMMANDS_ON_BOT) {
    const client = container.get<Client>(TYPES.Client);

    const rest = new REST({version: '10'}).setToken(config.DISCORD_TOKEN);

    await registerCommandsOnGuild({
      rest,
      applicationId: client.user!.id,
      guildId: guild.id,
      commands: container.getAll<Command>(TYPES.Command).map(command => command.slashCommand),
    });
  }

  const owner = await guild.fetchOwner();
  if (state.kind === 'grace') {
    await owner.send(`👋 Hi! Ich wurde gerade auf deinen Server **${guild.name}** eingeladen. Der Server ist aber nicht lizenziert. Wer eine Lizenz hat, kann ihn dort mit \`/license activate\` (oder einen Schlüssel mit \`/license redeem\`) freischalten. Sonst verlasse ich den Server <t:${Math.floor(state.until.getTime() / 1000)}:R>.`).catch(() => undefined);
    return;
  }

  await owner.send(`👋 Hi! Jemand (wahrscheinlich du) hat mich gerade auf einen deiner Server eingeladen${state.kind === 'licensed' ? ' – er wurde automatisch mit deiner Lizenz freigeschaltet' : ''}. Ich bin **ByteMusic**, dein Musik-Bot – leg los mit \`/play\` und schau dir mit \`/help\` alle Befehle an. Standardmäßig können mich alle Mitglieder in allen Kanälen benutzen. Einschränken kannst du das unter Servereinstellungen → Integrationen → ByteMusic.`).catch(() => undefined);
};
