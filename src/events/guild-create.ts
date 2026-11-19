import {Client, Guild} from 'discord.js';
import container from '../inversify.config.js';
import Command from '../commands/index.js';
import {TYPES} from '../types.js';
import Config from '../services/config.js';
import {prisma} from '../utils/db.js';
import {REST} from '@discordjs/rest';
import {Setting} from '@prisma/client';
import registerCommandsOnGuild from '../utils/register-commands-on-guild.js';
import {leaveIfOwnerAbsent} from '../utils/access.js';

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
  // Nur auf Servern bleiben, auf denen der Bot-Besitzer Mitglied ist.
  if (await leaveIfOwnerAbsent(guild, true)) {
    return;
  }

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
  await owner.send('👋 Hi! Jemand (wahrscheinlich du) hat mich gerade auf einen deiner Server eingeladen. Standardmäßig können mich alle Mitglieder in allen Kanälen benutzen. Wie du das einschränkst, steht hier: https://github.com/museofficial/muse/wiki/Configuring-Bot-Permissions');
};
