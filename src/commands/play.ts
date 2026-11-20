import {AutocompleteInteraction, ChatInputCommandInteraction} from 'discord.js';
import {URL} from 'url';
import {SlashCommandBuilder} from '@discordjs/builders';
import {inject, injectable, optional} from 'inversify';
import Spotify from 'spotify-web-api-node';
import Command from './index.js';
import {TYPES} from '../types.js';
import ThirdParty from '../services/third-party.js';
import getYouTubeAndSpotifySuggestionsFor, {SpotifySuggestionsUnavailableError} from '../utils/get-youtube-and-spotify-suggestions-for.js';
import KeyValueCacheProvider from '../services/key-value-cache.js';
import {ONE_HOUR_IN_SECONDS} from '../utils/constants.js';
import AddQueryToQueue from '../services/add-query-to-queue.js';
import {truncate} from '../utils/string.js';
import {prisma} from '../utils/db.js';
import PlayerManager from '../managers/player.js';
import {MediaSource} from '../services/player-types.js';

@injectable()
export default class implements Command {
  public readonly slashCommand: Command['slashCommand'];

  public requiresVC = true;

  private readonly spotify?: Spotify;
  private readonly cache: KeyValueCacheProvider;
  private readonly addQueryToQueue: AddQueryToQueue;

  constructor(@inject(TYPES.ThirdParty) @optional() thirdParty: ThirdParty, @inject(TYPES.KeyValueCache) cache: KeyValueCacheProvider, @inject(TYPES.Services.AddQueryToQueue) addQueryToQueue: AddQueryToQueue,
    @inject(TYPES.Managers.Player) private readonly playerManager: PlayerManager) {
    this.spotify = thirdParty?.spotify;
    this.cache = cache;
    this.addQueryToQueue = addQueryToQueue;

    const queryDescription = thirdParty === undefined
      ? 'YouTube-Link oder Suchbegriff'
      : 'YouTube-Link, Spotify-Link oder Suchbegriff';

    this.slashCommand = new SlashCommandBuilder()
      .setName('play')
      .setDescription('einen Song abspielen')
      .addStringOption(option => option
        .setName('query')
        .setDescription(queryDescription)
        .setAutocomplete(true)
        .setRequired(true))
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
        .setDescription('aktuellen Song überspringen'));
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const query = interaction.options.getString('query')!;

    await this.addQueryToQueue.addToQueue({
      interaction,
      query: query.trim(),
      addToFrontOfQueue: interaction.options.getBoolean('immediate') ?? false,
      shuffleAdditions: interaction.options.getBoolean('shuffle') ?? false,
      shouldSplitChapters: interaction.options.getBoolean('split') ?? false,
      skipCurrentTrack: interaction.options.getBoolean('skip') ?? false,
    });
  }

  public async handleAutocompleteInteraction(interaction: AutocompleteInteraction): Promise<void> {
    const query = interaction.options.getString('query')?.trim();

    if (!query || query.length === 0) {
      await interaction.respond([]);
      return;
    }

    let queryProtocol: string | undefined;
    try {
      queryProtocol = new URL(query).protocol;
    } catch {}

    // Don't return suggestions for supported provider URLs
    if (queryProtocol && ['http:', 'https:', 'spotify:'].includes(queryProtocol)) {
      await interaction.respond([]);
      return;
    }

    let suggestions;

    try {
      suggestions = await this.cache.wrap(
        getYouTubeAndSpotifySuggestionsFor,
        query,
        this.spotify,
        10,
        {
          expiresIn: ONE_HOUR_IN_SECONDS,
          key: `autocomplete:${query}`,
        });
    } catch (error: unknown) {
      if (error instanceof SpotifySuggestionsUnavailableError) {
        suggestions = error.suggestions;
      } else {
        throw error;
      }
    }

    // Eigene Favoriten und zuletzt gespielte Songs dieses Servers zuerst.
    const local = await this.localSuggestions(interaction.guildId, query).catch(() => []);
    suggestions = [...local, ...suggestions.map(choice => ({...choice, name: choice.name.replace(/^YouTube: /, '🔎 ')}))];

    // Normalize after reading the cache or fallback so old results obey Discord's limits too.
    const choices = suggestions
      .filter(({name, value}) => name.length > 0 && (typeof value !== 'string' || value.length <= 100))
      .slice(0, 25)
      .map(choice => ({...choice, name: truncate(choice.name, 100)}));

    await interaction.respond(choices);
  }

  private async localSuggestions(guildId: string | null, query: string): Promise<Array<{name: string; value: string}>> {
    if (!guildId) {
      return [];
    }

    const needle = query.toLowerCase();
    const favorites = (await prisma.favoriteQuery.findMany({where: {guildId}}))
      .filter(favorite => favorite.name.toLowerCase().includes(needle) || favorite.query.toLowerCase().includes(needle))
      .slice(0, 3)
      .filter(favorite => favorite.query.length <= 100)
      .map(favorite => ({name: `⭐ ${favorite.name}`, value: favorite.query}));

    const seen = new Set<string>();
    const player = this.playerManager.getExisting(guildId);
    const recent = [...(player?.getHistory() ?? [])].reverse()
      .filter(song => song.source === MediaSource.Youtube && /^[\w-]{11}$/.test(song.url))
      .filter(song => `${song.title} ${song.artist}`.toLowerCase().includes(needle))
      .filter(song => !seen.has(song.url) && Boolean(seen.add(song.url)))
      .slice(0, 3)
      .map(song => ({name: `🕘 ${song.title}`, value: `https://youtu.be/${song.url}`}));

    return [...favorites, ...recent];
  }
}
