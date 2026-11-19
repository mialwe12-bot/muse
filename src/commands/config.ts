import {SlashCommandBuilder} from '@discordjs/builders';
import {ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits} from 'discord.js';
import {injectable} from 'inversify';
import {prisma} from '../utils/db.js';
import Command from './index.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';
import {notice} from '../utils/embeds.js';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('config')
    .setDescription('Bot-Einstellungen ändern')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
    .addSubcommand(subcommand => subcommand
      .setName('set-playlist-limit')
      .setDescription('maximale Anzahl an Songs, die aus einer Playlist hinzugefügt werden')
      .addIntegerOption(option => option
        .setName('limit')
        .setDescription('maximale Anzahl an Songs')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-wait-after-queue-empties')
      .setDescription('Sekunden bis zum Verlassen, wenn die Warteschlange leer ist (0 = nie verlassen)')
      .addIntegerOption(option => option
        .setName('delay')
        .setDescription('Wartezeit in Sekunden (0 = nie verlassen)')
        .setRequired(true)
        .setMinValue(0)))
    .addSubcommand(subcommand => subcommand
      .setName('set-leave-if-no-listeners')
      .setDescription('festlegen, ob der Bot geht, wenn alle anderen gegangen sind')
      .addBooleanOption(option => option
        .setName('value')
        .setDescription('gehen, wenn alle anderen gegangen sind?')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-reduce-vol-when-voice')
      .setDescription('festlegen, ob die Lautstärke gesenkt wird, wenn jemand spricht')
      .addBooleanOption(option => option
        .setName('value')
        .setDescription('Lautstärke senken, wenn jemand spricht?')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-reduce-vol-when-voice-target')
      .setDescription('Ziel-Lautstärke, wenn jemand spricht')
      .addIntegerOption(option => option
        .setName('volume')
        .setDescription('Lautstärke in Prozent (0 = stumm, 100 = maximal & Standard)')
        .setMinValue(0)
        .setMaxValue(100)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-auto-announce-next-song')
      .setDescription('festlegen, ob der nächste Song automatisch angekündigt wird')
      .addBooleanOption(option => option
        .setName('value')
        .setDescription('nächsten Song automatisch ankündigen?')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-default-volume')
      .setDescription('Standard-Lautstärke beim Betreten des Sprachkanals')
      .addIntegerOption(option => option
        .setName('level')
        .setDescription('Lautstärke in Prozent (0 = stumm, 100 = maximal & Standard)')
        .setMinValue(0)
        .setMaxValue(100)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-default-queue-page-size')
      .setDescription('Standard-Seitengröße von /queue')
      .addIntegerOption(option => option
        .setName('page-size')
        .setDescription('Seitengröße von /queue')
        .setMinValue(1)
        .setMaxValue(30)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('get')
      .setDescription('alle Einstellungen anzeigen'));

  async execute(interaction: ChatInputCommandInteraction) {
    // Ensure guild settings exist before trying to update
    await getGuildSettings(interaction.guild!.id);

    switch (interaction.options.getSubcommand()) {
      case 'set-playlist-limit': {
        const limit: number = interaction.options.getInteger('limit')!;

        if (limit < 1) {
          throw new Error('ungültiges Limit');
        }

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            playlistLimit: limit,
          },
        });

        await interaction.reply({embeds: [notice('success', '⚙️ Einstellung gespeichert', '**Playlist-Limit** wurde geändert. Alle Einstellungen siehst du mit `/config get`.')]});

        break;
      }

      case 'set-wait-after-queue-empties': {
        const delay = interaction.options.getInteger('delay')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            secondsToWaitAfterQueueEmpties: delay,
          },
        });

        await interaction.reply({embeds: [notice('success', '⚙️ Einstellung gespeichert', '**Wartezeit** wurde geändert. Alle Einstellungen siehst du mit `/config get`.')]});

        break;
      }

      case 'set-leave-if-no-listeners': {
        const value = interaction.options.getBoolean('value')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            leaveIfNoListeners: value,
          },
        });

        await interaction.reply({embeds: [notice('success', '⚙️ Einstellung gespeichert', '**Verlassen ohne Zuhörer** wurde geändert. Alle Einstellungen siehst du mit `/config get`.')]});

        break;
      }

      case 'set-auto-announce-next-song': {
        const value = interaction.options.getBoolean('value')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            autoAnnounceNextSong: value,
          },
        });

        await interaction.reply({embeds: [notice('success', '⚙️ Einstellung gespeichert', '**Ankündigungen** wurde geändert. Alle Einstellungen siehst du mit `/config get`.')]});

        break;
      }

      case 'set-default-volume': {
        const value = interaction.options.getInteger('level')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            defaultVolume: value,
          },
        });

        await interaction.reply({embeds: [notice('success', '⚙️ Einstellung gespeichert', '**Standard-Lautstärke** wurde geändert. Alle Einstellungen siehst du mit `/config get`.')]});

        break;
      }

      case 'set-default-queue-page-size': {
        const value = interaction.options.getInteger('page-size')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            defaultQueuePageSize: value,
          },
        });

        await interaction.reply({embeds: [notice('success', '⚙️ Einstellung gespeichert', '**Seitengröße der Warteschlange** wurde geändert. Alle Einstellungen siehst du mit `/config get`.')]});

        break;
      }

      case 'set-reduce-vol-when-voice': {
        const value = interaction.options.getBoolean('value')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            turnDownVolumeWhenPeopleSpeak: value,
          },
        });

        await interaction.reply({embeds: [notice('success', '⚙️ Einstellung gespeichert', '**Absenken bei Sprache** wurde geändert. Alle Einstellungen siehst du mit `/config get`.')]});

        break;
      }

      case 'set-reduce-vol-when-voice-target': {
        const value = interaction.options.getInteger('volume')!;

        await prisma.setting.update({
          where: {
            guildId: interaction.guild!.id,
          },
          data: {
            turnDownVolumeWhenPeopleSpeakTarget: value,
          },
        });

        await interaction.reply({embeds: [notice('success', '⚙️ Einstellung gespeichert', '**Ziel-Lautstärke beim Absenken** wurde geändert. Alle Einstellungen siehst du mit `/config get`.')]});

        break;
      }

      case 'get': {
        const embed = new EmbedBuilder().setTitle('Einstellungen');

        const config = await getGuildSettings(interaction.guild!.id);

        const settingsToShow = {
          'Playlist-Limit': config.playlistLimit,
          'Wartezeit vor dem Verlassen bei leerer Warteschlange': config.secondsToWaitAfterQueueEmpties === 0
            ? 'nie verlassen'
            : `${config.secondsToWaitAfterQueueEmpties}s`,
          'Verlassen, wenn niemand mehr zuhört': config.leaveIfNoListeners ? 'ja' : 'nein',
          'Nächsten Song automatisch ankündigen': config.autoAnnounceNextSong ? 'ja' : 'nein',
          'Standard-Lautstärke': config.defaultVolume,
          'Standard-Seitengröße der Warteschlange': config.defaultQueuePageSize,
          'Lautstärke senken, wenn jemand spricht': config.turnDownVolumeWhenPeopleSpeak ? 'ja' : 'nein',
          'Ziel-Lautstärke beim Absenken': config.turnDownVolumeWhenPeopleSpeakTarget,
        };

        let description = '';
        for (const [key, value] of Object.entries(settingsToShow)) {
          description += `**${key}**: ${value}\n`;
        }

        embed.setDescription(description);

        await interaction.reply({embeds: [embed]});

        break;
      }

      default:
        throw new Error('unbekannter Unterbefehl');
    }
  }
}
