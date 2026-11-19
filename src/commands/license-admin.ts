import {ChatInputCommandInteraction} from 'discord.js';
import {injectable} from 'inversify';
import {SlashCommandBuilder} from '@discordjs/builders';
import Command from './index.js';
import {executeLicense} from './license.js';

/**
 * Lizenzverwaltung für den Bot-Besitzer. Wird nur auf Servern registriert,
 * auf denen der Besitzer Mitglied ist, und dort nur Admins angezeigt.
 */
@injectable()
export default class implements Command {
  public readonly ownerOnly = true;

  public readonly slashCommand = new SlashCommandBuilder()
    .setName('license-admin')
    .setDescription('Lizenzen vergeben und verwalten (nur Bot-Besitzer)')
    .setDefaultMemberPermissions(0)
    .setDMPermission(false)
    .addSubcommand(sub => sub
      .setName('give')
      .setDescription('Lizenz an einen Nutzer vergeben (nur Bot-Besitzer)')
      .addUserOption(option => option.setName('user').setDescription('Nutzer').setRequired(true))
      .addIntegerOption(option => option.setName('servers').setDescription('Anzahl Server').setRequired(true).setMinValue(1).setMaxValue(1000))
      .addIntegerOption(option => option.setName('tage').setDescription('gültig für X Tage (leer = unbegrenzt)').setMinValue(1).setMaxValue(36500))
      .addStringOption(option => option.setName('notiz').setDescription('Notiz').setMaxLength(200)))
    .addSubcommand(sub => sub
      .setName('key')
      .setDescription('Lizenzschlüssel erzeugen (nur Bot-Besitzer)')
      .addIntegerOption(option => option.setName('servers').setDescription('Anzahl Server').setRequired(true).setMinValue(1).setMaxValue(1000))
      .addIntegerOption(option => option.setName('tage').setDescription('gültig für X Tage ab Einlösen (leer = unbegrenzt)').setMinValue(1).setMaxValue(36500))
      .addStringOption(option => option.setName('notiz').setDescription('Notiz').setMaxLength(200)))
    .addSubcommand(sub => sub
      .setName('revoke')
      .setDescription('Lizenz entziehen (nur Bot-Besitzer)')
      .addStringOption(option => option.setName('id').setDescription('Lizenz-ID, z. B. L-ABC123'))
      .addUserOption(option => option.setName('user').setDescription('alle Lizenzen dieses Nutzers')))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('alle Lizenzen anzeigen (nur Bot-Besitzer)'))
    .addSubcommand(sub => sub
      .setName('keys')
      .setDescription('offene Lizenzschlüssel anzeigen (nur Bot-Besitzer)'))
    .addSubcommand(sub => sub
      .setName('delete-key')
      .setDescription('Lizenzschlüssel löschen (nur Bot-Besitzer)')
      .addStringOption(option => option.setName('key').setDescription('Lizenzschlüssel').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('extend')
      .setDescription('Lizenz verlängern oder Server-Anzahl ändern (nur Bot-Besitzer)')
      .addStringOption(option => option.setName('id').setDescription('Lizenz-ID, z. B. L-ABC123').setRequired(true))
      .addIntegerOption(option => option.setName('tage').setDescription('so viele Tage verlängern').setMinValue(1).setMaxValue(36500))
      .addIntegerOption(option => option.setName('servers').setDescription('neue Gesamtzahl an Servern').setMinValue(1).setMaxValue(1000))
      .addBooleanOption(option => option.setName('unbegrenzt').setDescription('Ablaufdatum entfernen')));

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await executeLicense(interaction);
  }
}
