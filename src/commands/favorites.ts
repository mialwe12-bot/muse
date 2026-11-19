import {SlashCommandBuilder} from '@discordjs/builders';
import {APIEmbedField, AutocompleteInteraction, ChatInputCommandInteraction} from 'discord.js';
import {inject, injectable} from 'inversify';
import Command from './index.js';
import AddQueryToQueue from '../services/add-query-to-queue.js';
import {TYPES} from '../types.js';
import {prisma} from '../utils/db.js';
import {Pagination} from 'pagination.djs';
import {truncate} from '../utils/string.js';
import {notice} from '../utils/embeds.js';

const MAX_NAME_LENGTH = 100;

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('favorites')
    .setDescription('Suchbegriffe oder Links als Favoriten für diesen Server speichern')
    .addSubcommand(subcommand => subcommand
      .setName('use')
      .setDescription('einen gespeicherten Favoriten abspielen')
      .addStringOption(option => option
        .setName('name')
        .setDescription('Name des Favoriten')
        .setRequired(true)
        .setAutocomplete(true))
      .addBooleanOption(option => option
        .setName('immediate')
        .setDescription('Song vorne in die Warteschlange einreihen'))
      .addBooleanOption(option => option
        .setName('shuffle')
        .setDescription('bei mehreren Songs die Reihenfolge mischen'))
      .addBooleanOption(option => option
        .setName('split')
        .setDescription('Song mit Kapiteln in einzelne Kapitel aufteilen'))
      .addBooleanOption(option => option
        .setName('skip')
        .setDescription('aktuellen Song überspringen')))
    .addSubcommand(subcommand => subcommand
      .setName('list')
      .setDescription('alle Favoriten anzeigen'))
    .addSubcommand(subcommand => subcommand
      .setName('create')
      .setDescription('einen Suchbegriff oder Link als Favorit speichern')
      .addStringOption(option => option
        .setName('name')
        .setDescription('diesen Namen gibst du beim Abspielen ein')
        .setMinLength(1)
        .setMaxLength(MAX_NAME_LENGTH)
        .setRequired(true))
      .addStringOption(option => option
        .setName('query')
        .setDescription('alles, was du sonst bei /play eingeben würdest')
        .setMinLength(1)
        .setRequired(true),
      ))
    .addSubcommand(subcommand => subcommand
      .setName('remove')
      .setDescription('einen Favoriten löschen')
      .addStringOption(option => option
        .setName('name')
        .setDescription('Name des Favoriten')
        .setAutocomplete(true)
        .setRequired(true),
      ),
    );

  constructor(@inject(TYPES.Services.AddQueryToQueue) private readonly addQueryToQueue: AddQueryToQueue) {
  }

  requiresVC = (interaction: ChatInputCommandInteraction) => interaction.options.getSubcommand() === 'use';

  async execute(interaction: ChatInputCommandInteraction) {
    switch (interaction.options.getSubcommand()) {
      case 'use':
        await this.use(interaction);
        break;
      case 'list':
        await this.list(interaction);
        break;
      case 'create':
        await this.create(interaction);
        break;
      case 'remove':
        await this.remove(interaction);
        break;
      default:
        throw new Error('unbekannter Unterbefehl');
    }
  }

  async handleAutocompleteInteraction(interaction: AutocompleteInteraction) {
    const subcommand = interaction.options.getSubcommand();
    const query = interaction.options.getString('name')!.trim();

    const favorites = await prisma.favoriteQuery.findMany({
      where: {
        guildId: interaction.guild!.id,
      },
    });

    // Legacy names outside the choice limits can still be typed in full.
    let results = favorites.filter(f => f.name.length > 0 && f.name.length <= MAX_NAME_LENGTH
      && f.name.toLowerCase().startsWith(query.toLowerCase()));

    if (subcommand === 'remove') {
      // Only show favorites that user is allowed to remove
      results = interaction.member?.user.id === interaction.guild?.ownerId ? results : results.filter(r => r.authorId === interaction.member!.user.id);
    }

    // Limit results to 25 maximum per Discord limits
    const trimmed = results.length > 25 ? results.slice(0, 25) : results;
    await interaction.respond(trimmed.map(r => ({
      name: r.name,
      value: r.name,
    })));
  }

  private async use(interaction: ChatInputCommandInteraction) {
    const name = interaction.options.getString('name')!.trim();

    const favorite = await prisma.favoriteQuery.findFirst({
      where: {
        name,
        guildId: interaction.guild!.id,
      },
    });

    if (!favorite) {
      throw new Error('es gibt keinen Favoriten mit diesem Namen');
    }

    await this.addQueryToQueue.addToQueue({
      interaction,
      query: favorite.query,
      shuffleAdditions: interaction.options.getBoolean('shuffle') ?? false,
      addToFrontOfQueue: interaction.options.getBoolean('immediate') ?? false,
      shouldSplitChapters: interaction.options.getBoolean('split') ?? false,
      skipCurrentTrack: interaction.options.getBoolean('skip') ?? false,
    });
  }

  private async list(interaction: ChatInputCommandInteraction) {
    const favorites = await prisma.favoriteQuery.findMany({
      where: {
        guildId: interaction.guild!.id,
      },
    });

    if (favorites.length === 0) {
      await interaction.reply({embeds: [notice('info', '⭐ Noch keine Favoriten', 'Lege einen an mit `/favorites create`.')]});
      return;
    }

    const fields = new Array<APIEmbedField>(favorites.length);
    for (let index = 0; index < favorites.length; index++) {
      const favorite = favorites[index];
      const attribution = ` (<@${favorite.authorId}>)`;
      fields[index] = {
        inline: false,
        name: truncate(favorite.name || '(Favorit ohne Namen)', 256),
        value: `${truncate(favorite.query, 1024 - attribution.length)}${attribution}`,
      };
    }

    // Reserve enough room for the paginator's footer even on the last page.
    const footerLength = `Pages: ${favorites.length}/${favorites.length}`.length;
    const largestField = fields.reduce((largest, field) => Math.max(largest, field.name.length + field.value.length), 0);
    const pageSize = Math.min(25, Math.floor((6000 - footerLength) / largestField));

    await new Pagination(
      interaction as ChatInputCommandInteraction<'cached'>,
      {ephemeral: true, limit: pageSize})
      .setFields(fields)
      .paginateFields(true)
      .render();
  }

  private async create(interaction: ChatInputCommandInteraction) {
    const name = interaction.options.getString('name')!.trim();
    const query = interaction.options.getString('query')!.trim();

    if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
      throw new Error(`der Name muss zwischen 1 und ${MAX_NAME_LENGTH} Zeichen lang sein`);
    }

    if (query.length === 0) {
      throw new Error('der Suchbegriff darf nicht leer sein');
    }

    const existingFavorite = await prisma.favoriteQuery.findFirst({where: {
      guildId: interaction.guild!.id,
      name,
    }});

    if (existingFavorite) {
      throw new Error('es gibt schon einen Favoriten mit diesem Namen');
    }

    await prisma.favoriteQuery.create({
      data: {
        authorId: interaction.member!.user.id,
        guildId: interaction.guild!.id,
        name,
        query,
      },
    });

    await interaction.reply({embeds: [notice('success', '⭐ Favorit gespeichert', 'Abspielen mit `/favorites use`.')]});
  }

  private async remove(interaction: ChatInputCommandInteraction) {
    const name = interaction.options.getString('name')!.trim();

    const favorite = await prisma.favoriteQuery.findFirst({where: {
      name,
      guildId: interaction.guild!.id,
    }});

    if (!favorite) {
      throw new Error('es gibt keinen Favoriten mit diesem Namen');
    }

    const isUserGuildOwner = interaction.member!.user.id === interaction.guild!.ownerId;

    if (favorite.authorId !== interaction.member!.user.id && !isUserGuildOwner) {
      throw new Error('du kannst nur deine eigenen Favoriten löschen');
    }

    await prisma.favoriteQuery.delete({where: {id: favorite.id}});

    await interaction.reply({embeds: [notice('success', '🗑️ Favorit gelöscht')]});
  }
}
