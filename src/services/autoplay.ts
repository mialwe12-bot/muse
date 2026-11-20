import {execa} from 'execa';
import getYouTubeID from 'get-youtube-id';
import {ChannelType, type Client, type Guild, type VoiceChannel} from 'discord.js';
import type Player from './player.js';
import {MediaSource, STATUS, type QueuedSong, type SongMetadata} from './player-types.js';
import {getExecutable, isDeferredSearch, resolveDeferredSearch, DEFERRED_SEARCH_PREFIX} from '../utils/yt-dlp.js';
import {getGuildExtras} from '../utils/guild-extras.js';
import {getSizeWithoutBots} from '../utils/channels.js';
import debug from '../utils/debug.js';

/*
 * Autoplay und Radio: Wenn die Warteschlange leer ist, holt der Bot einen
 * ähnlichen Song aus dem YouTube-„Mix“ des zuletzt gespielten Songs
 * (https://www.youtube.com/watch?v=<id>&list=RD<id>). Läuft über yt-dlp,
 * verbraucht also kein YouTube-API-Kontingent.
 */

const EXTRACT_TIMEOUT_MS = 45_000;
const MAX_TRACK_SECONDS = 20 * 60;
const RECENT_LIMIT = 100;

type FlatEntry = {
  id?: string;
  title?: string;
  duration?: number | null;
  channel?: string | null;
  uploader?: string | null;
  live_status?: string | null;
};

/** Pro Server die zuletzt gespielten/vorgeschlagenen YouTube-IDs, damit nichts doppelt kommt. */
const recentIds = new Map<string, string[]>();
/** Vorrat an Vorschlägen pro Server, damit nicht für jeden Song yt-dlp läuft. */
const pool = new Map<string, {seedId: string; songs: SongMetadata[]}>();

const remember = (guildId: string, id: string) => {
  const list = recentIds.get(guildId) ?? [];
  list.push(id);
  recentIds.set(guildId, list.slice(-RECENT_LIMIT));
};

const flatPlaylist = async (url: string, limit: number): Promise<FlatEntry[]> => {
  const {stdout} = await execa(getExecutable(), [
    '--flat-playlist', '--dump-single-json', '--skip-download', '--no-warnings', '--no-cache-dir',
    '--playlist-end', String(limit), url,
  ], {timeout: EXTRACT_TIMEOUT_MS});
  const data = JSON.parse(stdout) as FlatEntry & {entries?: FlatEntry[]};
  return data.entries ?? (data.id ? [data] : []);
};

const toSong = (entry: FlatEntry): SongMetadata | null => {
  if (!entry.id || !/^[\w-]{11}$/.test(entry.id) || !entry.title) {
    return null;
  }

  const length = Number(entry.duration ?? 0);
  if (entry.live_status === 'is_live' || !Number.isFinite(length) || length <= 0 || length > MAX_TRACK_SECONDS) {
    return null;
  }

  return {
    title: entry.title,
    artist: (entry.channel ?? entry.uploader ?? '').replace(/ - Topic$/, '') || 'YouTube',
    url: entry.id,
    length,
    offset: 0,
    playlist: null,
    isLive: false,
    thumbnailUrl: `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`,
    source: MediaSource.Youtube,
  };
};

/** YouTube-ID eines Songs, notfalls über eine Suche nach „Interpret – Titel“. */
const youtubeIdOf = async (song: Pick<SongMetadata, 'url' | 'source' | 'title' | 'artist'>): Promise<string | null> => {
  if (song.source === MediaSource.Youtube) {
    if (/^[\w-]{11}$/.test(song.url)) {
      return song.url;
    }

    if (isDeferredSearch(song.url)) {
      return resolveDeferredSearch(song.url);
    }

    return getYouTubeID(song.url);
  }

  const query = `${song.artist} - ${song.title}`.trim();
  return resolveDeferredSearch(`${DEFERRED_SEARCH_PREFIX}${query}`);
};

/** Startpunkt aus einem Suchbegriff oder Link (Radio ohne vorherigen Song). */
const youtubeIdFromSeed = async (seed: string): Promise<string | null> => {
  const trimmed = seed.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    const direct = getYouTubeID(trimmed);
    if (direct) {
      return direct;
    }

    const entries = await flatPlaylist(trimmed, 50);
    const ids = entries.map(entry => entry.id).filter((id): id is string => Boolean(id && /^[\w-]{11}$/.test(id)));
    return ids.length > 0 ? ids[Math.floor(Math.random() * ids.length)] : null;
  }

  return resolveDeferredSearch(`${DEFERRED_SEARCH_PREFIX}${trimmed}`);
};

const nextFromSeed = async (guildId: string, seedId: string, exclude: Set<string>): Promise<SongMetadata | null> => {
  let cached = pool.get(guildId);
  if (!cached || cached.seedId !== seedId) {
    const entries = await flatPlaylist(`https://www.youtube.com/watch?v=${seedId}&list=RD${seedId}`, 30);
    cached = {seedId, songs: entries.map(toSong).filter((song): song is SongMetadata => song !== null)};
    pool.set(guildId, cached);
  }

  const index = cached.songs.findIndex(song => !exclude.has(song.url));
  if (index === -1) {
    return null;
  }

  const [song] = cached.songs.splice(index, 1);
  return song;
};

