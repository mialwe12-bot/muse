import {Client} from 'discord.js';
import {REST} from '@discordjs/rest';
import container from '../inversify.config.js';
import {TYPES} from '../types.js';
import type Command from '../commands/index.js';
import type Config from '../services/config.js';
import registerCommandsOnGuild from './register-commands-on-guild.js';
import {isAdminGuild} from './admin-guilds.js';

/** Registers the slash commands of one server; admin commands only on admin servers. */
const syncGuildCommands = async (guildId: string): Promise<void> => {
  const config = container.get<Config>(TYPES.Config);
  if (config.REGISTER_COMMANDS_ON_BOT) {
    return;
  }

  const client = container.get<Client>(TYPES.Client);
  const adminHere = await isAdminGuild(guildId);
  await registerCommandsOnGuild({
    rest: new REST({version: '10'}).setToken(config.DISCORD_TOKEN),
    applicationId: client.user!.id,
    guildId,
    commands: container.getAll<Command>(TYPES.Command)
      .filter(command => adminHere || !command.ownerOnly)
      .map(command => command.slashCommand),
  });
};

export default syncGuildCommands;
