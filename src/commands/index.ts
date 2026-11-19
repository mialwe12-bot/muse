import {SlashCommandBuilder, SlashCommandSubcommandsOnlyBuilder} from '@discordjs/builders';
import {AutocompleteInteraction, ButtonInteraction, ChatInputCommandInteraction} from 'discord.js';

export default interface Command {
  readonly slashCommand: Partial<SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder> & Pick<SlashCommandBuilder, 'toJSON'>;
  readonly handledButtonIds?: readonly string[];
  /** Nur für den Bot-Besitzer: nur auf Admin-Servern (utils/admin-guilds.ts) registriert, nur für Admins sichtbar. */
  readonly ownerOnly?: boolean;
  readonly requiresVC?: boolean | ((interaction: ChatInputCommandInteraction) => boolean);
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  handleButtonInteraction?: (interaction: ButtonInteraction) => Promise<void>;
  handleAutocompleteInteraction?: (interaction: AutocompleteInteraction) => Promise<void>;
  setCommands?: (commands: Command[]) => void;
}