/**
 * Nächster Autoplay-Song für einen Player. `fallbackSeed` wird benutzt, wenn
 * noch kein Song gespielt wurde (Radio-Startpunkt).
 */
export const findAutoplaySong = async (player: Player, fallbackSeed?: string): Promise<SongMetadata | null> => {
  const history = player.getHistory();
  const exclude = new Set([...(recentIds.get(player.guildId) ?? []), ...history.map(song => song.url)]);

  // Vom letzten Song aus suchen; klappt das nicht, vom vorletzten usw.
  const candidates = [...history].reverse().slice(0, 3);
  for (const song of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const seedId = await youtubeIdOf(song);
      if (!seedId) {
        continue;
      }

      exclude.add(seedId);
      // eslint-disable-next-line no-await-in-loop
      const next = await nextFromSeed(player.guildId, seedId, exclude);
      if (next) {
        remember(player.guildId, next.url);
        return next;
      }
    } catch (error: unknown) {
      debug(`Autoplay-Suche fehlgeschlagen (${player.guildId}): ${String((error as Error).message ?? error)}`);
    }
  }

  if (fallbackSeed) {
    try {
      const seedId = await youtubeIdFromSeed(fallbackSeed);
      if (seedId) {
        // Beim Start vom Startpunkt selbst beginnen, danach aus seinem Mix.
        if (!exclude.has(seedId)) {
          const [entry] = await flatPlaylist(`https://www.youtube.com/watch?v=${seedId}`, 1);
          const song = entry ? toSong(entry) : null;
          if (song) {
            remember(player.guildId, song.url);
            return song;
          }
        }

        const next = await nextFromSeed(player.guildId, seedId, exclude);
        if (next) {
          remember(player.guildId, next.url);
          return next;
        }
      }
    } catch (error: unknown) {
      debug(`Radio-Startpunkt fehlgeschlagen (${player.guildId}): ${String((error as Error).message ?? error)}`);
    }
  }

  return null;
};

/** Ist der Bot gerade im Radio-Kanal des Servers? */
export const isInRadioChannel = async (player: Player): Promise<boolean> => {
  const channelId = player.getVoiceChannelId();
  if (!channelId) {
    return false;
  }

  const {radioChannelId} = await getGuildExtras(player.guildId);
  return radioChannelId === channelId;
};

let botUserId: string | undefined;
export const setAutoplayClient = (client: Client) => {
  botUserId = client.user?.id;
};

/** Wird vom Player aufgerufen, wenn die Warteschlange zu Ende ist. */
export const queueEndHandler = async (player: Player): Promise<QueuedSong | null> => {
  const extras = await getGuildExtras(player.guildId);
  const radio = Boolean(extras.radioChannelId && extras.radioChannelId === player.getVoiceChannelId());
  if (!extras.autoplay && !radio) {
    return null;
  }

  const song = await findAutoplaySong(player, radio ? extras.radioSeed : undefined);
  if (!song) {
    return null;
  }

  const last = player.getHistory().at(-1);
  return {
    ...song,
    addedInChannelId: last?.addedInChannelId ?? player.getVoiceChannelId() ?? '',
    requestedBy: botUserId ?? last?.requestedBy ?? '',
  };
};

/**
 * Alle Zuhörer sind gegangen: in den Radio-Kanal wechseln und dort
 * weiterspielen. Gibt false zurück, wenn kein Radio eingerichtet ist.
 */
export const switchToRadio = async (player: Player, guild: Guild): Promise<boolean> => {
  const {radioChannelId, radioSeed} = await getGuildExtras(guild.id);
  if (!radioChannelId) {
    return false;
  }

  const channel = guild.channels.cache.get(radioChannelId);
  if (!channel || channel.type !== ChannelType.GuildVoice || !channel.joinable) {
    return false;
  }

  if (player.getVoiceChannelId() === radioChannelId) {
    return true;
  }

  if (player.voiceConnection) {
    await player.moveTo(channel);
  } else {
    await player.connect(channel);
  }

  await startRadioPlayback(player, channel, radioSeed);
  return true;
};

/** Läuft nichts, wird der nächste Autoplay-Song geholt und gestartet. */
export const startRadioPlayback = async (player: Player, channel: VoiceChannel, seed?: string): Promise<void> => {
  if (player.getCurrent()) {
    if (player.status !== STATUS.PLAYING) {
      await player.play();
    }

    return;
  }

  const song = await findAutoplaySong(player, seed);
  if (!song) {
    console.warn(`Radio in ${channel.guild.id}: kein Song gefunden.`);
    return;
  }

  if (player.getCurrent()) {
    // Während der Suche hat jemand etwas hinzugefügt.
    return;
  }

  const last = player.getHistory().at(-1);
  player.add({
    ...song,
    addedInChannelId: last?.addedInChannelId ?? channel.id,
    requestedBy: botUserId ?? last?.requestedBy ?? '',
  });
  await player.play();
};

export const humansIn = (channel: VoiceChannel) => getSizeWithoutBots(channel);
